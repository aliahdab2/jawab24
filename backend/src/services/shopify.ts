/**
 * Shopify-specific e-commerce service.
 *
 * Platform-agnostic functions (store CRUD, KB enrichment, cache invalidation,
 * product summary, pending installs) live in ./ecommerce.ts. This file only
 * contains Shopify OAuth, GraphQL API helpers, product sync, and policy sync.
 *
 * Re-exports from ecommerce.ts are provided for backward compatibility so
 * existing imports from 'services/shopify' continue to work.
 */
import crypto from 'crypto';
import { tracedExternalCall } from '../utils/tracing';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';
import { stripHtml } from '../utils/htmlUtils';
import { REQUEST_TIMEOUT_MS } from '../utils/httpRetry';

// Re-export shared functions for backward compat
export {
    getStoreById,
    getEnrichedKnowledgeBase,
    invalidateCachesForStore,
    getProducts,
    mapToEcommerceStore,
    buildProductSummary,
    disconnectStore,
    linkStoreToPage,
    unlinkStoreFromPage,
    KB_MAX_CHARS,
    getAllActiveStores,
} from './ecommerce';

// Re-export with Shopify-default platform binding for backward compat
import {
    getStoreById,
    getStoreByDomain as _getStoreByDomain,
    getStoreByWorkspace as _getStoreByWorkspace,
    getStoreByUserId as _getStoreByUserId,
    createStore as _createStore,
    deactivateStore as _deactivateStore,
    createPendingInstall as _createPendingInstall,
    claimPendingInstall as _claimPendingInstall,
    cleanupExpiredInstalls as _cleanupExpiredInstalls,
    replaceProductsAndRebuildSummary,
    invalidateCachesForStore,
    getStoreByWorkspaceAny as _getStoreByWorkspaceAny,
    applySyncedStoreInfo,
    PRODUCT_SAFETY_CAP,
} from './ecommerce';

// Shopify supports each API version for ~12 months from its quarterly release. Bump this
// to a currently-supported version well before it sunsets — the sunset guard in
// test/services/shopifyApiVersion.test.ts fails locally ~60 days before expiry.
export const SHOPIFY_API_VERSION = '2026-04';
const MAX_PRODUCTS_PER_PAGE = 50;
// Page enough to reach the shared safety cap (loop also early-exits at the cap).
const MAX_PAGES_TO_FETCH = Math.ceil(PRODUCT_SAFETY_CAP / MAX_PRODUCTS_PER_PAGE);
const ERROR_TEXT_MAX_LENGTH = 200;
const POLICY_PREVIEW_LENGTH = 100;
const GRAPHQL_STRING_MAX_LENGTH = 100;

// --- OAuth ---

export function buildAuthUrl(shop: string, state: string): string {
    const { apiKey, scopes } = config.shopify;
    const redirectUri = `https://${config.shopify.hostName}/shopify/auth/callback`;
    return `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
    const response = await tracedExternalCall('shopify', 'exchangeCodeForToken', () =>
        fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: config.shopify.apiKey,
                client_secret: config.shopify.apiSecret,
                code,
            }),
        }),
    );

    if (!response.ok) {
        throw new Error(`Shopify token exchange failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
}

export function verifyWebhookHmac(body: string, hmacHeader: string): boolean {
    const hash = crypto
        .createHmac('sha256', config.shopify.apiSecret)
        .update(body, 'utf8')
        .digest('base64');
    const hashBuf = Buffer.from(hash);
    const hmacBuf = Buffer.from(hmacHeader);
    if (hashBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, hmacBuf);
}

export type { WebhookRegistrationResult as WebhookStatus } from './ecommerce';
import type { WebhookRegistrationResult } from './ecommerce';

export async function registerWebhooks(shop: string, accessToken: string): Promise<WebhookRegistrationResult> {
    const webhookUrl = `https://${config.shopify.hostName}/shopify/webhooks`;
    const topics = [
        { topic: 'app/uninstalled', address: `${webhookUrl}/uninstall` },
        { topic: 'products/create', address: `${webhookUrl}/products-update` },
        { topic: 'products/update', address: `${webhookUrl}/products-update` },
        { topic: 'products/delete', address: `${webhookUrl}/products-update` },
        // Order lifecycle — for customer notifications
        { topic: 'orders/create', address: `${webhookUrl}/orders` },
        { topic: 'orders/fulfilled', address: `${webhookUrl}/orders` },
        { topic: 'orders/cancelled', address: `${webhookUrl}/orders` },
        // Delivery — order-level fulfillment_status never becomes 'delivered'; the delivered
        // signal is fulfillment.shipment_status, delivered via the fulfillments/update topic.
        { topic: 'fulfillments/update', address: `${webhookUrl}/fulfillments` },
    ];

    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];

    // Topics subscribed in parallel — each is an independent REST call.
    const results = await Promise.allSettled(topics.map(({ topic, address }) =>
        tracedExternalCall('shopify', 'registerWebhook', () =>
            fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
            }).then(async response => ({ topic, response, body: response.ok ? '' : await response.text() })),
        ),
    ));

    for (let i = 0; i < results.length; i++) {
        const { topic } = topics[i];
        const result = results[i];
        if (result.status === 'rejected') {
            const err = result.reason;
            failed.push({ topic, error: err instanceof Error ? err.message : String(err) });
            captureError(err, `Shopify webhook registration error: ${topic}`, { tags: { service: 'shopify' } });
            continue;
        }
        const { response, body } = result.value;
        if (response.ok) {
            registered.push(topic);
        } else if (response.status === 422) {
            // 422 = already registered, treat as success
            registered.push(topic);
        } else {
            failed.push({ topic, status: response.status, error: body.slice(0, ERROR_TEXT_MAX_LENGTH) });
            captureError(
                new Error(`Shopify webhook registration failed: ${topic} ${response.status}`),
                `Shopify webhook registration failed: ${topic}`,
                { tags: { service: 'shopify' }, extra: { topic, status: response.status, body } },
            );
        }
    }

    return { registered, failed, lastAttempt: new Date().toISOString() };
}

import { saveWebhookStatus } from './ecommerce';

// --- Shopify-default wrappers (bind platform='shopify' for backward compat) ---

export function getStoreByDomain(storeDomain: string) {
    return _getStoreByDomain('shopify', storeDomain);
}

export function getStoreByWorkspace(workspaceId: string) {
    return _getStoreByWorkspace('shopify', workspaceId);
}

/** Returns the store for this workspace regardless of isActive — used by integrations page to show Reconnect card */
export function getStoreByWorkspaceAny(workspaceId: string) {
    return _getStoreByWorkspaceAny('shopify', workspaceId);
}

/** @deprecated Use getStoreByWorkspace */
export function getStoreByUserId(userId: string) {
    return _getStoreByUserId('shopify', userId);
}

export function createStore(userId: string, storeDomain: string, accessToken: string, shopInfo?: {
    shopName?: string; shopEmail?: string; shopCurrency?: string; shopTimezone?: string;
}, workspaceId?: string | null) {
    return _createStore({
        userId,
        platform: 'shopify',
        storeDomain,
        accessToken,
        shopInfo: shopInfo ? {
            shopName: shopInfo.shopName,
            shopEmail: shopInfo.shopEmail,
            shopCurrency: shopInfo.shopCurrency,
            shopTimezone: shopInfo.shopTimezone,
        } : undefined,
        workspaceId,
    });
}

export function deactivateStore(storeDomain: string) {
    return _deactivateStore('shopify', storeDomain);
}

export function createPendingInstall(data: {
    shopDomain: string;
    accessToken: string;
    scopes: string;
    nonce: string;
}): Promise<string> {
    return _createPendingInstall('shopify', {
        storeDomain: data.shopDomain,
        accessToken: data.accessToken,
        scopes: data.scopes,
        nonce: data.nonce,
    });
}

export function claimPendingInstall(pendingId: string, userId: string) {
    return _claimPendingInstall(pendingId, userId, 'shopify', registerWebhooks, saveWebhookStatus);
}

export function cleanupExpiredInstalls(): Promise<number> {
    return _cleanupExpiredInstalls('shopify');
}

// --- Shopify Admin API helpers ---

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function shopifyGraphQL<T = unknown>(shop: string, accessToken: string, query: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await tracedExternalCall('shopify', 'graphql', () =>
            fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({ query }),
                // Without a timeout a hung Shopify connection stalls the caller
                // indefinitely (audit 2026-07-09); a timed-out attempt throws and
                // surfaces to the caller like any network error.
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }),
        );

        if (response.status === 429 || response.status >= 500) {
            const retryAfter = response.headers.get('retry-after');
            const delayMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

            if (attempt < MAX_RETRIES) {
                await sleep(delayMs);
                continue;
            }
            lastError = new Error(`Shopify API ${response.status} after ${MAX_RETRIES} retries`);
            break;
        }

        if (!response.ok) {
            throw new Error(`Shopify GraphQL HTTP error: ${response.status}`);
        }

        const result = await response.json() as T & {
            errors?: Array<{ message: string; extensions?: { code?: string } }>;
            extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
        };

        // Cost-based throttling: Shopify returns HTTP 200 with a THROTTLED error, NOT 429.
        // Back off (using the returned throttle status when present) and retry the whole call.
        if (result.errors?.some(e => e.extensions?.code === 'THROTTLED')) {
            if (attempt < MAX_RETRIES) {
                const cost = result.extensions?.cost;
                const deficit = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
                const restoreRate = cost?.throttleStatus?.restoreRate;
                const delayMs = deficit > 0 && restoreRate && restoreRate > 0
                    ? Math.ceil(deficit / restoreRate) * 1000 + 250
                    : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                await sleep(delayMs);
                continue;
            }
            lastError = new Error(`Shopify GraphQL THROTTLED after ${MAX_RETRIES} retries`);
            break;
        }

        if (result.errors && result.errors.length > 0) {
            throw new Error(`Shopify GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
        }

        return result;
    }

    throw lastError || new Error('Shopify API request failed');
}

async function fetchShopInfo(shop: string, accessToken: string) {
    const data = await shopifyGraphQL<{
        data: { shop: { name: string; email: string; currencyCode: string; timezoneAbbreviation: string; plan: { publicDisplayName: string } } }
    }>(shop, accessToken, `{
        shop {
            name
            email
            currencyCode
            timezoneAbbreviation
            plan { publicDisplayName }
        }
    }`);

    const s = data.data.shop;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currencyCode,
        storeTimezone: s.timezoneAbbreviation,
        platformData: { planName: s.plan?.publicDisplayName ?? null },
    };
}

// --- Product Sync ---

interface ShopifyGQLProduct {
    id: string;
    handle: string;
    title: string;
    description: string;
    productType: string;
    vendor: string;
    status: string;
    tags: string[];
    totalInventory: number;
    hasOnlyDefaultVariant: boolean;
    featuredImage?: { url: string } | null;
    priceRangeV2: {
        minVariantPrice: { amount: string; currencyCode: string };
        maxVariantPrice: { amount: string; currencyCode: string };
    };
    variants: {
        edges: Array<{
            node: {
                title: string;
                selectedOptions: Array<{ name: string; value: string }>;
            };
        }>;
    };
}

interface ProductsPageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}

interface ProductsQueryResult {
    data: {
        products: {
            edges: Array<{ node: ShopifyGQLProduct; cursor: string }>;
            pageInfo: ProductsPageInfo;
        }
    }
}

async function fetchAllProducts(shop: string, accessToken: string): Promise<ShopifyGQLProduct[]> {
    const allProducts: ShopifyGQLProduct[] = [];
    let cursor: string | null = null;
    let pagesCount = 0;

    while (pagesCount < MAX_PAGES_TO_FETCH) {
        const afterArg: string = cursor ? `, after: "${cursor}"` : '';
        const query = `{
            products(first: ${MAX_PRODUCTS_PER_PAGE}${afterArg}, query: "status:active") {
                edges {
                    node {
                        id
                        handle
                        title
                        description
                        productType
                        vendor
                        status
                        tags
                        totalInventory
                        hasOnlyDefaultVariant
                        featuredImage { url }
                        priceRangeV2 {
                            minVariantPrice { amount currencyCode }
                            maxVariantPrice { amount currencyCode }
                        }
                        variants(first: 20) {
                            edges {
                                node {
                                    title
                                    selectedOptions { name value }
                                }
                            }
                        }
                    }
                    cursor
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }`;
        const data: ProductsQueryResult = await shopifyGraphQL<ProductsQueryResult>(shop, accessToken, query);

        const edges = data.data.products.edges;
        allProducts.push(...edges.map((e: { node: ShopifyGQLProduct }) => e.node));

        // Stop once we've reached the shared safety cap — the DB layer would truncate
        // beyond it anyway (replaceProductsAndRebuildSummary), so don't keep paginating.
        if (allProducts.length >= PRODUCT_SAFETY_CAP) break;
        if (!data.data.products.pageInfo.hasNextPage) break;
        cursor = data.data.products.pageInfo.endCursor;
        pagesCount++;
    }

    return allProducts;
}

/**
 * Resolve store + decrypted access token for a given storeId.
 * Throws a descriptive error if the store is missing or token data is corrupted.
 */
function resolveStoreToken(store: Awaited<ReturnType<typeof getStoreById>>): string {
    if (!store) throw new Error('Store not found');
    if (!store.accessToken || !store.accessTokenIv) {
        throw new Error(`Store ${store.id} has missing token data — re-connect the store`);
    }
    return decrypt(store.accessToken, store.accessTokenIv);
}

/**
 * Sync all active products from Shopify store.
 * Accepts optional pre-resolved credentials to avoid redundant DB/decrypt calls
 * when called from fullSync.
 */
export async function syncProducts(storeId: string, opts?: { storeDomain: string; accessToken: string }) {
    let storeDomain: string;
    let accessToken: string;

    if (opts) {
        storeDomain = opts.storeDomain;
        accessToken = opts.accessToken;
    } else {
        const store = await getStoreById(storeId);
        accessToken = resolveStoreToken(store);
        storeDomain = store?.storeDomain ?? '';
    }

    const products = await fetchAllProducts(storeDomain, accessToken);

    const mapped = products.map(p => {
        const minPrice = parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? '0');
        const maxPrice = parseFloat(p.priceRangeV2?.maxVariantPrice?.amount ?? '0');
        const currency = p.priceRangeV2?.minVariantPrice?.currencyCode ?? '';
        const priceRange = minPrice === maxPrice
            ? `${minPrice} ${currency}`
            : `${minPrice} - ${maxPrice} ${currency}`;
        const variantSummary = buildVariantSummary(
            (p.variants?.edges ?? []).map(e => e.node)
        );

        return {
            platformProductId: p.id.replace('gid://shopify/Product/', ''),
            handle: p.handle,
            title: p.title,
            description: p.description || null,
            productType: p.productType || null,
            vendor: p.vendor || null,
            status: p.status.toLowerCase(),
            priceRange,
            currency,
            totalInventory: p.totalInventory,
            hasVariants: !p.hasOnlyDefaultVariant,
            variantSummary: variantSummary || null,
            tags: Array.isArray(p.tags) ? (p.tags.join(', ') || null) : null,
            imageUrl: p.featuredImage?.url || null,
        };
    });

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

/**
 * Shopify product webhook payload (REST shape — different from GraphQL).
 * Only fields we read are typed; unknown fields are tolerated.
 */
interface ShopifyWebhookProduct {
    id: number | string;
    title?: string;
    body_html?: string | null;
    vendor?: string;
    product_type?: string;
    handle?: string;
    status?: string;
    tags?: string;
    image?: { src?: string } | null;
    images?: Array<{ src?: string }>;
    variants?: Array<{
        title?: string;
        price?: string;
        inventory_quantity?: number;
        option1?: string | null;
        option2?: string | null;
        option3?: string | null;
    }>;
    options?: Array<{ name: string; values: string[] }>;
}

/**
 * Convert a Shopify webhook product payload into the shape `upsertSingleProduct`
 * expects. Used by the products/create and products/update webhook handlers.
 */
export function mapShopifyWebhookProduct(payload: ShopifyWebhookProduct): {
    platformProductId: string;
    handle: string | null;
    title: string;
    description: string | null;
    productType: string | null;
    vendor: string | null;
    status: string;
    priceRange: string;
    currency: string;
    totalInventory: number;
    hasVariants: boolean;
    variantSummary: string | null;
    tags: string | null;
    imageUrl: string | null;
} {
    const variants = payload.variants ?? [];
    const prices = variants
        .map(v => parseFloat(v.price ?? '0'))
        .filter(n => !Number.isNaN(n));
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    // REST webhook payload doesn't include shop currency — caller's store
    // currency is the source of truth, but for the per-product cache we leave
    // it empty and let the next full sync repair (every 6h).
    const currency = '';
    const priceRange = minPrice === maxPrice
        ? `${minPrice}`
        : `${minPrice} - ${maxPrice}`;

    const totalInventory = variants.reduce(
        (sum, v) => sum + (typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 0),
        0,
    );
    const hasVariants = variants.length > 1;

    const variantSummary = buildVariantSummary(
        variants.map(v => ({
            title: v.title ?? '',
            selectedOptions: (payload.options ?? []).map((opt, idx) => {
                const value = (idx === 0 ? v.option1 : idx === 1 ? v.option2 : v.option3) ?? '';
                return { name: opt.name, value };
            }),
        })),
    );

    const imageUrl = payload.image?.src ?? payload.images?.[0]?.src ?? null;

    return {
        platformProductId: String(payload.id),
        handle: payload.handle ?? null,
        title: payload.title ?? '',
        description: payload.body_html?.replace(/<[^>]+>/g, '').trim() || null,
        productType: payload.product_type || null,
        vendor: payload.vendor || null,
        status: (payload.status ?? 'active').toLowerCase(),
        priceRange,
        currency,
        totalInventory,
        hasVariants,
        variantSummary: variantSummary || null,
        tags: payload.tags && payload.tags.trim() ? payload.tags : null,
        imageUrl,
    };
}

const MAX_VARIANT_SUMMARY_LENGTH = 200;

export function buildVariantSummary(variants: Array<{ title: string; selectedOptions: Array<{ name: string; value: string }> }>): string {
    const optionGroups: Record<string, Set<string>> = {};

    for (const v of variants) {
        if (!v.selectedOptions) continue;
        for (const opt of v.selectedOptions) {
            if (opt.name === 'Title' && opt.value === 'Default Title') continue;
            if (!optionGroups[opt.name]) optionGroups[opt.name] = new Set();
            optionGroups[opt.name].add(opt.value);
        }
    }

    const parts = Object.entries(optionGroups).map(
        ([name, values]) => `${name}: ${[...values].join(', ')}`
    );

    const summary = parts.join(' | ');
    if (summary.length > MAX_VARIANT_SUMMARY_LENGTH) {
        return summary.slice(0, MAX_VARIANT_SUMMARY_LENGTH - 3) + '...';
    }
    return summary;
}


/**
 * Sync store policies (shipping, returns, etc.)
 * Accepts optional pre-resolved credentials to avoid redundant DB/decrypt calls.
 */
export async function syncPolicies(storeId: string, opts?: { storeDomain: string; accessToken: string }) {
    let storeDomain: string;
    let accessToken: string;

    if (opts) {
        storeDomain = opts.storeDomain;
        accessToken = opts.accessToken;
    } else {
        const store = await getStoreById(storeId);
        accessToken = resolveStoreToken(store);
        storeDomain = store?.storeDomain ?? '';
    }

    const data = await shopifyGraphQL<{
        data: { shop: { shippingPolicy: { body: string } | null; refundPolicy: { body: string } | null } }
    }>(storeDomain, accessToken, `{
        shop {
            shippingPolicy { body }
            refundPolicy { body }
        }
    }`);

    const policies: string[] = [];
    if (data.data.shop.shippingPolicy?.body) {
        const text = stripHtml(data.data.shop.shippingPolicy.body);
        policies.push(`Shipping: ${text.slice(0, POLICY_PREVIEW_LENGTH)}`);
    }
    if (data.data.shop.refundPolicy?.body) {
        const text = stripHtml(data.data.shop.refundPolicy.body);
        policies.push(`Returns: ${text.slice(0, POLICY_PREVIEW_LENGTH)}`);
    }

    const policiesSummary = policies.join('\n') || null;

    await db.update(ecommerceStores).set({
        policiesSummary,
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

    await invalidateCachesForStore(storeId);

    return { policiesSummary };
}

/**
 * Full sync: products + policies + shop info.
 * Fetches store + decrypts token ONCE and passes credentials down.
 */
export async function fullSync(storeId: string) {
    const store = await getStoreById(storeId);
    const accessToken = resolveStoreToken(store);
    const storeDomain = store?.storeDomain ?? '';

    // platformData is merged, not replaced — a full sync must not wipe
    // webhookStatus/tokenHealth written by other flows.
    const { platformData: platformDataPatch, ...shopScalars } = await fetchShopInfo(storeDomain, accessToken);
    await applySyncedStoreInfo(storeId, shopScalars, platformDataPatch);

    const creds = { storeDomain, accessToken };
    const [productResult, policyResult] = await Promise.allSettled([
        syncProducts(storeId, creds),
        syncPolicies(storeId, creds),
    ]);

    const result: Record<string, unknown> = {};
    if (productResult.status === 'fulfilled') Object.assign(result, productResult.value);
    if (policyResult.status === 'fulfilled') Object.assign(result, policyResult.value);

    // If product sync failed, propagate that error (it's the critical one)
    if (productResult.status === 'rejected') throw productResult.reason;

    return result;
}

// --- E-Commerce Agent Tools (read-only order/tracking/inventory) ---

import type { OrderInfoFull, ShipmentInfoFull, InventoryInfo } from '@jawab24/shared';

/**
 * Resolve store credentials for a given storeId.
 * Returns storeDomain + decrypted accessToken, or null if store missing/inactive.
 */
async function resolveStoreCredentials(storeId: string): Promise<{ storeDomain: string; accessToken: string } | null> {
    const store = await getStoreById(storeId);
    if (!store || !store.isActive) return null;
    const accessToken = resolveStoreToken(store);
    return { storeDomain: store.storeDomain, accessToken };
}

/**
 * Resolve the customer-notification target (order number + phone + first name) for a
 * Shopify order by its numeric id — used by the fulfillments/update (delivery) webhook,
 * whose payload carries only `order_id` and an unnormalized `destination`. Returns null
 * if the store is inactive or the order can't be fetched (caller falls back to the
 * webhook's own destination fields).
 */
export async function getOrderNotificationTarget(
    storeId: string,
    orderId: string | number,
): Promise<{ orderNumber: string; phone?: string; firstName?: string } | null> {
    const creds = await resolveStoreCredentials(storeId);
    if (!creds) return null;

    // Sanitize to digits — the id is interpolated into the GraphQL global id string.
    const numericId = String(orderId).replace(/[^0-9]/g, '');
    if (!numericId) return null;

    const data = await shopifyGraphQL<{
        data: { order: { name: string; phone: string | null; customer: { firstName: string | null; phone: string | null } | null } | null };
    }>(creds.storeDomain, creds.accessToken, `{
        order(id: "gid://shopify/Order/${numericId}") {
            name
            phone
            customer { firstName phone }
        }
    }`);

    const order = data.data.order;
    if (!order) return null;

    return {
        orderNumber: order.name.replace(/^#/, ''),
        phone: order.customer?.phone || order.phone || undefined,
        firstName: order.customer?.firstName || undefined,
    };
}

/**
 * Look up an order by order number via Shopify GraphQL.
 * Returns normalized OrderInfo or null if not found.
 */
export async function lookupOrder(storeId: string, orderNumber: string): Promise<OrderInfoFull | null> {
    const creds = await resolveStoreCredentials(storeId);
    if (!creds) return null;

    // Shopify order names include '#' prefix (e.g. "#1234")
    const cleanNumber = orderNumber.replace(/^#/, '');

    const data = await shopifyGraphQL<{
        data: {
            orders: {
                edges: Array<{
                    node: {
                        name: string;
                        createdAt: string;
                        displayFinancialStatus: string;
                        displayFulfillmentStatus: string;
                        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
                        lineItems: { edges: Array<{ node: { title: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } } } }> };
                        shippingAddress: { city: string; province: string } | null;
                        customer: { firstName: string; phone: string | null } | null;
                        refunds: Array<{ totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } }>;
                    };
                }>;
            };
        };
    }>(creds.storeDomain, creds.accessToken, `{
        orders(first: 1, query: "name:#${cleanNumber}") {
            edges {
                node {
                    name
                    createdAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                    lineItems(first: 20) {
                        edges {
                            node {
                                title
                                quantity
                                originalUnitPriceSet { shopMoney { amount currencyCode } }
                            }
                        }
                    }
                    shippingAddress { city province }
                    customer { firstName phone }
                    refunds {
                        totalRefundedSet { shopMoney { amount currencyCode } }
                    }
                }
            }
        }
    }`);

    const order = data.data.orders.edges[0]?.node;
    if (!order) return null;

    const totalRefund = order.refunds.reduce(
        (sum, r) => sum + parseFloat(r.totalRefundedSet.shopMoney.amount || '0'), 0,
    );

    return {
        orderNumber: order.name.replace(/^#/, ''),
        customerFirstName: order.customer?.firstName || '',
        customerPhone: order.customer?.phone || undefined,
        status: mapShopifyFulfillmentStatus(order.displayFulfillmentStatus),
        orderDate: order.createdAt,
        items: order.lineItems.edges.map(e => ({
            name: e.node.title,
            quantity: e.node.quantity,
            price: `${e.node.originalUnitPriceSet.shopMoney.amount} ${e.node.originalUnitPriceSet.shopMoney.currencyCode}`,
        })),
        totalAmount: order.totalPriceSet.shopMoney.amount,
        currency: order.totalPriceSet.shopMoney.currencyCode,
        paymentStatus: mapShopifyFinancialStatus(order.displayFinancialStatus),
        refundAmount: totalRefund > 0 ? `${totalRefund} ${order.totalPriceSet.shopMoney.currencyCode}` : undefined,
        shippingCity: order.shippingAddress?.city || undefined,
        shippingDistrict: order.shippingAddress?.province || undefined,
    };
}

/**
 * Get shipment tracking info for an order via Shopify GraphQL.
 * Returns normalized ShipmentInfo or null if not found.
 */
export async function getShipmentTracking(storeId: string, orderNumber: string): Promise<ShipmentInfoFull | null> {
    const creds = await resolveStoreCredentials(storeId);
    if (!creds) return null;

    const cleanNumber = orderNumber.replace(/^#/, '');

    const data = await shopifyGraphQL<{
        data: {
            orders: {
                edges: Array<{
                    node: {
                        name: string;
                        displayFulfillmentStatus: string;
                        shippingAddress: { city: string } | null;
                        customer: { firstName: string; phone: string | null } | null;
                        fulfillments: Array<{
                            status: string;
                            estimatedDeliveryAt: string | null;
                            trackingInfo: Array<{
                                number: string;
                                url: string | null;
                                company: string | null;
                            }>;
                        }>;
                    };
                }>;
            };
        };
    }>(creds.storeDomain, creds.accessToken, `{
        orders(first: 1, query: "name:#${cleanNumber}") {
            edges {
                node {
                    name
                    displayFulfillmentStatus
                    shippingAddress { city }
                    customer { firstName phone }
                    fulfillments(first: 5) {
                        status
                        estimatedDeliveryAt
                        trackingInfo {
                            number
                            url
                            company
                        }
                    }
                }
            }
        }
    }`);

    const order = data.data.orders.edges[0]?.node;
    if (!order) return null;

    const fulfillment = order.fulfillments[0];
    const tracking = fulfillment?.trackingInfo[0];

    return {
        orderNumber: order.name.replace(/^#/, ''),
        customerFirstName: order.customer?.firstName || '',
        customerPhone: order.customer?.phone || undefined,
        status: mapShopifyFulfillmentStatus(order.displayFulfillmentStatus),
        trackingNumber: tracking?.number || undefined,
        courierName: tracking?.company || undefined,
        trackingUrl: tracking?.url || undefined,
        estimatedDelivery: fulfillment?.estimatedDeliveryAt || undefined,
        shippingCity: order.shippingAddress?.city || undefined,
    };
}

/**
 * Check real-time inventory for a product by name search via Shopify GraphQL.
 * Returns normalized InventoryInfo or null if no matching product found.
 */
export async function checkInventory(storeId: string, productName: string, variant?: string): Promise<InventoryInfo | null> {
    const creds = await resolveStoreCredentials(storeId);
    if (!creds) return null;

    const data = await shopifyGraphQL<{
        data: {
            products: {
                edges: Array<{
                    node: {
                        title: string;
                        handle: string;
                        totalInventory: number;
                        priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
                        variants: {
                            edges: Array<{
                                node: {
                                    title: string;
                                    inventoryQuantity: number | null;
                                    selectedOptions: Array<{ name: string; value: string }>;
                                };
                            }>;
                        };
                    };
                }>;
            };
        };
    }>(creds.storeDomain, creds.accessToken, `{
        products(first: 5, query: "title:*${sanitizeGraphQLString(productName)}* status:active") {
            edges {
                node {
                    title
                    handle
                    totalInventory
                    priceRangeV2 { minVariantPrice { amount currencyCode } }
                    variants(first: 30) {
                        edges {
                            node {
                                title
                                inventoryQuantity
                                selectedOptions { name value }
                            }
                        }
                    }
                }
            }
        }
    }`);

    const products = data.data.products.edges.map(e => e.node);
    if (products.length === 0) return null;

    // Find best match by title similarity (case-insensitive contains)
    const lowerQuery = productName.toLowerCase();
    const bestMatch = products.find(p => p.title.toLowerCase().includes(lowerQuery)) || products[0];

    const allVariants = bestMatch.variants.edges.map(e => e.node);

    // If a specific variant was requested, filter to matching variants
    let filteredVariants = allVariants;
    if (variant) {
        const lowerVariant = variant.toLowerCase();
        filteredVariants = allVariants.filter(v =>
            v.title.toLowerCase().includes(lowerVariant) ||
            v.selectedOptions.some(opt => opt.value.toLowerCase().includes(lowerVariant))
        );
    }

    const variantResults = (filteredVariants.length > 0 ? filteredVariants : allVariants).map(v => ({
        name: v.title,
        available: (v.inventoryQuantity ?? 0) > 0,
        quantity: v.inventoryQuantity ?? 0,
    }));

    const totalAvailable = variant
        ? variantResults.reduce((sum, v) => sum + v.quantity, 0)
        : bestMatch.totalInventory;

    return {
        productName: bestMatch.title,
        available: totalAvailable > 0,
        quantity: totalAvailable,
        variants: variantResults.length > 1 || variant ? variantResults : undefined,
        price: `${bestMatch.priceRangeV2.minVariantPrice.amount} ${bestMatch.priceRangeV2.minVariantPrice.currencyCode}`,
        currency: bestMatch.priceRangeV2.minVariantPrice.currencyCode,
        productUrl: bestMatch.handle ? `https://${creds.storeDomain}/products/${bestMatch.handle}` : undefined,
    };
}

// --- Helper functions for status mapping ---

function mapShopifyFulfillmentStatus(status: string): string {
    const map: Record<string, string> = {
        'UNFULFILLED': 'pending',
        'PARTIALLY_FULFILLED': 'partially_shipped',
        'FULFILLED': 'shipped',
        'RESTOCKED': 'cancelled',
        'PENDING_FULFILLMENT': 'pending',
        'OPEN': 'pending',
        'IN_PROGRESS': 'processing',
        'ON_HOLD': 'on_hold',
        'SCHEDULED': 'scheduled',
    };
    return map[status] || status.toLowerCase();
}

function mapShopifyFinancialStatus(status: string): string {
    const map: Record<string, string> = {
        'PENDING': 'pending',
        'AUTHORIZED': 'pending',
        'PARTIALLY_PAID': 'partially_paid',
        'PAID': 'paid',
        'PARTIALLY_REFUNDED': 'partially_refunded',
        'REFUNDED': 'refunded',
        'VOIDED': 'cancelled',
    };
    return map[status] || status.toLowerCase();
}

/** Sanitize user input for use in Shopify GraphQL query strings */
function sanitizeGraphQLString(input: string): string {
    return input.replace(/["\\\n\r]/g, '').slice(0, GRAPHQL_STRING_MAX_LENGTH);
}

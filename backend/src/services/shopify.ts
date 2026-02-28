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
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';

// Re-export shared functions for backward compat
export {
    getStoreById,
    getEnrichedKnowledgeBase,
    invalidateCachesForStore,
    getProducts,
    mapToEcommerceStore,
    mapToShopifyStore,
    buildProductSummary,
    disconnectStore,
    linkStoreToPage,
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
} from './ecommerce';

const SHOPIFY_API_VERSION = '2025-01';
const MAX_PRODUCTS_PER_PAGE = 50;
const MAX_PAGES_TO_FETCH = 5; // 250 products max

// --- OAuth ---

export function buildAuthUrl(shop: string, state: string): string {
    const { apiKey, scopes } = config.shopify;
    const redirectUri = `https://${config.shopify.hostName}/shopify/auth/callback`;
    return `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}

export async function exchangeCodeForToken(shop: string, code: string): Promise<string> {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: config.shopify.apiKey,
            client_secret: config.shopify.apiSecret,
            code,
        }),
    });

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

export async function registerWebhooks(shop: string, accessToken: string): Promise<void> {
    const webhookUrl = `https://${config.shopify.hostName}/shopify/webhooks`;
    const topics = [
        { topic: 'app/uninstalled', address: `${webhookUrl}/uninstall` },
        { topic: 'products/create', address: `${webhookUrl}/products-update` },
        { topic: 'products/update', address: `${webhookUrl}/products-update` },
        { topic: 'products/delete', address: `${webhookUrl}/products-update` },
    ];

    for (const { topic, address } of topics) {
        try {
            const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({
                    webhook: { topic, address, format: 'json' },
                }),
            });
            if (!response.ok) {
                const text = await response.text();
                if (response.status !== 422) {
                    captureError(new Error(`Shopify webhook registration failed: ${topic} ${response.status}`), `Shopify webhook registration failed: ${topic}`, { tags: { service: 'shopify' }, extra: { topic, status: response.status, body: text } });
                }
            }
        } catch (err) {
            captureError(err, `Shopify webhook registration error: ${topic}`, { tags: { service: 'shopify' } });
        }
    }
}

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
    return _claimPendingInstall(pendingId, userId, 'shopify', registerWebhooks);
}

export function cleanupExpiredInstalls(): Promise<number> {
    return _cleanupExpiredInstalls('shopify');
}

// --- Shopify Admin API helpers ---

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function shopifyGraphQL<T = unknown>(shop: string, accessToken: string, query: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ query }),
        });

        if (response.status === 429 || response.status >= 500) {
            const retryAfter = response.headers.get('retry-after');
            const delayMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            lastError = new Error(`Shopify API ${response.status} after ${MAX_RETRIES} retries`);
            break;
        }

        if (!response.ok) {
            throw new Error(`Shopify GraphQL HTTP error: ${response.status}`);
        }

        const result = await response.json() as T & { errors?: Array<{ message: string }> };

        if (result.errors && result.errors.length > 0) {
            throw new Error(`Shopify GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
        }

        return result;
    }

    throw lastError || new Error('Shopify API request failed');
}

async function fetchShopInfo(shop: string, accessToken: string) {
    const data = await shopifyGraphQL<{
        data: { shop: { name: string; email: string; currencyCode: string; timezoneAbbreviation: string; plan: { displayName: string } } }
    }>(shop, accessToken, `{
        shop {
            name
            email
            currencyCode
            timezoneAbbreviation
            plan { displayName }
        }
    }`);

    const s = data.data.shop;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currencyCode,
        storeTimezone: s.timezoneAbbreviation,
        platformData: { planName: s.plan?.displayName ?? null },
    };
}

// --- Product Sync ---

interface ShopifyGQLProduct {
    id: string;
    title: string;
    description: string;
    productType: string;
    vendor: string;
    status: string;
    tags: string[];
    totalInventory: number;
    hasOnlyDefaultVariant: boolean;
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
                        title
                        description
                        productType
                        vendor
                        status
                        tags
                        totalInventory
                        hasOnlyDefaultVariant
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
        };
    });

    return replaceProductsAndRebuildSummary(storeId, mapped);
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
 * Strip HTML tags and decode common HTML entities.
 */
function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
        policies.push(`Shipping: ${text.slice(0, 100)}`);
    }
    if (data.data.shop.refundPolicy?.body) {
        const text = stripHtml(data.data.shop.refundPolicy.body);
        policies.push(`Returns: ${text.slice(0, 100)}`);
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

    const shopInfo = await fetchShopInfo(storeDomain, accessToken);
    await db.update(ecommerceStores).set({
        ...shopInfo,
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

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

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
    type NormalizedProduct,
    type PlatformProductDetail,
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

// Each subscription pairs the REST-style topic name (what X-Shopify-Topic
// carries on deliveries and what webhookStatus persists — the format predates
// the GraphQL migration and existing DB rows/UI depend on it) with the
// WebhookSubscriptionTopic enum the Admin GraphQL API speaks, plus the
// delivery route suffix under /shopify/webhooks.
const SHOPIFY_WEBHOOK_TOPIC_DEFS = [
    { topic: 'app/uninstalled', gqlTopic: 'APP_UNINSTALLED', path: 'uninstall' },
    { topic: 'products/create', gqlTopic: 'PRODUCTS_CREATE', path: 'products-update' },
    { topic: 'products/update', gqlTopic: 'PRODUCTS_UPDATE', path: 'products-update' },
    { topic: 'products/delete', gqlTopic: 'PRODUCTS_DELETE', path: 'products-update' },
    // Order lifecycle — for customer notifications
    { topic: 'orders/create', gqlTopic: 'ORDERS_CREATE', path: 'orders' },
    { topic: 'orders/fulfilled', gqlTopic: 'ORDERS_FULFILLED', path: 'orders' },
    // orders/cancelled is subscribed but intentionally a no-op today:
    // buildShopifyOrderEvent has no 'orders/cancelled' branch (no cancellation
    // notification is designed yet), so the webhook is received and 200'd without
    // dispatching. Kept subscribed so the feature can be added handler-side without
    // a re-registration round-trip on every existing store.
    { topic: 'orders/cancelled', gqlTopic: 'ORDERS_CANCELLED', path: 'orders' },
    // Delivery — order-level fulfillment_status never becomes 'delivered'; the delivered
    // signal is fulfillment.shipment_status, delivered via the fulfillments/update topic.
    { topic: 'fulfillments/update', gqlTopic: 'FULFILLMENTS_UPDATE', path: 'fulfillments' },
] as const;

/** REST-style topic names, in registration order — pinned against the adapter copy in webhookTopicDrift.test.ts.
 * Readonly for parity with the Salla/Zid `as const` twins — consumers must not mutate it. */
export const SHOPIFY_WEBHOOK_EVENTS: readonly string[] = SHOPIFY_WEBHOOK_TOPIC_DEFS.map(d => d.topic);

/**
 * Union of delivery route suffixes under /shopify/webhooks. routes/shopify.ts
 * keys its handler map with this, so a path registered here without a route
 * handler (or vice versa) is a compile error instead of a silent 404 on
 * every delivery.
 */
export type ShopifyWebhookPath = (typeof SHOPIFY_WEBHOOK_TOPIC_DEFS)[number]['path'];

// The query is app-scoped (only this app's subscriptions are visible), so the
// realistic ceiling is the 8 topics plus REST-era duplicates — far below one page.
const WEBHOOK_LIST_PAGE_SIZE = 100;

const WEBHOOK_SUBSCRIPTIONS_QUERY = `
    query webhookSubscriptions($first: Int!) {
        webhookSubscriptions(first: $first) {
            edges {
                node {
                    id
                    topic
                    endpoint {
                        __typename
                        ... on WebhookHttpEndpoint { callbackUrl }
                    }
                }
            }
            pageInfo { hasNextPage }
        }
    }`;

const WEBHOOK_CREATE_MUTATION = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            webhookSubscription { id }
            userErrors { field message }
        }
    }`;

const WEBHOOK_UPDATE_MUTATION = `
    mutation webhookSubscriptionUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
            webhookSubscription { id }
            userErrors { field message }
        }
    }`;

interface WebhookUserError { field?: string[] | null; message: string }

interface WebhookSubscriptionsQueryResult {
    data: {
        webhookSubscriptions: {
            edges: Array<{
                node: {
                    id: string;
                    topic: string;
                    endpoint?: { __typename: string; callbackUrl?: string } | null;
                };
            }>;
            pageInfo?: { hasNextPage: boolean };
        };
    };
}

interface WebhookCreateResult {
    data: { webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: WebhookUserError[] } };
}

interface WebhookUpdateResult {
    data: { webhookSubscriptionUpdate: { webhookSubscription: { id: string } | null; userErrors: WebhookUserError[] } };
}

export async function registerWebhooks(shop: string, accessToken: string): Promise<WebhookRegistrationResult> {
    const webhookUrl = `https://${config.shopify.hostName}/shopify/webhooks`;

    // List this app's existing subscriptions first so registration is a true
    // upsert: a changed callback URL (hostName drift, dev tunnels) updates the
    // existing subscription in place. The REST predecessor could only POST and
    // treat 422 as "already registered", which silently left a stale address
    // in place. If the list query itself fails, this throws — callers
    // (registerWebhooksWithPersist / finalizeClaim) persist a failed-all
    // marker and enqueue a retry.
    const existing = await shopifyGraphQL<WebhookSubscriptionsQueryResult>(
        shop, accessToken, WEBHOOK_SUBSCRIPTIONS_QUERY, { first: WEBHOOK_LIST_PAGE_SIZE },
    );

    // Overflow guard: with subscriptions beyond the first page, the URL-matching
    // one can sit on the invisible page 2 and the upsert below degenerates into
    // the exact unhealable "address already taken" loop the list step exists to
    // prevent. Realistic only on a long-lived dev store (~8 stale twins per
    // tunnel-hostname change), but when it happens the failure is misleading —
    // name it loudly so the diagnosis is one Sentry search away.
    if (existing.data.webhookSubscriptions.pageInfo?.hasNextPage) {
        captureError(
            new Error(`Shopify webhook subscription list overflowed one page (>${WEBHOOK_LIST_PAGE_SIZE}) for ${shop}`),
            'shopify_webhook_list_overflow — upsert may collide with subscriptions on the unseen page',
            { level: 'warning', tags: { service: 'shopify', flow: 'webhook_registration' }, extra: { shop } },
        );
    }

    const byGqlTopic = new Map<string, Array<{ id: string; callbackUrl: string | null }>>();
    for (const { node } of existing.data.webhookSubscriptions.edges) {
        const list = byGqlTopic.get(node.topic) ?? [];
        list.push({
            id: node.id,
            callbackUrl: node.endpoint?.__typename === 'WebhookHttpEndpoint' ? node.endpoint.callbackUrl ?? null : null,
        });
        byGqlTopic.set(node.topic, list);
    }

    // Topics upserted in parallel — each is an independent mutation. Inner
    // try/catch means one topic's failure never rejects the batch.
    const results = await Promise.all(SHOPIFY_WEBHOOK_TOPIC_DEFS.map(async ({ topic, gqlTopic, path }) => {
        const address = `${webhookUrl}/${path}`;
        try {
            // A topic can carry duplicate subscriptions from the REST era (a
            // changed address POSTed a second subscription instead of updating
            // the first). Prefer the one already pointing at the right URL,
            // then any HTTP-endpoint twin — updating a stale HTTP twin heals
            // it in place, while a non-HTTP subscription (EventBridge/PubSub,
            // created out-of-band on the same credentials; callbackUrl null)
            // can't take a callbackUrl and would loop on userErrors forever.
            // Leftover stale duplicates are not deleted here: their deliveries
            // fail and Shopify removes persistently-failing subscriptions itself.
            const candidates = byGqlTopic.get(gqlTopic) ?? [];
            const current = candidates.find(c => c.callbackUrl === address)
                ?? candidates.find(c => c.callbackUrl !== null)
                ?? candidates[0];
            if (current && current.callbackUrl === address) {
                return { topic, error: null };
            }
            const userErrors = current
                ? (await shopifyGraphQL<WebhookUpdateResult>(shop, accessToken, WEBHOOK_UPDATE_MUTATION, {
                    id: current.id,
                    webhookSubscription: { callbackUrl: address },
                })).data.webhookSubscriptionUpdate.userErrors
                : (await shopifyGraphQL<WebhookCreateResult>(shop, accessToken, WEBHOOK_CREATE_MUTATION, {
                    topic: gqlTopic,
                    webhookSubscription: { callbackUrl: address, format: 'JSON' },
                })).data.webhookSubscriptionCreate.userErrors;
            if (userErrors.length > 0) {
                return { topic, error: userErrors.map(e => e.message).join(', ').slice(0, ERROR_TEXT_MAX_LENGTH) };
            }
            // healedFrom set ONLY on the update path — its presence IS the drift signal.
            return { topic, error: null, healedFrom: current ? current.callbackUrl ?? '(non-http)' : undefined };
        } catch (err) {
            return { topic, error: err instanceof Error ? err.message : String(err) };
        }
    }));

    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];
    const healed: Array<{ topic: string; from: string }> = [];
    for (const { topic, error, healedFrom } of results as Array<{ topic: string; error: string | null; healedFrom?: string }>) {
        if (error === null) {
            registered.push(topic);
            if (healedFrom !== undefined) healed.push({ topic, from: healedFrom });
        } else {
            failed.push({ topic, error });
            captureError(
                new Error(`Shopify webhook registration failed: ${topic}: ${error}`),
                `Shopify webhook registration failed: ${topic}`,
                { tags: { service: 'shopify' }, extra: { topic, error } },
            );
        }
    }

    // The drift-heal path is the whole point of the GraphQL migration; without
    // this it is invisible in production telemetry (a regression would present
    // only as slow webhook-delivery loss). One aggregated event per run — a
    // hostname change heals up to 8 topics at once. Expected event, so
    // warning + stable fingerprint (one Sentry issue, alert on frequency).
    if (healed.length > 0) {
        captureError(
            null,
            `Shopify webhook drift healed: ${healed.length} subscription(s) updated in place`,
            {
                level: 'warning',
                tags: { service: 'shopify', flow: 'webhook_registration' },
                fingerprint: ['shopify-webhook-drift-healed'],
                extra: { shop, to: webhookUrl, healed },
            },
        );
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

// Exported for services/shopifyBilling.ts — the one other module allowed to
// talk to the Admin API. It reuses this transport for retry/throttle/timeout
// behavior instead of growing a second fetch loop.
export async function shopifyGraphQL<T = unknown>(
    shop: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await tracedExternalCall('shopify', 'graphql', () =>
            fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify(variables ? { query, variables } : { query }),
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
 * Format a product's price range consistently across the full-sync and webhook
 * paths: "<min> <currency>" for a single price, "<min> - <max> <currency>" for a
 * range. A blank currency yields a trailing-space-free string. Single source of
 * truth so the webhook path can't drift from the full-sync format.
 */
export function formatPriceRange(minPrice: number, maxPrice: number, currency: string): string {
    const suffix = currency ? ` ${currency}` : '';
    return minPrice === maxPrice
        ? `${minPrice}${suffix}`
        : `${minPrice} - ${maxPrice}${suffix}`;
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

    const mapped = products.map(mapShopifyProduct);

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

/**
 * The Shopify GraphQL product node → NormalizedProduct mapper, shared by the
 * full sync and the by-id read (D-092, Rule 10.8). `mapShopifyWebhookProduct`
 * below stays separate on purpose: it maps the REST webhook payload, a
 * different shape (snake_case, per-variant prices, no priceRangeV2), and
 * converging the two would mean inventing fields one side does not have.
 */
export function mapShopifyProduct(p: ShopifyGQLProduct): NormalizedProduct {
    const minPrice = parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? '0');
    const maxPrice = parseFloat(p.priceRangeV2?.maxVariantPrice?.amount ?? '0');
    const currency = p.priceRangeV2?.minVariantPrice?.currencyCode ?? '';
    const variantSummary = buildVariantSummary((p.variants?.edges ?? []).map(e => e.node));

    return {
        platformProductId: p.id.replace('gid://shopify/Product/', ''),
        handle: p.handle,
        title: p.title,
        description: p.description || null,
        productType: p.productType || null,
        vendor: p.vendor || null,
        status: p.status.toLowerCase(),
        priceRange: formatPriceRange(minPrice, maxPrice, currency),
        currency,
        totalInventory: p.totalInventory,
        hasVariants: !p.hasOnlyDefaultVariant,
        variantSummary: variantSummary || null,
        tags: Array.isArray(p.tags) ? (p.tags.join(', ') || null) : null,
        imageUrl: p.featuredImage?.url || null,
    };
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
 *
 * The REST webhook payload has no shop currency, so the caller passes the store's
 * currency (from `store.storeCurrency`) — this builds the priceRange WITH the
 * currency suffix so the AI-facing string matches the full-sync format immediately,
 * instead of showing a bare number until the next 6h sync repairs it.
 */
export function mapShopifyWebhookProduct(payload: ShopifyWebhookProduct, storeCurrency = ''): {
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
    const currency = storeCurrency;
    const priceRange = formatPriceRange(minPrice, maxPrice, currency);

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

import type { OrderInfoFull, ShipmentInfoFull } from '@jawab24/shared';

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
 * Read ONE product by its Shopify id — the platform call the resolver makes
 * only when the local answer is risky (D-092). Admin GraphQL `product(id:)`
 * with the Product GID (the sync strips that prefix when it stores the id, so
 * it is re-added here). A missing or non-ACTIVE product is null. The former
 * `products(query: "title:*…*")` search is gone with the matcher that used it:
 * it returned the FIRST hit when nothing matched (`|| products[0]`).
 */
export async function getProductById(storeId: string, platformProductId: string): Promise<PlatformProductDetail | null> {
    const creds = await resolveStoreCredentials(storeId);
    if (!creds) return null;

    type ProductNode = Omit<ShopifyGQLProduct, 'variants'> & {
        variants: { edges: Array<{ node: { title: string; inventoryQuantity: number | null; selectedOptions: Array<{ name: string; value: string }> } }> };
    };
    const data = await shopifyGraphQL<{ data: { product: ProductNode | null } }>(
        creds.storeDomain,
        creds.accessToken,
        `query ($id: ID!) {
            product(id: $id) {
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
        }`,
        { id: `gid://shopify/Product/${platformProductId}` },
    );

    const product = data.data.product;
    if (!product || product.status !== 'ACTIVE') return null;

    const base = mapShopifyProduct(product);
    const variants = product.variants.edges.map(e => e.node).map(v => ({
        name: v.title,
        available: (v.inventoryQuantity ?? 0) > 0,
        quantity: v.inventoryQuantity ?? 0,
    }));

    return {
        ...base,
        productUrl: product.handle ? `https://${creds.storeDomain}/products/${product.handle}` : undefined,
        variants: variants.length > 0 ? variants : undefined,
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

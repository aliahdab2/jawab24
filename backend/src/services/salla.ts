/**
 * Salla e-commerce service — OAuth, REST API, product sync, webhook verification.
 *
 * Key differences from Shopify:
 * - REST API (not GraphQL) — simpler
 * - Page-based pagination (max 65/page)
 * - Access tokens expire in 14 days, refresh tokens are single-use (30 days)
 * - Webhook HMAC uses hex digest (Shopify uses base64)
 * - Webhooks registered via API call (not during OAuth)
 * - No shop domain input — Salla authenticates merchant directly
 * - No GDPR endpoints required
 */
import { tracedExternalCall } from '../utils/tracing';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { normalizeStoreDomain } from './storeDomain';
import { captureError } from '../utils/sentryHelpers';
import {
    getStoreById,
    replaceProductsAndRebuildSummary,
    applySyncedStoreInfo,
    saveStoreCategories,
    PRODUCT_SAFETY_CAP,
    type WebhookRegistrationResult,
    type NormalizedProduct,
    type PlatformProductDetail,
    type StoreCategory,
} from './ecommerce';
import { stripHtml } from '../utils/htmlUtils';
import { verifyHexHmac } from '../utils/hmacVerify';
import { ecommerceApiGet } from '../utils/httpRetry';
import {
    refreshAccessToken as sharedRefreshAccessToken,
    ensureValidToken as sharedEnsureValidToken,
    resolveStoreAccessToken,
    getStoresNeedingTokenRefresh as sharedGetStoresNeedingTokenRefresh,
    refreshExpiringTokens as sharedRefreshExpiringTokens,
    type TokenRefreshConfig,
} from './ecommerceTokenRefresh';

const MAX_PRODUCTS_PER_PAGE = 65;
// Page enough to reach the shared safety cap (loop also early-exits at the cap).
const MAX_PAGES_TO_FETCH = Math.ceil(PRODUCT_SAFETY_CAP / MAX_PRODUCTS_PER_PAGE);
const ERROR_TEXT_MAX_LENGTH = 200;

const SALLA_TOKEN_REFRESH_CONFIG: TokenRefreshConfig = {
    platform: 'salla',
    tokenEndpointUrl: 'https://accounts.salla.sa/oauth2/token',
    get clientId() { return config.salla.clientId; },
    get clientSecret() { return config.salla.clientSecret; },
};

// --- Phone normalization (shared) ---

/**
 * Compose a full international phone from Salla's split `mobile` + `mobile_code`.
 * Salla delivers the customer mobile as a bare local number (e.g. 555123456) plus
 * a separate dialing code (e.g. "+966") across BOTH webhook payloads and the REST
 * orders API. Some payloads (order.status.updated) already deliver a `+`-prefixed
 * full number — those are returned as-is.
 *
 * Single source of truth: used by the webhook controller (buildSallaOrderEvent) AND
 * the order/shipment agent tools (mapSallaOrderToOrderInfo, getShipmentTracking).
 */
export function composeSallaPhone(
    mobile?: string | number | null,
    mobileCode?: string | null,
): string | undefined {
    if (mobile === undefined || mobile === null || mobile === '') return undefined;
    const m = String(mobile).trim();
    if (m === '') return undefined;
    if (m.startsWith('+')) return m; // already international
    const code = mobileCode ? String(mobileCode).trim() : '';
    return code ? `${code}${m}` : m;
}

// --- OAuth ---

export function buildAuthUrl(state: string): string {
    const { clientId, hostName, scopes } = config.salla;
    const redirectUri = `https://${hostName}/salla/auth/callback`;
    return `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
}

export interface SallaTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number; // seconds
}

export async function exchangeCodeForToken(code: string): Promise<SallaTokenResponse> {
    const { clientId, clientSecret, hostName } = config.salla;
    const redirectUri = `https://${hostName}/salla/auth/callback`;

    const response = await tracedExternalCall('salla', 'exchangeCodeForToken', () =>
        fetch('https://accounts.salla.sa/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }).toString(),
        }),
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Salla token exchange failed: ${response.status} ${text}`);
    }

    const data = await response.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
    };

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}

// --- Token Refresh (CRITICAL: distributed locking for single-use refresh tokens) ---

// --- Webhook Verification (hex HMAC, NOT base64) ---

export function verifyWebhookHmac(body: string, signature: string): boolean {
    return verifyHexHmac(body, signature, config.salla.webhookSecret);
}

// --- Webhook Registration via API ---

/** Events we subscribe per-store via `POST /admin/v2/webhooks/subscribe`. */
export const SALLA_API_WEBHOOK_EVENTS = [
    'product.created',
    'product.deleted',
    'product.price.updated',
    'product.status.updated',
    'product.quantity.low',
    'app.uninstalled',
    'abandoned.cart',
] as const;

/**
 * Order lifecycle — for customer notifications. Delivered APP-LEVEL via the
 * portal's Webhooks/Notifications → Store Events list, NOT via per-store API
 * subscriptions: since mid-day 2026-08-23 Salla refuses API subscribe/update
 * for these with 422 «The event type is disabled» whenever they are managed
 * through the portal list (SALLA_TEST_PLAN.md Tier 0.10). With the portal list
 * populated, signed deliveries arrive for every installed store with no
 * per-store subscription at all (verified live 2026-08-24, order #279531515).
 *
 * Salla has NO `order.completed` event and NO `order.shipping.update` event
 * (verified against docs.salla.dev + SDKs). Order completion/delivery is a
 * STATUS VALUE inside `order.status.updated` (data.status.slug in
 * {completed,delivered,shipped}); shipment/tracking is `order.shipment.created`.
 */
export const SALLA_PORTAL_WEBHOOK_EVENTS = [
    'order.created',
    'order.updated',
    'order.status.updated',
    'order.shipment.created',
] as const;

/** Everything `/salla/webhooks` receives and processes, regardless of channel. */
export const SALLA_WEBHOOK_EVENTS = [...SALLA_API_WEBHOOK_EVENTS, ...SALLA_PORTAL_WEBHOOK_EVENTS] as const;

export type SallaWebhookEvent = typeof SALLA_WEBHOOK_EVENTS[number];

export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}

export function isOrderEvent(event: string): boolean {
    return event.startsWith('order.') || event === 'abandoned.cart';
}

/** Webhook payload version 2 — the shape `controllers/salla.ts` parses (v1 differs). */
const SALLA_WEBHOOK_VERSION = 2;

/**
 * The security fields every subscription we own must carry.
 *
 * A subscription registered WITHOUT these delivers with no `X-Salla-Signature`
 * at all (Merchant API `GET /admin/v2/webhooks` showed `security: { strategy: "",
 * secret: null }` on all ten of the demo store's subscriptions, 2026-08-23), and
 * `verifyWebhookHmac` correctly refuses every such delivery with 401. That is why
 * no order or product event had ever been accepted while the portal-configured
 * app events (`app.installed`, `app.store.authorize`) — signed with the App's
 * Webhook Secret Key — passed. The same key is used here so the verifier stays
 * one function for both sources.
 */
function webhookSecurityFields(): { version: number; security_strategy: 'signature'; secret: string } {
    return { version: SALLA_WEBHOOK_VERSION, security_strategy: 'signature', secret: config.salla.webhookSecret };
}

interface SallaWebhookSubscription {
    id: number;
    event: string;
    url: string;
    security?: { strategy?: string | null; secret?: string | null } | null;
}

/**
 * Subscriptions Salla already holds for OUR endpoint, keyed by event. A listing
 * failure is reported and treated as "none known" — the subscribe path below
 * then answers 422 for duplicates, which it tolerates as before.
 */
async function listOwnSubscriptions(accessToken: string, webhookUrl: string): Promise<Map<string, SallaWebhookSubscription>> {
    const own = new Map<string, SallaWebhookSubscription>();
    try {
        const data = await sallaApiGet<{ data: SallaWebhookSubscription[] }>('https://api.salla.dev/admin/v2/webhooks', accessToken);
        for (const sub of data.data ?? []) {
            if (sub.url === webhookUrl) own.set(sub.event, sub);
        }
    } catch (err) {
        captureError(err, 'Salla webhook listing failed — registering blind (existing unsigned subscriptions cannot be repaired this pass)', {
            tags: { service: 'salla' },
        });
    }
    return own;
}

/**
 * Register (or repair) our subscription for every event in SALLA_API_WEBHOOK_EVENTS.
 *
 * List-then-upsert, like the Shopify path: an event Salla already has for our
 * URL is UPDATED in place (`PUT /webhooks/{id}`) so the security fields land on
 * it; a missing one is subscribed. A plain re-subscribe of an existing event
 * answers 422 and would leave an unsigned subscription unsigned forever — which
 * is exactly the state every pre-2026-08-23 store is in, and what the per-store
 * "Re-register" button and src/scripts/reregister-webhooks.ts now fix.
 *
 * SALLA_PORTAL_WEBHOOK_EVENTS are deliberately NOT subscribed here — the API
 * refuses them with 422 «The event type is disabled» (portal-managed), and
 * counting that refusal as a failure kept `webhookStatus.failed` at 4 forever:
 * the retry worker re-attempted until exhaustion, Sentry alerted on every
 * pass, and the integrations card showed the merchant a permanent
 * "Re-register webhooks" CTA that no click could clear. Any leftover per-store
 * subscription for those events is deleted instead (see below).
 *
 * Single endpoint receives all events — dispatches by event type in body. Topics
 * are written in parallel because each is an independent REST call; serial
 * registration exceeded the OAuth-callback budget for merchants on slower
 * networks (~11 topics × ~500ms = 5.5s p95).
 */
export async function registerWebhooks(accessToken: string): Promise<WebhookRegistrationResult> {
    const webhookUrl = `https://${config.salla.hostName}/salla/webhooks`;
    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };
    const security = webhookSecurityFields();

    const existing = await listOwnSubscriptions(accessToken, webhookUrl);

    const results = await Promise.allSettled(SALLA_API_WEBHOOK_EVENTS.map(event => {
        const current = existing.get(event);
        // `event` is REQUIRED on the update too. docs.salla.dev (Update Webhook)
        // lists only name/url/version/rule/headers/security_*, but the live API
        // answers 422 «حقل event غير صالح» when it is absent — measured 2026-08-23
        // on the demo store: PUT without `event` → 422, the same body with it →
        // 200. Without it every pre-fix (unsigned) subscription stayed unsigned.
        const request = current
            ? fetch(`https://api.salla.dev/admin/v2/webhooks/${current.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ name: event, event, url: webhookUrl, ...security }),
            })
            : fetch('https://api.salla.dev/admin/v2/webhooks/subscribe', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: event, event, url: webhookUrl, ...security }),
            });
        return tracedExternalCall('salla', current ? 'updateWebhook' : 'registerWebhook', () =>
            request.then(async response => ({ event, response, body: response.ok ? '' : await response.text() })),
        );
    }));

    for (let i = 0; i < results.length; i++) {
        const event = SALLA_API_WEBHOOK_EVENTS[i];
        const result = results[i];
        if (result.status === 'rejected') {
            const err = result.reason;
            failed.push({ topic: event, error: err instanceof Error ? err.message : String(err) });
            captureError(err, `Salla webhook registration error: ${event}`, { tags: { service: 'salla' } });
            continue;
        }
        const { response, body } = result.value;
        if (response.ok) {
            registered.push(event);
        } else if (response.status === 422 && !existing.has(event)) {
            // 422 on SUBSCRIBE = the event exists but the listing did not show it
            // (listing failed). Treat as registered, as before; the next
            // re-registration with a working listing repairs its security fields.
            registered.push(event);
        } else {
            failed.push({ topic: event, status: response.status, error: body.slice(0, ERROR_TEXT_MAX_LENGTH) });
            captureError(
                new Error(`Salla webhook registration failed: ${event} ${response.status}`),
                `Salla webhook registration failed: ${event}`,
                { tags: { service: 'salla' }, extra: { event, status: response.status, body } }
            );
        }
    }

    await deleteStalePortalEventSubscriptions(existing, headers);

    return { registered, failed, lastAttempt: new Date().toISOString() };
}

/**
 * Delete our leftover per-store subscriptions for portal-managed events.
 *
 * Every pre-enforcement store carries them: they are unsigned (delivering a
 * DUPLICATE of every order event that `verifyWebhookHmac` refuses with 401)
 * and unrepairable — a PUT answers the same 422 «The event type is disabled»
 * as a subscribe. Only rows whose url is OURS and whose event is
 * portal-managed are touched.
 *
 * A failed delete is reported but never pushed into `failed`: the leftover
 * row is inert to us (its deliveries can't pass the signature check), and
 * counting it as a failure would re-open exactly the exhausted-retry /
 * permanent-CTA loop this split exists to close.
 */
async function deleteStalePortalEventSubscriptions(
    existing: Map<string, SallaWebhookSubscription>,
    headers: Record<string, string>,
): Promise<void> {
    const stale = SALLA_PORTAL_WEBHOOK_EVENTS
        .map(event => existing.get(event))
        .filter((sub): sub is SallaWebhookSubscription => sub !== undefined);

    const results = await Promise.allSettled(stale.map(sub =>
        tracedExternalCall('salla', 'deleteWebhook', () =>
            fetch(`https://api.salla.dev/admin/v2/webhooks/${sub.id}`, { method: 'DELETE', headers })
                .then(async response => ({ response, body: response.ok ? '' : await response.text() })),
        ),
    ));

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const { id, event } = stale[i];
        if (result.status === 'rejected') {
            captureError(result.reason, `Salla stale portal-event subscription delete failed: ${event}`, {
                tags: { service: 'salla' }, extra: { event, subscriptionId: id },
            });
        } else if (!result.value.response.ok) {
            captureError(
                new Error(`Salla stale portal-event subscription delete failed: ${event} ${result.value.response.status}`),
                `Salla stale portal-event subscription delete failed: ${event}`,
                { tags: { service: 'salla' }, extra: { event, subscriptionId: id, status: result.value.response.status, body: result.value.body.slice(0, ERROR_TEXT_MAX_LENGTH) } }
            );
        }
    }
}

// --- REST API Helper ---

function sallaApiGet<T = unknown>(url: string, accessToken: string): Promise<T> {
    return ecommerceApiGet<T>(url, {
        platform: 'salla',
        authHeaderValue: `Bearer ${accessToken}`,
    });
}

// --- Store Info ---

export async function fetchStoreInfo(accessToken: string) {
    const data = await sallaApiGet<{
        data: {
            name: string;
            email: string;
            currency: string;
            domain: string;
            id: number;
            /** Store environment — `demo` | `development` | `live` (docs.salla.dev/5394261e0). */
            type?: string;
        };
    }>('https://api.salla.dev/admin/v2/store/info', accessToken);

    const s = data.data;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currency,
        // Salla sends `domain` as a full URL — with a path for demo/development
        // stores. The column is an identity key; canonicalise at the border.
        storeDomain: normalizeStoreDomain(s.domain),
        merchantId: String(s.id),
        storeType: s.type ?? null,
    };
}

// --- Products (REST, page-based) ---

/** Customer/admin links Salla attaches to products AND categories (docs.salla.dev List Products). */
interface SallaUrls {
    customer?: string;
    admin?: string;
}

interface SallaProduct {
    id: number;
    name: string;
    description?: string; // HTML — stripped to plain text before storage
    type: string;
    status: string; // 'sale', 'out', 'hidden', 'deleted'
    price: { amount: number; currency: string };
    quantity: number | null;
    thumbnail?: string;   // Main product image URL
    options: Array<{
        name: string;
        values: Array<{ name: string }>;
    }>;
    categories: Array<{ name: string; urls?: SallaUrls }>;
    sku: string | null;
    /**
     * The product's real storefront URL. Salla has NO `slug` field — the
     * `/p/{slug}` URL the mapper used to build never matched a real store, and
     * every real Salla row was stored without a link (20/20 on the test store,
     * 2026-08-23). `urls.customer` is the only source of a product link.
     */
    urls?: SallaUrls;
}

/** Every category link across a product list, raw — `saveStoreCategories` de-duplicates, sorts and caps. */
export function collectSallaCategories(products: ReadonlyArray<Pick<SallaProduct, 'categories'>>): StoreCategory[] {
    const out: StoreCategory[] = [];
    for (const p of products) {
        for (const c of p.categories ?? []) {
            if (c?.name && c.urls?.customer) out.push({ name: c.name, url: c.urls.customer });
        }
    }
    return out;
}


interface SallaProductsResponse {
    data: SallaProduct[];
    // Optional in the TYPE because it is an external payload, not a promise we
    // control — `fetchAllProducts` refuses to page on without it rather than
    // trusting the declaration. (Salla sends it on every observed response.)
    pagination?: {
        currentPage: number;
        totalPages: number;
        perPage: number;
        total: number;
    };
}

function mapSallaStatus(status: string): string {
    switch (status) {
        case 'sale': return 'active';
        case 'out': return 'out_of_stock';
        case 'hidden': return 'hidden';
        case 'deleted': return 'archived';
        default: return status;
    }
}

function buildSallaVariantSummary(options: SallaProduct['options']): string {
    if (!options || options.length === 0) return '';

    const parts = options.map(opt => {
        const values = opt.values.map(v => v.name).join(', ');
        return `${opt.name}: ${values}`;
    });

    return parts.join(' | ');
}

async function fetchAllProducts(accessToken: string): Promise<SallaProduct[]> {
    const allProducts: SallaProduct[] = [];
    let page = 1;

    while (page <= MAX_PAGES_TO_FETCH) {
        const data = await sallaApiGet<SallaProductsResponse>(
            `https://api.salla.dev/admin/v2/products?page=${page}&per_page=${MAX_PRODUCTS_PER_PAGE}`,
            accessToken,
        );

        allProducts.push(...(data.data ?? []));

        // Stop at the shared safety cap — the DB layer truncates beyond it anyway.
        if (allProducts.length >= PRODUCT_SAFETY_CAP) break;

        // ⛔ An unknown page count must FAIL, never "stop here". syncProducts
        // REPLACES the catalogue, so treating a missing envelope as "we're done"
        // would delete every product past page 1 — a silent amputation the
        // merchant would only notice through the AI answering "we don't sell
        // that". Failing keeps the previous catalogue intact.
        //
        // The throw itself is not new; before, the same case surfaced as
        // "Cannot read properties of undefined (reading 'totalPages')", which
        // named neither Salla nor the store. Only the diagnosis changed.
        const totalPages = data.pagination?.totalPages;
        if (typeof totalPages !== 'number') {
            throw new Error(
                `Salla products response has no pagination envelope (page ${page}) — refusing to truncate the catalogue`,
            );
        }
        if (page >= totalPages) break;
        page++;
    }

    return allProducts;
}

/**
 * Sync all products from Salla store
 */
export async function syncProducts(storeId: string) {
    await sharedEnsureValidToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const products = await fetchAllProducts(accessToken);

    const live = products.filter(p => p.status !== 'deleted');
    const mapped = live.map(mapSallaProduct);

    // Category links come from the same payload; persisted before the summary
    // is rebuilt so the catalog block that this sync produces already lists them.
    await saveStoreCategories(storeId, collectSallaCategories(live));

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

/**
 * The ONE Salla product → NormalizedProduct mapper, shared by the full sync
 * and the by-id read (D-092, Rule 10.8). Salla has no "unlimited" concept, so a
 * missing quantity is 0, never null — the F1 null-first ladder cannot fire for
 * a Salla row; its sold-out signal is the `out` STATUS instead.
 */
export function mapSallaProduct(p: SallaProduct): NormalizedProduct {
    const variantSummary = buildSallaVariantSummary(p.options);
    return {
        platformProductId: String(p.id),
        handle: null,
        productUrl: p.urls?.customer || null,
        title: p.name,
        description: p.description ? stripHtml(p.description) : null,
        productType: p.categories?.[0]?.name || null,
        vendor: null,
        status: mapSallaStatus(p.status),
        priceRange: `${p.price.amount} ${p.price.currency}`,
        currency: p.price.currency,
        totalInventory: p.quantity ?? 0,
        hasVariants: (p.options?.length ?? 0) > 0,
        variantSummary: variantSummary || null,
        tags: null,
        imageUrl: p.thumbnail || null,
    };
}

/**
 * Full sync: store info + products
 */
export async function fullSync(storeId: string) {
    await sharedEnsureValidToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);

    // Update store info. platformData is merged, not replaced — a full sync must
    // not wipe webhookStatus/tokenHealth written by other flows.
    const storeInfo = await fetchStoreInfo(accessToken);
    await applySyncedStoreInfo(storeId, {
        storeName: storeInfo.storeName,
        storeEmail: storeInfo.storeEmail,
        storeCurrency: storeInfo.storeCurrency,
    }, { merchantId: storeInfo.merchantId });

    // Sync products
    const productResult = await syncProducts(storeId);

    return productResult;
}

// --- Periodic Token Refresh ---

/**
 * Refresh tokens for all Salla stores nearing expiry.
 * Called periodically from the integration adapter (every 6h).
 */
export async function refreshExpiringTokens(): Promise<number> {
    return sharedRefreshExpiringTokens(SALLA_TOKEN_REFRESH_CONFIG);
}

export async function refreshAccessToken(storeId: string): Promise<void> {
    return sharedRefreshAccessToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);
}

export async function ensureValidToken(storeId: string): Promise<void> {
    return sharedEnsureValidToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);
}

export async function getStoresNeedingTokenRefresh() {
    return sharedGetStoresNeedingTokenRefresh('salla');
}

// --- E-Commerce Agent Tools (read-only order/tracking/inventory) ---

import type { OrderInfoFull, ShipmentInfoFull } from '@jawab24/shared';

/**
 * Resolve store credentials for a given storeId.
 * Ensures token is valid (refreshes if needed) and returns decrypted accessToken.
 */
async function resolveStoreCredentials(storeId: string): Promise<string | null> {
    return resolveStoreAccessToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);
}

// --- Salla Order Response Types ---

interface SallaOrderItem {
    name: string;
    quantity: number;
    // Present on the order DETAIL endpoint; the orders LIST endpoint returns items
    // as { name, quantity, thumbnail } with no per-item amounts. Hence optional.
    amounts?: { price_without_tax?: { amount: number }; total?: { amount: number; currency: string } };
}

interface SallaShipment {
    tracking_number: string | null;
    courier_name: string | null;
    // The List Shipments schema documents the tracking URL under BOTH names; accept either
    // rather than betting on one and silently handing the customer a shipment with no link.
    tracking_link?: string | null;
    tracking_url?: string | null;
}

interface SallaShipmentsResponse {
    data: SallaShipment[];
}

// Salla's orders LIST endpoint (/orders, /orders?keyword=) and DETAIL endpoint
// (/orders/:id) return DIFFERENT shapes (verified against a live store 2026-06-27):
//   • LIST item: has a top-level `total` ({amount,currency}), `items` WITHOUT prices,
//     and NO `amounts` breakdown / NO `shipping` address.
//   • DETAIL item: has the full `amounts` breakdown but NO `items` inline.
// The customer's `mobile` is a bare local NUMBER plus a separate `mobile_code`
// (e.g. 555123456 + "+966") on BOTH shapes — compose them before use.
//
// ⚠️ That missing-`items` observation is the LIGHT response, recognised as such only on
// 2026-08-17. Salla serves order DETAIL in "light" format to every app created after
// 15 Aug 2024 (ours dates from 2026-02-25), and light OMITS `shipments`, `items`, pickup
// branch and customer groups — permanently, not from some future date. The 1 Sep 2026
// deprecation of `expanded=true` therefore changes NOTHING for us; we were never eligible
// for the expanded response. Consequence: `order.shipments` is ALWAYS absent here, so
// tracking must come from the separate List Shipments endpoint (see fetchOrderShipment).
// Refs: docs.salla.dev/5394147e0 (Order Details), docs.salla.dev/5394232e0 (List Shipments).
interface SallaOrder {
    id: number;
    reference_id: string;
    status: { slug: string; name: string };
    payment_method?: string;
    amounts?: { total?: { amount: number; currency: string }; cash_on_delivery?: { amount: number } };
    total?: { amount: number; currency: string }; // LIST endpoint top-level total
    currency?: string;
    customer?: { first_name?: string; mobile?: string | number | null; mobile_code?: string | null };
    shipping?: { address: { city: string; district: string } | null } | null;
    items?: SallaOrderItem[];
    // ⛔ No `shipments` field — deliberately absent so nothing can read it again. The light
    // order payload never carries one (see the note above); use fetchOrderShipment instead.
    date?: { date: string };
    is_refunded?: boolean;
    refund_amount?: { amount: number; currency: string };
}

interface SallaOrdersResponse {
    data: SallaOrder[];
}

interface SallaOrderDetailResponse {
    data: SallaOrder;
}

/**
 * Look up an order by order number via Salla REST API.
 * Returns normalized OrderInfo or null if not found.
 */
export async function lookupOrder(storeId: string, orderNumber: string): Promise<OrderInfoFull | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    const data = await sallaApiGet<SallaOrdersResponse>(
        `https://api.salla.dev/admin/v2/orders?keyword=${encodeURIComponent(orderNumber)}`,
        accessToken,
    );

    const order = data.data[0];
    if (!order) return null;

    return mapSallaOrderToOrderInfo(order);
}

/**
 * Orders belonging to the customer holding this phone number (D-101).
 *
 * Salla's List Orders has no phone filter, so this is the documented two-step:
 * `customers?keyword=<phone>` (keyword matches `customer.mobile`) → each match's
 * `orders?customer_id=`. `keyword` also matches name and email, so a hit is a
 * CANDIDATE, never a verification — the caller re-compares phone and name
 * against the order itself.
 */
export async function findOrdersByPhone(storeId: string, phone: string): Promise<OrderInfoFull[]> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return [];

    const customers = await sallaApiGet<{ data?: Array<{ id?: number | string }> }>(
        `https://api.salla.dev/admin/v2/customers?keyword=${encodeURIComponent(phone)}`,
        accessToken,
    );
    const ids = (customers.data ?? []).map(c => c.id).filter((id): id is number | string => id !== undefined && id !== null);
    if (ids.length === 0) return [];

    const orders: OrderInfoFull[] = [];
    for (const id of ids.slice(0, PHONE_LOOKUP_MAX_CUSTOMERS)) {
        const page = await sallaApiGet<SallaOrdersResponse>(
            `https://api.salla.dev/admin/v2/orders?customer_id=${encodeURIComponent(String(id))}&per_page=${PHONE_LOOKUP_MAX_ORDERS}`,
            accessToken,
        );
        for (const order of page.data ?? []) orders.push(mapSallaOrderToOrderInfo(order));
        if (orders.length >= PHONE_LOOKUP_MAX_ORDERS) break;
    }
    return orders.slice(0, PHONE_LOOKUP_MAX_ORDERS);
}

/** Bounds on the phone-lookup fan-out — a customer has one recent order, not a catalogue of them. */
const PHONE_LOOKUP_MAX_CUSTOMERS = 3;
const PHONE_LOOKUP_MAX_ORDERS = 10;

/**
 * Fetch the order's shipment from the dedicated List Shipments endpoint.
 *
 * Tracking is NOT available on the order payload (see the light-response note above), so
 * this is the only source. Requires the `shipping.read` scope: a store that authorised
 * before that scope was added to the app answers 403 here. Tracking is therefore treated
 * as best-effort — a failure degrades `track_shipment` to status-only rather than failing
 * the whole tool, which would leave the customer with no answer at all.
 *
 * An order can carry several shipments (multi-package, or a cancelled one plus its
 * replacement) and the endpoint documents no ordering guarantee, so prefer the first that
 * actually has a tracking number — blindly taking [0] can answer "no tracking" while a
 * later element in the same response holds the number the customer asked for.
 */
async function fetchOrderShipment(orderId: number, accessToken: string): Promise<SallaShipment | null> {
    try {
        const data = await sallaApiGet<SallaShipmentsResponse>(
            `https://api.salla.dev/admin/v2/shipments?order_id=${orderId}`,
            accessToken,
        );
        const shipments = data.data ?? [];
        return shipments.find(s => s.tracking_number) ?? shipments[0] ?? null;
    } catch (err) {
        captureError(err, 'Salla shipments lookup failed', {
            tags: { service: 'salla' },
            extra: { orderId, hint: 'a 403 here means the store token predates the shipping.read scope' },
        });
        return null;
    }
}

/**
 * Get shipment tracking info for an order via Salla REST API.
 * Returns normalized ShipmentInfo or null if not found.
 */
export async function getShipmentTracking(storeId: string, orderNumber: string): Promise<ShipmentInfoFull | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    // First find the order by keyword search
    const searchData = await sallaApiGet<SallaOrdersResponse>(
        `https://api.salla.dev/admin/v2/orders?keyword=${encodeURIComponent(orderNumber)}`,
        accessToken,
    );

    const orderSummary = searchData.data[0];
    if (!orderSummary) return null;

    // Order detail (customer, status, shipping city) and the shipment (tracking) are two
    // independent lookups — issue them together, never in sequence (AI_INSTRUCTIONS §17.3).
    const [detailData, shipment] = await Promise.all([
        sallaApiGet<SallaOrderDetailResponse>(
            `https://api.salla.dev/admin/v2/orders/${orderSummary.id}`,
            accessToken,
        ),
        fetchOrderShipment(orderSummary.id, accessToken),
    ]);

    const order = detailData.data;

    return {
        orderNumber: String(order.reference_id ?? ''),
        customerFirstName: order.customer?.first_name || '',
        customerPhone: composeSallaPhone(order.customer?.mobile, order.customer?.mobile_code),
        status: mapSallaOrderStatus(order.status?.slug ?? ''),
        trackingNumber: shipment?.tracking_number || undefined,
        courierName: shipment?.courier_name || undefined,
        trackingUrl: shipment?.tracking_link || shipment?.tracking_url || undefined,
        estimatedDelivery: undefined, // Salla doesn't provide estimated delivery date
        shippingCity: order.shipping?.address?.city || undefined,
    };
}

/**
 * Read ONE product by its Salla id — the platform call the resolver makes only
 * when the local answer is risky (D-092). `GET /admin/v2/products/{id}` per
 * docs.salla.dev (single-product envelope `{ data: Product }`); a 404 is "no
 * such product". The former `?keyword=` search is gone with the matcher that
 * used it: it returned the FIRST hit when nothing matched (`|| products[0]`),
 * which handed the model a wrong product and cached it for five minutes.
 *
 * Salla reports stock per product, not per option value — the per-variant
 * figure below is the product's, and is labelled as such rather than invented.
 */
export async function getProductById(storeId: string, platformProductId: string): Promise<PlatformProductDetail | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    let data: { data: SallaProduct };
    try {
        data = await sallaApiGet<{ data: SallaProduct }>(
            `https://api.salla.dev/admin/v2/products/${encodeURIComponent(platformProductId)}`,
            accessToken,
        );
    } catch (err) {
        if (err instanceof Error && /HTTP error: 404\b/.test(err.message)) return null;
        throw err;
    }

    const product = data.data;
    if (!product || String(product.id) !== platformProductId || product.status === 'deleted') return null;

    const base = mapSallaProduct(product);
    const productAvailable = (product.quantity ?? 0) > 0;
    const variants = (product.options || []).flatMap(opt =>
        opt.values.map(v => ({
            name: `${opt.name}: ${v.name}`,
            available: productAvailable,
            quantity: product.quantity ?? 0,
        }))
    );

    return {
        ...base,
        productUrl: product.urls?.customer || undefined,
        variants: variants.length > 0 ? variants : undefined,
    };
}

// --- Mapping helpers ---

function mapSallaOrderToOrderInfo(order: SallaOrder): OrderInfoFull {
    const slug = order.status?.slug ?? '';
    const isRefunded = order.is_refunded || slug === 'refunded';

    // Total lives under `amounts.total` (DETAIL) or the top-level `total` (LIST).
    const totalObj = order.amounts?.total ?? order.total;

    return {
        // Salla returns reference_id as a number on the list endpoint, a string elsewhere.
        orderNumber: String(order.reference_id ?? ''),
        customerFirstName: order.customer?.first_name || '',
        customerPhone: composeSallaPhone(order.customer?.mobile, order.customer?.mobile_code),
        status: mapSallaOrderStatus(slug),
        orderDate: order.date?.date ?? '',
        // LIST items carry only name + quantity (no per-item amounts); guard the price.
        items: (order.items ?? []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.amounts?.total
                ? `${item.amounts.total.amount} ${item.amounts.total.currency}`
                : '',
        })),
        totalAmount: typeof totalObj?.amount === 'number' ? String(totalObj.amount) : '',
        currency: totalObj?.currency ?? order.currency ?? '',
        paymentStatus: isRefunded ? 'refunded' : (slug === 'payment_pending' ? 'pending' : 'paid'),
        refundAmount: order.refund_amount ? `${order.refund_amount.amount} ${order.refund_amount.currency}` : undefined,
        shippingCity: order.shipping?.address?.city || undefined,
        shippingDistrict: order.shipping?.address?.district || undefined,
    };
}

function mapSallaOrderStatus(slug: string): string {
    const map: Record<string, string> = {
        'under_review': 'pending',
        'payment_pending': 'pending',
        'in_progress': 'processing',
        'completed': 'delivered',
        'shipped': 'shipped',
        'cancelled': 'cancelled',
        'refunded': 'refunded',
        'restored': 'cancelled',
    };
    return map[slug] || slug;
}


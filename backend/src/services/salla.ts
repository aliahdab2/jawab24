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
import { captureError } from '../utils/sentryHelpers';
import {
    getStoreById,
    replaceProductsAndRebuildSummary,
    applySyncedStoreInfo,
    PRODUCT_SAFETY_CAP,
    type WebhookRegistrationResult,
    type NormalizedProduct,
    type PlatformProductDetail,
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

export const SALLA_WEBHOOK_EVENTS = [
    'product.created',
    'product.deleted',
    'product.price.updated',
    'product.status.updated',
    'product.quantity.low',
    'app.uninstalled',
    // Order lifecycle — for customer notifications.
    // Salla has NO `order.completed` event and NO `order.shipping.update` event
    // (verified against docs.salla.dev + SDKs). Order completion/delivery is a
    // STATUS VALUE inside `order.status.updated` (data.status.slug in
    // {completed,delivered,shipped}); shipment/tracking is `order.shipment.created`.
    'order.created',
    'order.updated',
    'order.status.updated',
    'order.shipment.created',
    'abandoned.cart',
] as const;

export type SallaWebhookEvent = typeof SALLA_WEBHOOK_EVENTS[number];

export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}

export function isOrderEvent(event: string): boolean {
    return event.startsWith('order.') || event === 'abandoned.cart';
}

export async function registerWebhooks(accessToken: string): Promise<WebhookRegistrationResult> {
    // Single endpoint receives all events — dispatches by event type in body.
    // Topics are subscribed in parallel because each is an independent REST call;
    // serial subscription on Salla's REST endpoint exceeded the OAuth-callback
    // budget for merchants on slower networks (~11 topics × ~500ms = 5.5s p95).
    const webhookUrl = `https://${config.salla.hostName}/salla/webhooks`;
    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];

    const results = await Promise.allSettled(SALLA_WEBHOOK_EVENTS.map(event =>
        tracedExternalCall('salla', 'registerWebhook', () =>
            fetch('https://api.salla.dev/admin/v2/webhooks/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ name: event, event, url: webhookUrl }),
            }).then(async response => ({ event, response, body: response.ok ? '' : await response.text() })),
        ),
    ));

    for (let i = 0; i < results.length; i++) {
        const event = SALLA_WEBHOOK_EVENTS[i];
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
        } else if (response.status === 422) {
            // 422 = webhook already exists, treat as success (mirrors Shopify)
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

    return { registered, failed, lastAttempt: new Date().toISOString() };
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
        };
    }>('https://api.salla.dev/admin/v2/store/info', accessToken);

    const s = data.data;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currency,
        storeDomain: s.domain,
        merchantId: String(s.id),
    };
}

// --- Products (REST, page-based) ---

interface SallaProduct {
    id: number;
    slug?: string;
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
    categories: Array<{ name: string }>;
    sku: string | null;
}


interface SallaProductsResponse {
    data: SallaProduct[];
    pagination: {
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

        allProducts.push(...data.data);

        // Stop at the shared safety cap — the DB layer truncates beyond it anyway.
        if (allProducts.length >= PRODUCT_SAFETY_CAP) break;
        if (page >= data.pagination.totalPages) break;
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

    const mapped = products
        .filter(p => p.status !== 'deleted')
        .map(mapSallaProduct);

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
        handle: p.slug || null,
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
    const storeDomain = await getStoreDomainForProduct(storeId);
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
        productUrl: product.slug && storeDomain ? `https://${storeDomain}/p/${product.slug}` : undefined,
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

/** Get store domain for building product URLs */
async function getStoreDomainForProduct(storeId: string): Promise<string | null> {
    const store = await getStoreById(storeId);
    return store?.storeDomain || null;
}

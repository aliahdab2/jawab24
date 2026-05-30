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
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';
import {
    getStoreById,
    replaceProductsAndRebuildSummary,
    type WebhookRegistrationResult,
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
const MAX_PAGES_TO_FETCH = 4; // 260 products max
const ERROR_TEXT_MAX_LENGTH = 200;

const SALLA_TOKEN_REFRESH_CONFIG: TokenRefreshConfig = {
    platform: 'salla',
    tokenEndpointUrl: 'https://accounts.salla.sa/oauth2/token',
    get clientId() { return config.salla.clientId; },
    get clientSecret() { return config.salla.clientSecret; },
};

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
        .map(p => {
            const priceRange = `${p.price.amount} ${p.price.currency}`;
            const variantSummary = buildSallaVariantSummary(p.options);
            const category = p.categories?.[0]?.name || null;

            return {
                platformProductId: String(p.id),
                handle: p.slug || null,
                title: p.name,
                description: p.description ? stripHtml(p.description) : null,
                productType: category,
                vendor: null as string | null,
                status: mapSallaStatus(p.status),
                priceRange,
                currency: p.price.currency,
                totalInventory: p.quantity ?? 0,
                hasVariants: (p.options?.length ?? 0) > 0,
                variantSummary: variantSummary || null,
                tags: null as string | null,
                imageUrl: p.thumbnail || null,
            };
        });

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

/**
 * Full sync: store info + products
 */
export async function fullSync(storeId: string) {
    await sharedEnsureValidToken(storeId, SALLA_TOKEN_REFRESH_CONFIG);

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);

    // Update store info
    const storeInfo = await fetchStoreInfo(accessToken);
    await db.update(ecommerceStores).set({
        storeName: storeInfo.storeName,
        storeEmail: storeInfo.storeEmail,
        storeCurrency: storeInfo.storeCurrency,
        platformData: { merchantId: storeInfo.merchantId },
        updatedAt: new Date(),
    }).where(eq(ecommerceStores.id, storeId));

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

import type { OrderInfoFull, ShipmentInfoFull, InventoryInfo } from '@jawab24/shared';

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
    amounts: { price_without_tax: { amount: number }; total: { amount: number; currency: string } };
}

interface SallaShipment {
    tracking_number: string | null;
    courier_name: string | null;
    tracking_link: string | null;
    shipped_at: string | null;
}

interface SallaOrder {
    id: number;
    reference_id: string;
    status: { slug: string; name: string };
    payment_method: string;
    amounts: { total: { amount: number; currency: string }; cash_on_delivery: { amount: number } };
    customer: { first_name: string; mobile: string | null };
    shipping: { address: { city: string; district: string } | null } | null;
    items: SallaOrderItem[];
    shipments?: SallaShipment[];
    date: { date: string };
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

    // Fetch full order details (includes shipments)
    const detailData = await sallaApiGet<SallaOrderDetailResponse>(
        `https://api.salla.dev/admin/v2/orders/${orderSummary.id}`,
        accessToken,
    );

    const order = detailData.data;
    const shipment = order.shipments?.[0];

    return {
        orderNumber: order.reference_id,
        customerFirstName: order.customer?.first_name || '',
        customerPhone: order.customer?.mobile || undefined,
        status: mapSallaOrderStatus(order.status.slug),
        trackingNumber: shipment?.tracking_number || undefined,
        courierName: shipment?.courier_name || undefined,
        trackingUrl: shipment?.tracking_link || undefined,
        estimatedDelivery: undefined, // Salla doesn't provide estimated delivery date
        shippingCity: order.shipping?.address?.city || undefined,
    };
}

/**
 * Check real-time inventory for a product by name search via Salla REST API.
 * Returns normalized InventoryInfo or null if no matching product found.
 */
export async function checkInventory(storeId: string, productName: string, variant?: string): Promise<InventoryInfo | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    const data = await sallaApiGet<{ data: SallaProduct[] }>(
        `https://api.salla.dev/admin/v2/products?keyword=${encodeURIComponent(productName)}&per_page=5`,
        accessToken,
    );

    const products = data.data.filter(p => p.status !== 'deleted');
    if (products.length === 0) return null;

    // Find best match by title similarity (case-insensitive contains)
    const lowerQuery = productName.toLowerCase();
    const bestMatch = products.find(p => p.name.toLowerCase().includes(lowerQuery)) || products[0];

    // Map options to variant format
    const allVariants = (bestMatch.options || []).flatMap(opt =>
        opt.values.map(v => ({
            name: `${opt.name}: ${v.name}`,
            available: (bestMatch.quantity ?? 0) > 0, // Salla doesn't have per-variant inventory in list
            quantity: bestMatch.quantity ?? 0,
        }))
    );

    // If specific variant requested, filter
    let filteredVariants = allVariants;
    if (variant) {
        const lowerVariant = variant.toLowerCase();
        filteredVariants = allVariants.filter(v => v.name.toLowerCase().includes(lowerVariant));
    }

    const storeDomain = await getStoreDomainForProduct(storeId);

    return {
        productName: bestMatch.name,
        available: (bestMatch.quantity ?? 0) > 0,
        quantity: bestMatch.quantity ?? 0,
        variants: (filteredVariants.length > 0 ? filteredVariants : allVariants).length > 0
            ? (filteredVariants.length > 0 ? filteredVariants : allVariants)
            : undefined,
        price: `${bestMatch.price.amount} ${bestMatch.price.currency}`,
        currency: bestMatch.price.currency,
        productUrl: bestMatch.slug && storeDomain ? `https://${storeDomain}/p/${bestMatch.slug}` : undefined,
    };
}

// --- Mapping helpers ---

function mapSallaOrderToOrderInfo(order: SallaOrder): OrderInfoFull {
    const isRefunded = order.is_refunded || order.status.slug === 'refunded';

    return {
        orderNumber: order.reference_id,
        customerFirstName: order.customer?.first_name || '',
        customerPhone: order.customer?.mobile || undefined,
        status: mapSallaOrderStatus(order.status.slug),
        orderDate: order.date.date,
        items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: `${item.amounts.total.amount} ${item.amounts.total.currency}`,
        })),
        totalAmount: String(order.amounts.total.amount),
        currency: order.amounts.total.currency,
        paymentStatus: isRefunded ? 'refunded' : (order.status.slug === 'payment_pending' ? 'pending' : 'paid'),
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

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
import crypto from 'crypto';
import { tracedExternalCall } from '../utils/tracing';
import { eq, and, lt } from 'drizzle-orm';
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';
import { redis } from '../lib/redis';
import {
    getStoreById,
    updateStoreTokens,
    replaceProductsAndRebuildSummary,
} from './ecommerce';
import { stripHtml } from '../utils/htmlUtils';

const MAX_PRODUCTS_PER_PAGE = 65;
const MAX_PAGES_TO_FETCH = 4; // 260 products max
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const LOCK_WAIT_DELAY_MS = 2000; // wait for concurrent token refresh to finish
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
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

/**
 * Refresh the access token for a Salla store.
 * Uses a Redis distributed lock to prevent concurrent refreshes — Salla refresh
 * tokens are single-use, so a race condition would invalidate the token.
 */
export async function refreshAccessToken(storeId: string): Promise<void> {
    const lockKey = `salla:token_refresh:${storeId}`;

    // Acquire lock (NX = only if not exists, EX = 30s TTL as safety net)
    const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');
    if (!acquired) {
        // Another process is refreshing — wait and re-read from DB
        await new Promise(r => setTimeout(r, LOCK_WAIT_DELAY_MS));
        return;
    }

    try {
        const store = await getStoreById(storeId);
        if (!store) throw new Error('Store not found');

        // Re-check expiry (may have been refreshed while waiting for lock)
        const oneDayFromNow = new Date(Date.now() + ONE_DAY_MS);
        if (store.tokenExpiresAt && store.tokenExpiresAt > oneDayFromNow) return;

        if (!store.refreshToken || !store.refreshTokenIv) {
            throw new Error(`No refresh token for Salla store ${storeId}`);
        }

        const refreshToken = decrypt(store.refreshToken, store.refreshTokenIv);

        const response = await tracedExternalCall('salla', 'refreshAccessToken', () =>
            fetch('https://accounts.salla.sa/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: config.salla.clientId,
                    client_secret: config.salla.clientSecret,
                }),
            }),
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Salla token refresh failed: ${response.status} ${text}`);
        }

        const data = await response.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
        };

        // Store new tokens (both encrypted)
        await updateStoreTokens(storeId, {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        });
    } finally {
        await redis.del(lockKey);
    }
}

/**
 * Ensure the store has a valid access token. Refreshes if token expires within 24h.
 */
export async function ensureValidToken(storeId: string): Promise<void> {
    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    // If no expiry set or token still valid for > 24h, skip
    if (!store.tokenExpiresAt) return;

    const oneDayFromNow = new Date(Date.now() + ONE_DAY_MS);
    if (store.tokenExpiresAt > oneDayFromNow) return;

    await refreshAccessToken(storeId);
}

/**
 * Find stores with tokens expiring within 2 days (for periodic refresh checks)
 */
export async function getStoresNeedingTokenRefresh() {
    const twoDaysFromNow = new Date(Date.now() + 2 * ONE_DAY_MS);
    return db.select({ id: ecommerceStores.id }).from(ecommerceStores).where(
        and(
            eq(ecommerceStores.platform, 'salla'),
            eq(ecommerceStores.isActive, true),
            lt(ecommerceStores.tokenExpiresAt, twoDaysFromNow),
        )
    );
}

// --- Webhook Verification (hex HMAC, NOT base64) ---

export function verifyWebhookHmac(body: string, signature: string): boolean {
    if (!config.salla.webhookSecret) return false;
    const hash = crypto
        .createHmac('sha256', config.salla.webhookSecret)
        .update(body, 'utf8')
        .digest('hex');  // HEX not base64!
    const hashBuf = Buffer.from(hash);
    const sigBuf = Buffer.from(signature);
    if (hashBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, sigBuf);
}

// --- Webhook Registration via API ---

export const SALLA_WEBHOOK_EVENTS = [
    'product.created',
    'product.deleted',
    'product.price.updated',
    'product.status.updated',
    'product.quantity.low',
    'app.uninstalled',
    // Order lifecycle — for customer notifications
    'order.created',
    'order.updated',
    'order.shipping.update',
    'order.completed',
    'abandoned.cart',
] as const;

export type SallaWebhookEvent = typeof SALLA_WEBHOOK_EVENTS[number];

export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}

export function isOrderEvent(event: string): boolean {
    return event.startsWith('order.') || event === 'abandoned.cart';
}

export async function registerWebhooks(accessToken: string): Promise<void> {
    // Single endpoint receives all events — dispatches by event type in body
    const webhookUrl = `https://${config.salla.hostName}/salla/webhooks`;

    for (const event of SALLA_WEBHOOK_EVENTS) {
        try {
            const response = await tracedExternalCall('salla', 'registerWebhook', () =>
                fetch('https://api.salla.dev/admin/v2/webhooks/subscribe', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        name: event,
                        event,
                        url: webhookUrl,
                    }),
                }),
            );
            if (!response.ok) {
                const text = await response.text();
                // 422 = webhook already exists
                if (response.status !== 422) {
                    captureError(
                        new Error(`Salla webhook registration failed: ${event} ${response.status}`),
                        `Salla webhook registration failed: ${event}`,
                        { tags: { service: 'salla' }, extra: { event, status: response.status, body: text } }
                    );
                }
            }
        } catch (err) {
            captureError(err, `Salla webhook registration error: ${event}`, { tags: { service: 'salla' } });
        }
    }
}

// --- REST API Helper ---

async function sallaApiGet<T = unknown>(url: string, accessToken: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await tracedExternalCall('salla', 'apiGet', () =>
            fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            }),
        );

        // Retry on 429 (rate limit) or 5xx (server error)
        if (response.status === 429 || response.status >= 500) {
            const retryAfter = response.headers.get('retry-after');
            const delayMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, delayMs));
                continue;
            }
            lastError = new Error(`Salla API ${response.status} after ${MAX_RETRIES} retries`);
            break;
        }

        if (!response.ok) {
            throw new Error(`Salla API HTTP error: ${response.status}`);
        }

        return await response.json() as T;
    }

    throw lastError || new Error('Salla API request failed');
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
    await ensureValidToken(storeId);

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
    await ensureValidToken(storeId);

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
 * Refresh tokens for all stores nearing expiry.
 * Called periodically from the integration adapter (every 6h).
 */
export async function refreshExpiringTokens(): Promise<number> {
    const stores = await getStoresNeedingTokenRefresh();
    let refreshed = 0;

    for (const { id } of stores) {
        try {
            await refreshAccessToken(id);
            refreshed++;
        } catch (err) {
            captureError(err, `Salla token refresh failed for store ${id}`, {
                tags: { service: 'salla' },
                extra: { storeId: id },
            });
        }
    }

    return refreshed;
}

// --- E-Commerce Agent Tools (read-only order/tracking/inventory) ---

import type { OrderInfoFull, ShipmentInfoFull, InventoryInfo } from '@jawab24/shared';

/**
 * Resolve store credentials for a given storeId.
 * Ensures token is valid (refreshes if needed) and returns decrypted accessToken.
 */
async function resolveStoreCredentials(storeId: string): Promise<string | null> {
    await ensureValidToken(storeId);
    const store = await getStoreById(storeId);
    if (!store || !store.isActive) return null;
    if (!store.accessToken || !store.accessTokenIv) return null;
    return decrypt(store.accessToken, store.accessTokenIv);
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

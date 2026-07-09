/**
 * Zid e-commerce service — OAuth, REST API, product sync, webhook verification.
 *
 * Key differences from Salla/Shopify:
 * - Auth header is X-MANAGER-TOKEN (NOT Authorization: Bearer)
 * - Token expiry: 1 year (rare refresh needed)
 * - No shop domain input — Zid authenticates merchant directly
 * - Products API: GET https://api.zid.sa/v1/products
 * - Webhooks registered via API call after OAuth claim
 * - Webhook HMAC uses hex SHA256 digest (header: X-ZID-SIGNATURE)
 */
import { tracedExternalCall } from '../utils/tracing';
import { config } from '../config';
import { decrypt } from './ecommerceCrypto';
import { captureError } from '../utils/sentryHelpers';
import {
    getStoreById,
    replaceProductsAndRebuildSummary,
    applySyncedStoreInfo,
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

const MAX_PRODUCTS_PER_PAGE = 50;
const MAX_PAGES_TO_FETCH = 6; // 300 products max
const ERROR_TEXT_MAX_LENGTH = 200;

const ZID_TOKEN_REFRESH_CONFIG: TokenRefreshConfig = {
    platform: 'zid',
    tokenEndpointUrl: 'https://oauth.zid.sa/oauth/token',
    get clientId() { return config.zid.clientId; },
    get clientSecret() { return config.zid.clientSecret; },
};

// --- OAuth ---

export function buildAuthUrl(state: string): string {
    const { clientId, hostName, scopes } = config.zid;
    const redirectUri = `https://${hostName}/zid/auth/callback`;
    return (
        `https://oauth.zid.sa/oauth/authorize` +
        `?client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&state=${state}`
    );
}

export interface ZidTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number; // seconds — typically 1 year
}

export async function exchangeCodeForToken(code: string): Promise<ZidTokenResponse> {
    const { clientId, clientSecret, hostName } = config.zid;
    const redirectUri = `https://${hostName}/zid/auth/callback`;

    const response = await tracedExternalCall('zid', 'exchangeCodeForToken', () =>
        fetch('https://oauth.zid.sa/oauth/token', {
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
        throw new Error(`Zid token exchange failed: ${response.status} ${text}`);
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

// --- Token Refresh (distributed lock — refresh tokens may be single-use) ---

// --- Webhook Verification ---

export function verifyWebhookHmac(body: string, signature: string): boolean {
    return verifyHexHmac(body, signature, config.zid.webhookSecret);
}

// --- Webhook Registration ---

export const ZID_WEBHOOK_EVENTS = [
    'product.created',
    'product.updated',
    'product.deleted',
    'app.uninstalled',
    // Order lifecycle — for customer notifications
    'order.created',
    'order.updated',
    'order.shipped',
    'order.delivered',
] as const;

export type ZidWebhookEvent = typeof ZID_WEBHOOK_EVENTS[number];

export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}

export function isOrderEvent(event: string): boolean {
    return event.startsWith('order.');
}

export async function registerWebhooks(accessToken: string): Promise<WebhookRegistrationResult> {
    // Topics subscribed in parallel — see services/salla.ts for rationale.
    const webhookUrl = `https://${config.zid.hostName}/zid/webhooks`;
    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];

    const results = await Promise.allSettled(ZID_WEBHOOK_EVENTS.map(event =>
        tracedExternalCall('zid', 'registerWebhook', () =>
            fetch('https://api.zid.sa/v1/webhooks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-MANAGER-TOKEN': accessToken,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ event, url: webhookUrl }),
            }).then(async response => ({ event, response, body: response.ok ? '' : await response.text() })),
        ),
    ));

    for (let i = 0; i < results.length; i++) {
        const event = ZID_WEBHOOK_EVENTS[i];
        const result = results[i];
        if (result.status === 'rejected') {
            const err = result.reason;
            failed.push({ topic: event, error: err instanceof Error ? err.message : String(err) });
            captureError(err, `Zid webhook registration error: ${event}`, { tags: { service: 'zid' } });
            continue;
        }
        const { response, body } = result.value;
        if (response.ok) {
            registered.push(event);
        } else if (response.status === 409) {
            // 409 = webhook already exists, treat as success (mirrors Shopify 422 / Salla 422)
            registered.push(event);
        } else {
            failed.push({ topic: event, status: response.status, error: body.slice(0, ERROR_TEXT_MAX_LENGTH) });
            captureError(
                new Error(`Zid webhook registration failed: ${event} ${response.status}`),
                `Zid webhook registration failed: ${event}`,
                { tags: { service: 'zid' }, extra: { event, status: response.status, body } }
            );
        }
    }

    return { registered, failed, lastAttempt: new Date().toISOString() };
}

// --- REST API Helper ---

function zidApiGet<T = unknown>(url: string, accessToken: string): Promise<T> {
    return ecommerceApiGet<T>(url, {
        platform: 'zid',
        authHeaderName: 'X-MANAGER-TOKEN',
        authHeaderValue: accessToken,
    });
}

// --- Store Info ---

export async function fetchStoreInfo(accessToken: string) {
    const data = await zidApiGet<{
        store: {
            id: string | number;
            name: string;
            email: string;
            currency: string;
            domain: string;
        };
    }>('https://api.zid.sa/v1/store/info', accessToken);

    const s = data.store;
    return {
        storeName: s.name,
        storeEmail: s.email,
        storeCurrency: s.currency,
        storeDomain: s.domain,
        merchantId: String(s.id),
    };
}

// --- Products (REST, page-based) ---

interface ZidProduct {
    id: string;
    name: string;
    description?: string; // May be HTML — stripped before storage
    status: string; // 'active' | 'inactive' | 'out_of_stock'
    price: number;
    currency?: string;
    quantity: number | null;
    sku?: string | null;
    handle?: string | null;
    images?: Array<{ url: string }>;
    categories?: Array<{ name: string }>;
    has_variants?: boolean;
    options?: Array<{
        name: string;
        values: Array<{ name: string }>;
    }>;
}

interface ZidProductsResponse {
    store_products: ZidProduct[];
    meta?: {
        current_page: number;
        last_page: number;
        per_page: number;
        total: number;
    };
}

function mapZidStatus(status: string): string {
    switch (status) {
        case 'active': return 'active';
        case 'inactive': return 'hidden';
        case 'out_of_stock': return 'out_of_stock';
        default: return status;
    }
}

function buildZidVariantSummary(options: ZidProduct['options']): string {
    if (!options || options.length === 0) return '';
    return options
        .map(opt => `${opt.name}: ${opt.values.map(v => v.name).join(', ')}`)
        .join(' | ');
}

async function fetchAllProducts(accessToken: string): Promise<ZidProduct[]> {
    const allProducts: ZidProduct[] = [];
    let page = 1;

    while (page <= MAX_PAGES_TO_FETCH) {
        const data = await zidApiGet<ZidProductsResponse>(
            `https://api.zid.sa/v1/products?per_page=${MAX_PRODUCTS_PER_PAGE}&page=${page}`,
            accessToken,
        );

        const products = data.store_products || [];
        allProducts.push(...products);

        const lastPage = data.meta?.last_page ?? 1;
        if (page >= lastPage || products.length === 0) break;
        page++;
    }

    return allProducts;
}

export async function syncProducts(storeId: string) {
    await sharedEnsureValidToken(storeId, ZID_TOKEN_REFRESH_CONFIG);

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);
    const products = await fetchAllProducts(accessToken);
    const currency = store.storeCurrency || 'SAR';

    const mapped = products
        .filter(p => p.status !== 'deleted')
        .map(p => {
            const priceRange = `${p.price} ${p.currency || currency}`;
            const variantSummary = buildZidVariantSummary(p.options);
            const category = p.categories?.[0]?.name || null;

            return {
                platformProductId: String(p.id),
                handle: p.handle || null,
                title: p.name,
                description: p.description ? stripHtml(p.description) : null,
                productType: category,
                vendor: null as string | null,
                status: mapZidStatus(p.status),
                priceRange,
                currency: p.currency || currency,
                totalInventory: p.quantity ?? 0,
                hasVariants: p.has_variants || (p.options?.length ?? 0) > 0,
                variantSummary: variantSummary || null,
                tags: null as string | null,
                imageUrl: p.images?.[0]?.url || null,
            };
        });

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

export async function fullSync(storeId: string) {
    await sharedEnsureValidToken(storeId, ZID_TOKEN_REFRESH_CONFIG);

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const accessToken = decrypt(store.accessToken, store.accessTokenIv);

    // platformData is merged, not replaced — a full sync must not wipe
    // webhookStatus/tokenHealth written by other flows.
    const storeInfo = await fetchStoreInfo(accessToken);
    await applySyncedStoreInfo(storeId, {
        storeName: storeInfo.storeName,
        storeEmail: storeInfo.storeEmail,
        storeCurrency: storeInfo.storeCurrency,
    }, { merchantId: storeInfo.merchantId });

    return syncProducts(storeId);
}

// --- Periodic Token Refresh ---

/**
 * Refresh tokens for all Zid stores nearing expiry.
 * Called periodically from the integration adapter (every 6h).
 */
export async function refreshExpiringTokens(): Promise<number> {
    return sharedRefreshExpiringTokens(ZID_TOKEN_REFRESH_CONFIG);
}

export async function refreshAccessToken(storeId: string): Promise<void> {
    return sharedRefreshAccessToken(storeId, ZID_TOKEN_REFRESH_CONFIG);
}

export async function ensureValidToken(storeId: string): Promise<void> {
    return sharedEnsureValidToken(storeId, ZID_TOKEN_REFRESH_CONFIG);
}

export async function getStoresNeedingTokenRefresh() {
    return sharedGetStoresNeedingTokenRefresh('zid');
}

// --- E-Commerce Agent Tools (read-only order/inventory) ---

import type { OrderInfoFull, ShipmentInfoFull, InventoryInfo } from '@jawab24/shared';

async function resolveStoreCredentials(storeId: string): Promise<string | null> {
    return resolveStoreAccessToken(storeId, ZID_TOKEN_REFRESH_CONFIG);
}

// --- Zid Order Response Types ---

interface ZidOrderItem {
    name: string;
    quantity: number;
    price: number;
    currency: string;
}

interface ZidOrder {
    id: string;
    order_id?: string;
    reference_id?: string;
    status: string;
    payment_method?: string;
    total_amount: number;
    currency: string;
    customer_name?: string;
    customer_phone?: string;
    shipping_city?: string;
    created_at?: string;
    items?: ZidOrderItem[];
    tracking_number?: string;
    courier_name?: string;
    tracking_url?: string;
}

interface ZidOrdersResponse {
    orders: ZidOrder[];
}

interface ZidOrderDetailResponse {
    order: ZidOrder;
}

export async function lookupOrder(storeId: string, orderNumber: string): Promise<OrderInfoFull | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    const data = await zidApiGet<ZidOrdersResponse>(
        `https://api.zid.sa/v1/orders?search=${encodeURIComponent(orderNumber)}`,
        accessToken,
    );

    const order = data.orders?.[0];
    if (!order) return null;

    return mapZidOrderToOrderInfo(order);
}

export async function getShipmentTracking(storeId: string, orderNumber: string): Promise<ShipmentInfoFull | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    const searchData = await zidApiGet<ZidOrdersResponse>(
        `https://api.zid.sa/v1/orders?search=${encodeURIComponent(orderNumber)}`,
        accessToken,
    );

    const orderSummary = searchData.orders?.[0];
    if (!orderSummary) return null;

    const detailData = await zidApiGet<ZidOrderDetailResponse>(
        `https://api.zid.sa/v1/orders/${orderSummary.id}`,
        accessToken,
    );

    const order = detailData.order;

    return {
        orderNumber: order.reference_id || order.order_id || order.id,
        customerFirstName: order.customer_name?.split(' ')[0] || '',
        customerPhone: order.customer_phone || undefined,
        status: mapZidOrderStatus(order.status),
        trackingNumber: order.tracking_number || undefined,
        courierName: order.courier_name || undefined,
        trackingUrl: order.tracking_url || undefined,
        estimatedDelivery: undefined,
        shippingCity: order.shipping_city || undefined,
    };
}

export async function checkInventory(storeId: string, productName: string, variant?: string): Promise<InventoryInfo | null> {
    const accessToken = await resolveStoreCredentials(storeId);
    if (!accessToken) return null;

    const data = await zidApiGet<ZidProductsResponse>(
        `https://api.zid.sa/v1/products?search=${encodeURIComponent(productName)}&per_page=5`,
        accessToken,
    );

    const products = (data.store_products || []).filter(p => p.status !== 'deleted');
    if (products.length === 0) return null;

    const lowerQuery = productName.toLowerCase();
    const bestMatch = products.find(p => p.name.toLowerCase().includes(lowerQuery)) || products[0];

    const allVariants = (bestMatch.options || []).flatMap(opt =>
        opt.values.map(v => ({
            name: `${opt.name}: ${v.name}`,
            available: (bestMatch.quantity ?? 0) > 0,
            quantity: bestMatch.quantity ?? 0,
        }))
    );

    let filteredVariants = allVariants;
    if (variant) {
        const lowerVariant = variant.toLowerCase();
        filteredVariants = allVariants.filter(v => v.name.toLowerCase().includes(lowerVariant));
    }

    const store = await getStoreById(storeId);
    const storeDomain = store?.storeDomain || null;

    const currency = bestMatch.currency || store?.storeCurrency || 'SAR';

    return {
        productName: bestMatch.name,
        available: (bestMatch.quantity ?? 0) > 0,
        quantity: bestMatch.quantity ?? 0,
        variants: (filteredVariants.length > 0 ? filteredVariants : allVariants).length > 0
            ? (filteredVariants.length > 0 ? filteredVariants : allVariants)
            : undefined,
        price: `${bestMatch.price} ${currency}`,
        currency,
        productUrl: bestMatch.handle && storeDomain
            ? `https://${storeDomain}/products/${bestMatch.handle}`
            : undefined,
    };
}

// --- Mapping helpers ---

function mapZidOrderToOrderInfo(order: ZidOrder): OrderInfoFull {
    return {
        orderNumber: order.reference_id || order.order_id || order.id,
        customerFirstName: order.customer_name?.split(' ')[0] || '',
        customerPhone: order.customer_phone || undefined,
        status: mapZidOrderStatus(order.status),
        orderDate: order.created_at || '',
        items: (order.items || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: `${item.price} ${item.currency}`,
        })),
        totalAmount: String(order.total_amount),
        currency: order.currency,
        paymentStatus: order.status === 'refunded' ? 'refunded' : 'paid',
        shippingCity: order.shipping_city || undefined,
    };
}

function mapZidOrderStatus(status: string): string {
    const map: Record<string, string> = {
        'pending': 'pending',
        'confirmed': 'processing',
        'processing': 'processing',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'cancelled': 'cancelled',
        'refunded': 'refunded',
    };
    return map[status] || status;
}

import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import * as shopifyService from '../services/shopify';
import { workspaceService } from '../services/workspace';
import type { WorkspaceRequest } from '../middleware/workspace';
import { enqueueSyncJob } from '../lib/ecommerceSyncQueue';
import { upsertSingleProduct, deleteSingleProduct, registerWebhooksWithPersist, purgeStore, redactCustomerNotifications } from '../services/ecommerce';
import { config } from '../config';
import {
    dispatchOrderNotification,
    orderConfirmedEvent,
    orderShippedEvent,
    orderDeliveredEvent,
} from '../services/orderNotificationScheduler';
import type { OrderEvent } from '../services/orderNotificationScheduler';
import {
    PENDING_SHOPIFY_COOKIE_OPTIONS,
    SHOPIFY_NONCE_COOKIE_OPTIONS,
} from '../services/cookies';
import { tryGetUserId } from '../utils/authHelpers';
import { captureError } from '../utils/sentryHelpers';

/**
 * A shop domain must be a `*.myshopify.com` host. Validated on BOTH legs of the
 * OAuth flow: `authRedirect` (before we build the auth URL) and `authCallback`
 * (before we POST the app client_secret to the shop). Without the callback-side
 * check, a caller holding a valid nonce could point `shop` at an arbitrary host
 * and exfiltrate the app secret via `exchangeCodeForToken`.
 */
const SHOPIFY_SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * Tag a Shopify webhook crash for Sentry routing. Shopify retries 5xx
 * webhooks 19 times over 48h then silently gives up — without explicit
 * tags, a handler crash is undetectable from production noise.
 */
function reportWebhookFailure(
    request: FastifyRequest,
    webhookName: string,
    error: unknown,
) {
    captureError(error, `Shopify webhook handler failed: ${webhookName}`, {
        tags: {
            service: 'shopify',
            webhook: webhookName,
        },
        extra: {
            shopDomain: request.headers['x-shopify-shop-domain'],
            topic: request.headers['x-shopify-topic'],
            webhookId: request.headers['x-shopify-webhook-id'],
        },
    });
}

// --- OAuth Flow (PUBLIC — no JWT required) ---

export async function authRedirect(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop?: string };

    if (!shop || !SHOPIFY_SHOP_DOMAIN.test(shop)) {
        return reply.status(400).send({ error: 'Invalid shop domain' });
    }

    // Generate cryptographic nonce for CSRF protection
    const nonce = crypto.randomBytes(16).toString('hex');

    // Set signed nonce cookie (sameSite: lax for cross-site Shopify redirect)
    reply.setCookie('shopifyNonce', nonce, SHOPIFY_NONCE_COOKIE_OPTIONS);

    const authUrl = shopifyService.buildAuthUrl(shop, nonce);
    return reply.redirect(authUrl);
}

/**
 * Verify Shopify OAuth callback query-string HMAC.
 * Shopify signs all query params (except `hmac` itself) with the app secret.
 * Used when Shopify initiates the install (no state/nonce available).
 */
function verifyCallbackHmac(query: Record<string, string>): boolean {
    const { hmac, ...params } = query;
    if (!hmac) return false;

    // Sort params alphabetically and build query string
    const message = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const digest = crypto
        .createHmac('sha256', config.shopify.apiSecret)
        .update(message)
        .digest('hex');

    // Timing-safe comparison
    const digestBuf = Buffer.from(digest);
    const hmacBuf = Buffer.from(hmac);
    if (digestBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(digestBuf, hmacBuf);
}

export async function authCallback(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as Record<string, string>;
    const { shop, code, state } = query;

    if (!shop || !code) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: missing shop or code' });
    }

    // Re-validate the shop host before any token exchange. A valid nonce alone
    // must NOT authorize sending the app client_secret to an arbitrary `shop`.
    if (!SHOPIFY_SHOP_DOMAIN.test(shop)) {
        return reply.status(400).send({ error: 'Invalid OAuth callback: invalid shop domain' });
    }

    // Two validation paths:
    // 1. User-initiated (from Jawab24 settings): validate state/nonce cookie
    // 2. Shopify-initiated (from Partners/App Store): validate HMAC query signature
    const nonceCookie = request.cookies.shopifyNonce;
    let storedNonce: string | null = null;
    if (nonceCookie) {
        const unsigned = request.unsignCookie(nonceCookie);
        if (unsigned.valid && unsigned.value) {
            storedNonce = unsigned.value;
        }
    }

    if (state && storedNonce) {
        // User-initiated flow: validate nonce
        if (state !== storedNonce) {
            return reply.status(400).send({ error: 'Invalid OAuth callback: state mismatch' });
        }
    } else {
        // Shopify-initiated flow: validate HMAC signature
        if (!verifyCallbackHmac(query)) {
            return reply.status(400).send({ error: 'Invalid OAuth callback: HMAC verification failed' });
        }
    }

    // Clear the nonce cookie
    reply.clearCookie('shopifyNonce', { path: '/' });

    const frontendUrl = config.frontendUrl;

    try {
        // Exchange code for access token
        const accessToken = await shopifyService.exchangeCodeForToken(shop, code);

        // Check if user is already logged in
        const userId = tryGetUserId(request);

        if (userId) {
            // --- LOGGED IN: Create store directly ---
            const workspaces = await workspaceService.getUserWorkspaces(userId);
            const workspaceId = workspaces[0]?.id || null;
            const store = await shopifyService.createStore(userId, shop, accessToken, undefined, workspaceId);

            // Register webhooks with persist-on-throw + retry queue (was
            // fire-and-forget; A-1.9). On any failure the helper persists a
            // marker and enqueues a retry so the merchant doesn't silently
            // miss webhooks.
            await registerWebhooksWithPersist(
                store.id,
                'shopify',
                () => shopifyService.registerWebhooks(shop, accessToken),
            );

            // Enqueue full sync (non-blocking)
            enqueueSyncJob(store.id).catch(err => {
                request.log.error({ err }, 'Failed to enqueue Shopify sync');
            });

            return reply.redirect(`${frontendUrl}/shopify/onboarding`);
        } else {
            // --- NOT LOGGED IN: Create pending install ---

            // Check if shop is already actively linked to a user
            const existingStore = await shopifyService.getStoreByDomain(shop);
            if (existingStore && existingStore.isActive) {
                return reply.redirect(`${frontendUrl}/login?shopify_error=already_connected`);
            }

            const pendingId = await shopifyService.createPendingInstall({
                shopDomain: shop,
                accessToken,
                scopes: config.shopify.scopes,
                nonce: state || crypto.randomBytes(16).toString('hex'),
            });

            // Set pending install cookie (sameSite: lax, 30min TTL)
            reply.setCookie('pendingShopifyId', pendingId, PENDING_SHOPIFY_COOKIE_OPTIONS);

            return reply.redirect(`${frontendUrl}/login?shopify_pending=true`);
        }
    } catch (error) {
        request.log.error({ error }, 'Shopify auth callback failed');
        return reply.redirect(`${frontendUrl}/login?shopify_error=auth_failed`);
    }
}

// --- Webhooks (Shopify calls these — HMAC verified) ---

export async function webhookUninstall(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const { myshopify_domain } = request.body as { myshopify_domain?: string };
        if (myshopify_domain) {
            // D-D: cancel the local billing mirror FIRST — it is keyed on
            // subscriptions.shopify_shop_domain, not on the store row, but
            // running it before deactivateStore keeps the ordering safe if the
            // store row ever becomes an input. Without this, uninstalling left
            // a paid local subscription alive forever (the D-023 bug class).
            const { cancelShopifySubscriptionLocal } = await import('../services/shopifyBilling');
            await cancelShopifySubscriptionLocal(myshopify_domain, 'shopify_app_uninstalled', request.log);
            await shopifyService.deactivateStore(myshopify_domain);
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'app-uninstalled', error);
        throw error;
    }
}

export async function webhookProductsUpdate(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const shopDomain = request.headers['x-shopify-shop-domain'] as string;
        const topic = request.headers['x-shopify-topic'] as string;

        if (!shopDomain) {
            return reply.status(200).send({ ok: true });
        }

        const store = await shopifyService.getStoreByDomain(shopDomain);
        if (!store) {
            return reply.status(200).send({ ok: true });
        }

        // Per-row upsert — bug B-3.1. Editing one product no longer rotates
        // every other product's internal id. The 6h scheduled full-sync still
        // catches missed webhooks (now idempotent thanks to onConflictDoUpdate).
        const payload = request.body as { id?: number | string };
        if (!payload || payload.id === undefined || payload.id === null) {
            request.log.warn({ topic, shopDomain }, 'Shopify product webhook missing id');
            return reply.status(200).send({ ok: true });
        }

        if (topic === 'products/delete') {
            await deleteSingleProduct(store.id, String(payload.id));
        } else {
            // products/create + products/update. The REST webhook has no shop currency,
            // so pass the store's currency in — the mapper builds both currency and the
            // priceRange string with it, matching the full-sync format immediately.
            const normalized = shopifyService.mapShopifyWebhookProduct(payload as never, store.storeCurrency || '');
            await upsertSingleProduct(store.id, normalized);
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'products-update', error);
        throw error;
    }
}

export async function webhookOrders(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const shopDomain = request.headers['x-shopify-shop-domain'] as string;
        const topic = request.headers['x-shopify-topic'] as string;

        if (shopDomain) {
            const store = await shopifyService.getStoreByDomain(shopDomain);
            if (store) {
                const orderEvent = buildShopifyOrderEvent(store.id, topic, request.body);
                if (orderEvent) dispatchOrderNotification(orderEvent, request.log);
            }
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'orders', error);
        throw error;
    }
}

interface ShopifyOrderBody {
    id?: number;
    order_number?: number;
    phone?: string | null;
    customer?: { phone?: string | null; first_name?: string };
    shipping_address?: { phone?: string | null; first_name?: string } | null;
    billing_address?: { phone?: string | null; first_name?: string } | null;
    fulfillments?: Array<{ tracking_number?: string }>;
}

function buildShopifyOrderEvent(storeId: string, topic: string, body: unknown): OrderEvent | null {
    const order = body as ShopifyOrderBody;
    // customer.phone is the customer-ACCOUNT phone and is null for guest/one-off
    // checkouts (most social-commerce buyers). Fall back through the order-level and
    // address phones — same chain the delivered path uses (getOrderNotificationTarget).
    const phone = order.customer?.phone || order.phone
        || order.shipping_address?.phone || order.billing_address?.phone;
    if (!phone) return null;

    const orderId = String(order.id ?? '');
    const orderNumber = String(order.order_number ?? order.id ?? '');
    const trackingNumber = order.fulfillments?.[0]?.tracking_number;
    const customerName = order.customer?.first_name
        || order.shipping_address?.first_name || order.billing_address?.first_name;

    if (topic === 'orders/create') {
        return orderConfirmedEvent('shopify', storeId, { customerPhone: phone, customerName, orderId, orderNumber });
    } else if (topic === 'orders/fulfilled') {
        return orderShippedEvent('shopify', storeId, { customerPhone: phone, customerName, orderId, orderNumber, trackingNumber });
    }
    // orders/cancelled is subscribed but intentionally unhandled (no cancellation
    // notification is designed yet) → returns null here, so the webhook is 200'd
    // without dispatching. Add a branch here + an i18n template to enable it.
    //
    // Delivery is NOT an orders/* event: the order-level fulfillment_status enum is only
    // null|partial|fulfilled|restocked — never 'delivered'. Delivery arrives on the
    // fulfillments/update topic (see webhookFulfillments) via fulfillment.shipment_status.
    return null;
}

// fulfillments/update carries the delivery signal (`shipment_status`) that orders/* lacks.
// Payload fields we rely on: { order_id, shipment_status, destination: { first_name, phone } }.
// (An earlier version of this comment also listed `tracking_number`; nothing here reads it,
// and the delivered template carries no tracking placeholder.)
interface ShopifyFulfillmentBody {
    order_id?: number;
    shipment_status?: string | null;
    destination?: { first_name?: string; phone?: string } | null;
}

export async function webhookFulfillments(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        const fulfillment = request.body as ShopifyFulfillmentBody;
        // Only act on the terminal 'delivered' status. Other values (in_transit,
        // out_for_delivery, attempted_delivery, failure, …) fire the same topic repeatedly;
        // the order_delivered dedup key collapses duplicate 'delivered' deliveries.
        if (fulfillment.shipment_status !== 'delivered' || !fulfillment.order_id) {
            return reply.status(200).send({ ok: true });
        }

        const shopDomain = request.headers['x-shopify-shop-domain'] as string;
        if (shopDomain) {
            // Resolve + dispatch AFTER the ACK: the canonical-order lookup is a Shopify
            // GraphQL round-trip (retry/throttle back-off can exceed Shopify's ~5s webhook
            // timeout — a late 200 marks the delivery failed and triggers redelivery).
            // The order_delivered dedup key makes any redelivery double-dispatch safe.
            void resolveDeliveredTargetAndDispatch(shopDomain, fulfillment.order_id, fulfillment.destination, request).catch(error => {
                reportWebhookFailure(request, 'fulfillments-dispatch', error);
            });
        }

        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'fulfillments', error);
        throw error;
    }
}

async function resolveDeliveredTargetAndDispatch(
    shopDomain: string,
    orderId: number,
    destination: ShopifyFulfillmentBody['destination'],
    request: FastifyRequest,
): Promise<void> {
    const store = await shopifyService.getStoreByDomain(shopDomain);
    if (!store) return;

    // Prefer the canonical order (E.164 phone, order name) over the webhook's
    // unnormalized destination fields. getOrderNotificationTarget THROWS on a
    // GraphQL failure — and since this runs post-ACK there's no webhook retry to
    // save us, so a throw must NOT drop the notification: fall back to the
    // destination fields the webhook already carries (no API call needed).
    let target: Awaited<ReturnType<typeof shopifyService.getOrderNotificationTarget>> = null;
    try {
        target = await shopifyService.getOrderNotificationTarget(store.id, orderId);
    } catch (error) {
        captureError(error, 'Shopify getOrderNotificationTarget failed; using webhook destination', {
            tags: { service: 'shopify', webhook: 'fulfillments' },
            extra: { orderId },
        });
    }
    const phone = target?.phone || destination?.phone;
    if (!phone) return;

    dispatchOrderNotification(orderDeliveredEvent('shopify', store.id, {
        customerPhone: phone,
        customerName: target?.firstName || destination?.first_name,
        orderId: String(orderId),
        orderNumber: target?.orderNumber || String(orderId),
    }), request.log);
}

// --- GDPR Mandatory Endpoints (HMAC-verified) ---
// customers/redact deletes the customer's stored PII (phone + name persisted in
// customer_notifications_log from order/cart webhooks). shop/redact hard-deletes
// the store and ALL its data (encrypted tokens, products, notification PII) via
// purgeStore. customers/data_request is acknowledged + logged for manual
// fulfilment within Shopify's 30-day window (no self-serve export portal yet).

function verifyShopifyWebhookHmac(request: FastifyRequest, reply: FastifyReply): boolean {
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = request.rawBody;
    if (!rawBody) {
        reply.status(401).send({ error: 'Missing raw body for HMAC verification' });
        return false;
    }
    const body = rawBody.toString('utf8');
    if (!hmac || !shopifyService.verifyWebhookHmac(body, hmac)) {
        reply.status(401).send({ error: 'Invalid HMAC' });
        return false;
    }
    return true;
}

export async function gdprCustomerDataRequest(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;
        // We persist minimal customer PII (phone + name in customer_notifications_log).
        // No self-serve export yet — log for manual fulfilment within Shopify's 30-day
        // window, and acknowledge promptly as Shopify requires.
        const { shop_domain } = request.body as { shop_domain?: string };
        request.log.info({ shop_domain }, 'Shopify GDPR customers/data_request received');
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-customers-data-request', error);
        throw error;
    }
}

export async function gdprCustomerRedact(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;
        const { shop_domain, customer } = request.body as {
            shop_domain?: string;
            customer?: { phone?: string };
        };
        if (shop_domain && customer?.phone) {
            const removed = await redactCustomerNotifications('shopify', shop_domain, customer.phone);
            request.log.info({ shop_domain, removed }, 'Shopify GDPR customers/redact processed');
        }
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-customers-redact', error);
        throw error;
    }
}

export async function gdprShopRedact(request: FastifyRequest, reply: FastifyReply) {
    try {
        if (!verifyShopifyWebhookHmac(request, reply)) return;

        // shop/redact fires 48h after uninstall — the signal to fully erase the shop.
        // Hard-delete (tokens, products, customer-notification PII) rather than the
        // soft deactivate done at uninstall time.
        const { shop_domain } = request.body as { shop_domain?: string };
        if (shop_domain) {
            // shop/redact is a second HMAC-verified, provably-post-uninstall
            // signal: if the uninstall webhook was missed, the paid local
            // mirror is still live here. Cancel it (idempotent no-op when the
            // uninstall path already did) instead of leaving it to the
            // orphan-flag → human loop — prevention over detection.
            const { cancelShopifySubscriptionLocal } = await import('../services/shopifyBilling');
            await cancelShopifySubscriptionLocal(shop_domain, 'shopify_shop_redacted', request.log);

            const purged = await purgeStore('shopify', shop_domain);
            request.log.info({ shop_domain, purged }, 'Shopify GDPR shop/redact processed');
        }
        return reply.status(200).send({ ok: true });
    } catch (error) {
        reportWebhookFailure(request, 'gdpr-shop-redact', error);
        throw error;
    }
}

// --- Protected API (Jawab24 JWT required) ---

export async function getStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    // Return inactive stores too so the frontend can show a Reconnect card
    const store = await shopifyService.getStoreByWorkspaceAny(req.workspaceId);
    if (!store) {
        return reply.send(null);
    }
    return reply.send(shopifyService.mapToEcommerceStore(store));
}

export async function connectStore(request: FastifyRequest, reply: FastifyReply) {
    const { shopDomain } = request.body as { shopDomain?: string };
    if (!shopDomain || !SHOPIFY_SHOP_DOMAIN.test(shopDomain)) {
        return reply.status(400).send({ error: 'Invalid shop domain. Use format: store-name.myshopify.com' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    reply.setCookie('shopifyNonce', nonce, SHOPIFY_NONCE_COOKIE_OPTIONS);

    const authUrl = shopifyService.buildAuthUrl(shopDomain, nonce);
    return reply.send({ authUrl });
}

/**
 * GET /shopify/billing/return — the redirection URL configured on every App
 * Pricing plan. Shopify sends the merchant here after they approve (or abandon)
 * a plan selection. The query params (`shop`, `plan_handle`, `charge_id`) are
 * UNTRUSTED triggers only (D-C): billing state is verified server-side through
 * syncShopifyBilling; nothing is ever activated from a redirect param. Public
 * and rate-limited — the merchant may not be logged in in this browser, and the
 * 6-hourly reconciler redoes any sync that fails here, so every path ends in a
 * redirect, never an error page.
 */
export async function billingReturn(request: FastifyRequest, reply: FastifyReply) {
    const { shop } = request.query as { shop?: string };
    const frontendUrl = config.frontendUrl;

    if (!shop || !SHOPIFY_SHOP_DOMAIN.test(shop)) {
        return reply.redirect(`${frontendUrl}/dashboard`);
    }

    let billingParam = 'synced';
    try {
        const { syncShopifyBilling } = await import('../services/shopifyBilling');
        const result = await syncShopifyBilling(shop, request.log);
        request.log.info({ shop, outcome: result.outcome }, 'Shopify billing return processed');
    } catch (error) {
        // In-band access-log breadcrumb (the Rule-17b marker doctrine): nothing
        // reads this param client-side today — its job is making a failed
        // return-leg sync greppable in nginx logs. The reconciler redoes the sync.
        billingParam = 'sync_failed';
        captureError(error, 'Shopify billing return sync failed — reconciler will retry', {
            tags: { service: 'shopify_billing', flow: 'billing_return' },
            extra: { shop },
        });
    }

    return reply.redirect(`${frontendUrl}/shopify/onboarding?billing=${billingParam}`);
}

export async function disconnectStoreHandler(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }
    await shopifyService.disconnectStore(store.id);
    return reply.send({ ok: true });
}

export async function syncStore(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const result = await shopifyService.fullSync(store.id);
    return reply.send(result);
}

export async function getStoreProducts(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    const products = await shopifyService.getProducts(store.id);
    return reply.send({ products, total: products.length });
}

export async function linkPage(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    const store = await shopifyService.getStoreByWorkspace(req.workspaceId);
    if (!store) {
        return reply.status(404).send({ error: 'No Shopify store connected' });
    }

    try {
        await shopifyService.linkStoreToPage(store.id, pageId, req.workspaceId);
        return reply.send({ ok: true });
    } catch (error) {
        if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
            return reply.status(403).send({ error: 'Page does not belong to workspace' });
        }
        throw error;
    }
}

export async function unlinkPage(request: FastifyRequest, reply: FastifyReply) {
    const req = request as WorkspaceRequest;
    if (!req.workspaceId) return reply.status(401).send({ error: 'Unauthorized' });
    const { pageId } = request.body as { pageId?: string };

    if (!pageId) {
        return reply.status(400).send({ error: 'pageId is required' });
    }

    try {
        await shopifyService.unlinkStoreFromPage(pageId, req.workspaceId);
        return reply.send({ ok: true });
    } catch (error) {
        if (error instanceof Error && error.message?.includes('does not belong to workspace')) {
            return reply.status(403).send({ error: 'Page does not belong to workspace' });
        }
        throw error;
    }
}

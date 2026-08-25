/**
 * Shared order notification scheduling logic.
 *
 * Each e-commerce platform (Salla, Shopify, Zid) has different webhook payload
 * shapes and event names. This module provides a single `scheduleOrderNotifications`
 * function that accepts a platform-normalized `OrderEvent`, eliminating duplication
 * across platform controllers.
 */
import { customerNotificationService, OrderNotificationType } from './customerNotifications';
import { captureError } from '../utils/sentryHelpers';

export interface OrderEvent {
    platform: string;
    storeId: string;
    type: OrderNotificationType;
    customerPhone: string;
    customerName?: string;
    orderId: string;
    orderNumber: string;
    trackingNumber?: string;
    cartTotal?: string;
    /** Minimum delay before sending (ms). Effective delay = max(template delay, this).
     *  Used to hold a tracking-less shipped SMS briefly so a later shipment webhook
     *  carrying the tracking number can upgrade it in place. */
    minDelayMs?: number;
    /** On dedup conflict, upgrade the still-pending row's rendered message instead of
     *  skipping — lets a tracking-bearing shipment webhook enrich an earlier row. */
    upgradePendingOnDuplicate?: boolean;
    /** Additional notification types to schedule together (e.g. review_request after delivery) */
    also?: Array<{ type: OrderNotificationType; variables: Record<string, string> }>;
}

/** Fields shared by every order-derived notification, common to all platforms. */
export interface OrderEventFields {
    customerPhone: string;
    customerName?: string;
    orderId: string;
    orderNumber: string;
}

// Factories that build a platform-normalized OrderEvent. Each platform's webhook
// controller extracts these fields from its own payload shape, then calls the matching
// factory — keeping the event-shape (and the "review_request after delivery" rule) in
// one place instead of duplicated across the Salla/Shopify/Zid controllers.

export function orderConfirmedEvent(platform: string, storeId: string, fields: OrderEventFields): OrderEvent {
    return { platform, storeId, type: 'order_confirmed', ...fields };
}

export function orderShippedEvent(
    platform: string,
    storeId: string,
    fields: OrderEventFields & { trackingNumber?: string; minDelayMs?: number; upgradePendingOnDuplicate?: boolean },
): OrderEvent {
    return { platform, storeId, type: 'order_shipped', ...fields };
}

export function orderDeliveredEvent(platform: string, storeId: string, fields: OrderEventFields): OrderEvent {
    return {
        platform,
        storeId,
        type: 'order_delivered',
        ...fields,
        also: [{ type: 'review_request', variables: { review_url: '' } }],
    };
}

/**
 * Schedule one or more customer notifications for an order event.
 * Shared across Salla, Shopify, and Zid controllers.
 */
export async function scheduleOrderNotifications(event: OrderEvent): Promise<void> {
    const { platform, storeId, type, customerPhone, customerName, orderId, orderNumber, trackingNumber, cartTotal, minDelayMs, upgradePendingOnDuplicate, also } = event;

    // The customer bought — a still-pending "you left items in your cart" nudge must
    // never reach them. Runs regardless of whether the order_confirmed template is
    // enabled (schedule() below may no-op on a disabled template, but the purchase
    // still invalidates the nudge), and best-effort so a cancel failure can never
    // cost the confirmation SMS itself.
    if (type === 'order_confirmed') {
        try {
            await customerNotificationService.cancel(storeId, 'abandoned_cart', customerPhone);
        } catch (err) {
            captureError(err, 'Abandoned-cart cancel on order_confirmed failed', {
                tags: { service: 'customer-notifications', platform },
                extra: { storeId, orderId },
            });
        }
    }

    const variables: Record<string, string> = {
        order_number: orderNumber,
        tracking_number: trackingNumber ?? '',
        cart_total: cartTotal ?? '',
    };

    await customerNotificationService.schedule({
        storeId,
        type,
        customerPhone,
        customerName,
        variables,
        platformEventId: `${platform}:${type}:${orderId}`,
        orderNumber,
        cartTotal,
        minDelayMs,
        upgradePendingOnDuplicate,
    });

    for (const extra of also ?? []) {
        await customerNotificationService.schedule({
            storeId,
            type: extra.type,
            customerPhone,
            customerName,
            variables: { ...variables, ...extra.variables },
            platformEventId: `${platform}:${extra.type}:${orderId}`,
            orderNumber,
        });
    }
}

/**
 * Wrapper for non-blocking webhook dispatch with error capture.
 * Keeps webhook handlers clean — just call dispatchOrderNotification(...).catch(ignore)
 * is an anti-pattern; use this instead so errors reach Sentry.
 */
export function dispatchOrderNotification(
    event: OrderEvent,
    logger: { error: (obj: object, msg: string) => void },
): void {
    scheduleOrderNotifications(event).catch(err => {
        logger.error({ err }, `[OrderNotif] Failed to schedule ${event.platform} ${event.type}`);
        captureError(err, `Order notification scheduling failed: ${event.platform} ${event.type}`, {
            tags: { service: 'customer-notifications', platform: event.platform },
            extra: { storeId: event.storeId, orderId: event.orderId, type: event.type },
        });
    });
}

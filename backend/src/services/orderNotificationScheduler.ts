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
    /** Additional notification types to schedule together (e.g. review_request after delivery) */
    also?: Array<{ type: OrderNotificationType; variables: Record<string, string> }>;
}

/**
 * Schedule one or more customer notifications for an order event.
 * Shared across Salla, Shopify, and Zid controllers.
 */
export async function scheduleOrderNotifications(event: OrderEvent): Promise<void> {
    const { platform, storeId, type, customerPhone, customerName, orderId, orderNumber, trackingNumber, cartTotal, also } = event;

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

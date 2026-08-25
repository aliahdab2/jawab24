import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be declared before imports
vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: {
        schedule: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import {
    scheduleOrderNotifications,
    dispatchOrderNotification,
    type OrderEvent,
} from '../../src/services/orderNotificationScheduler';
import { customerNotificationService } from '../../src/services/customerNotifications';
import { captureError } from '../../src/utils/sentryHelpers';

const sampleEvent: OrderEvent = {
    platform: 'salla',
    storeId: 'store-1',
    type: 'order_confirmed',
    customerPhone: '+966501234567',
    customerName: 'Ahmed',
    orderId: '999',
    orderNumber: 'ORD-999',
};

describe('scheduleOrderNotifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('schedules main notification with correct variables', async () => {
        await scheduleOrderNotifications({ ...sampleEvent, trackingNumber: 'TRK-1', cartTotal: '150' });

        expect(customerNotificationService.schedule).toHaveBeenCalledWith(
            expect.objectContaining({
                storeId: 'store-1',
                type: 'order_confirmed',
                customerPhone: '+966501234567',
                customerName: 'Ahmed',
                variables: {
                    order_number: 'ORD-999',
                    tracking_number: 'TRK-1',
                    cart_total: '150',
                },
            }),
        );
    });

    it('generates correct platformEventId as ${platform}:${type}:${orderId}', async () => {
        await scheduleOrderNotifications(sampleEvent);

        expect(customerNotificationService.schedule).toHaveBeenCalledWith(
            expect.objectContaining({
                platformEventId: 'salla:order_confirmed:999',
            }),
        );
    });

    it('schedules also array notifications with merged variables', async () => {
        const eventWithAlso: OrderEvent = {
            ...sampleEvent,
            also: [
                {
                    type: 'review_request',
                    variables: { review_url: 'https://example.com/review' },
                },
            ],
        };

        await scheduleOrderNotifications(eventWithAlso);

        expect(customerNotificationService.schedule).toHaveBeenCalledTimes(2);
        expect(customerNotificationService.schedule).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                type: 'review_request',
                variables: expect.objectContaining({
                    order_number: 'ORD-999',
                    review_url: 'https://example.com/review',
                }),
            }),
        );
    });

    it('uses correct platformEventId for also items: ${platform}:${extra.type}:${orderId}', async () => {
        const eventWithAlso: OrderEvent = {
            ...sampleEvent,
            also: [{ type: 'review_request', variables: {} }],
        };

        await scheduleOrderNotifications(eventWithAlso);

        expect(customerNotificationService.schedule).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                platformEventId: 'salla:review_request:999',
            }),
        );
    });

    // The customer bought — a pending "you left items in your cart" nudge for the same
    // store+phone must be cancelled, or it fires up to an hour after the purchase.
    it('order_confirmed cancels a pending abandoned_cart nudge for the same store+phone', async () => {
        await scheduleOrderNotifications(sampleEvent);

        expect(customerNotificationService.cancel).toHaveBeenCalledTimes(1);
        expect(customerNotificationService.cancel).toHaveBeenCalledWith(
            'store-1', 'abandoned_cart', '+966501234567',
        );
    });

    it('non-purchase events do not cancel the abandoned_cart nudge', async () => {
        await scheduleOrderNotifications({ ...sampleEvent, type: 'order_shipped' });
        await scheduleOrderNotifications({ ...sampleEvent, type: 'order_delivered' });
        await scheduleOrderNotifications({ ...sampleEvent, type: 'abandoned_cart' });

        expect(customerNotificationService.cancel).not.toHaveBeenCalled();
    });

    it('a failing cancel never costs the confirmation SMS itself', async () => {
        vi.mocked(customerNotificationService.cancel).mockRejectedValueOnce(new Error('db down'));

        await scheduleOrderNotifications(sampleEvent);

        expect(customerNotificationService.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'order_confirmed' }),
        );
        expect(captureError).toHaveBeenCalledTimes(1);
    });
});

describe('dispatchOrderNotification', () => {
    const mockLogger = { error: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls customerNotificationService.schedule for a valid event', async () => {
        dispatchOrderNotification(sampleEvent, mockLogger);

        // dispatchOrderNotification is fire-and-forget — flush the microtask queue
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(customerNotificationService.schedule).toHaveBeenCalledTimes(1);
    });

    it('logs error and calls captureError when scheduling throws', async () => {
        vi.mocked(customerNotificationService.schedule).mockRejectedValueOnce(new Error('Queue error'));

        dispatchOrderNotification(sampleEvent, mockLogger);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            expect.stringContaining('salla'),
        );
        expect(captureError).toHaveBeenCalledTimes(1);
    });

    it('does not re-throw on error (fire-and-forget)', async () => {
        vi.mocked(customerNotificationService.schedule).mockRejectedValueOnce(new Error('Queue error'));

        // If dispatchOrderNotification re-threw, this would need try/catch — it should not
        dispatchOrderNotification(sampleEvent, mockLogger);
        await new Promise(resolve => setTimeout(resolve, 0));

        // Reaching here without unhandled rejection means it was swallowed correctly
        expect(true).toBe(true);
    });
});

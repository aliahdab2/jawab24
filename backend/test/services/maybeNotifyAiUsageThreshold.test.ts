/**
 * Integration test for the dispatch wiring:
 * usage increment → computeCrossedAiThresholds → thresholdToNotificationType
 *   → notificationService.sendTemplateNotification.
 *
 * Unit tests for the two pure helpers exist separately. This file proves the
 * three pieces are wired together correctly — specifically that crossing 90%
 * fires `ai_usage_warning_90` (the regression risk the 90% threshold was added
 * to address).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendTemplateNotificationMock = vi.fn();
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: (...args: unknown[]) => sendTemplateNotificationMock(...args),
    },
}));

const redisSetMock = vi.fn();
vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: (...args: unknown[]) => redisSetMock(...args),
    },
}));

import { subscriptionsService } from '../../src/services/subscriptions';

const PERIOD_START = new Date('2026-05-01T00:00:00Z');

function mockSubscriptionWithLimit(limit: number | null) {
    vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
        plan: { maxAiRepliesPerMonth: limit },
    } as Awaited<ReturnType<typeof subscriptionsService.getUserSubscription>>);
}

describe('maybeNotifyAiUsageThreshold — dispatch wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redisSetMock.mockResolvedValue('OK');
    });

    it('fires ai_usage_warning_80 when usage crosses the 80% boundary', async () => {
        mockSubscriptionWithLimit(1000);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 799, 800, PERIOD_START);

        expect(sendTemplateNotificationMock).toHaveBeenCalledTimes(1);
        expect(sendTemplateNotificationMock).toHaveBeenCalledWith(
            'user-1',
            'ai_usage_warning_80',
            expect.objectContaining({ used: '800', limit: '1000', percent: '80' }),
        );
    });

    it('fires ai_usage_warning_90 when usage crosses the 90% boundary (the regression risk)', async () => {
        mockSubscriptionWithLimit(1000);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 899, 900, PERIOD_START);

        expect(sendTemplateNotificationMock).toHaveBeenCalledTimes(1);
        expect(sendTemplateNotificationMock).toHaveBeenCalledWith(
            'user-1',
            'ai_usage_warning_90',
            expect.objectContaining({ used: '900', limit: '1000', percent: '90' }),
        );
    });

    it('fires ai_usage_limit_reached when usage crosses the 100% boundary', async () => {
        mockSubscriptionWithLimit(1000);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 999, 1000, PERIOD_START);

        expect(sendTemplateNotificationMock).toHaveBeenCalledTimes(1);
        expect(sendTemplateNotificationMock).toHaveBeenCalledWith(
            'user-1',
            'ai_usage_limit_reached',
            expect.objectContaining({ used: '1000', limit: '1000', percent: '100' }),
        );
    });

    it('fires all three notifications in order when a single increment crosses 80, 90, and 100', async () => {
        mockSubscriptionWithLimit(1000);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 0, 1000, PERIOD_START);

        expect(sendTemplateNotificationMock).toHaveBeenCalledTimes(3);
        const types = sendTemplateNotificationMock.mock.calls.map((c) => c[1]);
        expect(types).toEqual(['ai_usage_warning_80', 'ai_usage_warning_90', 'ai_usage_limit_reached']);
    });

    it('does NOT fire when Redis dedup says the threshold was already notified this period', async () => {
        mockSubscriptionWithLimit(1000);
        redisSetMock.mockResolvedValue(null);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 899, 900, PERIOD_START);

        expect(sendTemplateNotificationMock).not.toHaveBeenCalled();
    });

    it('does NOT fire when the plan limit is null (unlimited)', async () => {
        mockSubscriptionWithLimit(null);

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 899, 900, PERIOD_START);

        expect(sendTemplateNotificationMock).not.toHaveBeenCalled();
        expect(redisSetMock).not.toHaveBeenCalled();
    });

    it('still fires the notification when Redis itself is unavailable (degrades to "send")', async () => {
        mockSubscriptionWithLimit(1000);
        redisSetMock.mockRejectedValue(new Error('redis offline'));

        await subscriptionsService.maybeNotifyAiUsageThreshold('user-1', 899, 900, PERIOD_START);

        expect(sendTemplateNotificationMock).toHaveBeenCalledWith(
            'user-1',
            'ai_usage_warning_90',
            expect.anything(),
        );
    });
});

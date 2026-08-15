import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks must be hoisted before importing the service ─────────────
const { mockRedisSet, mockSendTemplateNotification } = vi.hoisted(() => ({
    mockRedisSet: vi.fn().mockResolvedValue('OK'),
    mockSendTemplateNotification: vi.fn().mockResolvedValue('notif-id'),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: mockRedisSet,
        get: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: mockSendTemplateNotification,
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('../../src/services/plans', () => ({
    plansService: { getPlanById: vi.fn(), getDefaultPlan: vi.fn(), mapToPlan: vi.fn() },
}));

// ── Import after mocks ─────────────────────────────────────────────
import { subscriptionsService } from '../../src/services/subscriptions';

type SubscriptionWithPlan = Awaited<ReturnType<typeof subscriptionsService.getUserSubscription>>;

/** Build a minimal subscription+plan shape that checkSubscriptionStatus consumes. */
function makeSubscription(overrides: Partial<{
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
}> = {}): SubscriptionWithPlan {
    return {
        id: 'sub_1',
        userId: 'user_1',
        planId: 'plan_1',
        status: 'active',
        trialEndsAt: null,
        currentPeriodEnd: null,
        currentPeriodStart: new Date(),
        ...overrides,
        plan: { id: 'plan_1', name: 'Business' },
    } as unknown as SubscriptionWithPlan;
}

describe('canAutoReply', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRedisSet.mockResolvedValue('OK');
    });

    it('allows when user has no subscription row (pre-signup / onboarding)', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(true);
    });

    it('allows an active subscription', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'active' }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(true);
    });

    it('allows a trialing subscription whose trial has not ended', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({
                status: 'trialing',
                trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(true);
    });

    it('blocks a trialing subscription whose trial has expired', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({
                status: 'trialing',
                trialEndsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/trial/i);
    });

    it('blocks a canceled subscription', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'canceled' }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/canceled/i);
    });

    it('blocks a paused subscription', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'paused' }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/paused/i);
    });

    it('allows a past_due subscription inside the 3-day grace window', async () => {
        // currentPeriodEnd 1 day ago — clearly within the 3-day grace
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({
                status: 'past_due',
                currentPeriodEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(true);
    });

    it('blocks a past_due subscription past the 3-day grace window', async () => {
        // currentPeriodEnd 5 days ago — past 3-day grace
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({
                status: 'past_due',
                currentPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            }),
        );
        const result = await subscriptionsService.canAutoReply('user_1');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/expired|renew/i);
    });
});

describe('enforceAutoReplyGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRedisSet.mockResolvedValue('OK');
    });

    it('returns allowed and sends NO notification when subscription is active', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'active' }),
        );

        const result = await subscriptionsService.enforceAutoReplyGate('user_1');

        expect(result.allowed).toBe(true);
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
        expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('dispatches one notification when blocked and Redis lock is fresh', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'canceled' }),
        );
        mockRedisSet.mockResolvedValue('OK');

        const result = await subscriptionsService.enforceAutoReplyGate('user_1');

        expect(result.allowed).toBe(false);
        expect(mockRedisSet).toHaveBeenCalledWith(
            expect.stringContaining('notif:auto_reply_paused:user_1'),
            '1',
            'EX',
            24 * 60 * 60,
            'NX',
        );
        // Contract (2026-08-15): NO variables — the template has no {reason}
        // placeholder (the gate's internal English reason used to leak into the
        // Arabic body) — and a deepLink so the card is actionable.
        expect(mockSendTemplateNotification).toHaveBeenCalledWith(
            'user_1',
            'auto_reply_paused_billing',
            {},
            { deepLink: '/settings' },
        );
    });

    it('ships billing-pause copy with no placeholder and no English inside the Arabic body', async () => {
        const { NOTIFICATION_TEMPLATES } = await vi.importActual<typeof import('../../src/services/notifications')>(
            '../../src/services/notifications',
        );
        const tpl = NOTIFICATION_TEMPLATES.auto_reply_paused_billing;

        expect(tpl.bodies.ar).not.toContain('{reason}');
        expect(tpl.bodies.en).not.toContain('{reason}');
        // Latin words in the Arabic body = the leak this guards against
        // (brand names like Jawab24 would be fine, but this copy has none).
        expect(tpl.bodies.ar).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('suppresses the notification when the 24h dedup lock is held (Redis SET NX returns null)', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'paused' }),
        );
        mockRedisSet.mockResolvedValue(null); // key already exists → rate limited

        const result = await subscriptionsService.enforceAutoReplyGate('user_1');

        expect(result.allowed).toBe(false);
        expect(mockRedisSet).toHaveBeenCalledOnce();
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });

    it('still returns the block verdict if the notification dispatch throws', async () => {
        vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(
            makeSubscription({ status: 'canceled' }),
        );
        mockRedisSet.mockRejectedValue(new Error('redis down'));

        const result = await subscriptionsService.enforceAutoReplyGate('user_1');

        // Redis failure must never prevent the block verdict from being returned
        expect(result.allowed).toBe(false);
    });
});

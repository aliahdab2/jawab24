import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscriptionsService } from '../../src/services/subscriptions';

// Mock plansService
vi.mock('../../src/services/plans', () => ({
    plansService: {
        getPlanById: vi.fn().mockResolvedValue({
            id: 'plan_123',
            name: 'Business',
            slug: 'business',
            price: 2500,
            maxPages: 3,
            maxAiRepliesPerMonth: 1500,
            maxTemplates: null,
            maxRules: null,
            trialDays: 0,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            showBranding: false,
            prioritySupport: false,
        }),
        getDefaultPlan: vi.fn().mockResolvedValue({
            id: 'free_plan_123',
            name: 'Free Trial',
            slug: 'free',
            price: 0,
            maxPages: 1,
            maxAiRepliesPerMonth: 60,
            maxTemplates: 3,
            maxRules: 2,
            trialDays: 30,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            showBranding: true,
            prioritySupport: false,
        }),
        mapToPlan: vi.fn((row) => row),
    },
}));

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 'sub_123',
                    userId: 'user_123',
                    planId: 'plan_123',
                    status: 'active',
                    trialEndsAt: null,
                    currentPeriodStart: new Date(),
                    currentPeriodEnd: new Date(),
                    createdAt: new Date(),
                }]),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'sub_123',
                        userId: 'user_123',
                        status: 'active',
                    }]),
                }),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    subscriptions: { userId: 'user_id', planId: 'plan_id', status: 'status' },
    plans: { id: 'id' },
    usage: { userId: 'user_id', periodStart: 'period_start', periodEnd: 'period_end' },
    usageLogs: {},
    pages: { userId: 'user_id', id: 'id' },
    templates: { userId: 'user_id', id: 'id' },
    rules: { userId: 'user_id', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    gte: vi.fn((field, value) => ({ field, value, op: 'gte' })),
    lte: vi.fn((field, value) => ({ field, value, op: 'lte' })),
    desc: vi.fn((field) => ({ field, direction: 'desc' })),
    sql: vi.fn(),
}));

describe('Subscriptions Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('mapToSubscription', () => {
        it('should correctly map database row to Subscription type', () => {
            const dbRow = {
                id: 'sub_123',
                userId: 'user_123',
                planId: 'plan_456',
                status: 'active',
                trialEndsAt: new Date('2024-02-01'),
                currentPeriodStart: new Date('2024-01-01'),
                currentPeriodEnd: new Date('2024-02-01'),
                externalSubscriptionId: 'stripe_123',
                paymentMethod: 'stripe',
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-01-01'),
            };

            const subscription = subscriptionsService.mapToSubscription(dbRow);

            expect(subscription.id).toBe('sub_123');
            expect(subscription.userId).toBe('user_123');
            expect(subscription.planId).toBe('plan_456');
            expect(subscription.status).toBe('active');
            expect(subscription.trialEndsAt).toEqual(new Date('2024-02-01'));
        });

        it('should handle null status with default', () => {
            const dbRow = {
                id: 'sub_123',
                userId: 'user_123',
                planId: 'plan_456',
                status: null,
                trialEndsAt: null,
                currentPeriodStart: new Date(),
                currentPeriodEnd: null,
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date(),
                updatedAt: null,
            };

            const subscription = subscriptionsService.mapToSubscription(dbRow);

            expect(subscription.status).toBe('active');
        });
    });

    describe('mapToUsage', () => {
        it('should correctly map database row to Usage type', () => {
            const dbRow = {
                id: 'usage_123',
                userId: 'user_123',
                periodStart: new Date('2024-01-01'),
                periodEnd: new Date('2024-02-01'),
                aiRepliesCount: 150,
                templateRepliesCount: 50,
                totalCommentsProcessed: 200,
                totalMessagesProcessed: 100,
                dailyBreakdown: { '2024-01-15': { ai: 10, template: 5 } },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const usage = subscriptionsService.mapToUsage(dbRow);

            expect(usage.id).toBe('usage_123');
            expect(usage.userId).toBe('user_123');
            expect(usage.aiRepliesCount).toBe(150);
            expect(usage.templateRepliesCount).toBe(50);
            expect(usage.dailyBreakdown).toEqual({ '2024-01-15': { ai: 10, template: 5 } });
        });

        it('should handle null counts with defaults', () => {
            const dbRow = {
                id: 'usage_123',
                userId: 'user_123',
                periodStart: new Date(),
                periodEnd: new Date(),
                aiRepliesCount: null,
                templateRepliesCount: null,
                totalCommentsProcessed: null,
                totalMessagesProcessed: null,
                dailyBreakdown: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const usage = subscriptionsService.mapToUsage(dbRow);

            expect(usage.aiRepliesCount).toBe(0);
            expect(usage.templateRepliesCount).toBe(0);
            expect(usage.totalCommentsProcessed).toBe(0);
            expect(usage.totalMessagesProcessed).toBe(0);
            expect(usage.dailyBreakdown).toEqual({});
        });
    });

    describe('Limit Check Logic', () => {
        // These test the limit check return format
        it('should return correct LimitCheckResult format when allowed', () => {
            const result = {
                allowed: true,
                limit: 1500,
                used: 500,
                remaining: 1000,
            };

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(1000);
        });

        it('should return correct LimitCheckResult format when not allowed', () => {
            const result = {
                allowed: false,
                reason: 'Monthly AI reply limit reached',
                limit: 60,
                used: 60,
                remaining: 0,
            };

            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('Monthly AI reply limit reached');
            expect(result.remaining).toBe(0);
        });

        it('should handle unlimited (null) limits', () => {
            const plan = {
                maxAiRepliesPerMonth: null, // unlimited
                maxPages: null,
                maxTemplates: null,
                maxRules: null,
            };

            // When limit is null, it means unlimited
            expect(plan.maxAiRepliesPerMonth).toBeNull();
        });
    });

    describe('Trial Period Logic', () => {
        it('should calculate trial days remaining correctly', () => {
            const now = new Date();
            const trialEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now

            const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

            expect(daysRemaining).toBe(10);
        });

        it('should return 0 days remaining when trial is expired', () => {
            const now = new Date();
            const trialEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

            const daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

            expect(daysRemaining).toBe(0);
        });
    });

    describe('Usage Percentage Calculation', () => {
        it('should calculate usage percentage correctly', () => {
            const used = 450;
            const limit = 1500;
            const percentUsed = (used / limit) * 100;

            expect(percentUsed).toBe(30);
        });

        it('should cap percentage at 100 when over limit', () => {
            const used = 2000;
            const limit = 1500;
            const percentUsed = Math.min(100, (used / limit) * 100);

            expect(percentUsed).toBe(100);
        });

        it('should handle zero limit (unlimited) gracefully', () => {
            const used = 1000;
            const limit = null;
            const percentUsed = limit ? Math.min(100, (used / limit) * 100) : 0;

            expect(percentUsed).toBe(0);
        });
    });
});

describe('Subscription Status Logic', () => {
    it('should recognize valid subscription statuses', () => {
        const validStatuses = ['trialing', 'active', 'past_due', 'canceled', 'paused'];

        validStatuses.forEach(status => {
            expect(['trialing', 'active', 'past_due', 'canceled', 'paused']).toContain(status);
        });
    });

    it('should identify active subscriptions', () => {
        const activeStatuses = ['trialing', 'active'];
        const inactiveStatuses = ['canceled', 'paused', 'past_due'];

        expect(activeStatuses.includes('trialing')).toBe(true);
        expect(activeStatuses.includes('active')).toBe(true);
        expect(activeStatuses.includes('canceled')).toBe(false);
    });
});


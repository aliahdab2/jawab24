import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscriptionsService, startOfUtcDay } from '../../src/services/subscriptions';
import { config } from '../../src/config';

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
            trialDays: 0,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            prioritySupport: false,
        }),
        getDefaultPlan: vi.fn().mockResolvedValue({
            id: 'free_plan_123',
            name: 'Free Trial',
            slug: 'free',
            price: 0,
            maxPages: 1,
            maxAiRepliesPerMonth: 60,
            trialDays: 14,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
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
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
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
    workspaces: { id: 'id', ownerId: 'owner_id' },
    users: { id: 'id', topupBalance: 'topup_balance' },
    topupPurchases: { userId: 'user_id', status: 'status', repliesAdded: 'replies_added' },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), quit: vi.fn(), del: vi.fn() },
}));

// The marketplace billing guard. getUsageSummary consults it to set
// subscription.marketplaceBilling (and the legacy sallaBilled flag); it issues a
// real LEFT JOIN that this file's hand-rolled db/drizzle mocks cannot serve.
// Mocked at the service boundary — the rule is covered by
// test/services/marketplaceBilling.test.ts and, against real Postgres, by
// test/integration/sallaArticle5Guard.test.ts.
vi.mock('../../src/services/marketplaceBilling', () => ({
    resolveMarketplaceBilling: vi.fn(async () => null),
}));

// Channel-availability gate (Zid block, D-117). getUsageSummary consults it to
// set subscription.whatsappUnavailable. Default "available" so existing usage
// tests are unchanged; the dedicated test flips it.
const mockGetWaUnavailable = vi.fn(async () => null as null | 'zid_marketplace');
vi.mock('../../src/services/whatsappAvailability', () => ({
    getWhatsAppUnavailableReason: (...args: unknown[]) => mockGetWaUnavailable(...(args as [])),
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    gte: vi.fn((field, value) => ({ field, value, op: 'gte' })),
    lte: vi.fn((field, value) => ({ field, value, op: 'lte' })),
    desc: vi.fn((field) => ({ field, direction: 'desc' })),
    sql: vi.fn(),
}));

// Helper: restore db.select default mock (cleared when tests override it)
function restoreDefaultDbSelectMock(db: any) {
    vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                    limit: vi.fn().mockResolvedValue([]),
                }),
            }),
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
            }),
        }),
    } as any);
    vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
                id: 'sub_123', userId: 'user_123', planId: 'plan_123',
                status: 'active', trialEndsAt: null,
                currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
                createdAt: new Date(),
            }]),
        }),
    } as any);
    vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 'sub_123', userId: 'user_123', status: 'active',
                }]),
            }),
        }),
    } as any);
}

describe('Subscriptions Service', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { db } = await import('../../src/db');
        restoreDefaultDbSelectMock(db);
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
                totalCommentsProcessed: 200,
                totalMessagesProcessed: 100,
                dailyBreakdown: { '2024-01-15': { ai: 10 } },
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const usage = subscriptionsService.mapToUsage(dbRow);

            expect(usage.id).toBe('usage_123');
            expect(usage.userId).toBe('user_123');
            expect(usage.aiRepliesCount).toBe(150);
            expect(usage.dailyBreakdown).toEqual({ '2024-01-15': { ai: 10 } });
        });

        it('should handle null counts with defaults', () => {
            const dbRow = {
                id: 'usage_123',
                userId: 'user_123',
                periodStart: new Date(),
                periodEnd: new Date(),
                aiRepliesCount: null,
                totalCommentsProcessed: null,
                totalMessagesProcessed: null,
                dailyBreakdown: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const usage = subscriptionsService.mapToUsage(dbRow);

            expect(usage.aiRepliesCount).toBe(0);
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

    describe('getUserSubscription', () => {
        it('should return null when no subscription found', async () => {
            const result = await subscriptionsService.getUserSubscription('user_no_sub');
            expect(result).toBeNull();
        });

        it('should auto-expire trialing subscription past trial end', async () => {
            const { db } = await import('../../src/db');

            const expiredTrialDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
            const subRow = {
                id: 'sub_trial_expired',
                userId: 'user_123',
                planId: 'plan_123',
                status: 'trialing',
                trialEndsAt: expiredTrialDate,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const planRow = {
                id: 'plan_123',
                name: 'Free',
                slug: 'free',
                price: 0,
                maxPages: 1,
                maxAiRepliesPerMonth: 60,
                trialDays: 14,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                prioritySupport: false,
            };

            // Mock the select chain for getUserSubscription
            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ subscription: subRow, plan: planRow }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUserSubscription('user_123');

            // Should update status to past_due
            expect(db.update).toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result!.status).toBe('past_due');
        });

        it('should auto-expire active subscription past period end', async () => {
            const { db } = await import('../../src/db');

            const expiredPeriodEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
            const subRow = {
                id: 'sub_expired',
                userId: 'user_123',
                planId: 'plan_123',
                status: 'active',
                trialEndsAt: null,
                currentPeriodStart: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
                currentPeriodEnd: expiredPeriodEnd,
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const planRow = {
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                price: 2500,
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                trialDays: 0,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                prioritySupport: false,
            };

            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ subscription: subRow, plan: planRow }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUserSubscription('user_123');

            expect(db.update).toHaveBeenCalled();
            expect(result!.status).toBe('past_due');
        });

        it('should auto-transition expired active subscription with cancel_at_period_end=true to canceled (not past_due)', async () => {
            const { db } = await import('../../src/db');

            const expiredPeriodEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const subRow = {
                id: 'sub_grace_cancel',
                userId: 'user_123',
                planId: 'plan_123',
                status: 'active',
                trialEndsAt: null,
                currentPeriodStart: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
                currentPeriodEnd: expiredPeriodEnd,
                cancelAtPeriodEnd: true,
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const planRow = {
                id: 'plan_123', name: 'Business', slug: 'business', price: 2500,
                maxPages: 3, maxAiRepliesPerMonth: 1500, trialDays: 0,
                facebookEnabled: true, instagramEnabled: true, whatsappEnabled: false,
                prioritySupport: false,
            };

            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{ subscription: subRow, plan: planRow }]),
                            }),
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUserSubscription('user_123');

            // The user opted for graceful cancel — terminal state must be 'canceled',
            // not 'past_due'. Past-due would put them in a 3-day grace they didn't ask for.
            expect(db.update).toHaveBeenCalled();
            expect(result!.status).toBe('canceled');
        });

        it('should NOT auto-expire active subscription within period', async () => {
            const { db } = await import('../../src/db');

            const futurePeriodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
            const subRow = {
                id: 'sub_active',
                userId: 'user_123',
                planId: 'plan_123',
                status: 'active',
                trialEndsAt: null,
                currentPeriodStart: new Date(),
                currentPeriodEnd: futurePeriodEnd,
                canceledAt: null,
                cancelReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const planRow = {
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                price: 2500,
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                trialDays: 0,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                prioritySupport: false,
            };

            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ subscription: subRow, plan: planRow }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUserSubscription('user_123');

            // Should NOT call update
            expect(db.update).not.toHaveBeenCalled();
            expect(result!.status).toBe('active');
        });
    });

    describe('createSubscription', () => {
        it('should use default plan when no planId provided', async () => {
            const { plansService } = await import('../../src/services/plans');

            await subscriptionsService.createSubscription('user_123');

            expect(plansService.getDefaultPlan).toHaveBeenCalled();
            expect(plansService.getPlanById).not.toHaveBeenCalled();
        });

        it('should use specified plan when planId provided', async () => {
            const { plansService } = await import('../../src/services/plans');

            await subscriptionsService.createSubscription('user_123', 'plan_123');

            expect(plansService.getPlanById).toHaveBeenCalledWith('plan_123');
            expect(plansService.getDefaultPlan).not.toHaveBeenCalled();
        });

        it('should throw when no valid plan found', async () => {
            const { plansService } = await import('../../src/services/plans');
            vi.mocked(plansService.getPlanById).mockResolvedValueOnce(null);

            await expect(
                subscriptionsService.createSubscription('user_123', 'bad_plan')
            ).rejects.toThrow('No valid plan found');
        });

        it('should set trialing status when plan has trial days', async () => {
            const { db } = await import('../../src/db');

            // Default plan mock has trialDays: 14, so the insert should be called
            await subscriptionsService.createSubscription('user_123');

            expect(db.insert).toHaveBeenCalled();
            // The returned subscription should have status from the insert mock
        });
    });

    describe('canAddPage - integration', () => {
        it('should reject when subscription is canceled', async () => {
            const { db } = await import('../../src/db');

            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{
                    subscription: {
                        id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                        status: 'canceled', trialEndsAt: null,
                        currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
                        canceledAt: new Date(), cancelReason: 'test',
                        createdAt: new Date(), updatedAt: new Date(),
                    },
                    plan: {
                        id: 'plan_1', name: 'Free', slug: 'free', price: 0,
                        maxPages: 1, maxAiRepliesPerMonth: 60,
                        trialDays: 14, facebookEnabled: true, instagramEnabled: true,
                        whatsappEnabled: false, prioritySupport: false,
                    },
                }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                    where: vi.fn().mockResolvedValue([{ count: 0 }]),
                }),
            } as any);

            const result = await subscriptionsService.canAddPage('user_1');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('canceled');
        });

        it('should allow when under page limit with active subscription', async () => {
            const { db } = await import('../../src/db');

            let callCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // First call: getUserSubscription
                    return {
                        from: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    orderBy: vi.fn().mockReturnValue({
                                        limit: vi.fn().mockResolvedValue([{
                                            subscription: {
                                                id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                                                status: 'active', trialEndsAt: null,
                                                currentPeriodStart: new Date(),
                                                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                                canceledAt: null, cancelReason: null,
                                                createdAt: new Date(), updatedAt: new Date(),
                                            },
                                            plan: {
                                                id: 'plan_1', name: 'Business', slug: 'business', price: 2500,
                                                maxPages: 3, maxAiRepliesPerMonth: 1500, trialDays: 0, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                prioritySupport: false,
                                            },
                                        }]),
                                    }),
                                }),
                            }),
                        }),
                    } as any;
                }
                // Second call: count pages
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 1 }]),
                    }),
                } as any;
            });

            const result = await subscriptionsService.canAddPage('user_1');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(2); // 3 limit - 1 used
        });

        it('should reject when at page limit', async () => {
            const { db } = await import('../../src/db');

            let callCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return {
                        from: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    orderBy: vi.fn().mockReturnValue({
                                        limit: vi.fn().mockResolvedValue([{
                                            subscription: {
                                                id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                                                status: 'active', trialEndsAt: null,
                                                currentPeriodStart: new Date(),
                                                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                                canceledAt: null, cancelReason: null,
                                                createdAt: new Date(), updatedAt: new Date(),
                                            },
                                            plan: {
                                                id: 'plan_1', name: 'Free', slug: 'free', price: 0,
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 14, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                prioritySupport: false,
                                            },
                                        }]),
                                    }),
                                }),
                            }),
                        }),
                    } as any;
                }
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([{ count: 1 }]),
                    }),
                } as any;
            });

            const result = await subscriptionsService.canAddPage('user_1');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Page limit reached');
            expect(result.remaining).toBe(0);
        });

        it('should return no subscription when none exists', async () => {
            const result = await subscriptionsService.canAddPage('user_no_sub');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('No active subscription');
        });
    });


    describe('canUseAiReplies - integration', () => {
        beforeEach(() => {
            // canUseAiReplies now consults the top-up balance on every denial path.
            // These legacy tests don't care about top-up; stub it to zero so the
            // existing assertions for "no subscription / canceled / limit reached"
            // still surface those reasons (top-up > 0 would override them).
            vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(0);
        });

        it('should reject when no subscription', async () => {
            const result = await subscriptionsService.canUseAiReplies('user_no_sub');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('No active subscription');
        });

        it('should reject canceled subscription', async () => {
            const { db } = await import('../../src/db');

            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{
                    subscription: {
                        id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                        status: 'canceled', trialEndsAt: null,
                        currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
                        canceledAt: new Date(), cancelReason: null,
                        createdAt: new Date(), updatedAt: new Date(),
                    },
                    plan: {
                        id: 'plan_1', name: 'Free', slug: 'free', price: 0,
                        maxPages: 1, maxAiRepliesPerMonth: 60,
                        trialDays: 14, facebookEnabled: true, instagramEnabled: true,
                        whatsappEnabled: false, prioritySupport: false,
                    },
                }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.canUseAiReplies('user_1');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('canceled');
        });

        it('should allow unlimited AI replies (null limit)', async () => {
            const { db } = await import('../../src/db');

            const mockOrderBy = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{
                    subscription: {
                        id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                        status: 'active', trialEndsAt: null,
                        currentPeriodStart: new Date(),
                        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        canceledAt: null, cancelReason: null,
                        createdAt: new Date(), updatedAt: new Date(),
                    },
                    plan: {
                        id: 'plan_1', name: 'Enterprise', slug: 'enterprise', price: 10000,
                        maxPages: null, maxAiRepliesPerMonth: null, trialDays: 0, facebookEnabled: true,
                        instagramEnabled: true, whatsappEnabled: true,
                        prioritySupport: true,
                    },
                }]),
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: mockOrderBy,
                        }),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.canUseAiReplies('user_1');
            expect(result.allowed).toBe(true);
        });

        it('should reject when AI reply limit reached', async () => {
            const { db } = await import('../../src/db');

            let callCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // getUserSubscription
                    return {
                        from: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    orderBy: vi.fn().mockReturnValue({
                                        limit: vi.fn().mockResolvedValue([{
                                            subscription: {
                                                id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                                                status: 'active', trialEndsAt: null,
                                                currentPeriodStart: new Date(),
                                                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                                canceledAt: null, cancelReason: null,
                                                createdAt: new Date(), updatedAt: new Date(),
                                            },
                                            plan: {
                                                id: 'plan_1', name: 'Free', slug: 'free', price: 0,
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 14, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                prioritySupport: false,
                                            },
                                        }]),
                                    }),
                                }),
                            }),
                        }),
                    } as any;
                }
                // getCurrentUsage
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{
                                    id: 'usage_1',
                                    userId: 'user_1',
                                    periodStart: new Date(),
                                    periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                    aiRepliesCount: 60,
                                    totalCommentsProcessed: 0,
                                    totalMessagesProcessed: 0,
                                    dailyBreakdown: {},
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                }]),
                            }),
                        }),
                    }),
                } as any;
            });

            const result = await subscriptionsService.canUseAiReplies('user_1');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Monthly AI reply limit reached');
            expect(result.used).toBe(60);
            expect(result.remaining).toBe(0);
        });

        it('should return usage.periodEnd as resetsAt when limit reached, not subscription.currentPeriodEnd', async () => {
            const { db } = await import('../../src/db');

            const usagePeriodEnd = new Date('2026-05-10T21:12:43Z');
            const subscriptionPeriodEnd = new Date('2027-04-02T21:39:39Z');

            let callCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return {
                        from: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    orderBy: vi.fn().mockReturnValue({
                                        limit: vi.fn().mockResolvedValue([{
                                            subscription: {
                                                id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                                                status: 'active', trialEndsAt: null,
                                                currentPeriodStart: new Date('2026-04-02T21:39:39Z'),
                                                currentPeriodEnd: subscriptionPeriodEnd,
                                                canceledAt: null, cancelReason: null,
                                                createdAt: new Date(), updatedAt: new Date(),
                                            },
                                            plan: {
                                                id: 'plan_1', name: 'Pro', slug: 'pro', price: 1000,
                                                maxPages: 5, maxAiRepliesPerMonth: 10000, trialDays: 0, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                prioritySupport: true,
                                            },
                                        }]),
                                    }),
                                }),
                            }),
                        }),
                    } as any;
                }
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{
                                    id: 'usage_1',
                                    userId: 'user_1',
                                    periodStart: new Date('2026-04-10T21:12:43Z'),
                                    periodEnd: usagePeriodEnd,
                                    aiRepliesCount: 10000,
                                    totalCommentsProcessed: 0,
                                    totalMessagesProcessed: 0,
                                    dailyBreakdown: {},
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                }]),
                            }),
                        }),
                    }),
                } as any;
            });

            const result = await subscriptionsService.canUseAiReplies('user_1');
            expect(result.allowed).toBe(false);
            expect(result.resetsAt).toBe(usagePeriodEnd.toISOString());
            expect(result.resetsAt).not.toBe(subscriptionPeriodEnd.toISOString());
        });

        it('should allow when under AI reply limit', async () => {
            const { db } = await import('../../src/db');

            let callCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return {
                        from: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockReturnValue({
                                    orderBy: vi.fn().mockReturnValue({
                                        limit: vi.fn().mockResolvedValue([{
                                            subscription: {
                                                id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                                                status: 'active', trialEndsAt: null,
                                                currentPeriodStart: new Date(),
                                                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                                canceledAt: null, cancelReason: null,
                                                createdAt: new Date(), updatedAt: new Date(),
                                            },
                                            plan: {
                                                id: 'plan_1', name: 'Free', slug: 'free', price: 0,
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 14, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                prioritySupport: false,
                                            },
                                        }]),
                                    }),
                                }),
                            }),
                        }),
                    } as any;
                }
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{
                                    id: 'usage_1',
                                    userId: 'user_1',
                                    periodStart: new Date(),
                                    periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                    aiRepliesCount: 30,
                                    totalCommentsProcessed: 0,
                                    totalMessagesProcessed: 0,
                                    dailyBreakdown: {},
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                }]),
                            }),
                        }),
                    }),
                } as any;
            });

            const result = await subscriptionsService.canUseAiReplies('user_1');
            expect(result.allowed).toBe(true);
            expect(result.used).toBe(30);
            expect(result.remaining).toBe(30);
        });
    });

    // Regression: the shared demo account went AI-dead in prod from 2026-08-17
    // because its seeded trial expired and the demo exemption lived only in the
    // /limits/ai ROUTE, not in canUseAiReplies (which test-reply + the generator
    // call). The fix moved the exemption INTO the choke point. These pin both
    // the exemption placement and the predicate.
    describe('canUseAiReplies - demo exemption', () => {
        beforeEach(() => {
            vi.spyOn(subscriptionsService, 'getTopupBalance').mockResolvedValue(0);
        });
        afterEach(() => {
            vi.restoreAllMocks();
        });

        function mockPastDueSubscription(db: any): void {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{
                                    subscription: {
                                        id: 'sub_demo', userId: 'demo_user', planId: 'plan_1',
                                        status: 'past_due',
                                        trialEndsAt: new Date(Date.now() - 86_400_000),
                                        currentPeriodStart: new Date(Date.now() - 30 * 86_400_000),
                                        currentPeriodEnd: new Date(Date.now() - 86_400_000),
                                        canceledAt: null, cancelReason: null, paymentMethod: null,
                                        createdAt: new Date(), updatedAt: new Date(),
                                    },
                                    plan: {
                                        id: 'plan_1', name: 'Starter', slug: 'starter', price: 0,
                                        maxPages: 1, maxAiRepliesPerMonth: 1000, trialDays: 30,
                                        facebookEnabled: true, instagramEnabled: true,
                                        whatsappEnabled: false, prioritySupport: false,
                                    },
                                }]),
                            }),
                        }),
                    }),
                }),
            } as any);
        }

        it('exempts a demo user whose trial has expired (past_due)', async () => {
            const { db } = await import('../../src/db');
            mockPastDueSubscription(db);
            vi.spyOn(subscriptionsService, 'isDemoUser').mockResolvedValue(true);

            const result = await subscriptionsService.canUseAiReplies('demo_user');
            expect(result.allowed).toBe(true);
        });

        it('exempts a demo user with no subscription row', async () => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
                        }),
                    }),
                }),
            } as any);
            vi.spyOn(subscriptionsService, 'isDemoUser').mockResolvedValue(true);

            const result = await subscriptionsService.canUseAiReplies('demo_user');
            expect(result.allowed).toBe(true);
        });

        it('still DENIES a non-demo user whose trial has expired', async () => {
            const { db } = await import('../../src/db');
            mockPastDueSubscription(db);
            vi.spyOn(subscriptionsService, 'isDemoUser').mockResolvedValue(false);

            const result = await subscriptionsService.canUseAiReplies('real_user');
            expect(result.allowed).toBe(false);
        });

        it('isDemoUser is true for a demo_ facebook id when demo mode is on', async () => {
            const { db } = await import('../../src/db');
            const original = config.demo.enabled;
            config.demo.enabled = true;
            try {
                vi.mocked(db.select).mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([{ facebookId: 'demo_user_jawab24' }]),
                        }),
                    }),
                } as any);
                await expect(subscriptionsService.isDemoUser('demo_user')).resolves.toBe(true);
            } finally {
                config.demo.enabled = original;
            }
        });

        it('isDemoUser is false for a real (numeric) facebook id', async () => {
            const { db } = await import('../../src/db');
            const original = config.demo.enabled;
            config.demo.enabled = true;
            try {
                vi.mocked(db.select).mockReturnValue({
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([{ facebookId: '10223344556677' }]),
                        }),
                    }),
                } as any);
                await expect(subscriptionsService.isDemoUser('real_user')).resolves.toBe(false);
            } finally {
                config.demo.enabled = original;
            }
        });

        it('isDemoUser reads no DB row when demo mode is off', async () => {
            const { db } = await import('../../src/db');
            const original = config.demo.enabled;
            config.demo.enabled = false;
            try {
                const selectSpy = vi.mocked(db.select);
                selectSpy.mockClear();
                await expect(subscriptionsService.isDemoUser('anyone')).resolves.toBe(false);
                expect(selectSpy).not.toHaveBeenCalled();
            } finally {
                config.demo.enabled = original;
            }
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

        expect(activeStatuses.includes('trialing')).toBe(true);
        expect(activeStatuses.includes('active')).toBe(true);
        expect(activeStatuses.includes('canceled')).toBe(false);
    });
});

describe('checkSubscriptionStatus', () => {
    const makeSub = (overrides: Record<string, unknown>) => ({
        id: 'sub_1',
        userId: 'user_1',
        planId: 'plan_1',
        status: 'active' as const,
        trialEndsAt: null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        canceledAt: null,
        cancelReason: null,
        createdAt: new Date(),
        plan: {
            id: 'plan_1',
            name: 'Free Trial',
            slug: 'free',
            price: 0,
            maxPages: 1,
            maxAiRepliesPerMonth: 60,
            trialDays: 14,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            prioritySupport: false,
        },
        ...overrides,
    });

    it('should allow active subscriptions', () => {
        const result = subscriptionsService.checkSubscriptionStatus(makeSub({ status: 'active' }) as any);
        expect(result.allowed).toBe(true);
    });

    it('should allow trialing subscriptions with future trial end', () => {
        const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'trialing', trialEndsAt: futureDate }) as any
        );
        expect(result.allowed).toBe(true);
    });

    it('should reject canceled subscriptions', () => {
        const result = subscriptionsService.checkSubscriptionStatus(makeSub({ status: 'canceled' }) as any);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('canceled');
        expect(result.code).toBe('subscription_inactive');
    });

    it('should reject paused subscriptions', () => {
        const result = subscriptionsService.checkSubscriptionStatus(makeSub({ status: 'paused' }) as any);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('paused');
        expect(result.code).toBe('subscription_inactive');
    });

    it('should reject expired trial', () => {
        const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'trialing', trialEndsAt: pastDate }) as any
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Trial has expired');
        expect(result.code).toBe('subscription_inactive');
    });

    it('should allow past_due within grace period', () => {
        // Period ended 1 day ago (within 3-day grace)
        const periodEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as any
        );
        expect(result.allowed).toBe(true);
    });

    it('should reject past_due beyond grace period', () => {
        // Period ended 5 days ago (beyond 3-day grace)
        const periodEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as any
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('expired');
        // A billing problem must be distinguishable from a real page-count limit
        // so the toggle endpoint shows "renew" instead of "disable a page".
        expect(result.code).toBe('subscription_inactive');
    });

    it('should allow past_due with no period end (fallback)', () => {
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'past_due', currentPeriodEnd: null }) as any
        );
        expect(result.allowed).toBe(true);
    });
});

describe('isSubscriptionActive', () => {
    let redisMock: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        // Get the mocked redis to force cache miss on each test
        const { redis } = await import('../../src/lib/redis');
        redisMock = redis as any;
        redisMock.get.mockResolvedValue(null); // cache miss → hit DB
    });

    it('should return true when no subscription exists (free/trial user)', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);
        const result = await subscriptionsService.isSubscriptionActive('user-no-sub');
        expect(result).toBe(true);
        spy.mockRestore();
    });

    it('should return true for active subscription', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'active',
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(true);
        spy.mockRestore();
    });

    it('should return true for trialing subscription', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'trialing',
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(true);
        spy.mockRestore();
    });

    it('should return false for canceled subscription', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'canceled',
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(false);
        spy.mockRestore();
    });

    it('should return false for paused subscription', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'paused',
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(false);
        spy.mockRestore();
    });

    // past_due carries a 3-day grace in checkSubscriptionStatus (Stripe's first
    // payment-retry window). This used to answer a flat `false` for past_due
    // because it tested `status in (active, trialing)` itself — a SECOND opinion
    // that contradicted the gate actually deciding replies. It now delegates, so
    // these two pin the real boundary rather than the old disagreement.
    it('should return true for past_due still inside the 3-day grace window', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'past_due',
            currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(true);
        spy.mockRestore();
    });

    it('should return false for past_due beyond the grace window', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'past_due',
            currentPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(false);
        spy.mockRestore();
    });

    it('should return false for a manual plan past its snapped coverage end', async () => {
        // The regression, at this layer: `status` stays 'active' forever on a
        // manual plan, so a status-only check called this account healthy.
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'active', paymentMethod: 'manual',
            currentPeriodEnd: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        } as any);
        const result = await subscriptionsService.isSubscriptionActive('user_1');
        expect(result).toBe(false);
        spy.mockRestore();
    });

    it('should use cached value from Redis when available', async () => {
        redisMock.get.mockResolvedValue('0'); // cached as inactive
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription');
        const result = await subscriptionsService.isSubscriptionActive('user_cached');
        expect(result).toBe(false);
        expect(spy).not.toHaveBeenCalled(); // DB not hit
        spy.mockRestore();
    });

    describe('getUsageSummary', () => {
        const mockPlan = {
            id: 'plan_123',
            name: 'Business',
            slug: 'business',
            price: 2500,
            maxPages: 3,
            maxAiRepliesPerMonth: 1500,
            trialDays: 0,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            prioritySupport: false,
        };

        const mockSubscription = {
            id: 'sub_1',
            userId: 'owner-1',
            planId: 'plan_123',
            plan: mockPlan,
            status: 'active' as const,
            trialEndsAt: null,
            currentPeriodStart: new Date('2026-04-01'),
            currentPeriodEnd: new Date('2026-05-01'),
            stripeCustomerId: 'cus_xxx',
            canceledAt: null,
            cancelReason: null,
            externalSubscriptionId: null,
            paymentMethod: 'stripe' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockUsage = {
            id: 'usage_1',
            userId: 'owner-1',
            periodStart: new Date('2026-04-01'),
            periodEnd: new Date('2026-05-01'),
            aiRepliesCount: 300,
            totalCommentsProcessed: 350,
            totalMessagesProcessed: 100,
            dailyBreakdown: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        beforeEach(() => {
            // getUsageSummary now includes a top-up section. These legacy tests
            // only assert plan + pages behavior; stub top-up to zeros so they
            // don't need to mock the additional users + topup_purchases queries.
            vi.spyOn(subscriptionsService, 'getTopupSummary').mockResolvedValue({
                balance: 0,
                lifetimePurchased: 0,
            });
        });

        /**
         * Billing belongs to the WORKSPACE. `getUsageSummary` answers for the
         * workspace owner's subscription for everyone in it — the owner
         * included, for whom it is the same row either way.
         *
         * It used to answer "mine, else the owner's". That fallback existed for
         * team members and had never once run in production: every signup mints
         * a trial row, and it lingers when that person is later added to someone
         * else's workspace, so all 4 team members on the platform were answered
         * from their own expired `starter`. This endpoint feeds the dashboard's
         * plan banner, so when a workspace's subscription lapsed the people
         * actually using the app saw a healthy ghost plan and had no way to
         * learn why replies had stopped.
         */
        const mockWorkspaceOwner = async (ownerId: string | null) => {
            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(ownerId ? [{ ownerId }] : []),
                    }),
                }),
            } as any);
        };

        it('returns usage summary for workspace owner', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(2);
            await mockWorkspaceOwner('owner-1');

            const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

            expect(result).not.toBeNull();
            expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('owner-1');
            expect(result!.aiReplies.used).toBe(300);
            expect(result!.pages.used).toBe(2);
            // Default helper returns null → the field is omitted, not false.
            expect(result!.subscription.whatsappUnavailable).toBeUndefined();
        });

        it('carries subscription.whatsappUnavailable when the account is a Zid store (D-117)', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(2);
            await mockWorkspaceOwner('owner-1');
            // Mutation: drop the whatsappUnavailable field from getUsageSummary's
            // return and this fails.
            mockGetWaUnavailable.mockResolvedValueOnce('zid_marketplace');

            const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

            expect(result!.subscription.whatsappUnavailable).toEqual({ reason: 'zid_marketplace' });
        });

        /**
         * THE regression. A team member carrying a leftover trial row from their
         * own signup must be shown the WORKSPACE's plan, never that row — this
         * is the case that shipped, and the one a "mine, else the owner's"
         * resolver answers wrongly for every member who has ever signed up.
         */
        it("answers with the workspace owner's plan even when the member has a subscription of their own", async () => {
            const memberOwnStale = {
                ...mockSubscription,
                id: 'sub-member-ghost',
                status: 'past_due',
                plan: { ...mockSubscription.plan, slug: 'starter', maxAiRepliesPerMonth: 100 },
            } as typeof mockSubscription;

            const getUserSubscription = vi.spyOn(subscriptionsService, 'getUserSubscription')
                .mockImplementation(async (id: string) =>
                    (id === 'owner-1' ? mockSubscription : memberOwnStale) as never);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
            await mockWorkspaceOwner('owner-1');

            const result = await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(result!.subscription.plan.slug).toBe(mockSubscription.plan.slug);
            expect(result!.subscription.plan.slug).not.toBe('starter');
            // The member's own row must not even be consulted.
            expect(getUserSubscription).toHaveBeenCalledWith('owner-1');
            expect(getUserSubscription).not.toHaveBeenCalledWith('member-1');
        });

        it("uses the workspace owner's subscription for a member who has none", async () => {
            const getUserSubscription = vi.spyOn(subscriptionsService, 'getUserSubscription')
                .mockResolvedValue(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
            await mockWorkspaceOwner('owner-1');

            const result = await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(result).not.toBeNull();
            expect(getUserSubscription).toHaveBeenCalledWith('owner-1');
            expect(result!.aiReplies.used).toBe(300);
        });

        it('returns null when the workspace owner has no subscription', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);
            await mockWorkspaceOwner('owner-1');

            const result = await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(result).toBeNull();
        });

        /**
         * A missing workspace row is not a reason to show someone else's
         * billing — it falls back to the caller's own, which is what a personal
         * workspace resolves to anyway.
         */
        it('returns null when the workspace is not found and the caller has no subscription', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);
            await mockWorkspaceOwner(null);

            const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

            expect(result).toBeNull();
        });

        it('counts page slots by workspaceId, not owner userId', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            const countSpy = vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(2);
            await mockWorkspaceOwner('owner-1');

            await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(countSpy).toHaveBeenCalledWith('ws-1');
        });

        /**
         * The workspace-scoped twin of canUseAiReplies. It exists so an HTTP
         * surface calls ONE service method instead of composing the resolution
         * itself — the composition living in the route is what let /limits/ai
         * and /usage answer for different subjects.
         */
        it('canUseAiRepliesForWorkspace answers for the workspace owner, not the caller', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            const quotaSpy = vi.spyOn(subscriptionsService, 'canUseAiReplies')
                .mockResolvedValue({ allowed: true } as never);
            await mockWorkspaceOwner('owner-1');

            await subscriptionsService.canUseAiRepliesForWorkspace('member-1', 'ws-1');

            expect(quotaSpy).toHaveBeenCalledWith('owner-1');
            expect(quotaSpy).not.toHaveBeenCalledWith('member-1');
        });

        it('canUseAiRepliesForWorkspace falls back to the caller when the workspace is unknown', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);
            const quotaSpy = vi.spyOn(subscriptionsService, 'canUseAiReplies')
                .mockResolvedValue({ allowed: false } as never);
            await mockWorkspaceOwner(null);

            await subscriptionsService.canUseAiRepliesForWorkspace('member-1', 'ws-1');

            expect(quotaSpy).toHaveBeenCalledWith('member-1');
        });

        it('fetches AI usage from owner, not member', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            const getUsageSpy = vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(0);
            await mockWorkspaceOwner('owner-1');

            await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(getUsageSpy).toHaveBeenCalledWith('owner-1');
        });

        /**
         * The cost of a block, carried on the same payload as the verdict.
         *
         * The dashboard can say "your subscription ended" — a merchant defers
         * that. It could not say "579 customers wrote to you since and nobody
         * answered", which is the same fact in the terms they decide on. The
         * 2026-08-22 fleet read found 17 blocked pages holding 1,513 unanswered
         * messages in one week, four of them still showing auto-reply ON.
         */
        describe('unansweredSinceBlock', () => {
            const lapsedManual = {
                ...mockSubscription,
                paymentMethod: 'manual' as const,
                // Snapped boundary is 2026-08-01T00:00:00Z, comfortably past.
                currentPeriodEnd: new Date('2026-08-01T16:26:00.000Z'),
            };

            it('counts unanswered inbound since the boundary the gate enforces', async () => {
                vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(lapsedManual);
                vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
                vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
                const countSpy = vi.spyOn(subscriptionsService, 'countUnansweredSince').mockResolvedValue(579);
                await mockWorkspaceOwner('owner-1');

                const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

                expect(result!.subscription.autoReply).toMatchObject({ allowed: false, unansweredSinceBlock: 579 });
                // Counted from the SNAPPED entitlement end, not `currentPeriodEnd`:
                // the ~16h between them is time the merchant was already blocked,
                // and messages that arrived in it are part of what the block cost.
                expect(countSpy).toHaveBeenCalledWith('ws-1', new Date('2026-08-01T00:00:00.000Z'));
            });

            it('scopes the count to the VIEWED workspace, not the subscription owner', async () => {
                // An owner with two workspaces must not see one workspace's
                // silence reported on the other's dashboard.
                vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(lapsedManual);
                vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
                vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
                const countSpy = vi.spyOn(subscriptionsService, 'countUnansweredSince').mockResolvedValue(3);
                await mockWorkspaceOwner('owner-1');

                await subscriptionsService.getUsageSummary('member-1', 'ws-2');

                expect(countSpy).toHaveBeenCalledWith('ws-2', expect.any(Date));
            });

            it('does not count — at all — while the gate allows', async () => {
                // Three extra COUNT queries on every healthy dashboard load would
                // be a real cost for a number nothing renders.
                vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
                vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
                vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
                const countSpy = vi.spyOn(subscriptionsService, 'countUnansweredSince').mockResolvedValue(99);
                await mockWorkspaceOwner('owner-1');

                const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

                expect(countSpy).not.toHaveBeenCalled();
                expect(result!.subscription.autoReply?.unansweredSinceBlock).toBeUndefined();
            });

            it('forwards the gate\'s cause so the dashboard can tell a trial from a lapsed plan', async () => {
                vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
                    ...mockSubscription,
                    status: 'past_due' as const,
                    paymentMethod: null as unknown as typeof mockSubscription.paymentMethod,
                    trialEndsAt: new Date('2026-08-01T00:00:00.000Z'),
                });
                vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
                vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
                vi.spyOn(subscriptionsService, 'countUnansweredSince').mockResolvedValue(7);
                await mockWorkspaceOwner('owner-1');

                const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

                expect(result!.subscription.autoReply).toMatchObject({ allowed: false, cause: 'trial_expired', unansweredSinceBlock: 7 });
            });

            it('omits the count when the block has no boundary to count from', async () => {
                // canceled/paused are refused by STATUS, so resolveEntitlementEnd
                // returns null — there is no "since" and inventing one (the row's
                // period end) would count messages from before the block.
                vi.spyOn(subscriptionsService, 'getUserSubscription')
                    .mockResolvedValue({ ...mockSubscription, status: 'canceled' as const });
                vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
                vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);
                const countSpy = vi.spyOn(subscriptionsService, 'countUnansweredSince').mockResolvedValue(42);
                await mockWorkspaceOwner('owner-1');

                const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

                expect(result!.subscription.autoReply?.allowed).toBe(false);
                expect(countSpy).not.toHaveBeenCalled();
                expect(result!.subscription.autoReply?.unansweredSinceBlock).toBeUndefined();
            });
        });
    });
});

describe('startOfUtcDay', () => {
    it('snaps a mid-day UTC timestamp back to 00:00:00 UTC of the same day', () => {
        const result = startOfUtcDay(new Date('2026-05-10T21:12:43.111Z'));
        expect(result.toISOString()).toBe('2026-05-10T00:00:00.000Z');
    });

    it('keeps an already-midnight UTC timestamp unchanged', () => {
        const result = startOfUtcDay(new Date('2026-05-10T00:00:00.000Z'));
        expect(result.toISOString()).toBe('2026-05-10T00:00:00.000Z');
    });

    it('does not mutate the input date', () => {
        const input = new Date('2026-05-10T21:12:43.111Z');
        startOfUtcDay(input);
        expect(input.toISOString()).toBe('2026-05-10T21:12:43.111Z');
    });

    it('uses UTC day, not local — a UTC+3 evening still maps to the UTC date', () => {
        // 2026-05-10 23:30 UTC = 2026-05-11 02:30 in Riyadh (UTC+3)
        // We want UTC midnight, not local midnight.
        const result = startOfUtcDay(new Date('2026-05-10T23:30:00.000Z'));
        expect(result.toISOString()).toBe('2026-05-10T00:00:00.000Z');
    });
});


describe('isPayingCustomer — Shopify rail lock', () => {
    // Locked by AI_INSTRUCTIONS/D-A: a Shopify AppSubscription GID stored in
    // externalSubscriptionId reads as PAYING through the first branch, by
    // design — a Shopify-managed trial is card-equivalent commitment exactly
    // like a Stripe-managed one. If someone narrows that branch to Stripe ids,
    // this test is the tripwire.
    it('treats a shopify-billed row (AppSubscription GID) as paying', async () => {
        const { isPayingCustomer } = await import('../../src/services/subscriptions');
        expect(isPayingCustomer({
            status: 'trialing',
            externalSubscriptionId: 'gid://shopify/AppSubscription/123',
            stripeCustomerId: null,
            paymentMethod: 'shopify',
        })).toBe(true);
    });

    it('still rejects a bare trial row with no billing identity', async () => {
        const { isPayingCustomer } = await import('../../src/services/subscriptions');
        expect(isPayingCustomer({
            status: 'trialing',
            externalSubscriptionId: null,
            stripeCustomerId: null,
            paymentMethod: null,
        })).toBe(false);
    });
});

describe('getUsageSummary — shopify signals suppressed on a CANCELED mirror (H2)', () => {
    // A merchant who uninstalled the Shopify app has ONE row: the canceled
    // mirror. If it still read as shopify-billed, every frontend surface would
    // dead-end them into an app they no longer have — they must be free to
    // come back through Stripe (same exemption as rejectIfShopifyBilled).
    const basePlan = { id: 'p1', slug: 'business', maxPages: 3, maxAiRepliesPerMonth: 4500 };

    const stubInternals = (subscription: Record<string, unknown>) => {
        vi.spyOn(subscriptionsService, 'resolveWorkspaceSubscription').mockResolvedValue({
            subscription: { plan: basePlan, ...subscription },
            ownerId: 'u1',
        } as never);
        vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(null);
        vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(0);
        vi.spyOn(subscriptionsService, 'getTopupSummary').mockResolvedValue({ balance: 0, lifetimePurchased: 0 });
    };

    it('drops paymentMethod and the manage URL for a canceled shopify mirror', async () => {
        stubInternals({
            status: 'canceled',
            paymentMethod: 'shopify',
            shopifyShopDomain: 'left.myshopify.com',
        });

        const summary = await subscriptionsService.getUsageSummary('u1', 'ws1');

        expect(summary?.subscription.paymentMethod).toBeUndefined();
        expect(summary?.subscription.shopifyManageUrl).toBeUndefined();
    });

    it('keeps paymentMethod=shopify for a live mirror', async () => {
        stubInternals({
            status: 'active',
            paymentMethod: 'shopify',
            shopifyShopDomain: 'live.myshopify.com',
        });

        const summary = await subscriptionsService.getUsageSummary('u1', 'ws1');

        expect(summary?.subscription.paymentMethod).toBe('shopify');
    });

    /**
     * The Salla Article-5 signal (D-065). This choke point is the ONLY place
     * the frontend learns the answer, so if it stops being emitted every
     * suppressed CTA silently comes back and Salla merchants walk into Stripe.
     */
    it('exposes sallaBilled for a Salla merchant, resolved against the subscription OWNER', async () => {
        const { resolveMarketplaceBilling } = await import('../../src/services/marketplaceBilling');
        vi.mocked(resolveMarketplaceBilling).mockResolvedValueOnce({
            marketplace: 'salla', code: 'SALLA_BILLED', message: 'x',
        });
        stubInternals({ status: 'trialing' });

        const summary = await subscriptionsService.getUsageSummary('member-id', 'ws1');

        expect(summary?.subscription.sallaBilled).toBe(true);
        expect(summary?.subscription.marketplaceBilling).toEqual({
            marketplace: 'salla', manageUrl: undefined,
        });
        // 'u1' is the ownerId from resolveWorkspaceSubscription, NOT the caller:
        // one subscription serves every workspace its owner has.
        expect(resolveMarketplaceBilling).toHaveBeenCalledWith('u1', expect.anything());
    });

    /**
     * The legacy flag is Salla-only ON PURPOSE — the mobile app ships a bundled
     * frontend that lags, and an old build reading `sallaBilled` must not start
     * seeing Zid merchants under a Salla-worded surface. The general field is
     * what carries the Zid rail.
     */
    it('exposes a Zid merchant through marketplaceBilling WITHOUT setting the legacy sallaBilled flag', async () => {
        const { resolveMarketplaceBilling } = await import('../../src/services/marketplaceBilling');
        vi.mocked(resolveMarketplaceBilling).mockResolvedValueOnce({
            marketplace: 'zid', code: 'ZID_BILLED', message: 'x',
        });
        stubInternals({ status: 'trialing' });

        const summary = await subscriptionsService.getUsageSummary('u1', 'ws1');

        expect(summary?.subscription.marketplaceBilling?.marketplace).toBe('zid');
        expect(summary?.subscription.sallaBilled).toBeUndefined();
    });

    it('omits sallaBilled entirely when the rule does not apply', async () => {
        stubInternals({ status: 'trialing' });

        const summary = await subscriptionsService.getUsageSummary('u1', 'ws1');

        expect(summary?.subscription.sallaBilled).toBeUndefined();
    });
});

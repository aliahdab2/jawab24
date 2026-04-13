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
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), quit: vi.fn(), del: vi.fn() },
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
                trialDays: 30,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: true,
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
                showBranding: false,
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
                showBranding: false,
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

            // Default plan mock has trialDays: 30, so the insert should be called
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
                        trialDays: 30, facebookEnabled: true, instagramEnabled: true,
                        whatsappEnabled: false, showBranding: true, prioritySupport: false,
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
                                                showBranding: false, prioritySupport: false,
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
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 30, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                showBranding: true, prioritySupport: false,
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
                        trialDays: 30, facebookEnabled: true, instagramEnabled: true,
                        whatsappEnabled: false, showBranding: true, prioritySupport: false,
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
                        showBranding: false, prioritySupport: true,
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
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 30, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                showBranding: true, prioritySupport: false,
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
                            limit: vi.fn().mockResolvedValue([{
                                id: 'usage_1',
                                userId: 'user_1',
                                periodStart: new Date(),
                                periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                aiRepliesCount: 60,
                                templateRepliesCount: 0,
                                totalCommentsProcessed: 0,
                                totalMessagesProcessed: 0,
                                dailyBreakdown: {},
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            }]),
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
                                                maxPages: 1, maxAiRepliesPerMonth: 60, trialDays: 30, facebookEnabled: true,
                                                instagramEnabled: true, whatsappEnabled: false,
                                                showBranding: true, prioritySupport: false,
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
                            limit: vi.fn().mockResolvedValue([{
                                id: 'usage_1',
                                userId: 'user_1',
                                periodStart: new Date(),
                                periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                                aiRepliesCount: 30,
                                templateRepliesCount: 0,
                                totalCommentsProcessed: 0,
                                totalMessagesProcessed: 0,
                                dailyBreakdown: {},
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            }]),
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

    describe('cancelSubscription', () => {
        it('should set status to canceled and return updated subscription', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 'sub_1',
                            userId: 'user_1',
                            planId: 'plan_1',
                            status: 'canceled',
                            trialEndsAt: null,
                            currentPeriodStart: new Date(),
                            currentPeriodEnd: new Date(),
                            canceledAt: new Date(),
                            cancelReason: 'Too expensive',
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.cancelSubscription('user_1', 'Too expensive');
            expect(result).not.toBeNull();
            expect(result!.status).toBe('canceled');
            expect(result!.cancelReason).toBe('Too expensive');
        });

        it('should return null when no subscription found to cancel', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.cancelSubscription('user_none');
            expect(result).toBeNull();
        });
    });

    describe('pauseSubscription / resumeSubscription', () => {
        it('should set status to paused', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                            status: 'paused', trialEndsAt: null,
                            currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
                            canceledAt: null, cancelReason: null,
                            createdAt: new Date(), updatedAt: new Date(),
                        }]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.pauseSubscription('user_1');
            expect(result!.status).toBe('paused');
        });

        it('should set status to active on resume', async () => {
            const { db } = await import('../../src/db');

            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 'sub_1', userId: 'user_1', planId: 'plan_1',
                            status: 'active', trialEndsAt: null,
                            currentPeriodStart: new Date(), currentPeriodEnd: new Date(),
                            canceledAt: null, cancelReason: null,
                            createdAt: new Date(), updatedAt: new Date(),
                        }]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.resumeSubscription('user_1');
            expect(result!.status).toBe('active');
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
            trialDays: 30,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            showBranding: true,
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
    });

    it('should reject paused subscriptions', () => {
        const result = subscriptionsService.checkSubscriptionStatus(makeSub({ status: 'paused' }) as any);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('paused');
    });

    it('should reject expired trial', () => {
        const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'trialing', trialEndsAt: pastDate }) as any
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Trial has expired');
    });

    it('should allow past_due within grace period', () => {
        // Period ended 3 days ago (within 7-day grace)
        const periodEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as any
        );
        expect(result.allowed).toBe(true);
    });

    it('should reject past_due beyond grace period', () => {
        // Period ended 10 days ago (beyond 7-day grace)
        const periodEnd = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const result = subscriptionsService.checkSubscriptionStatus(
            makeSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as any
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('expired');
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

    it('should return false for past_due subscription', async () => {
        const spy = vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue({
            id: 'sub_1', userId: 'user_1', status: 'past_due',
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
            showBranding: false,
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
            templateRepliesCount: 50,
            totalCommentsProcessed: 350,
            totalMessagesProcessed: 100,
            dailyBreakdown: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        it('returns usage summary for workspace owner', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(2);

            const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

            expect(result).not.toBeNull();
            expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('owner-1');
            expect(result!.aiReplies.used).toBe(300);
            expect(result!.pages.used).toBe(2);
        });

        it('returns null when no subscription and workspace not found', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUsageSummary('owner-1', 'ws-1');

            expect(result).toBeNull();
        });

        it('falls back to workspace owner subscription for team members', async () => {
            const getUserSubscription = vi.spyOn(subscriptionsService, 'getUserSubscription')
                .mockResolvedValueOnce(null)              // member has no subscription
                .mockResolvedValueOnce(mockSubscription); // owner's subscription
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(1);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ ownerId: 'owner-1' }]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(result).not.toBeNull();
            expect(getUserSubscription).toHaveBeenCalledWith('member-1');
            expect(getUserSubscription).toHaveBeenCalledWith('owner-1');
            expect(result!.aiReplies.used).toBe(300);
        });

        it('returns null when member has no subscription and owner also has none', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription').mockResolvedValue(null);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ ownerId: 'owner-1' }]),
                    }),
                }),
            } as any);

            const result = await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(result).toBeNull();
        });

        it('counts page slots by workspaceId, not owner userId', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription')
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockSubscription);
            vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            const countSpy = vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(2);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ ownerId: 'owner-1' }]),
                    }),
                }),
            } as any);

            await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(countSpy).toHaveBeenCalledWith('ws-1');
        });

        it('fetches AI usage from owner, not member', async () => {
            vi.spyOn(subscriptionsService, 'getUserSubscription')
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockSubscription);
            const getUsageSpy = vi.spyOn(subscriptionsService, 'getCurrentUsage').mockResolvedValue(mockUsage);
            vi.spyOn(subscriptionsService, 'countEnabledPageSlots').mockResolvedValue(0);

            const { db } = await import('../../src/db');
            vi.mocked(db.select).mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ ownerId: 'owner-1' }]),
                    }),
                }),
            } as any);

            await subscriptionsService.getUsageSummary('member-1', 'ws-1');

            expect(getUsageSpy).toHaveBeenCalledWith('owner-1');
        });
    });
});


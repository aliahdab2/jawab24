import { describe, it, expect, vi, beforeEach } from 'vitest';
import { plansService } from '../../src/services/plans';

// Mock database
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockResolvedValue([]),
                    limit: vi.fn().mockResolvedValue([]),
                }),
                orderBy: vi.fn().mockResolvedValue([]),
            }),
        }),
        insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 'plan_uuid_123',
                    name: 'Test Plan',
                    slug: 'test-plan',
                    description: 'Test description',
                    price: 1000,
                    currency: 'USD',
                    interval: 'month',
                    maxPages: 3,
                    maxAiRepliesPerMonth: 1000,
                    maxTemplates: null,
                    maxRules: null,
                    facebookEnabled: true,
                    instagramEnabled: true,
                    whatsappEnabled: false,
                    showBranding: false,
                    prioritySupport: true,
                    trialDays: 14,
                    regionalPricing: {},
                    isActive: true,
                    isDefault: false,
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }]),
            }),
        }),
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 'plan_uuid_123',
                        name: 'Updated Plan',
                        slug: 'test-plan',
                        price: 2000,
                        isActive: true,
                    }]),
                }),
            }),
        }),
        delete: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 'plan_uuid_123' }]),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    plans: { id: 'id', slug: 'slug', isActive: 'is_active', isDefault: 'is_default', sortOrder: 'sort_order' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value })),
    and: vi.fn((...args) => args),
    asc: vi.fn((field) => ({ field, direction: 'asc' })),
}));

describe('Plans Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('mapToPlan', () => {
        it('should correctly map database row to Plan type', () => {
            const dbRow = {
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                description: 'For growing businesses',
                price: 2500,
                currency: 'USD',
                interval: 'month',
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                maxTemplates: null,
                maxRules: null,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: false,
                prioritySupport: false,
                trialDays: 0,
                regionalPricing: { SY: 350000 },
                isActive: true,
                isDefault: false,
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const plan = plansService.mapToPlan(dbRow);

            expect(plan.id).toBe('plan_123');
            expect(plan.name).toBe('Business');
            expect(plan.slug).toBe('business');
            expect(plan.price).toBe(2500);
            expect(plan.maxPages).toBe(3);
            expect(plan.maxTemplates).toBeNull();
            expect(plan.facebookEnabled).toBe(true);
            expect(plan.showBranding).toBe(false);
            expect(plan.regionalPricing).toEqual({ SY: 350000 });
        });

        it('should handle null/undefined values with defaults', () => {
            const dbRow = {
                id: 'plan_123',
                name: 'Free',
                slug: 'free',
                description: null,
                price: 0,
                currency: null,
                interval: null,
                maxPages: 1,
                maxAiRepliesPerMonth: 50,
                maxTemplates: 3,
                maxRules: 2,
                facebookEnabled: null,
                instagramEnabled: null,
                whatsappEnabled: null,
                showBranding: null,
                prioritySupport: null,
                trialDays: null,
                regionalPricing: null,
                isActive: null,
                isDefault: null,
                sortOrder: null,
                createdAt: null,
                updatedAt: null,
            };

            const plan = plansService.mapToPlan(dbRow);

            expect(plan.currency).toBe('USD');
            expect(plan.interval).toBe('month');
            expect(plan.facebookEnabled).toBe(true);
            expect(plan.instagramEnabled).toBe(true);
            expect(plan.whatsappEnabled).toBe(false);
            expect(plan.showBranding).toBe(true);
            expect(plan.prioritySupport).toBe(false);
            expect(plan.trialDays).toBe(0);
            expect(plan.regionalPricing).toEqual({});
            expect(plan.isActive).toBe(true);
            expect(plan.isDefault).toBe(false);
            expect(plan.sortOrder).toBe(0);
        });
    });

    describe('getPriceForRegion', () => {
        it('should return regional price when available', () => {
            const plan = {
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                price: 2500, // $25 USD
                currency: 'USD',
                interval: 'month' as const,
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                maxTemplates: null,
                maxRules: null,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: false,
                prioritySupport: false,
                trialDays: 0,
                regionalPricing: { SY: 350000, SA: 100 },
                isActive: true,
                isDefault: false,
                sortOrder: 2,
            };

            expect(plansService.getPriceForRegion(plan, 'SY')).toBe(350000);
            expect(plansService.getPriceForRegion(plan, 'SA')).toBe(100);
        });

        it('should return default price when region not found', () => {
            const plan = {
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                price: 2500,
                currency: 'USD',
                interval: 'month' as const,
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                maxTemplates: null,
                maxRules: null,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: false,
                prioritySupport: false,
                trialDays: 0,
                regionalPricing: { SY: 350000 },
                isActive: true,
                isDefault: false,
                sortOrder: 2,
            };

            expect(plansService.getPriceForRegion(plan, 'US')).toBe(2500);
            expect(plansService.getPriceForRegion(plan, 'DE')).toBe(2500);
        });

        it('should return default price when no regional pricing defined', () => {
            const plan = {
                id: 'plan_123',
                name: 'Free',
                slug: 'free',
                price: 0,
                currency: 'USD',
                interval: 'month' as const,
                maxPages: 1,
                maxAiRepliesPerMonth: 50,
                maxTemplates: 3,
                maxRules: 2,
                facebookEnabled: true,
                instagramEnabled: true,
                whatsappEnabled: false,
                showBranding: true,
                prioritySupport: false,
                trialDays: 30,
                regionalPricing: {},
                isActive: true,
                isDefault: true,
                sortOrder: 0,
            };

            expect(plansService.getPriceForRegion(plan, 'SY')).toBe(0);
        });
    });

    describe('createPlan', () => {
        it('should create a plan with provided data', async () => {
            const planData = {
                name: 'Test Plan',
                slug: 'test-plan',
                price: 1000,
                maxPages: 5,
            };

            const result = await plansService.createPlan(planData);

            expect(result).toBeDefined();
            expect(result.name).toBe('Test Plan');
            expect(result.slug).toBe('test-plan');
        });

        it('should use default values for missing fields', async () => {
            const planData = {
                name: 'Minimal Plan',
                slug: 'minimal',
            };

            const result = await plansService.createPlan(planData);

            expect(result).toBeDefined();
            // Defaults should be applied in the service
        });
    });
});


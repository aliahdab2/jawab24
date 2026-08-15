import { describe, it, expect, vi, beforeEach } from 'vitest';
import { plansService } from '../../src/services/plans';
import { db } from '../../src/db';

// ---------------------------------------------------------------------------
// DB mock — chainable builder for select/insert/update/delete
// ---------------------------------------------------------------------------
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    plans: {
        id: 'id',
        slug: 'slug',
        isActive: 'is_active',
        isPublic: 'is_public',
        isDefault: 'is_default',
        sortOrder: 'sort_order',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => args),
    asc: vi.fn((field) => ({ field, direction: 'asc' })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid DB row for plans */
function makeDbRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'plan_uuid_123',
        name: 'Test Plan',
        slug: 'test-plan',
        description: 'A test plan',
        price: 1000,
        yearlyPrice: null,
        currency: 'USD',
        interval: 'month',
        maxPages: 3,
        maxAiRepliesPerMonth: 1000,
        maxProducts: 50,
        facebookEnabled: true,
        instagramEnabled: true,
        whatsappEnabled: false,
        ecommerceEnabled: true,
        prioritySupport: true,
        trialDays: 14,
        regionalPricing: {},
        isActive: true,
        isDefault: false,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

/** Set up a chainable select mock that resolves to `rows` */
function mockSelect(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ orderBy, limit });
    const from = vi.fn().mockReturnValue({ where, orderBy });
    vi.mocked(db.select).mockReturnValue({ from } as any);
    return { from, where, orderBy, limit };
}

/** Set up a chainable update mock that resolves to `rows` via .returning() */
function mockUpdate(rows: unknown[]) {
    const returning = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where, returning });
    vi.mocked(db.update).mockReturnValue({ set } as any);
    return { set, where, returning };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plans Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // mapToPlan
    // -------------------------------------------------------------------------
    describe('mapToPlan', () => {
        it('should correctly map a full database row to Plan type', () => {
            const dbRow = makeDbRow({
                id: 'plan_123',
                name: 'Business',
                slug: 'business',
                description: 'For growing businesses',
                price: 2500,
                maxPages: 3,
                maxAiRepliesPerMonth: 1500,
                regionalPricing: { SY: 350000 },
                sortOrder: 2,
            });

            const plan = plansService.mapToPlan(dbRow);

            expect(plan.id).toBe('plan_123');
            expect(plan.name).toBe('Business');
            expect(plan.slug).toBe('business');
            expect(plan.price).toBe(2500);
            expect(plan.maxPages).toBe(3);
            expect(plan.facebookEnabled).toBe(true);
            expect(plan.regionalPricing).toEqual({ SY: 350000 });
        });

        it('should apply defaults for null/undefined fields', () => {
            const dbRow = {
                id: 'plan_123',
                name: 'Free',
                slug: 'free',
                description: null,
                price: 0,
                yearlyPrice: null,
                currency: null,
                interval: null,
                maxPages: 1,
                maxAiRepliesPerMonth: 50,
                maxProducts: null,
                facebookEnabled: null,
                instagramEnabled: null,
                whatsappEnabled: null,
                ecommerceEnabled: null,
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

            expect(plan.yearlyPrice).toBeNull();
            expect(plan.currency).toBe('USD');
            expect(plan.interval).toBe('month');
            expect(plan.facebookEnabled).toBe(true);
            expect(plan.instagramEnabled).toBe(true);
            expect(plan.whatsappEnabled).toBe(false);
            expect(plan.prioritySupport).toBe(false);
            expect(plan.trialDays).toBe(0);
            expect(plan.regionalPricing).toEqual({});
            expect(plan.isActive).toBe(true);
            expect(plan.isDefault).toBe(false);
            expect(plan.sortOrder).toBe(0);
        });
    });

    // -------------------------------------------------------------------------
    // getPriceForRegion
    // -------------------------------------------------------------------------
    describe('getPriceForRegion', () => {
        const basePlan = {
            id: 'plan_123',
            name: 'Business',
            slug: 'business',
            price: 2500,
            yearlyPrice: null,
            currency: 'USD',
            interval: 'month' as const,
            maxPages: 3,
            maxAiRepliesPerMonth: 1500,
            maxProducts: 50,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            ecommerceEnabled: true,
            prioritySupport: false,
            trialDays: 0,
            isActive: true,
            isDefault: false,
            sortOrder: 2,
        };

        it('returns the regional price when a matching region code is present', () => {
            const plan = { ...basePlan, regionalPricing: { SY: 350000, SA: 100 } };
            expect(plansService.getPriceForRegion(plan, 'SY')).toBe(350000);
            expect(plansService.getPriceForRegion(plan, 'SA')).toBe(100);
        });

        it('returns plan.price when region code is not in regionalPricing', () => {
            const plan = { ...basePlan, regionalPricing: { SY: 350000 } };
            expect(plansService.getPriceForRegion(plan, 'US')).toBe(2500);
            expect(plansService.getPriceForRegion(plan, 'DE')).toBe(2500);
        });

        it('returns plan.price when regionalPricing is an empty object', () => {
            const plan = { ...basePlan, regionalPricing: {} };
            expect(plansService.getPriceForRegion(plan, 'SY')).toBe(2500);
        });
    });

    // -------------------------------------------------------------------------
    // getActivePlans
    // -------------------------------------------------------------------------
    describe('getActivePlans', () => {
        it('returns mapped plans when rows are found', async () => {
            const row = makeDbRow();
            mockSelect([row]);

            const result = await plansService.getActivePlans();
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(row.id);
        });

        it('returns empty array when no active plans exist', async () => {
            mockSelect([]);
            const result = await plansService.getActivePlans();
            expect(result).toEqual([]);
        });

        it('filters to active AND public plans (hidden high-volume plans excluded)', async () => {
            const { where } = mockSelect([makeDbRow()]);
            await plansService.getActivePlans();
            // The public grid must request only is_active = true AND is_public = true,
            // so isPublic:false plans (e.g. scale-20k/scale-30k) never surface on /pricing.
            expect(where).toHaveBeenCalledWith(
                expect.arrayContaining([
                    { field: 'is_active', value: true, op: 'eq' },
                    { field: 'is_public', value: true, op: 'eq' },
                ]),
            );
        });
    });

    // -------------------------------------------------------------------------
    // getAllPlans
    // -------------------------------------------------------------------------
    describe('getAllPlans', () => {
        it('returns all plans regardless of isActive', async () => {
            const rows = [makeDbRow({ isActive: true }), makeDbRow({ id: 'plan_2', isActive: false })];
            // getAllPlans uses select().from().orderBy() — no where clause
            const orderBy = vi.fn().mockResolvedValue(rows);
            const from = vi.fn().mockReturnValue({ orderBy, where: vi.fn().mockReturnValue({ orderBy, limit: vi.fn() }) });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = await plansService.getAllPlans();
            expect(result).toHaveLength(2);
        });

        it('returns empty array when no plans exist', async () => {
            const orderBy = vi.fn().mockResolvedValue([]);
            const from = vi.fn().mockReturnValue({ orderBy, where: vi.fn().mockReturnValue({ orderBy, limit: vi.fn() }) });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = await plansService.getAllPlans();
            expect(result).toEqual([]);
        });
    });

    // -------------------------------------------------------------------------
    // getPlanById
    // -------------------------------------------------------------------------
    describe('getPlanById', () => {
        it('returns mapped plan when found', async () => {
            const row = makeDbRow();
            mockSelect([row]);

            const result = await plansService.getPlanById('plan_uuid_123');
            expect(result).not.toBeNull();
            expect(result!.id).toBe('plan_uuid_123');
        });

        it('returns null when plan not found', async () => {
            mockSelect([]);
            const result = await plansService.getPlanById('nonexistent');
            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // getPlanBySlug
    // -------------------------------------------------------------------------
    describe('getPlanBySlug', () => {
        it('returns mapped plan when found by slug', async () => {
            const row = makeDbRow({ slug: 'free' });
            mockSelect([row]);

            const result = await plansService.getPlanBySlug('free');
            expect(result).not.toBeNull();
            expect(result!.slug).toBe('free');
        });

        it('returns null when no plan matches the slug', async () => {
            mockSelect([]);
            const result = await plansService.getPlanBySlug('unknown-slug');
            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // getDefaultPlan
    // -------------------------------------------------------------------------
    describe('getDefaultPlan', () => {
        it('returns the plan marked as default when one exists', async () => {
            const defaultRow = makeDbRow({ isDefault: true, slug: 'pro' });
            mockSelect([defaultRow]);

            const result = await plansService.getDefaultPlan();
            expect(result).not.toBeNull();
            expect(result!.isDefault).toBe(true);
        });

        it('falls back to getPlanBySlug("free") when no isDefault plan exists', async () => {
            // First call (getDefaultPlan query) returns empty → then getPlanBySlug('free') returns a row
            const freeRow = makeDbRow({ slug: 'free', isDefault: false });
            let callCount = 0;
            const limit = vi.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(callCount === 1 ? [] : [freeRow]);
            });
            const orderBy = vi.fn().mockResolvedValue([]);
            const where = vi.fn().mockReturnValue({ limit, orderBy });
            const from = vi.fn().mockReturnValue({ where, orderBy });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = await plansService.getDefaultPlan();
            expect(result).not.toBeNull();
            expect(result!.slug).toBe('free');
        });

        it('returns null when no default plan and no free plan found', async () => {
            mockSelect([]);
            const result = await plansService.getDefaultPlan();
            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // createPlan
    // -------------------------------------------------------------------------
    describe('createPlan', () => {
        it('creates a plan with provided data and returns mapped result', async () => {
            const row = makeDbRow({ name: 'Pro', slug: 'pro', price: 1999 });
            const returning = vi.fn().mockResolvedValue([row]);
            const values = vi.fn().mockReturnValue({ returning });
            vi.mocked(db.insert).mockReturnValue({ values } as any);

            const result = await plansService.createPlan({ name: 'Pro', slug: 'pro', price: 1999 });

            expect(db.insert).toHaveBeenCalled();
            expect(result.name).toBe('Pro');
            expect(result.slug).toBe('pro');
            expect(result.price).toBe(1999);
        });

        it('applies defaults for fields not supplied', async () => {
            const row = makeDbRow({
                name: 'Minimal Plan',
                slug: 'minimal',
                price: 0,
                currency: 'USD',
                interval: 'month',
                maxAiRepliesPerMonth: 50,
            });
            const returning = vi.fn().mockResolvedValue([row]);
            const values = vi.fn().mockReturnValue({ returning });
            vi.mocked(db.insert).mockReturnValue({ values } as any);

            const result = await plansService.createPlan({ name: 'Minimal Plan', slug: 'minimal' });

            // The returned plan is mapped from the row — verify service calls insert with defaults
            expect(values).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Minimal Plan',
                    slug: 'minimal',
                    price: 0,
                    currency: 'USD',
                    interval: 'month',
                })
            );
            expect(result).toBeDefined();
        });
    });

    // -------------------------------------------------------------------------
    // updatePlan
    // -------------------------------------------------------------------------
    describe('updatePlan', () => {
        it('returns mapped plan when update finds the row', async () => {
            const updated = makeDbRow({ name: 'Updated Plan', price: 2000 });
            mockUpdate([updated]);

            const result = await plansService.updatePlan('plan_uuid_123', { name: 'Updated Plan', price: 2000 });

            expect(result).not.toBeNull();
            expect(result!.name).toBe('Updated Plan');
        });

        it('returns null when planId does not match any row', async () => {
            mockUpdate([]);
            const result = await plansService.updatePlan('nonexistent', { name: 'X' });
            expect(result).toBeNull();
        });

        it('includes updatedAt in the set payload', async () => {
            const row = makeDbRow();
            const { set } = mockUpdate([row]);

            await plansService.updatePlan('plan_uuid_123', { price: 500 });

            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({ updatedAt: expect.any(Date) })
            );
        });
    });

    // -------------------------------------------------------------------------
    // deletePlan (soft delete)
    // -------------------------------------------------------------------------
    describe('deletePlan', () => {
        it('returns true when a row is soft-deleted', async () => {
            const { set } = mockUpdate([{ id: 'plan_uuid_123' }]);
            const result = await plansService.deletePlan('plan_uuid_123');
            expect(result).toBe(true);
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({ isActive: false })
            );
        });

        it('returns false when no row matched', async () => {
            mockUpdate([]);
            const result = await plansService.deletePlan('nonexistent');
            expect(result).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // hardDeletePlan
    // -------------------------------------------------------------------------
    describe('hardDeletePlan', () => {
        it('returns true when a row is hard-deleted', async () => {
            const returning = vi.fn().mockResolvedValue([{ id: 'plan_uuid_123' }]);
            const where = vi.fn().mockReturnValue({ returning });
            vi.mocked(db.delete).mockReturnValue({ where } as any);

            const result = await plansService.hardDeletePlan('plan_uuid_123');
            expect(result).toBe(true);
            expect(db.delete).toHaveBeenCalled();
        });

        it('returns false when no row matched', async () => {
            const returning = vi.fn().mockResolvedValue([]);
            const where = vi.fn().mockReturnValue({ returning });
            vi.mocked(db.delete).mockReturnValue({ where } as any);

            const result = await plansService.hardDeletePlan('nonexistent');
            expect(result).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // setDefaultPlan
    // -------------------------------------------------------------------------
    describe('setDefaultPlan', () => {
        it('first unsets all defaults then sets the specified plan as default', async () => {
            // update is called twice: first unset-all (no .where), then set specific
            let callIndex = 0;
            const setMock = vi.fn().mockImplementation(() => {
                callIndex++;
                if (callIndex === 1) {
                    // First call: unset all — no .where chained
                    return Promise.resolve();
                }
                // Second call: set specific plan
                const returning = vi.fn().mockResolvedValue([{ id: 'plan_uuid_123' }]);
                const where = vi.fn().mockReturnValue({ returning });
                return { where };
            });

            vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

            const result = await plansService.setDefaultPlan('plan_uuid_123');

            // update should have been called twice
            expect(db.update).toHaveBeenCalledTimes(2);
            // First set call: isDefault false
            expect(setMock).toHaveBeenNthCalledWith(1, { isDefault: false });
            // Result from second call (rows found)
            expect(result).toBe(true);
        });

        it('returns false when no plan matched on the second update', async () => {
            let callIndex = 0;
            const setMock = vi.fn().mockImplementation(() => {
                callIndex++;
                if (callIndex === 1) {
                    return Promise.resolve();
                }
                const returning = vi.fn().mockResolvedValue([]);
                const where = vi.fn().mockReturnValue({ returning });
                return { where };
            });
            vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

            const result = await plansService.setDefaultPlan('nonexistent');
            expect(result).toBe(false);
        });
    });
});

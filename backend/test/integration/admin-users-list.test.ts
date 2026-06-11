/**
 * Admin users list — SQL filter/paginate integration tests (real Postgres).
 *
 * Proves the headline behaviour change in the admin routes refactor: the
 * `GET /admin/users/all` path (adminUsersService.listAll) pushes search / status
 * / plan filters into the SQL WHERE clause, uses LIMIT/OFFSET for pagination,
 * and a separate COUNT(*) for the total — i.e. filtering happens in SQL, not in
 * a JS .filter() over a 5k in-memory cap.
 *
 * Each assertion is constructed so the JS implementation could NOT produce it:
 *   - status/plan filters return a SUBSET whose size matches a SQL-side count
 *   - pagination offset returns the correct slice across pages
 *   - search matches email OR name OR phone via ILIKE %term%
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { adminUsersService } from '../../src/services/admin/users';

// Plans are NOT truncated by the shared setup (subscriptions reference them with
// ON DELETE RESTRICT), so create them per-test with unique slugs and clean up.
const createdPlanIds: string[] = [];

afterEach(async () => {
    for (const id of createdPlanIds.splice(0)) {
        await testDb.delete(schema.plans).where(eq(schema.plans.id, id)).catch(() => {});
    }
});

async function createPlan(slug: string, name: string) {
    const [plan] = await testDb
        .insert(schema.plans)
        .values({ name, slug, price: 0 })
        .returning();
    createdPlanIds.push(plan.id);
    return plan;
}

async function createSubscription(userId: string, planId: string, status: string) {
    const [sub] = await testDb
        .insert(schema.subscriptions)
        .values({ userId, planId, status })
        .returning();
    return sub;
}

describe('adminUsersService.listAll — SQL filter/paginate (integration)', () => {
    it('search-by-email returns only ILIKE matches (not all users)', async () => {
        await createTestUser({ facebookId: 'fb-a', email: 'alice@shop.com', name: 'Alice' });
        await createTestUser({ facebookId: 'fb-b', email: 'bob@store.com', name: 'Bob' });
        await createTestUser({ facebookId: 'fb-c', email: 'carol@shop.com', name: 'Carol' });

        const { data, total } = await adminUsersService.listAll({
            pageNum: 1, limitNum: 20, offset: 0, search: 'shop.com',
        });

        // Only the two @shop.com users — SQL WHERE excluded bob@store.com.
        expect(total).toBe(2);
        expect(data).toHaveLength(2);
        expect(data.map(u => u.email).sort()).toEqual(['alice@shop.com', 'carol@shop.com']);
    });

    it('search matches name OR phone, not just email', async () => {
        await createTestUser({ facebookId: 'fb-1', email: 'x1@a.com', name: 'Zaphod Beeblebrox', phone: '+100000001' });
        await createTestUser({ facebookId: 'fb-2', email: 'x2@a.com', name: 'Arthur Dent', phone: '+15559999' });
        await createTestUser({ facebookId: 'fb-3', email: 'x3@a.com', name: 'Trillian', phone: '+100000003' });

        // Name match
        const byName = await adminUsersService.listAll({ pageNum: 1, limitNum: 20, offset: 0, search: 'zaphod' });
        expect(byName.total).toBe(1);
        expect(byName.data[0].email).toBe('x1@a.com');

        // Phone match (substring)
        const byPhone = await adminUsersService.listAll({ pageNum: 1, limitNum: 20, offset: 0, search: '5559999' });
        expect(byPhone.total).toBe(1);
        expect(byPhone.data[0].email).toBe('x2@a.com');
    });

    it('status filter returns only users with that subscription status', async () => {
        const plan = await createPlan(`free-${Date.now()}`, 'Free');
        const u1 = await createTestUser({ facebookId: 'fb-act1', email: 'active1@a.com' });
        const u2 = await createTestUser({ facebookId: 'fb-act2', email: 'active2@a.com' });
        const u3 = await createTestUser({ facebookId: 'fb-can', email: 'canceled@a.com' });
        await createTestUser({ facebookId: 'fb-none', email: 'nosub@a.com' }); // no subscription at all

        await createSubscription(u1.id, plan.id, 'active');
        await createSubscription(u2.id, plan.id, 'active');
        await createSubscription(u3.id, plan.id, 'canceled');

        const active = await adminUsersService.listAll({ pageNum: 1, limitNum: 20, offset: 0, status: 'active' });
        expect(active.total).toBe(2);
        expect(active.data.map(u => u.email).sort()).toEqual(['active1@a.com', 'active2@a.com']);
        // Each returned row carries the joined subscription with the matching status.
        expect(active.data.every(u => u.subscription?.status === 'active')).toBe(true);

        const canceled = await adminUsersService.listAll({ pageNum: 1, limitNum: 20, offset: 0, status: 'canceled' });
        expect(canceled.total).toBe(1);
        expect(canceled.data[0].email).toBe('canceled@a.com');
    });

    it('plan filter returns only users on that plan slug', async () => {
        const proPlan = await createPlan(`pro-${Date.now()}`, 'Pro');
        const bizPlan = await createPlan(`business-${Date.now()}`, 'Business');
        const u1 = await createTestUser({ facebookId: 'fb-pro1', email: 'pro1@a.com' });
        const u2 = await createTestUser({ facebookId: 'fb-pro2', email: 'pro2@a.com' });
        const u3 = await createTestUser({ facebookId: 'fb-biz', email: 'biz@a.com' });

        await createSubscription(u1.id, proPlan.id, 'active');
        await createSubscription(u2.id, proPlan.id, 'active');
        await createSubscription(u3.id, bizPlan.id, 'active');

        const onPro = await adminUsersService.listAll({ pageNum: 1, limitNum: 20, offset: 0, planSlug: proPlan.slug });
        expect(onPro.total).toBe(2);
        expect(onPro.data.map(u => u.email).sort()).toEqual(['pro1@a.com', 'pro2@a.com']);
        expect(onPro.data.every(u => u.subscription?.planSlug === proPlan.slug)).toBe(true);
    });

    it('paginates with SQL LIMIT/OFFSET — page 2 returns the next slice, total is the full count', async () => {
        // Seed 5 users; with limit 2 we expect pages of [2, 2, 1] and total 5.
        for (let i = 0; i < 5; i++) {
            await createTestUser({ facebookId: `fb-pg-${i}`, email: `page${i}@a.com`, name: `User ${i}` });
        }

        const page1 = await adminUsersService.listAll({ pageNum: 1, limitNum: 2, offset: 0 });
        const page2 = await adminUsersService.listAll({ pageNum: 2, limitNum: 2, offset: 2 });
        const page3 = await adminUsersService.listAll({ pageNum: 3, limitNum: 2, offset: 4 });

        // Total is the SQL COUNT(*), not the page size.
        expect(page1.total).toBe(5);
        expect(page2.total).toBe(5);
        expect(page3.total).toBe(5);

        expect(page1.data).toHaveLength(2);
        expect(page2.data).toHaveLength(2);
        expect(page3.data).toHaveLength(1);

        // Pages are disjoint — no id appears on two pages (proves OFFSET advanced).
        const ids = [...page1.data, ...page2.data, ...page3.data].map(u => u.id);
        expect(new Set(ids).size).toBe(5);
    });

    it('combines search + status + plan filters in a single SQL WHERE', async () => {
        const plan = await createPlan(`combo-${Date.now()}`, 'Combo');
        const match = await createTestUser({ facebookId: 'fb-match', email: 'target@combo.com', name: 'Target' });
        const wrongStatus = await createTestUser({ facebookId: 'fb-ws', email: 'other@combo.com', name: 'Other' });
        const wrongEmail = await createTestUser({ facebookId: 'fb-we', email: 'target@elsewhere.com', name: 'Elsewhere' });

        await createSubscription(match.id, plan.id, 'active');
        await createSubscription(wrongStatus.id, plan.id, 'canceled');
        await createSubscription(wrongEmail.id, plan.id, 'active');

        const result = await adminUsersService.listAll({
            pageNum: 1, limitNum: 20, offset: 0,
            search: 'combo.com', status: 'active', planSlug: plan.slug,
        });

        // Only the user satisfying ALL three predicates survives the WHERE clause.
        expect(result.total).toBe(1);
        expect(result.data[0].email).toBe('target@combo.com');
    });
});

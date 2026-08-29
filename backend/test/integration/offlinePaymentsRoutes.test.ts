/**
 * The Sham Cash endpoints THROUGH Fastify, against a real database: route
 * schemas, the error contract, the receipt pipeline, the reviewer e-mail's
 * escaping, and the admin decision — none of which the service suite can see.
 *
 * Auth is replaced by a header-driven stand-in (both merchant and admin
 * routes); `adminAlerts` is captured so the e-mail HTML can be asserted; the
 * rail switch is a mutable config block.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import './setup';
import { testDb, createTestUser } from './setup';
import { offlinePayments, plans, subscriptions } from '../../src/db/schema';
import { OFFLINE_PAYMENT_RECEIPT_BASE64_MAX } from '@jawab24/shared';

const shamCash = vi.hoisted(() => ({ walletNumber: '0912345678', walletName: 'Jawab24', qrImageUrl: '' }));
const alerts = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, reject: false }));

vi.mock('../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config')>();
    return { ...actual, config: { ...actual.config, shamCash } };
});
vi.mock('../../src/services/adminAlerts', () => ({
    sendThrottledAdminAlert: vi.fn(async (opts: Record<string, unknown>) => {
        alerts.calls.push(opts);
        if (alerts.reject) throw new Error('mail down');
    }),
}));
// Header-driven auth: `x-test-user` names the caller; admin routes trust it too.
vi.mock('../../src/middleware/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/middleware/auth')>();
    return {
        ...actual,
        authenticate: async (req: { headers: Record<string, string | undefined>; user?: unknown }) => {
            const userId = req.headers['x-test-user'];
            if (!userId) { const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 }); throw err; }
            req.user = { userId, facebookId: 'fb_test' };
        },
        requireAdmin: async () => { /* trusted in this suite */ },
    };
});

// A valid 1×1 PNG.
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let app: FastifyInstance;
let planId: string;
const PLAN_SLUG = 'offline-routes-plan';

beforeAll(async () => {
    await testDb.insert(plans).values({ name: 'Routes Plan', slug: PLAN_SLUG, price: 3900, yearlyPrice: 39000, isActive: true })
        .onConflictDoNothing({ target: plans.slug });
    const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, PLAN_SLUG)).limit(1);
    planId = row.id;

    // Production's bodyLimit (index.ts): the receipt maxLength case must reach the
    // schema, not Fastify's default 1 MB body cap.
    app = fastify({ logger: false, bodyLimit: 10485760 });
    // The production error handler, so schema rejections carry the contract the
    // client discriminates on (`code: 'VALIDATION_ERROR'`), not Fastify's raw shape.
    app.setErrorHandler((await import('../../src/middleware/errorHandler')).errorHandler);
    const paymentRoutes = (await import('../../src/routes/payment')).default;
    const adminRoutes = (await import('../../src/routes/admin')).default;
    app.register(paymentRoutes, { prefix: '/payment' });
    app.register(adminRoutes, { prefix: '/admin' });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    const [row] = await testDb.select({ id: plans.id }).from(plans).where(eq(plans.slug, PLAN_SLUG)).limit(1);
    if (row) {
        await testDb.delete(offlinePayments).where(eq(offlinePayments.planId, row.id));
        await testDb.delete(plans).where(eq(plans.id, row.id));
    }
});

beforeEach(() => {
    shamCash.walletNumber = '0912345678';
    alerts.calls = [];
    alerts.reject = false;
});

function submit(userId: string | undefined, payload: Record<string, unknown>) {
    return app.inject({
        method: 'POST',
        url: '/payment/offline/claims',
        headers: { 'content-type': 'application/json', ...(userId ? { 'x-test-user': userId } : {}) },
        payload,
    });
}
const claimBody = (ref: string, extra: Record<string, unknown> = {}) => ({ planId, billingInterval: 'month', transferReference: ref, ...extra });

describe('GET /payment/offline/config', () => {
    it('is 200 { enabled: false } when the rail is off, and the wallet block when on', async () => {
        const user = await createTestUser();
        shamCash.walletNumber = '';
        const off = await app.inject({ method: 'GET', url: '/payment/offline/config', headers: { 'x-test-user': user.id } });
        expect(off.statusCode).toBe(200);
        expect(off.json()).toEqual({ enabled: false });
        shamCash.walletNumber = '0912345678';
        const on = await app.inject({ method: 'GET', url: '/payment/offline/config', headers: { 'x-test-user': user.id } });
        expect(on.json()).toMatchObject({ enabled: true, rail: 'sham_cash', walletNumber: '0912345678' });
    });
});

describe('POST /payment/offline/claims', () => {
    it('201 on a new claim, 200 with the SAME claim on a resend, and the reviewer is mailed once', async () => {
        const user = await createTestUser();
        const ref = `R-${Date.now()}-A`;
        const first = await submit(user.id, claimBody(ref));
        expect(first.statusCode).toBe(201);
        const again = await submit(user.id, claimBody(ref));
        expect(again.statusCode).toBe(200);
        expect(again.json().claim.id).toBe(first.json().claim.id);
        expect(alerts.calls).toHaveLength(1);
        expect(alerts.calls[0]).toMatchObject({ level: 'info', extra: { claimId: first.json().claim.id, userId: user.id } });
    });

    it('401 without a user', async () => {
        expect((await submit(undefined, claimBody('R-anon'))).statusCode).toBe(401);
    });

    it('403 offline_payments_unavailable when the rail is off', async () => {
        const user = await createTestUser();
        shamCash.walletNumber = '';
        const res = await submit(user.id, claimBody('R-off'));
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ code: 'offline_payments_unavailable' });
    });

    it('lets the SCHEMA refuse shape/bounds — one owner per rule', async () => {
        const user = await createTestUser();
        const tooLong = await submit(user.id, claimBody('x'.repeat(65)));
        expect(tooLong.statusCode).toBe(400);
        expect(tooLong.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
        const noInterval = await submit(user.id, { planId, transferReference: 'R-1' });
        expect(noInterval.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
        const hugeReceipt = await submit(user.id, claimBody('R-2', { receipt: { base64: 'A'.repeat(OFFLINE_PAYMENT_RECEIPT_BASE64_MAX + 4), mimeType: 'image/png' } }));
        expect(hugeReceipt.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('refuses a reference that normalizes to nothing, or to more than the cap', async () => {
        const user = await createTestUser();
        const empty = await submit(user.id, claimBody('- - -'));
        expect(empty.json()).toMatchObject({ code: 'reference_required' });
        const lengthens = await submit(user.id, claimBody('ß'.repeat(40)));
        expect(lengthens.json()).toMatchObject({ code: 'reference_too_long' });
    });

    it('runs the receipt through the shared upload pipeline — declared type must match the bytes', async () => {
        const user = await createTestUser();
        const mismatch = await submit(user.id, claimBody('R-png-as-jpeg', { receipt: { base64: PNG_1x1.toString('base64'), mimeType: 'image/jpeg' } }));
        expect(mismatch.statusCode).toBe(400);
        expect(mismatch.json()).toMatchObject({ code: 'file_content_mismatch' });
        const ok = await submit(user.id, claimBody('R-png-ok', { receipt: { base64: PNG_1x1.toString('base64'), mimeType: 'image/png' } }));
        expect(ok.statusCode).toBe(201);
        expect(ok.json().claim.hasReceipt).toBe(true);
    });

    it('ESCAPES the merchant-typed reference in the reviewer e-mail', async () => {
        const user = await createTestUser();
        const res = await submit(user.id, claimBody('<b>x</b><a href=//evil.tld>y</a>'));
        expect(res.statusCode).toBe(201);
        const html = String(alerts.calls[0]?.html ?? '');
        expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
        expect(html).not.toContain('<a href=//evil.tld>');
    });

    it('still records the claim when the reviewer mail fails', async () => {
        const user = await createTestUser();
        alerts.reject = true;
        const res = await submit(user.id, claimBody(`R-${Date.now()}-mailfail`));
        expect(res.statusCode).toBe(201);
    });

    it('409 duplicate_reference for a DIFFERENT account', async () => {
        const owner = await createTestUser();
        const thief = await createTestUser();
        const ref = `R-${Date.now()}-dup`;
        await submit(owner.id, claimBody(ref));
        const res = await submit(thief.id, claimBody(ref));
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ code: 'duplicate_reference' });
    });
});

describe('GET /payment/offline/claims', () => {
    it('serialises the MERCHANT shape only — no reviewNote, no userId', async () => {
        const user = await createTestUser();
        await submit(user.id, claimBody(`R-${Date.now()}-mine`));
        const res = await app.inject({ method: 'GET', url: '/payment/offline/claims', headers: { 'x-test-user': user.id } });
        expect(res.statusCode).toBe(200);
        const [claim] = res.json().claims;
        expect(claim).toMatchObject({ status: 'pending_review', hasReceipt: false });
        expect(claim).not.toHaveProperty('reviewNote');
        expect(claim).not.toHaveProperty('userId');
    });
});

describe('admin routes', () => {
    it('lists pending oldest-first with total and cursor; serves the receipt with no-store; approve activates; second decision is 409 with the row', async () => {
        const merchant = await createTestUser();
        const admin = await createTestUser({ isAdmin: true });
        const a = (await submit(merchant.id, claimBody(`R-${Date.now()}-q1`, { receipt: { base64: PNG_1x1.toString('base64'), mimeType: 'image/png' } }))).json().claim;
        const b = (await submit(merchant.id, claimBody(`R-${Date.now()}-q2`))).json().claim;

        const list = await app.inject({ method: 'GET', url: '/admin/offline-payments?status=pending_review&limit=1', headers: { 'x-test-user': admin.id } });
        expect(list.statusCode).toBe(200);
        expect(list.json()).toMatchObject({ total: 2, nextCursor: expect.any(String) });
        expect(list.json().claims[0].id).toBe(a.id);
        const next = await app.inject({ method: 'GET', url: `/admin/offline-payments?status=pending_review&limit=1&cursor=${encodeURIComponent(list.json().nextCursor)}`, headers: { 'x-test-user': admin.id } });
        expect(next.json().claims[0].id).toBe(b.id);

        const receipt = await app.inject({ method: 'GET', url: `/admin/offline-payments/${a.id}/receipt`, headers: { 'x-test-user': admin.id } });
        expect(receipt.statusCode).toBe(200);
        expect(receipt.headers['content-type']).toBe('image/png');
        expect(receipt.headers['cache-control']).toBe('no-store');
        expect((await app.inject({ method: 'GET', url: `/admin/offline-payments/${b.id}/receipt`, headers: { 'x-test-user': admin.id } })).statusCode).toBe(404);

        const approve = await app.inject({ method: 'POST', url: `/admin/offline-payments/${a.id}/review`, headers: { 'x-test-user': admin.id, 'content-type': 'application/json' }, payload: { decision: 'approved' } });
        expect(approve.statusCode).toBe(200);
        expect(approve.json().data).toMatchObject({ status: 'approved', grantedSubscriptionId: expect.any(String) });
        const [sub] = await testDb.select().from(subscriptions).where(eq(subscriptions.userId, merchant.id));
        expect(sub).toMatchObject({ status: 'active', paymentMethod: 'sham_cash', planId });

        const twice = await app.inject({ method: 'POST', url: `/admin/offline-payments/${a.id}/review`, headers: { 'x-test-user': admin.id, 'content-type': 'application/json' }, payload: { decision: 'rejected' } });
        expect(twice.statusCode).toBe(409);
        expect(twice.json()).toMatchObject({ code: 'already_reviewed', data: { id: a.id, status: 'approved' } });

        const missing = await app.inject({ method: 'POST', url: '/admin/offline-payments/00000000-0000-4000-8000-000000000000/review', headers: { 'x-test-user': admin.id, 'content-type': 'application/json' }, payload: { decision: 'approved' } });
        expect(missing.statusCode).toBe(404);
    });

    it('the upgrade route refuses a payment method that is not in the offline list', async () => {
        const merchant = await createTestUser();
        const admin = await createTestUser({ isAdmin: true });
        const res = await app.inject({ method: 'POST', url: `/admin/users/${merchant.id}/upgrade`, headers: { 'x-test-user': admin.id, 'content-type': 'application/json' }, payload: { planId, periodMonths: 1, paymentMethod: 'shamcash' } });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

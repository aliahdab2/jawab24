import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';

// Bypass real auth/workspace middleware — user + workspace are injected by a
// preHandler hook. The DB, the controller, the schema and the JSONB round trip
// are all REAL, which is the point: the defect this file pins lives in the
// interaction between a stored row and a full-replace patch, and a unit test on
// the schema alone cannot see it (it has no "what is already stored").
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async () => {}),
    requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn(async () => {}),
    requireRole: vi.fn(() => async () => {}),
}));

/**
 * A phone slot holding an instruction sentence, verbatim from production
 * (page `c75b6f33`, editor-confirmed). ZERO digits, so `isUsablePhoneEntry`
 * correctly refuses it — it is not a phone number by any reading.
 *
 * ⚠️ How a row like this gets stored in the first place is the whole reason this
 * test exists: NOT through the endpoint under test. `buildBusinessProfile`
 * validates Facebook-synced profiles with the BASE schema by design (a machine
 * producer must not be judged by a rule written for merchant typing), and the KB
 * fact extractor does the same. So the supply is continuous and the merchant
 * rule cannot assume the stored value ever passed it.
 */
const STORED_PROSE = 'اعطيهم ارقام الصالات فقط';
const REAL_NUMBER = '0993301022';

async function buildApp(userId: string, workspaceId: string): Promise<FastifyInstance> {
    const app = fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
        request.user = { userId, facebookId: 'fb_test' };
        request.workspaceId = workspaceId;
        request.role = 'admin';
    });
    const pagesRoutes = (await import('../../src/routes/pages')).default;
    app.register(pagesRoutes, { prefix: '/' });
    await app.ready();
    return app;
}

async function storedProfile(pageId: string): Promise<{ merchant?: { phones?: unknown; address?: string } }> {
    const [row] = await testDb.select({ bp: schema.pages.businessProfile })
        .from(schema.pages).where(eq(schema.pages.id, pageId));
    const raw = row.bp as unknown;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};
}

describe('PUT /pages/:id — a bad STORED phone entry must not lock the merchant out', () => {
    let app: FastifyInstance;
    let userId: string;
    let workspaceId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        workspaceId = (await createTestWorkspace(user.id)).id;
    });
    afterEach(async () => { await app?.close(); });

    /** A page carrying the bad row plus a real number, as production does. */
    async function seedPage() {
        return createTestPage(userId, {
            name: 'MES',
            workspaceId,
            businessProfile: {
                merchant: { phones: [STORED_PROSE, REAL_NUMBER] },
                merchantProvenance: { phones: { source: 'editor', confirmedAt: '2026-08-10T10:58:00.000Z' } },
            } as never,
        });
    }

    it('saves an unrelated field (address) while the bad row is echoed back untouched', async () => {
        // THE REGRESSION. The editor sends a full-replace patch, so saving the
        // address re-sends the phones exactly as stored. Before grandfathering
        // this returned 400 with a generic error, and it did so for EVERY field
        // on the page — hours, website, email — forever, on data the merchant
        // never typed.
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'PUT',
            url: `/pages/${page.id}`,
            payload: {
                businessProfile: {
                    address: 'دمشق، أبو رمانة',
                    phones: [STORED_PROSE, REAL_NUMBER],
                },
            },
        });

        expect(res.statusCode).toBe(200);
        const after = await storedProfile(page.id);
        expect(after.merchant?.address).toBe('دمشق، أبو رمانة');
        // The grandfathered row is preserved, not silently dropped: dropping a
        // merchant's stored value without being asked is its own defect.
        expect(after.merchant?.phones).toEqual([STORED_PROSE, REAL_NUMBER]);
    });

    it('lets the merchant DELETE the bad row', async () => {
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'PUT',
            url: `/pages/${page.id}`,
            payload: { businessProfile: { phones: [REAL_NUMBER] } },
        });

        expect(res.statusCode).toBe(200);
        expect((await storedProfile(page.id)).merchant?.phones).toEqual([REAL_NUMBER]);
    });

    it('STILL rejects the same text when it is newly typed, naming the row', async () => {
        // Grandfathering must not become a blanket amnesty: a page with nothing
        // stored gets the strict rule, so the guard still does its job.
        const page = await createTestPage(userId, { name: 'Fresh', workspaceId });
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'PUT',
            url: `/pages/${page.id}`,
            payload: { businessProfile: { phones: [REAL_NUMBER, STORED_PROSE] } },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { errors?: { field: string; message: string }[] };
        // The failing ROW is identified, so the client can mark it instead of
        // showing a generic "save failed" the merchant cannot act on.
        expect(body.errors?.some((e) => e.field.includes('phones') && e.field.includes('1'))).toBe(true);
    });

    it('does not let a bad entry in on a DIFFERENT page that happens to store it', async () => {
        // Grandfathering is scoped to THE page being edited. Page A storing the
        // prose must not make it acceptable on page B.
        await seedPage();
        const pageB = await createTestPage(userId, { name: 'Other', workspaceId });
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'PUT',
            url: `/pages/${pageB.id}`,
            payload: { businessProfile: { phones: [STORED_PROSE] } },
        });

        expect(res.statusCode).toBe(400);
    });
});

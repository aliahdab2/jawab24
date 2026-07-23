import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';

// Bypass real auth/workspace middleware — the user + workspace are injected by a
// preHandler hook in buildApp(). DB stays 100% real.
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async () => {}),
    requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn(async () => {}),
    requireRole: vi.fn(() => async () => {}),
}));

/**
 * A realistic small-merchant Business Info: a wall of free text where prices
 * live inside prose — exactly the shape Phase C cleans up after the products
 * move to the catalog. Two price lines (2, 3) are catalog items; the delivery
 * line, the address line, and the prose mention are NOT.
 */
const MERCHANT_KB = [
    '🏍️ دراجتي لقطع الموتوسيكل — أفضل الأسعار بدمشق',   // 0
    'منتجاتنا:',                                          // 1
    '- زيت موتول الأصلي ٢٢ ألف ليرة',                     // 2  ← catalog item
    '- حامل جوال مغناطيسي ٣٥ ألف',                        // 3  ← catalog item
    'التوصيل داخل دمشق ١٠ آلاف، وخارجها حسب المنطقة',      // 4  ← delivery fact (keep)
    'زيت موتول متوفر دائماً بكل الأنواع',                  // 5  ← prose, no distinct price (keep)
    'العنوان: دمشق، شارع الثورة',                          // 6  ← address (keep)
].join('\n');

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

async function kbOf(pageId: string): Promise<string> {
    const [row] = await testDb.select({ kb: schema.pages.knowledgeBase })
        .from(schema.pages).where(eq(schema.pages.id, pageId));
    return row.kb ?? '';
}

describe('POST /pages/:id/kb/cleanup — HTTP integration (real merchant KB)', () => {
    let app: FastifyInstance;
    let userId: string;
    let workspaceId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        workspaceId = (await createTestWorkspace(user.id)).id;
    });
    afterEach(async () => { await app?.close(); });

    async function seedPage() {
        return createTestPage(userId, {
            name: 'Moto', workspaceId, knowledgeBase: MERCHANT_KB, kbVersion: 1, kbActiveVersion: 1,
        });
    }

    it('removes exactly the merchant-confirmed lines and reports the count', async () => {
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'POST',
            url: `/pages/${page.id}/kb/cleanup`,
            payload: { lines: ['- زيت موتول الأصلي ٢٢ ألف ليرة', '- حامل جوال مغناطيسي ٣٥ ألف'] },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().cleanup).toEqual({ removed: 2 });

        const kb = await kbOf(page.id);
        expect(kb).not.toContain('حامل جوال مغناطيسي ٣٥');
        expect(kb).not.toContain('زيت موتول الأصلي ٢٢');
        // Non-product facts SURVIVE.
        expect(kb).toContain('التوصيل داخل دمشق');
        expect(kb).toContain('العنوان: دمشق، شارع الثورة');
        expect(kb).toContain('زيت موتول متوفر دائماً'); // prose mention kept
    });

    it('a cleanup NEVER touches the customer-question backlog', async () => {
        const page = await seedPage();
        await testDb.insert(schema.kbGaps).values({
            pageId: page.id, queryText: 'بتشحنوا لحلب؟', queryNormalized: 'بتشحنوا لحلب؟',
            detectedIntent: 'delivery', occurrenceCount: 3, resolved: false,
        });
        app = await buildApp(userId, workspaceId);

        await app.inject({
            method: 'POST', url: `/pages/${page.id}/kb/cleanup`,
            payload: { lines: ['- زيت موتول الأصلي ٢٢ ألف ليرة'] },
        });

        const [gap] = await testDb.select().from(schema.kbGaps).where(eq(schema.kbGaps.pageId, page.id));
        expect(gap.resolved).toBe(false);
        expect(gap.occurrenceCount).toBe(3);
    });

    it('is a safe no-op when a confirmed line no longer exists (concurrent edit)', async () => {
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'POST', url: `/pages/${page.id}/kb/cleanup`,
            payload: { lines: ['- منتج لم يعد موجوداً ٩٩ ألف'] },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().cleanup).toEqual({ removed: 0 });
        expect(await kbOf(page.id)).toBe(MERCHANT_KB); // untouched
    });

    it('refuses to empty the whole KB (would strand stale RAG chunks)', async () => {
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'POST', url: `/pages/${page.id}/kb/cleanup`,
            payload: { lines: MERCHANT_KB.split('\n') },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('CLEANUP_EMPTIES_KB');
        expect(await kbOf(page.id)).toBe(MERCHANT_KB); // untouched
    });

    it('rejects a malformed body', async () => {
        const page = await seedPage();
        app = await buildApp(userId, workspaceId);

        const res = await app.inject({
            method: 'POST', url: `/pages/${page.id}/kb/cleanup`,
            payload: { lines: 'not-an-array' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('404s for a page outside the caller workspace (ownership guard)', async () => {
        const otherUser = await createTestUser();
        const otherWs = (await createTestWorkspace(otherUser.id)).id;
        const foreignPage = await createTestPage(otherUser.id, {
            name: 'Foreign', workspaceId: otherWs, knowledgeBase: MERCHANT_KB,
        });
        app = await buildApp(userId, workspaceId); // caller is in a DIFFERENT workspace

        const res = await app.inject({
            method: 'POST', url: `/pages/${foreignPage.id}/kb/cleanup`,
            payload: { lines: ['- زيت موتول الأصلي ٢٢ ألف ليرة'] },
        });
        expect(res.statusCode).toBe(404);
        expect(await kbOf(foreignPage.id)).toBe(MERCHANT_KB); // untouched
    });
});

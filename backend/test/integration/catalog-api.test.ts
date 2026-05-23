import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';

import './setup';

// Bypass JWT auth — buildApp hook injects user/workspace context directly.
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn().mockImplementation(async () => { /* no-op */ }),
    requireAdmin: vi.fn().mockImplementation(async () => {}),
}));

// Bypass resolveWorkspace + requireRole — workspace is injected in the hook.
vi.mock('../../src/middleware/workspace', async () => {
    const actual = await vi.importActual<typeof import('../../src/middleware/workspace')>(
        '../../src/middleware/workspace',
    );
    return {
        ...actual,
        resolveWorkspace: vi.fn().mockImplementation(async () => { /* no-op */ }),
        requireRole: vi.fn().mockImplementation(() => async () => { /* no-op */ }),
    };
});

async function buildApp(userId: string, workspaceId: string, role: 'owner' | 'admin' | 'member' = 'admin') {
    const app = fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
        request.user = { userId, facebookId: 'fb_test' };
        request.workspaceId = workspaceId;
        request.workspaceOwnerId = userId;
        request.workspaceRole = role;
    });
    const catalogRoutes = (await import('../../src/routes/catalog')).default;
    app.register(catalogRoutes);
    await app.ready();
    return app;
}

describe('Catalog API — Stage 2.2', () => {
    let app: FastifyInstance;
    let userId: string;
    let workspaceId: string;
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const ws = await createTestWorkspace(userId);
        workspaceId = ws.id;
        const page = await createTestPage(userId, { workspaceId, kbActiveVersion: 1, kbVersion: 1 });
        pageId = page.id;
        app = await buildApp(userId, workspaceId);
    });

    afterEach(async () => { await app.close(); });

    describe('POST /catalog-items', () => {
        it('creates a course with all fields', async () => {
            const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const endsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: {
                    pageId,
                    type: 'course',
                    name: 'IELTS Prep',
                    description: 'Intensive 12-week course',
                    priceMinor: 250000,
                    currency: 'SAR',
                    startsAt,
                    endsAt,
                    metadata: { level: 'advanced' },
                },
            });
            expect(res.statusCode).toBe(201);
            const { data } = res.json();
            expect(data.name).toBe('IELTS Prep');
            expect(data.priceMinor).toBe(250000);
            expect(data.sourceTier).toBe(2);
            expect(data.archivedAt).toBeNull();
        });

        it('rejects unknown type', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: { pageId, type: 'widget', name: 'X' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('rejects endsAt before startsAt', async () => {
            const startsAt = new Date('2026-06-01').toISOString();
            const endsAt = new Date('2026-05-01').toISOString();
            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: { pageId, type: 'course', name: 'X', startsAt, endsAt },
            });
            expect(res.statusCode).toBe(400);
        });

        it('rejects priceMinor without currency', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: { pageId, type: 'product', name: 'X', priceMinor: 1000 },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 when page belongs to a different workspace', async () => {
            const otherUser = await createTestUser({ facebookId: `o-${Date.now()}` });
            const otherWs = await createTestWorkspace(otherUser.id);
            const otherPage = await createTestPage(otherUser.id, { workspaceId: otherWs.id });

            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: { pageId: otherPage.id, type: 'service', name: 'X' },
            });
            expect(res.statusCode).toBe(404);
        });

        it('bumps the page kbVersion on create', async () => {
            const before = await testDb.select({ v: schema.pages.kbVersion })
                .from(schema.pages).where(eq(schema.pages.id, pageId));
            const beforeV = before[0].v ?? 0;

            const res = await app.inject({
                method: 'POST',
                url: '/catalog-items',
                payload: { pageId, type: 'service', name: 'Haircut' },
            });
            expect(res.statusCode).toBe(201);

            const after = await testDb.select({ v: schema.pages.kbVersion })
                .from(schema.pages).where(eq(schema.pages.id, pageId));
            expect((after[0].v ?? 0)).toBeGreaterThan(beforeV);
        });
    });

    describe('GET /catalog-items', () => {
        beforeEach(async () => {
            const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await testDb.insert(schema.catalogItems).values([
                { pageId, type: 'course', name: 'Active', endsAt: future },
                { pageId, type: 'course', name: 'Expired', endsAt: past },
                { pageId, type: 'service', name: 'Evergreen' },
                { pageId, type: 'course', name: 'Archived', endsAt: future, archivedAt: new Date() },
            ]);
        });

        it('defaults to active+evergreen', async () => {
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}` });
            expect(res.statusCode).toBe(200);
            const names = res.json().data.map((r: any) => r.name).sort();
            expect(names).toEqual(['Active', 'Evergreen']);
        });

        it('filters by type=course active', async () => {
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&type=course` });
            const names = res.json().data.map((r: any) => r.name);
            expect(names).toEqual(['Active']);
        });

        it('status=expired returns only expired', async () => {
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&status=expired` });
            const names = res.json().data.map((r: any) => r.name);
            expect(names).toEqual(['Expired']);
        });

        it('status=archived returns only archived', async () => {
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&status=archived` });
            const names = res.json().data.map((r: any) => r.name);
            expect(names).toEqual(['Archived']);
        });

        it('status=all returns everything', async () => {
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&status=all` });
            expect(res.json().data).toHaveLength(4);
        });

        it('returns 400 without pageId', async () => {
            const res = await app.inject({ method: 'GET', url: '/catalog-items' });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 for foreign-workspace page', async () => {
            const otherUser = await createTestUser({ facebookId: `o2-${Date.now()}` });
            const otherWs = await createTestWorkspace(otherUser.id);
            const otherPage = await createTestPage(otherUser.id, { workspaceId: otherWs.id });
            const res = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${otherPage.id}` });
            expect(res.statusCode).toBe(404);
        });
    });

    describe('PATCH /catalog-items/:id', () => {
        it('updates name and price', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'service', name: 'Old' })
                .returning();
            const res = await app.inject({
                method: 'PATCH',
                url: `/catalog-items/${row.id}`,
                payload: { name: 'New', priceMinor: 5000, currency: 'USD' },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.name).toBe('New');
            expect(res.json().data.priceMinor).toBe(5000);
        });

        it('returns 404 for foreign workspace item', async () => {
            const otherUser = await createTestUser({ facebookId: `o3-${Date.now()}` });
            const otherWs = await createTestWorkspace(otherUser.id);
            const otherPage = await createTestPage(otherUser.id, { workspaceId: otherWs.id });
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId: otherPage.id, type: 'service', name: 'Foreign' })
                .returning();
            const res = await app.inject({
                method: 'PATCH', url: `/catalog-items/${row.id}`, payload: { name: 'Hack' },
            });
            expect(res.statusCode).toBe(404);
        });
    });

    describe('DELETE /catalog-items/:id', () => {
        it('soft-archives by setting archivedAt', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'service', name: 'Temp' })
                .returning();
            const res = await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}` });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.archivedAt).not.toBeNull();

            // Row still exists in DB
            const [stillThere] = await testDb.select().from(schema.catalogItems)
                .where(eq(schema.catalogItems.id, row.id));
            expect(stillThere).toBeDefined();
            expect(stillThere.archivedAt).not.toBeNull();
        });

        it('is idempotent on already-archived items', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'service', name: 'Already', archivedAt: new Date() })
                .returning();
            const res = await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}` });
            expect(res.statusCode).toBe(200);
        });
    });

    // ---------------------------------------------------------------------------
    // Stage 2.5 additions: restore via PATCH archivedAt:null + hard-delete gate.
    // ---------------------------------------------------------------------------
    describe('PATCH /catalog-items/:id — restore (Stage 2.5)', () => {
        it('restores an archived item by setting archivedAt to null', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'course', name: 'Restoreable', archivedAt: new Date() })
                .returning();

            const res = await app.inject({
                method: 'PATCH',
                url: `/catalog-items/${row.id}`,
                payload: { archivedAt: null },
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.archivedAt).toBeNull();

            const [refetched] = await testDb.select().from(schema.catalogItems)
                .where(eq(schema.catalogItems.id, row.id));
            expect(refetched.archivedAt).toBeNull();
        });

        it('restored item reappears in active list', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'course', name: 'BackToActive', archivedAt: new Date() })
                .returning();

            // Before restore: not in active list
            const listBefore = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&status=active` });
            expect(listBefore.json().data.find((r: { id: string }) => r.id === row.id)).toBeUndefined();

            await app.inject({
                method: 'PATCH',
                url: `/catalog-items/${row.id}`,
                payload: { archivedAt: null },
            });

            // After restore: in active list
            const listAfter = await app.inject({ method: 'GET', url: `/catalog-items?pageId=${pageId}&status=active` });
            expect(listAfter.json().data.find((r: { id: string }) => r.id === row.id)).toBeDefined();
        });
    });

    describe('DELETE /catalog-items/:id/permanent — hard-delete (Stage 2.5)', () => {
        it('hard-deletes an archived item', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'service', name: 'GoForever', archivedAt: new Date() })
                .returning();

            const res = await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}/permanent` });
            expect(res.statusCode).toBe(200);

            // Row truly gone — no soft trace.
            const after = await testDb.select().from(schema.catalogItems)
                .where(eq(schema.catalogItems.id, row.id));
            expect(after).toHaveLength(0);
        });

        it('returns 409 when item is not archived (gate enforces archive-first)', async () => {
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'product', name: 'StillActive' })
                .returning();

            const res = await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}/permanent` });
            expect(res.statusCode).toBe(409);
            expect(res.json().code).toBe('not_archived');

            // Row must still exist — gate prevented destruction.
            const after = await testDb.select().from(schema.catalogItems)
                .where(eq(schema.catalogItems.id, row.id));
            expect(after).toHaveLength(1);
            expect(after[0].archivedAt).toBeNull();
        });

        it('returns 404 for a non-existent id', async () => {
            const res = await app.inject({
                method: 'DELETE',
                url: '/catalog-items/00000000-0000-0000-0000-000000000000/permanent',
            });
            expect(res.statusCode).toBe(404);
        });

        it('returns 404 for an item in a different workspace', async () => {
            const otherUser = await createTestUser();
            const otherWs = await createTestWorkspace(otherUser.id);
            const otherPage = await createTestPage(otherUser.id, { workspaceId: otherWs.id });
            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId: otherPage.id, type: 'service', name: 'Other workspace', archivedAt: new Date() })
                .returning();

            // Our test app is scoped to `workspaceId`, not the foreign one.
            const res = await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}/permanent` });
            expect(res.statusCode).toBe(404);

            // Item must still exist — workspace isolation prevented destruction.
            const after = await testDb.select().from(schema.catalogItems)
                .where(eq(schema.catalogItems.id, row.id));
            expect(after).toHaveLength(1);
        });

        it('bumps the page kbVersion on hard-delete (cache invalidation)', async () => {
            const before = await testDb.select({ kbVersion: schema.pages.kbVersion })
                .from(schema.pages).where(eq(schema.pages.id, pageId));
            const beforeVer = before[0].kbVersion ?? 0;

            const [row] = await testDb.insert(schema.catalogItems)
                .values({ pageId, type: 'service', name: 'BumpCheck', archivedAt: new Date() })
                .returning();

            await app.inject({ method: 'DELETE', url: `/catalog-items/${row.id}/permanent` });

            const after = await testDb.select({ kbVersion: schema.pages.kbVersion })
                .from(schema.pages).where(eq(schema.pages.id, pageId));
            expect(after[0].kbVersion ?? 0).toBeGreaterThan(beforeVer);
        });
    });
});

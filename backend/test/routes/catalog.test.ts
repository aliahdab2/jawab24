/**
 * Route-level security wiring for /pages/:pageId/catalog (H2, PR #407 review).
 *
 * Unlike most route suites, the middleware mocks here ENFORCE semantics:
 * `authenticate` 401s when the test flips `authed` off, and `requireRole`
 * actually compares the workspace role against the hierarchy. That makes this
 * suite fail if a refactor drops `requireRole('admin')` from the write subtree
 * or accidentally gates the read — the exact regressions service-level tests
 * can't see.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import catalogRoutes from '../../src/routes/catalog';
import { catalogService, CatalogLimitError, CatalogStoreConflictError } from '../../src/services/catalog';

vi.mock('../../src/services/catalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/catalog')>();
    return {
        CatalogLimitError: actual.CatalogLimitError,
        CatalogStoreConflictError: actual.CatalogStoreConflictError,
        catalogService: {
            listCatalogItems: vi.fn(),
            createCatalogItem: vi.fn(),
            updateCatalogItem: vi.fn(),
            deleteCatalogItem: vi.fn(),
        },
    };
});
vi.mock('../../src/services/activation', () => ({
    recordActivationEvent: vi.fn().mockResolvedValue(undefined),
}));

const state = { authed: true, role: 'admin' as string };

vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any, reply: any) => {
        if (!state.authed) return reply.status(401).send({ error: 'Unauthorized' });
        req.user = { userId: 'user-1' };
    },
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'ws-1';
        req.workspaceRole = state.role;
    },
    // Real hierarchy semantics — member < admin < owner.
    requireRole: (minRole: string) => async (req: any, reply: any) => {
        const order = ['member', 'admin', 'owner'];
        if (order.indexOf(req.workspaceRole) < order.indexOf(minRole)) {
            return reply.status(403).send({ error: 'Forbidden' });
        }
    },
}));

const PAGE = '11111111-1111-1111-1111-111111111111';
const ITEM = '22222222-2222-2222-2222-222222222222';

describe('Catalog routes — security wiring', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        state.authed = true;
        state.role = 'admin';
        app = fastify();
        app.register(catalogRoutes);
        await app.ready();
    });

    it('401s every verb when unauthenticated', async () => {
        state.authed = false;
        for (const [method, url] of [
            ['GET', `/pages/${PAGE}/catalog`],
            ['POST', `/pages/${PAGE}/catalog`],
            ['PATCH', `/pages/${PAGE}/catalog/${ITEM}`],
            ['DELETE', `/pages/${PAGE}/catalog/${ITEM}`],
        ] as const) {
            const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(401);
        }
    });

    it('lets a plain member READ but not write (403 on POST/PATCH/DELETE)', async () => {
        state.role = 'member';
        vi.mocked(catalogService.listCatalogItems).mockResolvedValue([]);

        const read = await app.inject({ method: 'GET', url: `/pages/${PAGE}/catalog` });
        expect(read.statusCode).toBe(200);
        expect(JSON.parse(read.payload)).toEqual({ data: [] });

        for (const [method, url] of [
            ['POST', `/pages/${PAGE}/catalog`],
            ['PATCH', `/pages/${PAGE}/catalog/${ITEM}`],
            ['DELETE', `/pages/${PAGE}/catalog/${ITEM}`],
        ] as const) {
            const res = await app.inject({ method, url, payload: { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(403);
        }
        expect(catalogService.createCatalogItem).not.toHaveBeenCalled();
        expect(catalogService.updateCatalogItem).not.toHaveBeenCalled();
        expect(catalogService.deleteCatalogItem).not.toHaveBeenCalled();
    });

    it('404s (not 403) for a page outside the workspace — no existence leak', async () => {
        vi.mocked(catalogService.listCatalogItems).mockResolvedValue(null);
        vi.mocked(catalogService.createCatalogItem).mockResolvedValue(null);

        const read = await app.inject({ method: 'GET', url: `/pages/${PAGE}/catalog` });
        expect(read.statusCode).toBe(404);
        const write = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: 'x' } });
        expect(write.statusCode).toBe(404);
    });

    it('400s an invalid body with the validation envelope (empty name)', async () => {
        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: '   ' } });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error).toBe('Validation failed');
        expect(body.details[0].field).toBe('name');
        expect(catalogService.createCatalogItem).not.toHaveBeenCalled();
    });

    it('403s with CATALOG_LIMIT_REACHED at the cap', async () => {
        vi.mocked(catalogService.createCatalogItem).mockRejectedValue(new CatalogLimitError());
        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: 'x' } });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.payload).code).toBe('CATALOG_LIMIT_REACHED');
    });

    it('409s with PAGE_HAS_STORE on a store-linked page, on every write verb', async () => {
        vi.mocked(catalogService.createCatalogItem).mockRejectedValue(new CatalogStoreConflictError());
        vi.mocked(catalogService.updateCatalogItem).mockRejectedValue(new CatalogStoreConflictError());
        vi.mocked(catalogService.deleteCatalogItem).mockRejectedValue(new CatalogStoreConflictError());

        for (const [method, url] of [
            ['POST', `/pages/${PAGE}/catalog`],
            ['PATCH', `/pages/${PAGE}/catalog/${ITEM}`],
            ['DELETE', `/pages/${PAGE}/catalog/${ITEM}`],
        ] as const) {
            const res = await app.inject({ method, url, payload: { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(409);
            expect(JSON.parse(res.payload).code).toBe('PAGE_HAS_STORE');
        }
    });

    it('201s a create and returns the bare item (repo precedent)', async () => {
        const item = { id: ITEM, pageId: PAGE, name: 'خوذة', type: 'product' };
        vi.mocked(catalogService.createCatalogItem).mockResolvedValue({ item, pageUserId: 'user-1' } as never);
        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: 'خوذة' } });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.payload)).toMatchObject({ id: ITEM, name: 'خوذة' });
    });
});

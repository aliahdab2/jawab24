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
            getCatalogCapacity: vi.fn(),
            createCatalogItemsBatch: vi.fn(),
            getPageVertical: vi.fn(),
            setPageVertical: vi.fn(),
        },
    };
});
vi.mock('../../src/services/activation', () => ({
    recordActivationEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/catalogExtractor', () => ({
    catalogExtractor: { extract: vi.fn() },
}));
vi.mock('../../src/services/catalogScan', () => {
    // The class must come from THIS mock so the controller's instanceof matches.
    class CatalogScanUnavailableError extends Error {}
    return { catalogScanService: { scanPosts: vi.fn() }, CatalogScanUnavailableError };
});
vi.mock('../../src/lib/dailyCap', () => ({
    dailyCapKey: (prefix: string, id: string) => `${prefix}:${id}:2026-01-01`,
    checkDailyCap: vi.fn().mockResolvedValue({ allowed: true, used: 0, limit: 30 }),
    incrementDailyCap: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { catalogExtractor } from '../../src/services/catalogExtractor';
import { catalogScanService, CatalogScanUnavailableError } from '../../src/services/catalogScan';
import { checkDailyCap, incrementDailyCap } from '../../src/lib/dailyCap';

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
            ['POST', `/pages/${PAGE}/catalog/extract`],
            ['POST', `/pages/${PAGE}/catalog/scan-posts`],
            ['POST', `/pages/${PAGE}/catalog/batch`],
            ['PATCH', `/pages/${PAGE}/catalog/vertical`],
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
        vi.mocked(catalogService.getPageVertical).mockResolvedValue({ effective: 'other', source: 'default' });

        const read = await app.inject({ method: 'GET', url: `/pages/${PAGE}/catalog` });
        expect(read.statusCode).toBe(200);
        expect(JSON.parse(read.payload)).toEqual({ data: [], vertical: { effective: 'other', source: 'default' } });

        for (const [method, url] of [
            ['POST', `/pages/${PAGE}/catalog`],
            ['POST', `/pages/${PAGE}/catalog/extract`],
            ['POST', `/pages/${PAGE}/catalog/scan-posts`],
            ['POST', `/pages/${PAGE}/catalog/batch`],
            ['PATCH', `/pages/${PAGE}/catalog/vertical`],
            ['PATCH', `/pages/${PAGE}/catalog/${ITEM}`],
            ['DELETE', `/pages/${PAGE}/catalog/${ITEM}`],
        ] as const) {
            const res = await app.inject({ method, url, payload: { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(403);
        }
        expect(catalogService.createCatalogItem).not.toHaveBeenCalled();
        expect(catalogService.updateCatalogItem).not.toHaveBeenCalled();
        expect(catalogService.deleteCatalogItem).not.toHaveBeenCalled();
        expect(catalogService.setPageVertical).not.toHaveBeenCalled();
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
        expect(catalogScanService.scanPosts).not.toHaveBeenCalled();
        expect(catalogService.createCatalogItemsBatch).not.toHaveBeenCalled();
    });

    it('404s (not 403) for a page outside the workspace — no existence leak', async () => {
        vi.mocked(catalogService.listCatalogItems).mockResolvedValue(null);
        vi.mocked(catalogService.getPageVertical).mockResolvedValue(null);
        vi.mocked(catalogService.createCatalogItem).mockResolvedValue(null);

        const read = await app.inject({ method: 'GET', url: `/pages/${PAGE}/catalog` });
        expect(read.statusCode).toBe(404);
        const write = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: 'x' } });
        expect(write.statusCode).toBe(404);
    });

    it('PATCH /vertical validates the enum, persists a valid value, 404s a foreign page', async () => {
        const bad = await app.inject({ method: 'PATCH', url: `/pages/${PAGE}/catalog/vertical`, payload: { vertical: 'spaceships' } });
        expect(bad.statusCode).toBe(400);
        expect(catalogService.setPageVertical).not.toHaveBeenCalled();

        vi.mocked(catalogService.setPageVertical).mockResolvedValue({ effective: 'vehicles', source: 'merchant' });
        const ok = await app.inject({ method: 'PATCH', url: `/pages/${PAGE}/catalog/vertical`, payload: { vertical: 'vehicles' } });
        expect(ok.statusCode).toBe(200);
        expect(JSON.parse(ok.payload)).toEqual({ vertical: { effective: 'vehicles', source: 'merchant' } });
        expect(catalogService.setPageVertical).toHaveBeenCalledWith('ws-1', PAGE, 'vehicles');

        vi.mocked(catalogService.setPageVertical).mockResolvedValue(null);
        const foreign = await app.inject({ method: 'PATCH', url: `/pages/${PAGE}/catalog/vertical`, payload: { vertical: 'vehicles' } });
        expect(foreign.statusCode).toBe(404);
    });

    describe('POST /scan-posts', () => {
        beforeEach(() => {
            vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue({ remaining: 100, pageUserId: 'user-1' });
        });

        it('returns proposals + scan telemetry and counts the daily cap', async () => {
            vi.mocked(catalogScanService.scanPosts).mockResolvedValue({
                items: [{ name: 'ASUS ROG Strix G18', type: 'product' } as never],
                dropped: 1, truncated: false, failed: false, postsScanned: 3, upToDate: false,
            });
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/scan-posts` });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.items).toHaveLength(1);
            expect(body.postsScanned).toBe(3);
            expect(body.upToDate).toBe(false);
            expect(catalogScanService.scanPosts).toHaveBeenCalledWith('ws-1', PAGE, { userId: 'user-1' });
            expect(incrementDailyCap).toHaveBeenCalledTimes(1);
        });

        it('does NOT count an up-to-date no-op against the daily cap (no paid calls happened)', async () => {
            vi.mocked(catalogScanService.scanPosts).mockResolvedValue({
                items: [], dropped: 0, truncated: false, failed: false, postsScanned: 0, upToDate: true,
            });
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/scan-posts` });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.payload).upToDate).toBe(true);
            expect(incrementDailyCap).not.toHaveBeenCalled();
        });

        it('429s once the scan daily cap is spent — before any scan work', async () => {
            vi.mocked(checkDailyCap).mockResolvedValueOnce({ allowed: false, used: 10, limit: 10 });
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/scan-posts` });
            expect(res.statusCode).toBe(429);
            expect(catalogScanService.scanPosts).not.toHaveBeenCalled();
        });

        it('409s PAGE_DISCONNECTED when the page has no usable FB connection', async () => {
            vi.mocked(catalogScanService.scanPosts).mockRejectedValue(new CatalogScanUnavailableError());
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/scan-posts` });
            expect(res.statusCode).toBe(409);
            expect(JSON.parse(res.payload).code).toBe('PAGE_DISCONNECTED');
        });

        it('403s CATALOG_LIMIT_REACHED when the catalog is already full — before any scan work', async () => {
            vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue({ remaining: 0, pageUserId: 'user-1' });
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/scan-posts` });
            expect(res.statusCode).toBe(403);
            expect(catalogScanService.scanPosts).not.toHaveBeenCalled();
        });
    });

    it('400s an invalid body with the validation envelope (empty name)', async () => {
        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload: { name: '   ' } });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error).toBe('Validation failed');
        expect(body.details[0].field).toBe('name');
        expect(catalogService.createCatalogItem).not.toHaveBeenCalled();
    });

    it('400s malformed or inverted dates (create is strict — the extractor path sanitizes instead)', async () => {
        for (const payload of [
            { name: 'x', startsAt: '11/07/2026' },                       // wrong format
            { name: 'x', startsAt: '2026-13-45' },                        // impossible date
            { name: 'x', startsAt: '2026-09-20', endsAt: '2026-08-10' },  // inverted window
        ]) {
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog`, payload });
            expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        }
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

describe('Catalog import endpoints — extract + batch', () => {
    let app: ReturnType<typeof fastify>;
    const LONG_TEXT = 'دورة ICDL ٣٥٠٠ ل.س — دورة فوتوشوب ٥٠٠٠ ل.س';

    beforeEach(async () => {
        vi.clearAllMocks();
        state.authed = true;
        state.role = 'admin';
        vi.mocked(checkDailyCap).mockResolvedValue({ allowed: true, used: 0, limit: 30 });
        vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue({ remaining: 300, pageUserId: 'user-1' } as never);
        app = fastify();
        app.register(catalogRoutes);
        await app.ready();
    });

    it('declares a per-route rate limit on /extract (the only paid route)', async () => {
        const probe = fastify();
        const configs: Record<string, unknown> = {};
        probe.addHook('onRoute', (route) => {
            if (route.method === 'POST') configs[route.url] = route.config;
        });
        probe.register(catalogRoutes);
        await probe.ready();
        expect(configs['/pages/:pageId/catalog/extract']).toMatchObject({ rateLimit: { max: 5, timeWindow: '1 minute' } });
    });

    it('400s extract when text is too short or missing — before any service call', async () => {
        for (const payload of [{ text: 'short' }, {}]) {
            const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload });
            expect(res.statusCode).toBe(400);
        }
        expect(catalogService.getCatalogCapacity).not.toHaveBeenCalled();
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('403s extract on a full page WITHOUT spending an LLM call', async () => {
        vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue({ remaining: 0, pageUserId: 'user-1' } as never);
        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.payload).code).toBe('CATALOG_LIMIT_REACHED');
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('404s extract for a foreign page; 409s for a store page — no LLM spend either way', async () => {
        vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue(null);
        const notFound = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });
        expect(notFound.statusCode).toBe(404);

        vi.mocked(catalogService.getCatalogCapacity).mockRejectedValue(new CatalogStoreConflictError());
        const store = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });
        expect(store.statusCode).toBe(409);
        expect(JSON.parse(store.payload).code).toBe('PAGE_HAS_STORE');
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('429s at the daily cap; 503s FAIL-CLOSED when the quota check is unavailable', async () => {
        vi.mocked(checkDailyCap).mockResolvedValue({ allowed: false, used: 30, limit: 30 });
        const capped = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });
        expect(capped.statusCode).toBe(429);
        expect(JSON.parse(capped.payload).code).toBe('daily_limit_reached');

        vi.mocked(checkDailyCap).mockRejectedValue(new Error('redis down'));
        const down = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });
        expect(down.statusCode).toBe(503);
        expect(JSON.parse(down.payload).code).toBe('quota_check_unavailable');
        expect(catalogExtractor.extract).not.toHaveBeenCalled();
    });

    it('200s extract with proposals sliced to remaining capacity and an overflow count', async () => {
        vi.mocked(catalogService.getCatalogCapacity).mockResolvedValue({ remaining: 2, pageUserId: 'user-1' } as never);
        vi.mocked(catalogExtractor.extract).mockResolvedValue({
            items: [
                { type: 'course', name: 'دورة ICDL', price: 3500, currency: 'ل.س', description: null, isAvailable: true },
                { type: 'course', name: 'دورة فوتوشوب', price: 5000, currency: 'ل.س', description: null, isAvailable: true },
                { type: 'course', name: 'دورة إكسل', price: 2000, currency: 'ل.س', description: null, isAvailable: true },
            ],
            dropped: 1,
            truncated: false,
        });

        const res = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/extract`, payload: { text: LONG_TEXT } });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body.items).toHaveLength(2);
        expect(body.overflow).toBe(1);
        expect(body.dropped).toBe(1);
        expect(body.remainingCapacity).toBe(2);
        expect(body.truncated).toBe(false);
    });

    it('400s batch with per-index field paths on one bad row', async () => {
        const res = await app.inject({
            method: 'POST', url: `/pages/${PAGE}/catalog/batch`,
            payload: { items: [{ name: 'ok' }, { name: '' }] },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error).toBe('Validation failed');
        expect(JSON.stringify(body.details)).toContain('items.1.name');
        expect(catalogService.createCatalogItemsBatch).not.toHaveBeenCalled();
    });

    it('maps batch service outcomes: 404 foreign page, 403 limit, 409 store', async () => {
        const payload = { items: [{ name: 'x' }] };

        vi.mocked(catalogService.createCatalogItemsBatch).mockResolvedValue(null);
        expect((await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/batch`, payload })).statusCode).toBe(404);

        vi.mocked(catalogService.createCatalogItemsBatch).mockRejectedValue(new CatalogLimitError());
        const limit = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/batch`, payload });
        expect(limit.statusCode).toBe(403);
        expect(JSON.parse(limit.payload).code).toBe('CATALOG_LIMIT_REACHED');

        vi.mocked(catalogService.createCatalogItemsBatch).mockRejectedValue(new CatalogStoreConflictError());
        const store = await app.inject({ method: 'POST', url: `/pages/${PAGE}/catalog/batch`, payload });
        expect(store.statusCode).toBe(409);
        expect(JSON.parse(store.payload).code).toBe('PAGE_HAS_STORE');
    });

    it('201s batch with { data: items } and fires ONE activation event', async () => {
        const rows = [{ id: ITEM, name: 'a' }, { id: '33333333-3333-3333-3333-333333333333', name: 'b' }];
        vi.mocked(catalogService.createCatalogItemsBatch).mockResolvedValue({ items: rows, pageUserId: 'user-1' } as never);

        const res = await app.inject({
            method: 'POST', url: `/pages/${PAGE}/catalog/batch`,
            payload: { items: [{ name: 'a' }, { name: 'b' }] },
        });

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.payload).data).toHaveLength(2);
        const { recordActivationEvent } = await import('../../src/services/activation');
        expect(recordActivationEvent).toHaveBeenCalledTimes(1);
        expect(recordActivationEvent).toHaveBeenCalledWith('user-1', 'kb_filled', { source: 'catalog' });
    });
});

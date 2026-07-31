/**
 * Route-level security + contract wiring for /pages/:pageId/fact-collections
 * (G1b list editor). Same posture as catalog.test.ts: the middleware mocks
 * ENFORCE semantics, so this suite fails if a refactor drops
 * `requireRole('admin')` from the write subtree or accidentally gates the read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import factCollectionsRoutes from '../../src/routes/factCollections';
import { factCollectionsService, FactCollectionLimitError } from '../../src/services/factCollections';
import { pagesService } from '../../src/services/pages';

vi.mock('../../src/services/factCollections', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/factCollections')>();
    return {
        FactCollectionLimitError: actual.FactCollectionLimitError,
        factCollectionsService: {
            listCollectionsWithRows: vi.fn(),
            addRow: vi.fn(),
            updateRow: vi.fn(),
            deleteRow: vi.fn(),
            setCompleteness: vi.fn(),
        },
    };
});
vi.mock('../../src/services/pages', () => ({
    pagesService: { getPage: vi.fn() },
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
    requireRole: (minRole: string) => async (req: any, reply: any) => {
        const order = ['member', 'admin', 'owner'];
        if (order.indexOf(req.workspaceRole) < order.indexOf(minRole)) {
            return reply.status(403).send({ error: 'Forbidden' });
        }
    },
}));

const PAGE = '11111111-1111-1111-1111-111111111111';
const COLL = '22222222-2222-2222-2222-222222222222';
const ROW = '33333333-3333-3333-3333-333333333333';

const WRITES = [
    ['POST', `/pages/${PAGE}/fact-collections/${COLL}/rows`],
    ['PATCH', `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`],
    ['DELETE', `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`],
    ['PATCH', `/pages/${PAGE}/fact-collections/${COLL}/completeness`],
] as const;

describe('Fact-collections routes — security + contract wiring', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        state.authed = true;
        state.role = 'admin';
        vi.mocked(pagesService.getPage).mockResolvedValue({ id: PAGE } as any);
        app = fastify();
        app.register(factCollectionsRoutes);
        await app.ready();
    });

    it('401s every verb when unauthenticated', async () => {
        state.authed = false;
        for (const [method, url] of [['GET', `/pages/${PAGE}/fact-collections`], ...WRITES] as const) {
            const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(401);
        }
    });

    it('lets a plain member READ but not write', async () => {
        state.role = 'member';
        vi.mocked(factCollectionsService.listCollectionsWithRows).mockResolvedValue([]);

        const read = await app.inject({ method: 'GET', url: `/pages/${PAGE}/fact-collections` });
        expect(read.statusCode).toBe(200);
        expect(JSON.parse(read.payload)).toEqual({ data: [] });

        for (const [method, url] of WRITES) {
            const res = await app.inject({ method, url, payload: { name: 'x' } });
            expect(res.statusCode, `${method} ${url}`).toBe(403);
        }
    });

    it('404s (never 403) on a page outside the workspace — existence must not leak', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
        for (const [method, url] of [['GET', `/pages/${PAGE}/fact-collections`], ...WRITES] as const) {
            const res = await app.inject({
                method, url,
                payload: method === 'GET' ? undefined : { name: 'x', isComplete: true },
            });
            expect(res.statusCode, `${method} ${url}`).toBe(404);
        }
    });

    it('GET returns collections with their rows nested', async () => {
        vi.mocked(factCollectionsService.listCollectionsWithRows).mockResolvedValue([
            {
                id: COLL, label: 'أسعار الدورات', keyAttr: null, isComplete: null, rowCount: 1,
                rows: [{ id: ROW, name: 'دورة ICDL', price: '35000.00' }],
            } as any,
        ]);
        const res = await app.inject({ method: 'GET', url: `/pages/${PAGE}/fact-collections` });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body.data[0].rows).toHaveLength(1);
        expect(body.data[0].rows[0].name).toBe('دورة ICDL');
    });

    it('POST row: validates, normalizes Arabic-Indic price to a string, 201s', async () => {
        vi.mocked(factCollectionsService.addRow).mockResolvedValue({ id: ROW, name: 'دورة جديدة' } as any);
        const res = await app.inject({
            method: 'POST',
            url: `/pages/${PAGE}/fact-collections/${COLL}/rows`,
            payload: { name: 'دورة جديدة', price: '٣٥٠٠٠', currency: 'ل.س قديمة', startsAt: '2026-08-10', endsAt: '2026-08-10' },
        });
        expect(res.statusCode).toBe(201);
        expect(vi.mocked(factCollectionsService.addRow)).toHaveBeenCalledWith(
            PAGE, COLL, expect.objectContaining({ price: '35000.00' }),
        );
    });

    it('POST row: 400 on a nameless body, service never called', async () => {
        const res = await app.inject({
            method: 'POST',
            url: `/pages/${PAGE}/fact-collections/${COLL}/rows`,
            payload: { price: 10 },
        });
        expect(res.statusCode).toBe(400);
        expect(vi.mocked(factCollectionsService.addRow)).not.toHaveBeenCalled();
    });

    it('PATCH row: forwards only the provided keys; explicit null clears a date', async () => {
        vi.mocked(factCollectionsService.updateRow).mockResolvedValue({ id: ROW } as any);
        const res = await app.inject({
            method: 'PATCH',
            url: `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`,
            payload: { startsAt: null, endsAt: null },
        });
        expect(res.statusCode).toBe(200);
        const patch = vi.mocked(factCollectionsService.updateRow).mock.calls[0][3];
        expect(patch).toEqual({ startsAt: null, endsAt: null });
    });

    it('DELETE row: maps the last-row guard to 409 LAST_ROW', async () => {
        vi.mocked(factCollectionsService.deleteRow).mockRejectedValue(
            new FactCollectionLimitError('Cannot delete the last row — delete the collection instead'),
        );
        const res = await app.inject({
            method: 'DELETE',
            url: `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`,
        });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.payload).code).toBe('LAST_ROW');
    });

    it('PATCH completeness: tri-state body reaches the service verbatim', async () => {
        vi.mocked(factCollectionsService.setCompleteness).mockResolvedValue({ id: COLL, isComplete: true } as any);
        for (const isComplete of [true, false, null]) {
            const res = await app.inject({
                method: 'PATCH',
                url: `/pages/${PAGE}/fact-collections/${COLL}/completeness`,
                payload: { isComplete },
            });
            expect(res.statusCode).toBe(200);
        }
        expect(vi.mocked(factCollectionsService.setCompleteness).mock.calls.map(c => c[2])).toEqual([true, false, null]);
    });
});

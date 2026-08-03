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
            // The controller wires a request-scoped logger before every write
            // (the service's logger was never wired, so its 8 log lines were
            // no-ops in production). A mock without this throws on every write.
            setLogger: vi.fn(),
            listCollectionsWithRows: vi.fn(),
            addRow: vi.fn(),
            updateRow: vi.fn(),
            deleteRow: vi.fn(),
            setCompleteness: vi.fn(),
            saveEntityRows: vi.fn(),
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
    // The entity endpoint is a WRITE like any other. It landed after this suite
    // was written and was covered by neither the auth posture nor the error
    // contract — the gap this list exists to make impossible.
    ['PUT', `/pages/${PAGE}/fact-entity`],
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
            new FactCollectionLimitError('Cannot delete the last row — delete the collection instead', 'LAST_ROW'),
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

    // ── Error contract ────────────────────────────────────────────────────────
    // Every refusal used to arrive as one of two hand-picked literals: `LIMIT`
    // covered five distinct conditions while `deleteRow` called the SAME
    // last-row rule `LAST_ROW`, so one business rule had two names and the
    // client could not tell "list is full" from "your editor is stale". The
    // code now travels ON the error, which makes the two endpoints agree by
    // construction rather than by review.
    describe('error contract — one code per reason', () => {
        it.each([
            ['ROW_LIMIT', 'At most 500 rows per collection', 409],
            ['LAST_ROW', 'A collection needs at least one row', 409],
            // A bad date range is a MALFORMED BODY, not a state conflict.
            ['DATE_ORDER', 'End date must not be before the start date', 400],
        ] as const)('POST row surfaces %s as %i', async (code, message, status) => {
            vi.mocked(factCollectionsService.addRow).mockRejectedValue(
                new FactCollectionLimitError(message, code),
            );
            const res = await app.inject({
                method: 'POST',
                url: `/pages/${PAGE}/fact-collections/${COLL}/rows`,
                payload: { name: 'دورة جديدة' },
            });
            expect(res.statusCode).toBe(status);
            expect(JSON.parse(res.payload).code).toBe(code);
        });

        it('PATCH row: a merged-date violation is 400 DATE_ORDER, NOT a 500', async () => {
            // Regression: updateRow had no catch at all, so the service's guard
            // escaped to Fastify's default handler as a 500 — paging on-call for
            // a client input error and telling the caller to retry a request
            // that can never succeed.
            vi.mocked(factCollectionsService.updateRow).mockRejectedValue(
                new FactCollectionLimitError('End date must not be before the start date', 'DATE_ORDER'),
            );
            const res = await app.inject({
                method: 'PATCH',
                url: `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`,
                payload: { endsAt: '2020-01-01' },
            });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.payload).code).toBe('DATE_ORDER');
        });

        it('a missing row is STALE_ROW so the editor knows to reload, not retry', async () => {
            vi.mocked(factCollectionsService.updateRow).mockResolvedValue(null as any);
            const res = await app.inject({
                method: 'PATCH',
                url: `/pages/${PAGE}/fact-collections/${COLL}/rows/${ROW}`,
                payload: { name: 'x' },
            });
            expect(res.statusCode).toBe(404);
            expect(JSON.parse(res.payload).code).toBe('STALE_ROW');
        });

        it('404s carry a code so a client never string-matches English', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            const res = await app.inject({ method: 'GET', url: `/pages/${PAGE}/fact-collections` });
            expect(res.statusCode).toBe(404);
            expect(JSON.parse(res.payload).code).toBe('PAGE_NOT_FOUND');
        });

        // The entity endpoint arrived with the grouped-lists work, AFTER the codes
        // above existed, and kept the old hand-written `409 LIMIT` for every
        // refusal plus a bare `error` array on a bad body. One router answering
        // the same rule two ways is exactly what carrying the code on the error
        // was meant to end, so it is pinned per reason like the row endpoints.
        it.each([
            ['LAST_ROW', 'Cannot delete the last row — delete the collection instead', 409],
            ['ROW_LIMIT', 'At most 500 rows per collection', 409],
            // A row that vanished under a bulk save is GONE, not a conflict: the
            // row endpoints answer 404 STALE_ROW for the identical condition.
            ['STALE_ROW', 'Row not found — reload and try again', 404],
        ] as const)('PUT entity surfaces %s as %i', async (code, message, status) => {
            vi.mocked(factCollectionsService.saveEntityRows).mockRejectedValue(
                new FactCollectionLimitError(message, code),
            );
            const res = await app.inject({
                method: 'PUT',
                url: `/pages/${PAGE}/fact-entity`,
                payload: { upserts: [{ collectionId: COLL, name: 'دورة' }], deletes: [] },
            });
            expect(res.statusCode).toBe(status);
            expect(JSON.parse(res.payload).code).toBe(code);
        });

        it('PUT entity: a 400 body keeps `error` a STRING and puts field errors in `details`', async () => {
            const res = await app.inject({
                method: 'PUT',
                url: `/pages/${PAGE}/fact-entity`,
                payload: { upserts: [], deletes: [] }, // refine(): at least one operation
            });
            expect(res.statusCode).toBe(400);
            const body = JSON.parse(res.payload);
            expect(typeof body.error).toBe('string');
            expect(body.code).toBe('VALIDATION');
            expect(Array.isArray(body.details)).toBe(true);
        });

        it('a 400 body keeps `error` a STRING and puts field errors in `details`', async () => {
            // This controller was the only one in the backend putting an ARRAY in
            // `error`; every generic consumer assumes a string and would render
            // "[object Object]". catalog.ts already uses the shape asserted here.
            const res = await app.inject({
                method: 'POST',
                url: `/pages/${PAGE}/fact-collections/${COLL}/rows`,
                payload: { price: 10 },
            });
            expect(res.statusCode).toBe(400);
            const body = JSON.parse(res.payload);
            expect(typeof body.error).toBe('string');
            expect(body.code).toBe('VALIDATION');
            expect(Array.isArray(body.details)).toBe(true);
            expect(body.details[0]).toHaveProperty('field');
        });
    });

    it('wires a request-scoped logger before every write', async () => {
        // The service ships `setLogger` and 8 log lines; nothing ever called it,
        // so the fact engine was silent in production. If this regresses, the
        // silence returns and no test would otherwise notice.
        vi.mocked(factCollectionsService.addRow).mockResolvedValue({ id: ROW } as any);
        await app.inject({
            method: 'POST',
            url: `/pages/${PAGE}/fact-collections/${COLL}/rows`,
            payload: { name: 'دورة' },
        });
        expect(vi.mocked(factCollectionsService.setLogger)).toHaveBeenCalled();
    });

    it('wires the logger on the entity write too — the one write that did not', async () => {
        vi.mocked(factCollectionsService.saveEntityRows).mockResolvedValue({ upserted: [], deletedIds: [] } as any);
        await app.inject({
            method: 'PUT',
            url: `/pages/${PAGE}/fact-entity`,
            payload: { upserts: [{ collectionId: COLL, name: 'دورة' }], deletes: [] },
        });
        expect(vi.mocked(factCollectionsService.setLogger)).toHaveBeenCalled();
    });
});

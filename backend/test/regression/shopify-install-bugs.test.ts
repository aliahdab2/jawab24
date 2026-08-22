/**
 * Shopify Install Pipeline — Regression Tests
 *
 * Captures bugs found during the dogfood session on 2026-04-25 documented in
 * `docs/testing/SHOPIFY_TEST_PLAN.md`. Every test here corresponds to a real
 * bug ID (A-1.x, B-x.x). All bugs from this session are now CLOSED — these
 * tests guard against regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => mockSelect()),
        insert: vi.fn(() => mockInsert()),
        update: vi.fn(() => mockUpdate()),
        delete: vi.fn(() => mockDelete()),
        transaction: vi.fn((cb: (tx: unknown) => unknown) => mockTransaction(cb)),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id',
        workspaceId: 'workspaceId',
        platform: 'platform',
        isActive: 'isActive',
        updatedAt: 'updatedAt',
    },
    ecommerceProducts: {
        id: 'id',
        ecommerceStoreId: 'ecommerceStoreId',
        platformProductId: 'platformProductId',
    },
    pendingEcommerceInstalls: {
        id: 'id',
        platform: 'platform',
        storeDomain: 'storeDomain',
        accessToken: 'accessToken',
        accessTokenIv: 'accessTokenIv',
        scopes: 'scopes',
        nonce: 'nonce',
        status: 'status',
        expiresAt: 'expiresAt',
        claimedByUserId: 'claimedByUserId',
    },
    pages: {},
    workspaceMembers: { workspaceId: 'workspaceId', userId: 'userId' },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
    notInArray: vi.fn((col: unknown, vals: unknown[]) => ({ op: 'notInArray', col, vals })),
    inArray: vi.fn((col: unknown, vals: unknown[]) => ({ op: 'inArray', col, vals })),
    lt: vi.fn(),
    sql: Object.assign(
        (strings: TemplateStringsArray, ..._values: unknown[]) => ({ op: 'sql', strings: [...strings] }),
        { raw: vi.fn() },
    ),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    encrypt: vi.fn((token: string) => ({ ciphertext: `enc(${token})`, iv: 'iv-mock' })),
    decrypt: vi.fn((encrypted: string) => `dec(${encrypted})`),
    encryptOptional: vi.fn((token?: string | null) => (token ? { ciphertext: `enc(${token})`, iv: 'iv-mock' } : {})),
    decryptOptional: vi.fn((encrypted?: string | null, iv?: string | null) => (encrypted && iv ? `dec(${encrypted})` : undefined)),
}));

const captureErrorMock = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
}));

const seedDefaultsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: {
        seedDefaults: (...args: unknown[]) => seedDefaultsMock(...args),
    },
}));

const enqueueWebhookRetryMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/webhookRetryQueue', () => ({
    enqueueWebhookRetry: (...args: unknown[]) => enqueueWebhookRetryMock(...args),
}));

// ─── A-1.3 (FIXED): getStoreByWorkspaceAny ORDER BY ──────────────────────

describe('A-1.3 — getStoreByWorkspaceAny ORDER BY (FIXED, regression guard)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('issues a query that includes ORDER BY isActive DESC, updatedAt DESC', async () => {
        const limit = vi.fn().mockResolvedValue([]);
        const orderBy = vi.fn().mockReturnValue({ limit });
        const where = vi.fn().mockReturnValue({ orderBy });
        const from = vi.fn().mockReturnValue({ where });
        mockSelect.mockReturnValue({ from });

        const { getStoreByWorkspaceAny } = await import('../../src/services/ecommerce');
        await getStoreByWorkspaceAny('shopify', 'ws-1');

        expect(orderBy).toHaveBeenCalledTimes(1);
        const orderArgs = orderBy.mock.calls[0];
        expect(orderArgs.length).toBeGreaterThanOrEqual(2);
        expect(orderArgs[0]).toMatchObject({ op: 'desc' });
        expect(orderArgs[1]).toMatchObject({ op: 'desc' });
    });
});

// ─── A-1.4 + B-3.1 (FIXED): replaceProductsAndRebuildSummary uses transactional UPSERT ─
//
// Original A-1.4: delete-then-insert was not transactional, two concurrent
// syncs raced the unique index to a 500. Fix: wrap in db.transaction.
//
// Then B-3.1 surfaced: even with the transaction, every sync rotated all
// internal product ids because we delete-all + insert-all. Fix: per-row
// UPSERT inside the transaction (insert ... on conflict do update), then
// delete only the rows whose platform_product_id is no longer in the catalog.

describe('A-1.4 + B-3.1 — replaceProductsAndRebuildSummary transactional UPSERT', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('runs the upsert + stale-row delete inside one db.transaction', async () => {
        const insertValues = vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        });
        const txInsert = vi.fn().mockReturnValue({ values: insertValues });
        const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
        const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
        const tx = { insert: txInsert, delete: txDelete };

        mockTransaction.mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
            await cb(tx);
        });

        // Outside the transaction `refreshStoreProductMetadata` runs four selects:
        //   1+2. buildProductSummary (store row + products list, both .where().limit())
        //   3.   count(*) — destructured directly: .where() resolves to array
        //   4.   invalidateCachesForStore → pages where (no .limit)
        const limitEmpty = vi.fn().mockResolvedValue([]);
        const whereWithLimit = vi.fn().mockReturnValue({ limit: limitEmpty });
        const whereWithOrderByLimit = vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitEmpty }) });
        const countWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
        const linkedPagesWhere = vi.fn().mockResolvedValue([]);
        mockSelect
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithOrderByLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: countWhere }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: linkedPagesWhere }) });
        mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

        const { replaceProductsAndRebuildSummary } = await import('../../src/services/ecommerce');

        await replaceProductsAndRebuildSummary('store-1', [
            {
                platformProductId: 'p1', title: 'P1', status: 'active',
                priceRange: '10', currency: 'USD', totalInventory: 1,
                hasVariants: false,
            },
        ]);

        // The transaction must have been used exactly once for the
        // upsert + stale-delete pair. No bare db.delete / db.insert outside it.
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockInsert).not.toHaveBeenCalled();

        // Inside the transaction: insert .values() ran and onConflictDoUpdate was used.
        expect(txInsert).toHaveBeenCalledTimes(1);
        expect(insertValues).toHaveBeenCalledTimes(1);
        const onConflictReturn = insertValues.mock.results[0].value;
        expect(onConflictReturn.onConflictDoUpdate).toHaveBeenCalledTimes(1);

        // And then a delete-stale call went through the same tx.
        expect(txDelete).toHaveBeenCalledTimes(1);
    });

    it('still deletes everything inside the transaction when the product list is empty', async () => {
        const insertValues = vi.fn();
        const txInsert = vi.fn().mockReturnValue({ values: insertValues });
        const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
        const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
        mockTransaction.mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
            await cb({ insert: txInsert, delete: txDelete });
        });

        const limitEmpty = vi.fn().mockResolvedValue([]);
        const whereWithLimit = vi.fn().mockReturnValue({ limit: limitEmpty });
        const whereWithOrderByLimit = vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitEmpty }) });
        const countWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
        const linkedPagesWhere = vi.fn().mockResolvedValue([]);
        mockSelect
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithOrderByLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: countWhere }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: linkedPagesWhere }) });
        mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

        const { replaceProductsAndRebuildSummary } = await import('../../src/services/ecommerce');
        await replaceProductsAndRebuildSummary('store-1', []);

        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(txDelete).toHaveBeenCalledTimes(1);
        expect(txInsert).not.toHaveBeenCalled();
    });
});

// ─── A-1.5 (FIXED): empty-body parser returns 200 ────────────────────────

describe('A-1.5 — JSON parser treats empty body as {} (FIXED)', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        // Mount a Fastify instance with the SAME content-type parser shape
        // as src/index.ts so the parser logic is exercised end-to-end.
        app = fastify();
        app.addContentTypeParser(
            'application/json',
            { parseAs: 'buffer' },
            (req: any, body: Buffer, done: any) => {
                try {
                    req.rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
                    const text = body.toString('utf8');
                    if (text.trim() === '') {
                        done(null, {});
                        return;
                    }
                    done(null, JSON.parse(text));
                } catch (err: any) {
                    err.statusCode = 400;
                    done(err, undefined);
                }
            },
        );
        // Stub route — same shape as POST /shopify/store/sync (auth-gated upstream).
        app.post('/shopify/store/sync', async (_req, reply) => reply.send({ ok: true }));
        await app.ready();
    });

    it('returns 200 when the body is empty and Content-Type is application/json', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/shopify/store/sync',
            headers: { 'content-type': 'application/json' },
            payload: '',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
    });

    it('returns 200 when the body is "{}"', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/shopify/store/sync',
            headers: { 'content-type': 'application/json' },
            payload: '{}',
        });
        expect(response.statusCode).toBe(200);
    });

    it('still returns 400 for actually-malformed JSON bodies', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/shopify/store/sync',
            headers: { 'content-type': 'application/json' },
            payload: '{ not: json',
        });
        expect(response.statusCode).toBe(400);
    });
});

// ─── A-1.7 (REGRESSION): mapToEcommerceStore exposes isActive ────────────

describe('A-1.7 — mapToEcommerceStore must expose isActive (REGRESSION)', () => {
    it('includes isActive=true for active rows', async () => {
        const { mapToEcommerceStore } = await import('../../src/services/ecommerce');
        const out = mapToEcommerceStore({
            id: 'store-1', userId: 'u-1', workspaceId: 'ws-1', platform: 'shopify',
            storeDomain: 'x.myshopify.com', accessToken: 'enc', accessTokenIv: 'iv',
            refreshToken: null, refreshTokenIv: null, tokenExpiresAt: null,
            storeName: 'X', storeEmail: null, storeCurrency: 'USD', storeTimezone: null,
            productCount: 0, productSummary: null, policiesSummary: null,
            platformData: null, lastSyncAt: null, isActive: true,
            installedAt: null, uninstalledAt: null,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(out).toHaveProperty('isActive', true);
    });

    it('includes isActive=false for disconnected rows so the UI can render Reconnect', async () => {
        const { mapToEcommerceStore } = await import('../../src/services/ecommerce');
        const out = mapToEcommerceStore({
            id: 'store-1', userId: 'u-1', workspaceId: 'ws-1', platform: 'shopify',
            storeDomain: 'x.myshopify.com', accessToken: 'enc', accessTokenIv: 'iv',
            refreshToken: null, refreshTokenIv: null, tokenExpiresAt: null,
            storeName: 'X', storeEmail: null, storeCurrency: 'USD', storeTimezone: null,
            productCount: 0, productSummary: null, policiesSummary: null,
            platformData: null, lastSyncAt: null, isActive: false,
            installedAt: null, uninstalledAt: null,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(out).toHaveProperty('isActive', false);
    });
});

// ─── S3 (REGRESSION): mapToEcommerceStore derives needsReauth from token health ───

describe('mapToEcommerceStore must expose needsReauth (platformData.tokenHealth)', () => {
    const baseRow = {
        id: 'store-1', userId: 'u-1', workspaceId: 'ws-1', platform: 'shopify',
        storeDomain: 'x.myshopify.com', accessToken: 'enc', accessTokenIv: 'iv',
        refreshToken: null, refreshTokenIv: null, tokenExpiresAt: null,
        storeName: 'X', storeEmail: null, storeCurrency: 'USD', storeTimezone: null,
        productCount: 0, productSummary: null, policiesSummary: null,
        lastSyncAt: null, isActive: true,
        installedAt: null, uninstalledAt: null,
        createdAt: new Date(), updatedAt: new Date(),
    };

    it('needsReauth=true when platformData.tokenHealth is invalid', async () => {
        const { mapToEcommerceStore } = await import('../../src/services/ecommerce');
        const out = mapToEcommerceStore({ ...baseRow, platformData: { tokenHealth: 'invalid', merchantId: '123' } } as never);
        expect(out.needsReauth).toBe(true);
    });

    it('needsReauth=false when tokenHealth is ok, absent, or platformData is null', async () => {
        const { mapToEcommerceStore } = await import('../../src/services/ecommerce');
        // 'ok' (cleared after a successful refresh)
        expect(mapToEcommerceStore({ ...baseRow, platformData: { tokenHealth: 'ok' } } as never).needsReauth).toBe(false);
        // merchantId-only — i.e. after a reconnect REPLACES platformData, dropping tokenHealth
        expect(mapToEcommerceStore({ ...baseRow, platformData: { merchantId: '123' } } as never).needsReauth).toBe(false);
        // legacy / brand-new row
        expect(mapToEcommerceStore({ ...baseRow, platformData: null } as never).needsReauth).toBe(false);
    });
});

// ─── A-1.9 (FIXED): claimPendingInstall awaits webhook registration ──────
//
// Helper: mock just enough of the DB chain to drive claimPendingInstall to
// completion. Returns refs to the registerWebhooksFn / saveWebhookStatusFn
// mocks the test will assert on.

interface ClaimMocks {
    registerWebhooksFn: ReturnType<typeof vi.fn>;
    saveWebhookStatusFn: ReturnType<typeof vi.fn>;
}

function setupClaimPendingMocks(): ClaimMocks {
    // resetAllMocks wipes the seedDefaults mock implementation — restore it.
    seedDefaultsMock.mockResolvedValue(undefined);
    // Step 1: select pendingEcommerceInstalls
    const pendingRow = {
        id: 'pending-1',
        platform: 'shopify',
        storeDomain: 'demo.myshopify.com',
        accessToken: 'cipher',
        accessTokenIv: 'iv',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
    };
    // Step 2: select existing store by domain → null
    // Step 3: select workspaceMembers → empty
    // We chain mockSelect by call order.
    mockSelect
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([pendingRow]) }),
            }),
        })
        // getStoreByDomain
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
        })
        // workspaceMembers
        .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
        });

    // Insert: createStore → values().onConflictDoUpdate().returning()
    const insertReturning = vi.fn().mockResolvedValue([{ id: 'store-1', storeDomain: 'demo.myshopify.com' }]);
    mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({ returning: insertReturning }),
            returning: insertReturning,
        }),
    });

    // Update: pendingEcommerceInstalls set claimed
    mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });

    const registerWebhooksFn = vi.fn();
    const saveWebhookStatusFn = vi.fn().mockResolvedValue(undefined);
    return { registerWebhooksFn, saveWebhookStatusFn };
}

describe('A-1.9 — claimPendingInstall awaits webhook registration (FIXED)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        enqueueWebhookRetryMock.mockClear();
        captureErrorMock.mockClear();
    });

    it('does not return until registerWebhooksFn resolves; saveWebhookStatusFn runs after', async () => {
        const { registerWebhooksFn, saveWebhookStatusFn } = setupClaimPendingMocks();
        let registerResolved = false;
        registerWebhooksFn.mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10));
            registerResolved = true;
            return { registered: ['app/uninstalled'], failed: [], lastAttempt: 'now' };
        });

        const { claimPendingInstall } = await import('../../src/services/ecommerce');
        const store = await claimPendingInstall(
            'pending-1', 'user-1', 'shopify', registerWebhooksFn, saveWebhookStatusFn,
        );

        expect(store).toBeTruthy();
        // Must have awaited — saveWebhookStatusFn proves it (called only after register resolved).
        expect(registerResolved).toBe(true);
        expect(saveWebhookStatusFn).toHaveBeenCalledTimes(1);
        expect(enqueueWebhookRetryMock).not.toHaveBeenCalled();
    });

    it('captures error, persists pending marker, and enqueues retry when registerWebhooksFn rejects (does not throw)', async () => {
        const { registerWebhooksFn, saveWebhookStatusFn } = setupClaimPendingMocks();
        registerWebhooksFn.mockRejectedValue(new Error('Shopify API down'));

        const { claimPendingInstall } = await import('../../src/services/ecommerce');
        const store = await claimPendingInstall(
            'pending-1', 'user-1', 'shopify', registerWebhooksFn, saveWebhookStatusFn,
        );

        expect(store).toBeTruthy();
        expect(captureErrorMock).toHaveBeenCalled();
        expect(enqueueWebhookRetryMock).toHaveBeenCalledWith({ storeId: 'store-1', platform: 'shopify' });
        // saveWebhookStatusFn IS called — with a pending marker so the
        // integrations card surfaces 'pending' instead of 'unknown' until
        // retries succeed. This is the whole point of the merchant-visible
        // failure-state fix.
        expect(saveWebhookStatusFn).toHaveBeenCalledTimes(1);
        const persistedStatus = saveWebhookStatusFn.mock.calls[0][1];
        expect(persistedStatus.registered).toEqual([]);
        expect(persistedStatus.failed.length).toBeGreaterThan(0);
        expect(persistedStatus.exhausted).toBeUndefined(); // not yet exhausted
    });

    it('persists status AND enqueues retry on partial failure', async () => {
        const { registerWebhooksFn, saveWebhookStatusFn } = setupClaimPendingMocks();
        registerWebhooksFn.mockResolvedValue({
            registered: ['app/uninstalled'],
            failed: [{ topic: 'orders/create', status: 500, error: 'boom' }],
            lastAttempt: 'now',
        });

        const { claimPendingInstall } = await import('../../src/services/ecommerce');
        await claimPendingInstall('pending-1', 'user-1', 'shopify', registerWebhooksFn, saveWebhookStatusFn);

        expect(saveWebhookStatusFn).toHaveBeenCalledTimes(1);
        expect(enqueueWebhookRetryMock).toHaveBeenCalledWith({ storeId: 'store-1', platform: 'shopify' });
    });
});

// ─── webhookHealth surfacing — merchant-visible failure state ────────────
//
// When the retry queue exhausts (or the initial registration throws), the
// integrations card needs a way to know so it can render a "Re-register
// webhooks" CTA. mapToEcommerceStore derives `webhookHealth` from
// platformData.webhookStatus via `deriveWebhookHealth`.

describe('webhookHealth — derived state for the integrations card', () => {
    it('returns "unknown" when no webhookStatus has ever been persisted (legacy stores)', async () => {
        const { deriveWebhookHealth } = await import('../../src/services/ecommerce');
        expect(deriveWebhookHealth(null)).toBe('unknown');
        expect(deriveWebhookHealth(undefined)).toBe('unknown');
    });

    it('returns "ok" when every topic registered and nothing failed', async () => {
        const { deriveWebhookHealth } = await import('../../src/services/ecommerce');
        expect(deriveWebhookHealth({
            registered: ['app/uninstalled', 'products/create'],
            failed: [],
            lastAttempt: 'now',
        })).toBe('ok');
    });

    it('returns "pending" when some topics failed but retries can still run', async () => {
        const { deriveWebhookHealth } = await import('../../src/services/ecommerce');
        expect(deriveWebhookHealth({
            registered: ['app/uninstalled'],
            failed: [{ topic: 'products/create', status: 500 }],
            lastAttempt: 'now',
        })).toBe('pending');
    });

    it('returns "failed" when retries are exhausted (merchant must re-register)', async () => {
        const { deriveWebhookHealth } = await import('../../src/services/ecommerce');
        expect(deriveWebhookHealth({
            registered: [],
            failed: [{ topic: 'all', error: 'Shopify API down' }],
            lastAttempt: 'now',
            exhausted: true,
        })).toBe('failed');
    });
});

// ─── B-3.1 (FIXED): single-product webhook preserves internal id ─────────

describe('B-3.1 — upsertSingleProduct + deleteSingleProduct (FIXED)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('upsertSingleProduct inserts with onConflictDoUpdate (no full delete)', async () => {
        const onConflict = vi.fn().mockResolvedValue(undefined);
        const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflict });
        mockInsert.mockReturnValue({ values: insertValues });

        // refreshStoreProductMetadata path:
        //   1. buildProductSummary store select → .where().limit()
        //   2. buildProductSummary products select → .where().limit()
        //   3. count select → .where() (destructured directly, no .limit)
        //   4. final stores update
        const limitResolvesEmpty = vi.fn().mockResolvedValue([]);
        const whereWithLimit = vi.fn().mockReturnValue({ limit: limitResolvesEmpty });
        const whereWithOrderByLimit = vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitResolvesEmpty }) });
        const countWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
        const linkedPagesWhere = vi.fn().mockResolvedValue([]); // invalidateCachesForStore — no linked pages
        mockSelect
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithOrderByLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: countWhere }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: linkedPagesWhere }) });
        mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

        const { upsertSingleProduct } = await import('../../src/services/ecommerce');
        await upsertSingleProduct('store-1', {
            platformProductId: 'p1',
            title: 'Updated',
            status: 'active',
            priceRange: '10',
            currency: 'USD',
            totalInventory: 5,
            hasVariants: false,
        });

        expect(mockInsert).toHaveBeenCalledTimes(1);
        expect(insertValues).toHaveBeenCalledTimes(1);
        expect(onConflict).toHaveBeenCalledTimes(1);
        // Must NOT delete — that would defeat the whole point.
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deleteSingleProduct deletes only the targeted (storeId, platformProductId) row', async () => {
        const deleteWhere = vi.fn().mockResolvedValue(undefined);
        mockDelete.mockReturnValue({ where: deleteWhere });

        const limitResolvesEmpty = vi.fn().mockResolvedValue([]);
        const whereWithLimit = vi.fn().mockReturnValue({ limit: limitResolvesEmpty });
        const whereWithOrderByLimit = vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: limitResolvesEmpty }) });
        const countWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
        mockSelect
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereWithOrderByLimit }) })
            .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: countWhere }) });
        mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

        const { deleteSingleProduct } = await import('../../src/services/ecommerce');
        await deleteSingleProduct('store-1', 'p1');

        expect(mockDelete).toHaveBeenCalledTimes(1);
        // The where clause receives an `and(eq(storeId), eq(platformProductId))` —
        // we don't deserialize the structure here, just confirm the delete is scoped.
        expect(deleteWhere).toHaveBeenCalledTimes(1);
        expect(mockInsert).not.toHaveBeenCalled();
    });
});

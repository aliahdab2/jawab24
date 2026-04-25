/**
 * Shopify Install Pipeline — Regression Tests
 *
 * Captures bugs found during the dogfood session on 2026-04-25 documented in
 * `docs/testing/SHOPIFY_TEST_PLAN.md`. Every test here corresponds to a real
 * bug ID (A-1.x, B-x.x). Fixed bugs are asserted to stay fixed; unfixed bugs
 * have `it.todo` placeholders that document the expected behavior so a future
 * fixer can flip them to passing tests.
 *
 * If you fix one of the open bugs:
 *   1. Convert its `it.todo(...)` into `it(..., async () => { ... })`
 *   2. Implement the assertions
 *   3. Verify it passes
 *   4. Update `docs/testing/SHOPIFY_TEST_PLAN.md` bug log to mark it CLOSED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
    and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
    lt: vi.fn(),
    sql: vi.fn(),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    encrypt: vi.fn((token: string) => ({ encrypted: `enc(${token})`, iv: 'iv-mock' })),
    decrypt: vi.fn((encrypted: string) => `dec(${encrypted})`),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: {
        seedDefaults: vi.fn().mockResolvedValue(undefined),
    },
}));

// ─── A-1.3 (FIXED): getStoreByWorkspaceAny ORDER BY ──────────────────────
//
// Bug: when a workspace has multiple ecommerce_stores rows for the same
// platform (e.g. an old disconnected store + a new active reinstall on a
// different shop), the original query `LIMIT 1` with no ORDER BY returned
// whichever Postgres found first — which was the older inactive row. The
// frontend then showed a stale "Reconnect this store" card and never
// surfaced the actually-connected new store.
//
// Fix: ORDER BY isActive DESC, updatedAt DESC LIMIT 1
// Committed in `services/ecommerce.ts` getStoreByWorkspaceAny.
//
// Discovered: SHOPIFY_TEST_PLAN.md Section A, when both demo-electronics
// (inactive seed) and jawab24-demo (active install) coexisted in the
// workspace. The integrations page kept rendering demo-electronics.

describe('A-1.3 — getStoreByWorkspaceAny ORDER BY (FIXED, regression guard)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('issues a query that includes ORDER BY isActive DESC, updatedAt DESC', async () => {
        // We assert on the query-building chain instead of running real SQL.
        // The chain ends with .orderBy(...).limit(1) — `orderBy` must be present.
        const limit = vi.fn().mockResolvedValue([]);
        const orderBy = vi.fn().mockReturnValue({ limit });
        const where = vi.fn().mockReturnValue({ orderBy });
        const from = vi.fn().mockReturnValue({ where });
        mockSelect.mockReturnValue({ from });

        const { getStoreByWorkspaceAny } = await import('../../src/services/ecommerce');
        await getStoreByWorkspaceAny('shopify', 'ws-1');

        expect(orderBy).toHaveBeenCalledTimes(1);
        const orderArgs = orderBy.mock.calls[0];

        // Must order by isActive DESC and updatedAt DESC (in that priority).
        // Without these, Postgres returns nondeterministic order on LIMIT 1.
        expect(orderArgs.length).toBeGreaterThanOrEqual(2);
        expect(orderArgs[0]).toMatchObject({ op: 'desc' });
        expect(orderArgs[1]).toMatchObject({ op: 'desc' });
    });
});

// ─── A-1.4 (FIXED): sync replaceProductsAndRebuildSummary not transactional ─
//
// Bug: `replaceProductsAndRebuildSummary` deletes all products then inserts
// new rows. The two statements are NOT wrapped in a transaction, so two
// concurrent syncs can race:
//   T1: DELETE
//   T2: DELETE
//   T1: INSERT (works)
//   T2: INSERT → unique constraint violation `idx_ecommerce_products_store_product`
//   → 500 to the user.
//
// Discovered: when the test plan called POST /shopify/store/sync rapidly
// (or with body variations that took different code paths), got a 500
// duplicate-key. The UI's idempotent path uses `{}` body and worked, which
// masked the issue from regular usage but not concurrent ones.
//
// Fix: wrap the delete+insert in db.transaction(async (tx) => { ... })
// so concurrent syncs serialize. (See services/ecommerce.ts:692-714.)

describe('A-1.4 — replaceProductsAndRebuildSummary should be transactional (FIXED, regression guard)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs delete+insert inside a single db.transaction so concurrent syncs serialize', async () => {
        // Build a tx mock that records every call issued through it.
        const txDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        const txInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        const tx = { delete: txDelete, insert: txInsert };

        // Capture the transaction callback and run it synchronously.
        mockTransaction.mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
            await cb(tx);
        });

        // The non-tx db.* methods used after the transaction (buildProductSummary
        // queries, then the final stores update). Make them no-op resolves.
        const limit = vi.fn().mockResolvedValue([]);
        const where = vi.fn().mockReturnValue({ limit, then: (r: (v: unknown) => unknown) => r([]) });
        const from = vi.fn().mockReturnValue({ where });
        mockSelect.mockReturnValue({ from });

        const setWhere = vi.fn().mockResolvedValue(undefined);
        const setFn = vi.fn().mockReturnValue({ where: setWhere });
        mockUpdate.mockReturnValue({ set: setFn });

        const { replaceProductsAndRebuildSummary } = await import('../../src/services/ecommerce');

        await replaceProductsAndRebuildSummary('store-1', [
            {
                platformProductId: 'p1', title: 'P1', status: 'active',
                priceRange: '10', currency: 'USD', totalInventory: 1,
                hasVariants: false,
            },
        ]);

        // The transaction must have been used exactly once for the
        // delete-then-insert pair. No bare db.delete / db.insert outside it.
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockInsert).not.toHaveBeenCalled();

        // Inside the transaction, delete must come before insert.
        expect(txDelete).toHaveBeenCalledTimes(1);
        expect(txInsert).toHaveBeenCalledTimes(1);
        const deleteOrder = txDelete.mock.invocationCallOrder[0];
        const insertOrder = txInsert.mock.invocationCallOrder[0];
        expect(deleteOrder).toBeLessThan(insertOrder);
    });

    it('skips the insert call inside the transaction when the product list is empty', async () => {
        const txDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        const txInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
        mockTransaction.mockImplementation(async (cb: (t: unknown) => Promise<void>) => {
            await cb({ delete: txDelete, insert: txInsert });
        });

        const limit = vi.fn().mockResolvedValue([]);
        const where = vi.fn().mockReturnValue({ limit, then: (r: (v: unknown) => unknown) => r([]) });
        mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where }) });
        mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

        const { replaceProductsAndRebuildSummary } = await import('../../src/services/ecommerce');
        await replaceProductsAndRebuildSummary('store-1', []);

        // Empty list → still wraps in a transaction (delete must happen) but skips insert.
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(txDelete).toHaveBeenCalledTimes(1);
        expect(txInsert).not.toHaveBeenCalled();
    });
});

// ─── A-1.5 (OPEN): POST /shopify/store/sync rejects empty body with 400 ──
//
// Bug: Fastify's default JSON body parser fails on an empty request body
// when Content-Type: application/json is set. The route doesn't actually
// need a body — syncStore() reads from request.workspaceId only — so this
// is purely a parser strictness issue.
// Returns: 400 "Unexpected end of JSON input"
// UI sends `{}` so users don't hit it; only direct curl callers do.
//
// Fix: register a custom contentTypeParser that treats empty body as `{}`
// for this route, OR change the route to ignore body parsing entirely.

describe('A-1.5 — sync route should accept empty body as {} (OPEN)', () => {
    it.todo('returns 200 when POST /shopify/store/sync is sent with empty body and JSON content-type');
});

// ─── A-1.7 (OPEN): GET /shopify/store response missing isActive ──────────
//
// Bug: mapToEcommerceStore returns `isActive: row.isActive ?? true` so the
// type CONTAINS the field, but during the dogfood session a disconnected
// row's response payload appeared to omit it (extension reported it wasn't
// visible in the JSON). Two possibilities:
//   1. Display truncation in the test report (false alarm) — safe but
//      verifying that the field is in the actual JSON is a cheap regression.
//   2. EcommerceStore type from @jawab24/shared lacks isActive and JSON
//      serialization strips unknown fields somewhere downstream.
//
// Cheap regression: assert mapToEcommerceStore output has isActive.

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

// ─── A-1.9 (OPEN): claimPendingInstall fires registerWebhooks fire-and-forget ─
//
// Bug: services/ecommerce.ts:606 invokes the registerWebhooks callback as
// `.then(...).catch(...)` without awaiting. In long-lived Node backends
// this rarely matters, but ANY process restart, deploy, or short-lived
// runner (CLI scripts, CI, lambda) racing the async HTTP call to Shopify
// kills the registration silently:
//   - Shopify never receives the registration request → no webhooks
//   - DB never gets webhookStatus written → no signal that anything failed
//
// Discovered: the dogfood session's claim script ran claimPendingInstall in
// a CLI process that exited within ~500ms. Shopify ended up with 0
// registered webhooks, and B-3 (incremental update) failed because there
// was no callback URL on Shopify's side. We didn't realize until 30 min later.
//
// Fix: await the registerWebhooks call inside the function. If it fails,
// log + persist a `webhookStatus.failed` marker so a re-registration job
// can retry later.

describe('A-1.9 — claimPendingInstall should await webhook registration (OPEN)', () => {
    it.todo('does not return until registerWebhooks promise resolves or rejects');
    it.todo('persists webhookStatus to platform_data in the same flow as the store creation');
    it.todo('records a failure marker (and logs via captureError) when registration rejects');
});

// ─── B-3.1 (OPEN): products/update webhook does full re-sync, not row update ─
//
// Bug: webhookProductsUpdate enqueues a full sync job (enqueueSyncJob) for
// EVERY product update event from Shopify. The full sync then delete+inserts
// all products for the store, which means every product's internal id
// (ecommerce_products.id) changes on every single edit — even edits to
// other products.
//
// Concrete impact: any future foreign key pointing at ecommerce_products.id
// (e.g. messages.product_id, leads.product_id, abandonedCarts.product_id)
// would silently break on every product edit.
//
// Today there are no such FKs so the bug is dormant, but it's a footgun.
// platform_product_id is the stable external key and should be used for
// any downstream join.
//
// Fix: in webhookProductsUpdate, parse the product payload and do a single
// upsert by (ecommerceStoreId, platformProductId) ON CONFLICT DO UPDATE.
// Periodic full syncs (every 6h) can still delete+insert all.

describe('B-3.1 — products/update webhook should preserve internal product id (OPEN)', () => {
    it.todo('upserts a single product by (storeId, platformProductId) on products/update');
    it.todo('does not delete other products when handling a single-product update');
    it.todo('keeps ecommerce_products.id stable across consecutive update webhooks for the same product');
});

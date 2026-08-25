/**
 * Tier-4 stress suite for the Salla and Zid integrations (real Postgres, real
 * Redis, mocked platform HTTP).
 *
 * ⛔ **This never touches a partner's API.** `docs/SALLA_TEST_PLAN.md` Tier 4 makes
 * that a standing rule: hammering Salla's or Zid's endpoints risks throttling or a
 * flag at exactly the wrong moment, and measures THEIR infrastructure rather than
 * ours. Every scenario below drives our own code at volume with the platform HTTP
 * boundary faked.
 *
 * Scenarios map 1:1 onto the Tier-4 table:
 *   S1 webhook burst      → dedup holds under genuine concurrency
 *   S2 large catalog sync → the cap binds on Salla and Zid; a failed fetch never
 *                           replaces or truncates the stored catalogue
 *   S3 token refresh race → single-use refresh tokens are never spent twice
 *   S4 agent tool latency → independent reads run in parallel, not sequentially
 *
 * Run with `npm run test:stress:local` (never in the deploy gate — see
 * vitest.stress.config.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../integration/setup';
import * as schema from '../../src/db/schema';
import {
    createFixtureStore,
    createStoreWithNotificationTemplates,
    notificationLogRows,
    storeProductRows,
} from '../helpers/ecommerceFixtures';

// BullMQ queue → Redis, an external boundary. The token-refresh LOCK below uses
// real Redis deliberately (it is the thing under test in S3); only the job queue
// is faked, exactly as the integration suite does.
vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { PRODUCT_SAFETY_CAP } from '../../src/services/ecommerce';
import { customerNotificationService } from '../../src/services/customerNotifications';
import { syncProducts as sallaSyncProducts } from '../../src/services/salla';
import { syncProducts as zidSyncProducts } from '../../src/services/zid';
import { getShipmentTracking as sallaGetShipmentTracking } from '../../src/services/salla';
import { redis } from '../../src/lib/redis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
const realFetch = global.fetch;

function jsonOk(body: unknown) {
    return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
}

describe('Tier-4 stress — Salla + Zid (our side only)', () => {
    beforeEach(() => {
        // resetAllMocks, NOT clearAllMocks: `clear` wipes call history but KEEPS
        // mockImplementation, so a previous scenario's fetch behaviour leaks into
        // the next one — which is how a test can pass on a stub it never set.
        vi.resetAllMocks();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        // restoreAllMocks does not undo a global assignment; put fetch back by hand.
        global.fetch = realFetch;
    });

    // =======================================================================
    // S1 — Webhook burst: does dedup hold under genuine concurrency?
    // =======================================================================
    //
    // A real burst is not two deliveries. Salla sends every order event TWICE
    // (signed + unsigned, measured 2026-08-24), platforms retry on any non-2xx,
    // and a status flip can fan out several events at once. The unique index
    // (store, type, platform_event_id) is the only thing standing between that
    // and a customer's phone buzzing repeatedly.

    describe('S1 — webhook burst', () => {
        for (const platform of ['salla', 'zid'] as const) {
            it(`${platform}: 60 concurrent deliveries of ONE event insert exactly one row`, async () => {
                const store = await createStoreWithNotificationTemplates(platform);
                const params = {
                    storeId: store.id,
                    type: 'order_confirmed' as const,
                    customerPhone: '+966501806978',
                    customerName: 'Ahmed',
                    variables: { order_number: '1001' },
                    platformEventId: `${platform}:order_confirmed:1001`,
                    orderNumber: '1001',
                };

                const started = Date.now();
                const results = await Promise.allSettled(
                    Array.from({ length: 60 }, () => customerNotificationService.schedule(params)),
                );
                const elapsed = Date.now() - started;

                const rows = await notificationLogRows(store.id, 'order_confirmed');
                expect(rows).toHaveLength(1);
                // A losing racer must lose QUIETLY — a rejected promise here would
                // become an unhandled rejection in the webhook controller, which
                // answers Salla/Zid with a 500 and earns a redelivery.
                expect(results.every(r => r.status === 'fulfilled')).toBe(true);
                // eslint-disable-next-line no-console
                console.log(`[S1 ${platform}] 60 concurrent → 1 row in ${elapsed}ms`);
            });

            it(`${platform}: 40 distinct orders × 5 duplicates, all at once, insert exactly 40 rows`, async () => {
                const store = await createStoreWithNotificationTemplates(platform);
                const ORDERS = 40;
                const COPIES = 5;

                const calls = [];
                for (let o = 0; o < ORDERS; o++) {
                    for (let c = 0; c < COPIES; c++) {
                        calls.push(customerNotificationService.schedule({
                            storeId: store.id,
                            type: 'order_shipped',
                            customerPhone: `+96650180${String(1000 + o).slice(-4)}`,
                            customerName: `Customer ${o}`,
                            variables: { order_number: String(o) },
                            platformEventId: `${platform}:order_shipped:${o}`,
                            orderNumber: String(o),
                        }));
                    }
                }

                const started = Date.now();
                const results = await Promise.allSettled(calls);
                const elapsed = Date.now() - started;

                const rows = await notificationLogRows(store.id, 'order_shipped');
                expect(rows).toHaveLength(ORDERS);
                expect(results.every(r => r.status === 'fulfilled')).toBe(true);
                // Each order kept its OWN identity — a dedup key collision across
                // orders would silence a real customer, which is worse than a double.
                expect(new Set(rows.map(r => r.orderNumber)).size).toBe(ORDERS);
                // eslint-disable-next-line no-console
                console.log(`[S1 ${platform}] ${ORDERS * COPIES} concurrent → ${rows.length} rows in ${elapsed}ms`);
            });
        }
    });

    // =======================================================================
    // S2 — Large catalog sync: does the safety cap actually bind?
    // =======================================================================
    //
    // The Shopify path is already covered in ecommerce-sync.test.ts. Salla and
    // Zid were not, and they page differently (65/page vs 100/page), so each has
    // its own MAX_PAGES ceiling derived from PRODUCT_SAFETY_CAP. An unbounded
    // pager against a huge catalog is an OOM on the sync worker, which takes
    // every other store's sync down with it.

    describe('S2 — catalog sync at the safety cap', () => {
        it('salla: never writes more than PRODUCT_SAFETY_CAP, however many pages the platform offers', async () => {
            const store = await createFixtureStore('salla');
            const PAGE = 65;
            let served = 0;
            mockFetch.mockImplementation(async () => {
                const items = Array.from({ length: PAGE }, () => {
                    served++;
                    return {
                        id: `p-${served}`,
                        name: `منتج ${served}`,
                        status: 'sale',
                        price: { amount: 100, currency: 'SAR' },
                        quantity: 5,
                        urls: { customer: `https://demo.salla.sa/p${served}` },
                    };
                });
                // `totalPages` far beyond the cap — the CAP must be what stops us.
                return jsonOk({ data: items, pagination: { currentPage: 1, totalPages: 9999, perPage: PAGE, total: 999999 } });
            });

            const result = await sallaSyncProducts(store.id);

            expect(result.synced).toBe(PRODUCT_SAFETY_CAP);
            expect(await storeProductRows(store.id)).toHaveLength(PRODUCT_SAFETY_CAP);
            // Bounded pager: never more pages than the cap needs.
            expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(Math.ceil(PRODUCT_SAFETY_CAP / PAGE) + 1);
            // eslint-disable-next-line no-console
            console.log(`[S2 salla] capped at ${result.synced} after ${mockFetch.mock.calls.length} pages`);
        });

        it('zid: never writes more than PRODUCT_SAFETY_CAP, however many pages the platform offers', async () => {
            const store = await createFixtureStore('zid');
            const PAGE = 100;
            let served = 0;
            mockFetch.mockImplementation(async () => {
                const items = Array.from({ length: PAGE }, () => {
                    served++;
                    return {
                        id: `z-${served}`,
                        name: `منتج ${served}`,
                        status: 'active',
                        price: 100,
                        currency: 'SAR',
                        quantity: 5,
                        slug: `p${served}`,
                    };
                });
                return jsonOk({ results: items });
            });

            const result = await zidSyncProducts(store.id);

            expect(result.synced).toBe(PRODUCT_SAFETY_CAP);
            expect(await storeProductRows(store.id)).toHaveLength(PRODUCT_SAFETY_CAP);
            expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(Math.ceil(PRODUCT_SAFETY_CAP / PAGE) + 1);
            // eslint-disable-next-line no-console
            console.log(`[S2 zid] capped at ${result.synced} after ${mockFetch.mock.calls.length} pages`);
        });

        it('a FETCH failure mid-catalogue leaves the previous catalogue intact', async () => {
            const store = await createFixtureStore('salla');
            const onePage = (items: unknown[], totalPages: number) =>
                jsonOk({ data: items, pagination: { currentPage: 1, totalPages, perPage: 65, total: items.length } });

            // First: a small, healthy catalogue.
            mockFetch.mockImplementation(async () => onePage(
                [{ id: 'p-1', name: 'منتج', status: 'sale', price: { amount: 10, currency: 'SAR' }, quantity: 1 }], 1,
            ));
            await sallaSyncProducts(store.id);
            expect(await storeProductRows(store.id)).toHaveLength(1);

            // Then: a sync that explodes partway through paging.
            let page = 0;
            mockFetch.mockImplementation(async () => {
                page++;
                if (page > 1) throw new Error('upstream died mid-catalogue');
                return onePage(Array.from({ length: 65 }, (_, i) => ({
                    id: `q-${i}`, name: 'x', status: 'sale', price: { amount: 1, currency: 'SAR' }, quantity: 1,
                })), 99);
            });

            await sallaSyncProducts(store.id).catch(() => { /* failure is the scenario */ });

            // The merchant's catalogue is either the old one or a complete new one —
            // never a truncated one the AI would then quote from.
            const rows = await storeProductRows(store.id);
            expect(rows).toHaveLength(1);
            // eslint-disable-next-line no-console
            console.log(`[S2 salla] mid-sync failure left ${rows.length} product(s) — previous catalogue intact`);
        });

        // Found BY this suite: `fetchAllProducts` read `data.pagination.totalPages`
        // with no guard, so a products response missing the envelope died as
        // "Cannot read properties of undefined (reading 'totalPages')" — an error
        // that names neither Salla, nor the store, nor the catalogue.
        //
        // Failing is the RIGHT behaviour and is deliberately preserved: syncProducts
        // REPLACES the catalogue, so treating an unknown page count as "we're done"
        // would silently delete every product past page 1. Only the diagnosis improves.
        it('a products page with no pagination envelope fails with a diagnosable error, and deletes nothing', async () => {
            const store = await createFixtureStore('salla');
            mockFetch.mockImplementation(async () => jsonOk({
                data: [{ id: 'p-1', name: 'منتج', status: 'sale', price: { amount: 10, currency: 'SAR' }, quantity: 1 }],
                pagination: { currentPage: 1, totalPages: 1, perPage: 65, total: 1 },
            }));
            await sallaSyncProducts(store.id);
            expect(await storeProductRows(store.id)).toHaveLength(1);

            mockFetch.mockImplementation(async () => jsonOk({ data: [{ id: 'x', name: 'y', status: 'sale', price: { amount: 1, currency: 'SAR' }, quantity: 1 }] }));

            await expect(sallaSyncProducts(store.id)).rejects.toThrow(/pagination/i);
            // The old catalogue survived the failure.
            expect(await storeProductRows(store.id)).toHaveLength(1);
        });

        // The sibling of the case above, and the more dangerous one: a response
        // with pagination but NO product array. `replaceProductsAndRebuildSummary`
        // treats an empty list as "the merchant deleted everything" and drops every
        // row, so tolerating a missing array (`data.data ?? []`) silently amputates
        // the catalogue — the exact failure the pagination guard exists to prevent.
        // Caught in review after being introduced here; this pins it.
        it('a products page with no product array fails, and does NOT wipe the catalogue', async () => {
            const store = await createFixtureStore('salla');
            mockFetch.mockImplementation(async () => jsonOk({
                data: [{ id: 'p-1', name: 'منتج', status: 'sale', price: { amount: 10, currency: 'SAR' }, quantity: 1 }],
                pagination: { currentPage: 1, totalPages: 1, perPage: 65, total: 1 },
            }));
            await sallaSyncProducts(store.id);
            expect(await storeProductRows(store.id)).toHaveLength(1);

            // Pagination present, `data` absent.
            mockFetch.mockImplementation(async () => jsonOk({ pagination: { currentPage: 1, totalPages: 1, perPage: 65, total: 0 } }));

            await expect(sallaSyncProducts(store.id)).rejects.toThrow(/product array/i);
            expect(await storeProductRows(store.id)).toHaveLength(1);
        });
    });

    // =======================================================================
    // S3 — Token refresh race: is a single-use refresh token ever spent twice?
    // =======================================================================
    //
    // Salla and Zid both issue SINGLE-USE refresh tokens. Two concurrent
    // refreshes means the second call presents an already-spent token, the
    // platform rejects it, and the store is disconnected until the merchant
    // reauthorises by hand. The Redis lock in ecommerceTokenRefresh.ts is the
    // only guard; this measures whether it holds under a real stampede.

    describe('S3 — token refresh race', () => {
        for (const platform of ['salla', 'zid'] as const) {
            it(`${platform}: 25 concurrent callers spend the refresh token exactly ONCE`, async () => {
                const store = await createFixtureStore(platform, { overrides: { tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }, refreshToken: 'refresh_plain' });
                await redis.del(`${platform}:token_refresh:${store.id}`);

                let exchanges = 0;
                mockFetch.mockImplementation(async () => {
                    exchanges++;
                    return jsonOk({
                        access_token: `new_at_${exchanges}`,
                        refresh_token: `new_rt_${exchanges}`,
                        expires_in: 1209600,
                        Authorization: `new_auth_${exchanges}`,
                    });
                });

                const { refreshAccessToken } = await import('../../src/services/ecommerceTokenRefresh');
                const cfg = {
                    platform,
                    tokenEndpointUrl: 'https://example.test/oauth/token',
                    clientId: 'cid',
                    clientSecret: 'secret',
                };

                const outcomes = await Promise.allSettled(
                    Array.from({ length: 25 }, () => refreshAccessToken(store.id, cfg)),
                );

                // EXACTLY one, not "at most one". `<= 1` also passes when the refresh
                // never happened at all, which is how this test first went green while
                // proving nothing (every caller had died on a bad fixture ciphertext).
                // >1 means the store is disconnected in production; 0 means the test lied.
                expect(exchanges).toBe(1);
                // ...and every caller must have SUCCEEDED. Without this, "24 threw
                // before reaching the endpoint and one got through" is indistinguishable
                // from "the lock held" — the same wrong-reason pass in a new disguise.
                expect(outcomes.every(o => o.status === 'fulfilled')).toBe(true);
                // The refresh really landed: the stored expiry moved out of the window.
                const [refreshed] = await testDb.select().from(schema.ecommerceStores)
                    .where(eq(schema.ecommerceStores.id, store.id));
                expect(refreshed.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
                // eslint-disable-next-line no-console
                console.log(`[S3 ${platform}] 25 concurrent refreshes → ${exchanges} token exchange(s)`);
            });
        }

        // Measurement, not an assertion about intended behaviour: the lock LOSER
        // waits LOCK_WAIT_DELAY_MS (2s) and returns without re-checking. If the
        // winner's refresh outlives that wait, the loser proceeds on a token it
        // believes is fresh. This records what actually happens so the number is
        // on the table rather than assumed either way.
        it('records how a slow refresh interacts with the 2s lock wait', async () => {
            const store = await createFixtureStore('salla', { overrides: { tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }, refreshToken: 'refresh_plain' });
            await redis.del(`salla:token_refresh:${store.id}`);

            const SLOW_MS = 3500; // deliberately longer than LOCK_WAIT_DELAY_MS
            let exchanges = 0;
            mockFetch.mockImplementation(async () => {
                exchanges++;
                await new Promise(r => setTimeout(r, SLOW_MS));
                return jsonOk({ access_token: 'slow_at', refresh_token: 'slow_rt', expires_in: 1209600 });
            });

            const { refreshAccessToken } = await import('../../src/services/ecommerceTokenRefresh');
            const cfg = { platform: 'salla' as const, tokenEndpointUrl: 'https://example.test/oauth/token', clientId: 'c', clientSecret: 's' };

            const started = Date.now();
            // Time each caller SEPARATELY. Awaiting them together only reports the
            // slowest (the lock winner), which hides the very thing being measured.
            const returnedAt = await Promise.all(
                Array.from({ length: 3 }, () =>
                    refreshAccessToken(store.id, cfg)
                        .then(() => Date.now() - started, () => Date.now() - started)),
            );

            const [row] = await testDb.select().from(schema.ecommerceStores)
                .where(eq(schema.ecommerceStores.id, store.id));
            const earlyReturners = returnedAt.filter(ms => ms < SLOW_MS).length;

            // The token is still spent exactly once — that is the safety property,
            // and it holds even when the refresh outlives the lock wait.
            expect(exchanges).toBe(1);
            // eslint-disable-next-line no-console
            console.log(
                `[S3 salla] slow refresh (${SLOW_MS}ms > ${'LOCK_WAIT_DELAY_MS'} 2000ms): ${exchanges} exchange(s); ` +
                `per-caller returns ${returnedAt.map(ms => `${ms}ms`).join(', ')}; ` +
                `${earlyReturners}/3 returned BEFORE the refresh completed (they proceed on the OLD token); ` +
                `stored expiry = ${row?.tokenExpiresAt?.toISOString() ?? 'unchanged'}`,
            );
        });
    });

    // =======================================================================
    // S4 — Agent tool latency: independent reads must not be sequential
    // =======================================================================
    //
    // Rule 17: reply speed is the product. `getShipmentTracking` needs the order
    // detail AND the shipment; they do not depend on each other, so a sequential
    // pair silently doubles the customer's wait on every tracking question.

    describe('S4 — agent tool latency', () => {
        it('salla getShipmentTracking issues its two reads in PARALLEL, not one after the other', async () => {
            const store = await createFixtureStore('salla');
            const DELAY_MS = 300;
            const startedAt: number[] = [];

            mockFetch.mockImplementation(async (url: string) => {
                startedAt.push(Date.now());
                await new Promise(r => setTimeout(r, DELAY_MS));
                if (String(url).includes('/shipments')) {
                    return jsonOk({ data: [{ id: 1, tracking_number: 'TRK1', shipping_company: 'Dev Company' }] });
                }
                return jsonOk({
                    data: [{
                        id: 1, reference_id: 4242,
                        status: { slug: 'shipped' },
                        customer: { first_name: 'Ahmed', mobile: '501806978', mobile_code: '+966' },
                    }],
                });
            });

            const t0 = Date.now();
            await sallaGetShipmentTracking(store.id, '4242');
            const elapsed = Date.now() - t0;

            // Three reads: the keyword search, then the order detail + the shipment.
            // Only the LAST TWO can overlap — the search must resolve first because
            // both of them need the order id it returns. That dependency is real, so
            // the pair under test is [1] vs [2], never [0] vs [1].
            expect(startedAt.length).toBe(3);
            const overlap = startedAt[2] - startedAt[1] < DELAY_MS;
            // eslint-disable-next-line no-console
            console.log(
                `[S4 salla] ${startedAt.length} reads, total ${elapsed}ms with a ${DELAY_MS}ms upstream, ` +
                `detail/shipment parallel=${overlap} (floor is 2 sequential hops: search → pair)`,
            );
            expect(overlap).toBe(true);
            // Fully sequential would be ~3×DELAY. Parallelising the pair puts the
            // floor at ~2×DELAY; anything at or above 3× means the Promise.all broke.
            expect(elapsed).toBeLessThan(DELAY_MS * 3);
        });
    });
});

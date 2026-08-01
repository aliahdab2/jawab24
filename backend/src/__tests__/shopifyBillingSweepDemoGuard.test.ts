/**
 * The 6-hourly Shopify billing sweep must never sync a demo-seeded store.
 *
 * Demo rows (plugins/demo/seedData.ts) hold placeholder tokens that are not
 * real ciphertext — decrypt() rejects them — so an unguarded sweep fails on
 * the demo store every pass and raises the aggregated "reconciliation failed
 * for N/M store(s)" Sentry event for a store no merchant owns, drowning the
 * signal the sweep exists to give (JAWAB24-BACKEND-1Q). Every path that talks
 * to a real platform API must skip demo stores via isDemoStore — see
 * services/demoStore.ts for why the filter must stay a JS predicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const { selectMock, captureErrorMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
    captureErrorMock: vi.fn(),
}));

vi.mock('../db', () => ({ db: { select: selectMock } }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: captureErrorMock }));

import { reconcileShopifyBilling } from '../services/shopifyBilling';

/**
 * Queue rows for the sweep's sequential .select().from().where() queries and
 * capture each query's where-condition for inspection.
 */
function queueSelectResults(rowsPerCall: unknown[][]): { whereConditions: SQL[] } {
    const captured = { whereConditions: [] as SQL[] };
    let call = 0;
    selectMock.mockImplementation(() => ({
        from: () => ({
            where: (condition: SQL) => {
                captured.whereConditions.push(condition);
                return Promise.resolve(rowsPerCall[Math.min(call++, rowsPerCall.length - 1)]);
            },
        }),
    }));
    return captured;
}

const DEMO_STORE_ROW = {
    storeDomain: 'demo-electronics.myshopify.com',
    platformData: { planName: 'basic', demo: true },
};

describe('reconcileShopifyBilling — demo-store guard (JAWAB24-BACKEND-1Q)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('skips demo-seeded stores instead of failing on their placeholder tokens', async () => {
        queueSelectResults([
            [DEMO_STORE_ROW], // active shopify stores
            [],               // orphan scan
        ]);

        const result = await reconcileShopifyBilling();

        expect(result).toEqual({ scanned: 0, healed: 0, flagged: 0, orphaned: 0, errors: 0 });
        expect(captureErrorMock).not.toHaveBeenCalled();
    });

    it('keeps the demo domain in the orphan scan so a demo-mirrored subscription is never flagged', async () => {
        // The orphan scan asks "does an active store row exist for this
        // subscription's domain" — a demo store row satisfies that, so demo
        // domains must stay in the NOT IN domain list even though they are
        // never synced.
        const captured = queueSelectResults([
            [DEMO_STORE_ROW],
            [],
        ]);

        await reconcileShopifyBilling();

        expect(captured.whereConditions).toHaveLength(2);
        const orphanParams = new PgDialect().sqlToQuery(captured.whereConditions[1]).params;
        expect(orphanParams).toContain(DEMO_STORE_ROW.storeDomain);
    });
});

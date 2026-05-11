import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscriptionsService } from '../../src/services/subscriptions';
import { db } from '../../src/db';

/**
 * Regression tests for the overlapping-usage-row bug.
 *
 * The bug: when a customer's subscription was renewed/upgraded before their old
 * usage period naturally ended (e.g. admin manual upgrade, mid-period plan
 * change), initializeUsagePeriod inserted a new usage row but left the old row
 * with its periodEnd still in the future. getCurrentUsage's
 * `periodStart <= now <= periodEnd` query (with no ORDER BY) could then return
 * the older maxed-out row instead of the fresh one, leaving the customer
 * permanently blocked despite a successful upgrade.
 *
 * These tests pin the two guarantees that prevent regression:
 *   1. initializeUsagePeriod closes any prior still-open row before inserting.
 *   2. getCurrentUsage orders by periodStart DESC so the newest match wins.
 */

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    subscriptions: {},
    plans: {},
    usage: { userId: 'user_id', periodStart: 'period_start', periodEnd: 'period_end' },
    usageLogs: {},
    pages: {},
    workspaces: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((f, v) => ({ type: 'eq', f, v })),
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn(),
    gte: vi.fn((f, v) => ({ type: 'gte', f, v })),
    lte: vi.fn((f, v) => ({ type: 'lte', f, v })),
    desc: vi.fn((f) => ({ type: 'desc', f })),
    sql: Object.assign(
        vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => ({ type: 'sql', content: strings[0] })),
        {}
    ),
}));

vi.mock('../../src/lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../../src/services/notifications', () => ({ notificationService: {} }));
vi.mock('../../src/services/plans', () => ({ plansService: {} }));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

describe('subscriptionsService — usage period overlap regression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('initializeUsagePeriod', () => {
        const setupExistingRowMock = (existing: Array<Record<string, unknown>>) => {
            const limitMock = vi.fn().mockResolvedValue(existing);
            const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
            const fromMock = vi.fn().mockReturnValue({ where: whereMock });
            vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);
        };

        const setupUpdateMock = () => {
            const updateWhereMock = vi.fn().mockResolvedValue(undefined);
            const setMock = vi.fn().mockReturnValue({ where: updateWhereMock });
            vi.mocked(db.update).mockReturnValue({ set: setMock } as any);
            return { setMock, updateWhereMock };
        };

        const setupInsertMock = () => {
            const valuesMock = vi.fn().mockResolvedValue(undefined);
            vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as any);
            return valuesMock;
        };

        it('closes prior open usage rows before inserting the new period', async () => {
            setupExistingRowMock([]); // no row at the new normalizedStart
            const { setMock, updateWhereMock } = setupUpdateMock();
            const valuesMock = setupInsertMock();

            const periodStart = new Date('2026-05-11T14:30:00Z'); // mid-day upgrade
            const periodEnd = new Date('2026-06-11T14:30:00Z');

            await subscriptionsService.initializeUsagePeriod('user_123', periodStart, periodEnd);

            // It MUST issue an UPDATE that closes the prior row.
            // The set payload aligns the prior row's periodEnd to the new periodStart (UTC midnight).
            expect(setMock).toHaveBeenCalledTimes(1);
            const setPayload = setMock.mock.calls[0][0];
            expect(setPayload.periodEnd).toEqual(new Date('2026-05-11T00:00:00Z'));
            expect(updateWhereMock).toHaveBeenCalledTimes(1);

            // Then it inserts the new row, normalized to UTC midnight.
            expect(valuesMock).toHaveBeenCalledTimes(1);
            const inserted = valuesMock.mock.calls[0][0];
            expect(inserted).toMatchObject({
                userId: 'user_123',
                periodStart: new Date('2026-05-11T00:00:00Z'),
                periodEnd: new Date('2026-06-11T00:00:00Z'),
                aiRepliesCount: 0,
            });
        });

        it('is idempotent on webhook replay — same-period reinit does not insert again', async () => {
            // Existing row at the new normalizedStart (Stripe webhook fired twice)
            setupExistingRowMock([{ id: 'usage_existing', userId: 'user_123' }]);
            setupUpdateMock();
            const valuesMock = setupInsertMock();

            const periodStart = new Date('2026-05-11T00:00:00Z');
            const periodEnd = new Date('2026-06-11T00:00:00Z');

            await subscriptionsService.initializeUsagePeriod('user_123', periodStart, periodEnd);

            // Update still issues (no-op in practice because WHERE doesn't match),
            // but critically: no second INSERT for the same period.
            expect(valuesMock).not.toHaveBeenCalled();
        });
    });

    describe('getCurrentUsage', () => {
        it('orders by periodStart DESC so the newest matching row wins under overlap', async () => {
            const limitMock = vi.fn().mockResolvedValue([]);
            const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
            const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
            const fromMock = vi.fn().mockReturnValue({ where: whereMock });
            vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

            await subscriptionsService.getCurrentUsage('user_123');

            // The ordering is the load-bearing guarantee — without DESC, an old
            // maxed row whose periodEnd hadn't yet been closed could be returned
            // instead of the fresh row.
            expect(orderByMock).toHaveBeenCalledTimes(1);
            const orderArg = orderByMock.mock.calls[0][0];
            expect(orderArg).toEqual(expect.objectContaining({ type: 'desc' }));
            expect(limitMock).toHaveBeenCalledWith(1);
        });
    });
});

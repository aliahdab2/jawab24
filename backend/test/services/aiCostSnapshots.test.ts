import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { openaiAdmin: { apiKey: 'sk-admin-x', prodKeyId: 'key_prod', evalKeyId: 'key_eval' } },
}));

vi.mock('../../src/db', () => ({
    db: { select: vi.fn(), insert: vi.fn() },
}));

vi.mock('../../src/db/schema', () => ({
    aiCostSnapshots: {
        usageDate: 'usage_date', apiKeyId: 'api_key_id', model: 'model',
        lineItem: 'line_item', amountUsd: 'amount_usd',
    },
}));

vi.mock('drizzle-orm', () => ({
    and: vi.fn((...a: unknown[]) => a),
    gte: vi.fn((...a: unknown[]) => a),
    lte: vi.fn((...a: unknown[]) => a),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock('../../src/services/analytics', () => ({
    resolvePeriodRange: vi.fn(() => ({
        rangeStart: new Date('2026-06-01T00:00:00Z'),
        rangeEnd: new Date('2026-07-01T00:00:00Z'),
    })),
    analyticsService: {
        getGlobalAiCostByPipeline: vi.fn(async () => ({ totals: { costUsd: 56.71 } })),
    },
}));

import { db } from '../../src/db';
import { gte, lte } from 'drizzle-orm';
import { getBilling, getReconciliation, upsertSnapshots, apiKeyLabel } from '../../src/services/aiCostSnapshots';

/** Mock the `select().from().where()` chain to resolve the given snapshot rows. */
function mockSnapshotRows(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(db.select).mockReturnValue({ from } as any);
}

describe('aiCostSnapshots', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('apiKeyLabel maps known prod/eval ids and falls back to other', () => {
        expect(apiKeyLabel('key_prod')).toBe('production');
        expect(apiKeyLabel('key_eval')).toBe('eval_dev');
        expect(apiKeyLabel('key_other')).toBe('other');
        expect(apiKeyLabel('')).toBe('other');
    });

    it('getBilling rolls up by month, model, and api key with labels', async () => {
        mockSnapshotRows([
            { usageDate: '2026-06-10', apiKeyId: 'key_prod', model: 'gpt-4.1-mini', amountUsd: '40.00' },
            { usageDate: '2026-06-20', apiKeyId: 'key_prod', model: 'gpt-4.1-mini', amountUsd: '16.35' },
            { usageDate: '2026-06-15', apiKeyId: 'key_eval', model: 'gpt-4o-mini', amountUsd: '29.24' },
        ]);

        const r = await getBilling('30d');

        expect(r.totalUsd).toBeCloseTo(85.59, 2);
        expect(r.byMonth).toEqual([{ month: '2026-06', costUsd: 85.59 }]);
        expect(r.byModel).toEqual([
            { model: 'gpt-4.1-mini', costUsd: 56.35 },
            { model: 'gpt-4o-mini', costUsd: 29.24 },
        ]);
        expect(r.byApiKey).toEqual([
            { apiKeyId: 'key_prod', label: 'production', costUsd: 56.35 },
            { apiKeyId: 'key_eval', label: 'eval_dev', costUsd: 29.24 },
        ]);
        expect(r.empty).toBe(false);

        // Boundary: rangeEnd 2026-07-01T00:00Z is exclusive → inclusive last day is
        // 2026-06-30 (the day of rangeEnd − 1ms). Guards the today-inclusion fix.
        expect(vi.mocked(gte)).toHaveBeenCalledWith('usage_date', '2026-06-01');
        expect(vi.mocked(lte)).toHaveBeenCalledWith('usage_date', '2026-06-30');
    });

    it('getBilling reports empty when there are no snapshot rows', async () => {
        mockSnapshotRows([]);
        const r = await getBilling('7d');
        expect(r.empty).toBe(true);
        expect(r.totalUsd).toBe(0);
        expect(r.byApiKey).toEqual([]);
    });

    it('getReconciliation compares prod-key vs our estimate like-for-like, org total separate', async () => {
        mockSnapshotRows([
            { usageDate: '2026-06-10', apiKeyId: 'key_prod', model: 'gpt-4.1-mini', amountUsd: '56.35' },
            { usageDate: '2026-06-15', apiKeyId: 'key_eval', model: 'gpt-4o-mini', amountUsd: '29.24' },
        ]);

        const r = await getReconciliation('30d');

        expect(r.openaiProdUsd).toBeCloseTo(56.35, 2);   // prod key only
        expect(r.ourEstimateUsd).toBeCloseTo(56.71, 2);  // ai_usage_log (mocked)
        expect(r.deltaUsd).toBeCloseTo(-0.36, 2);
        expect(r.deltaPct).toBeCloseTo(-0.6, 1);
        expect(r.openaiOrgUsd).toBeCloseTo(85.59, 2);    // incl. eval/dev, reported separately
        expect(r.prodKeyUnknown).toBe(false);
    });

    it('upsertSnapshots no-ops on empty input', async () => {
        const n = await upsertSnapshots([]);
        expect(n).toBe(0);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('upsertSnapshots inserts with an idempotent onConflictDoUpdate', async () => {
        const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
        vi.mocked(db.insert).mockReturnValue({ values } as any);

        const n = await upsertSnapshots([
            { usageDate: '2026-06-10', apiKeyId: 'key_prod', model: 'gpt-4.1-mini', lineItem: 'gpt-4.1-mini, input', amountUsd: 40 },
        ]);

        expect(n).toBe(1);
        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({ usageDate: '2026-06-10', apiKeyId: 'key_prod', amountUsd: '40.000000', source: 'openai_costs' }),
        ]);
        expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });
});

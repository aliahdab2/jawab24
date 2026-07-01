import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: {
        adminEmails: ['admin@example.com'],
        aiCostMonitoring: {
            enabled: true,
            warnRunwayDays: 7,
            criticalRunwayDays: 3,
            warnRemainingUsd: 30,
            creditLowAlertCooldownSeconds: 86400,
            rollingRateDays: 7,
            spendSpikeMultiplier: 3,
            spendSpikeMinDailyUsd: 5,
            spendSpikeBaselineDays: 7,
            spendSpikeAlertCooldownSeconds: 86400,
        },
    },
}));

vi.mock('../../src/db', () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock('../../src/db/schema', () => ({
    aiCreditBalance: { balanceUsd: 'balance_usd', anchoredAt: 'anchored_at', note: 'note', updatedAt: 'updated_at' },
    aiCostSnapshots: { amountUsd: 'amount_usd', usageDate: 'usage_date' },
}));
vi.mock('drizzle-orm', () => ({
    and: vi.fn((...a: unknown[]) => a), gte: vi.fn((...a: unknown[]) => a),
    lt: vi.fn((...a: unknown[]) => a), eq: vi.fn((...a: unknown[]) => a),
    desc: vi.fn((x: unknown) => x), sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));
vi.mock('../../src/lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../src/services/email', () => ({ emailService: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

import { db } from '../../src/db';
import { redis } from '../../src/lib/redis';
import { emailService } from '../../src/services/email';
import * as Sentry from '@sentry/node';
import { computeRunway, evaluateAndAlert, detectSpendSpike, evaluateSpendSpikeAndAlert } from '../../src/services/aiCostMonitor';

const NOW = new Date('2026-06-29T00:00:00Z');

/** A select-chain whose terminal (.limit / .where) resolves to `result`. */
function selectOnce(result: unknown) {
    const terminal = Promise.resolve(result);
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => terminal;
    chain.where = () => terminal;
    return chain;
}

/** Queue the db.select results in call order: [anchor], [rollingSum], [anchorSum]. */
function queueSelects(...results: unknown[]) {
    const m = vi.mocked(db.select);
    m.mockReset();
    for (const r of results) m.mockReturnValueOnce(selectOnce(r) as any);
}

describe('aiCostMonitor.computeRunway', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redis.get).mockResolvedValue(null); // not parking by default
    });

    it('reports not-configured when no balance anchor is set', async () => {
        queueSelects([] /* no anchor */, [{ total: '14' }] /* rolling */);
        const r = await computeRunway(NOW);
        expect(r.configured).toBe(false);
        expect(r.remainingUsd).toBeNull();
        expect(r.severity).toBe('ok');
        expect(r.rollingDailyRateUsd).toBeCloseTo(2, 2); // 14 / 7 days
    });

    it('computes healthy runway from the org total (all keys), severity ok', async () => {
        // anchor $100 as of 2026-06-01; rolling 7d org spend $7 → $1/day; org spend since anchor $20 → remaining $80 → 80 days
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '7' }],
            [{ total: '20' }],
        );
        const r = await computeRunway(NOW);
        expect(r.configured).toBe(true);
        expect(r.orgSpentSinceAnchorUsd).toBeCloseTo(20, 2);
        expect(r.remainingUsd).toBeCloseTo(80, 2);
        expect(r.rollingDailyRateUsd).toBeCloseTo(1, 2);
        expect(r.runwayDays).toBeCloseTo(80, 1);
        expect(r.severity).toBe('ok');
    });

    it('flags CRITICAL when runway is below the critical threshold', async () => {
        // balance $100, spent $95 → remaining $5; rolling 7d $14 → $2/day → 2.5 days < 3
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '14' }],
            [{ total: '95' }],
        );
        const r = await computeRunway(NOW);
        expect(r.remainingUsd).toBeCloseTo(5, 2);
        expect(r.runwayDays).toBeCloseTo(2.5, 1);
        expect(r.severity).toBe('critical');
    });

    it('flags WARNING when runway is below the warn (but not critical) threshold', async () => {
        // remaining $50, $10/day → 5 days: <7 (warn) but >=3 (not critical)
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '70' }],   // 70/7 = $10/day
            [{ total: '50' }],   // remaining 50
        );
        const r = await computeRunway(NOW);
        expect(r.runwayDays).toBeCloseTo(5, 1);
        expect(r.severity).toBe('warning');
    });

    it('is CRITICAL whenever the system is currently parking, regardless of runway', async () => {
        vi.mocked(redis.get).mockResolvedValue('1'); // insufficient_quota alert active
        queueSelects(
            [{ balanceUsd: '100000.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '7' }],
            [{ total: '1' }],
        );
        const r = await computeRunway(NOW);
        expect(r.currentlyParking).toBe(true);
        expect(r.severity).toBe('critical');
    });
});

describe('aiCostMonitor.evaluateAndAlert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redis.get).mockResolvedValue(null);
    });

    it('does NOT alert when severity is ok', async () => {
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '7' }],
            [{ total: '20' }],
        );
        await evaluateAndAlert(NOW);
        expect(emailService.send).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('alerts (email + Sentry) when warning/critical and the dedup slot is free', async () => {
        vi.mocked(redis.set).mockResolvedValue('OK'); // SET NX acquired
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '14' }],
            [{ total: '95' }], // remaining 5 → critical
        );
        await evaluateAndAlert(NOW);
        expect(redis.set).toHaveBeenCalledWith('alert:openai_credit_low', '1', 'EX', 86400, 'NX');
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(emailService.send).toHaveBeenCalledTimes(1);
    });

    it('suppresses the alert when the dedup slot is already taken', async () => {
        vi.mocked(redis.set).mockResolvedValue(null); // SET NX not acquired
        queueSelects(
            [{ balanceUsd: '100.00', anchoredAt: '2026-06-01', note: null }],
            [{ total: '14' }],
            [{ total: '95' }],
        );
        await evaluateAndAlert(NOW);
        expect(emailService.send).not.toHaveBeenCalled();
    });
});

describe('aiCostMonitor.detectSpendSpike', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    // detectSpendSpike issues 2 selects: [yesterday total], [baseline-window total].

    it('flags a spike when the latest day far exceeds the baseline', async () => {
        queueSelects([{ total: '40' }], [{ total: '70' }]); // day $40 vs baseline 70/7 = $10/day → 4×
        const r = await detectSpendSpike(NOW);
        expect(r.dayUsd).toBeCloseTo(40, 2);
        expect(r.baselineDailyUsd).toBeCloseTo(10, 2);
        expect(r.ratio).toBeCloseTo(4, 1);
        expect(r.spike).toBe(true);
    });

    it('does NOT flag when the day is within the multiplier of the baseline', async () => {
        queueSelects([{ total: '20' }], [{ total: '70' }]); // $20 vs $10/day = 2× (< 3×)
        const r = await detectSpendSpike(NOW);
        expect(r.spike).toBe(false);
    });

    it('does NOT flag below the min-daily floor even at a high ratio', async () => {
        queueSelects([{ total: '4' }], [{ total: '3.5' }]); // $4 vs $0.5/day = 8× but < $5 floor
        const r = await detectSpendSpike(NOW);
        expect(r.spike).toBe(false);
    });

    it('does NOT flag on ramp-up (zero baseline)', async () => {
        queueSelects([{ total: '50' }], [{ total: '0' }]); // baseline 0 → not a spike
        const r = await detectSpendSpike(NOW);
        expect(r.ratio).toBeNull();
        expect(r.spike).toBe(false);
    });
});

describe('aiCostMonitor.evaluateSpendSpikeAndAlert', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('alerts (email + Sentry, own dedup key) on a spike when the slot is free', async () => {
        vi.mocked(redis.set).mockResolvedValue('OK');
        queueSelects([{ total: '40' }], [{ total: '70' }]);
        await evaluateSpendSpikeAndAlert(NOW);
        expect(redis.set).toHaveBeenCalledWith('alert:openai_spend_spike', '1', 'EX', 86400, 'NX');
        expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        expect(emailService.send).toHaveBeenCalledTimes(1);
    });

    it('does NOT alert when there is no spike', async () => {
        queueSelects([{ total: '20' }], [{ total: '70' }]);
        await evaluateSpendSpikeAndAlert(NOW);
        expect(emailService.send).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
});

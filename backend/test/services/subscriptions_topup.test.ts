import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscriptionsService, QuotaExhaustedError } from '../../src/services/subscriptions';

// ---- Module mocks (one factory call per import, kept lean) ----

vi.mock('../../src/services/plans', () => ({
    plansService: {
        getPlanById: vi.fn(),
        getDefaultPlan: vi.fn(),
        mapToPlan: vi.fn((row) => row),
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

// Schema mocks carry a `_tableName` marker so the transaction stub can record
// WHICH table each tx.update() call targeted — needed for tests that assert
// "decremented top-up, not plan counter".
vi.mock('../../src/db/schema', () => ({
    subscriptions: { _tableName: 'subscriptions', userId: 'user_id', planId: 'plan_id', status: 'status', createdAt: 'created_at' },
    plans: { _tableName: 'plans', id: 'id' },
    usage: { _tableName: 'usage', userId: 'user_id', periodStart: 'period_start', periodEnd: 'period_end', aiRepliesCount: 'ai_replies_count' },
    usageLogs: { _tableName: 'usage_logs' },
    pages: { _tableName: 'pages', userId: 'user_id', id: 'id' },
    workspaces: { _tableName: 'workspaces', id: 'id', ownerId: 'owner_id' },
    users: { _tableName: 'users', id: 'id', topupBalance: 'topup_balance' },
    topupPurchases: {
        _tableName: 'topup_purchases',
        userId: 'user_id',
        status: 'status',
        repliesAdded: 'replies_added',
        source: 'source',
        stripePaymentIntentId: 'stripe_payment_intent_id',
        externalRef: 'external_ref',
    },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));

vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    or: vi.fn((...args) => ({ op: 'or', args })),
    gte: vi.fn((field, value) => ({ field, value, op: 'gte' })),
    lte: vi.fn((field, value) => ({ field, value, op: 'lte' })),
    desc: vi.fn((field) => ({ field, direction: 'desc' })),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

// ---- Test helpers ----

interface SubscriptionShape {
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused';
    aiLimit: number | null;
    periodEnd?: Date;
    trialEndsAt?: Date | null;
    cancelAtPeriodEnd?: boolean;
}

function makeSubRow(s: SubscriptionShape) {
    return {
        subscription: {
            id: 'sub_1',
            userId: 'user_1',
            planId: 'plan_1',
            status: s.status,
            trialEndsAt: s.trialEndsAt ?? null,
            currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
            currentPeriodEnd: s.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? false,
            canceledAt: s.status === 'canceled' ? new Date() : null,
            cancelReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
        plan: {
            id: 'plan_1',
            name: 'Test',
            slug: 'test',
            price: 1000,
            maxPages: 5,
            maxAiRepliesPerMonth: s.aiLimit,
            trialDays: 0,
            facebookEnabled: true,
            instagramEnabled: true,
            whatsappEnabled: false,
            prioritySupport: false,
        },
    };
}

/**
 * Build a chainable mock that resolves to `result` no matter what chain shape
 * the service uses (.from().where().limit(), .innerJoin()...orderBy().limit(),
 * or bare .from().where() awaited directly).
 *
 * Implemented as a Proxy over a real Promise so await/then/catch/finally work
 * natively; every other property access returns a function returning the same
 * chain — so intermediate calls compose without losing thenability.
 */
function chainableResolve<T>(result: T) {
    const promise = Promise.resolve(result);
    return new Proxy(promise, {
        get(target, prop) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                const fn = (target as unknown as Record<PropertyKey, unknown>)[prop] as (...args: unknown[]) => unknown;
                return fn.bind(target);
            }
            // Any other prop (from, where, innerJoin, orderBy, limit, ...) → chain.
            return (..._args: unknown[]) => chainableResolve(result);
        },
    }) as unknown as Promise<T> & Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Mock db.select to return a different result per call (in order).
 * Each entry is the rows that the awaited chain will resolve to.
 */
function mockSelectSequence(db: { select: ReturnType<typeof vi.fn> }, responses: unknown[][]) {
    let i = 0;
    db.select.mockImplementation(() => {
        const response = responses[i++] ?? [];
        return chainableResolve(response);
    });
}

// ---- Tests ----

describe('Top-up gate: canUseAiReplies', () => {
    let db: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    it('no subscription + topup balance > 0 → allowed with usingTopup', async () => {
        mockSelectSequence(db, [
            [],                                  // getUserSubscription → no row
            [{ topupBalance: 500 }],             // getTopupBalance
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBe(true);
        expect(result.topupBalance).toBe(500);
    });

    it('no subscription + zero topup balance → denied (no active sub)', async () => {
        mockSelectSequence(db, [
            [],                                  // getUserSubscription → no row
            [{ topupBalance: 0 }],               // getTopupBalance
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('No active subscription');
    });

    it('active subscription + plan room available → allowed via plan (no usingTopup)', async () => {
        mockSelectSequence(db, [
            [makeSubRow({ status: 'active', aiLimit: 10000 })],
            [{ aiRepliesCount: 100, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBeUndefined();
        expect(result.limit).toBe(10000);
        expect(result.used).toBe(100);
        expect(result.remaining).toBe(9900);
    });

    it('active + unlimited plan → allowed without any topup check', async () => {
        mockSelectSequence(db, [
            [makeSubRow({ status: 'active', aiLimit: null })],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBeUndefined();
    });

    it('active + exhausted quota + topup balance → allowed via topup', async () => {
        mockSelectSequence(db, [
            [makeSubRow({ status: 'active', aiLimit: 10000 })],
            [{ aiRepliesCount: 10000, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            [{ topupBalance: 3000 }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBe(true);
        expect(result.topupBalance).toBe(3000);
    });

    it('active + exhausted quota + zero topup → denied with ai_limit_reached', async () => {
        const periodEnd = new Date(Date.now() + 5 * 86400000);
        mockSelectSequence(db, [
            [makeSubRow({ status: 'active', aiLimit: 10000 })],
            [{ aiRepliesCount: 10000, periodStart: new Date(), periodEnd }],
            [{ topupBalance: 0 }],
            // canUseAiReplies re-queries currentUsage on the denial path
            [{ aiRepliesCount: 10000, periodStart: new Date(), periodEnd }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(false);
        expect(result.code).toBe('ai_limit_reached');
        expect(result.used).toBe(10000);
        expect(result.remaining).toBe(0);
        expect(result.resetsAt).toBe(periodEnd.toISOString());
    });

    it('canceled subscription + topup balance → allowed via topup (balance survives cancellation)', async () => {
        mockSelectSequence(db, [
            [makeSubRow({ status: 'canceled', aiLimit: 10000 })],
            [{ topupBalance: 2000 }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBe(true);
        expect(result.topupBalance).toBe(2000);
    });

    it('canceled subscription + zero topup → denied with canceled reason', async () => {
        mockSelectSequence(db, [
            [makeSubRow({ status: 'canceled', aiLimit: 10000 })],
            [{ topupBalance: 0 }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('canceled');
    });

    it('past_due beyond grace + topup balance → allowed via topup', async () => {
        // Period ended 10 days ago — past the 3-day grace window.
        const periodEnd = new Date(Date.now() - 10 * 86400000);
        mockSelectSequence(db, [
            [makeSubRow({ status: 'past_due', aiLimit: 10000, periodEnd })],
            [{ topupBalance: 1500 }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(true);
        expect(result.usingTopup).toBe(true);
        expect(result.topupBalance).toBe(1500);
    });

    it('past_due beyond grace + zero topup → denied with status reason', async () => {
        const periodEnd = new Date(Date.now() - 10 * 86400000);
        mockSelectSequence(db, [
            [makeSubRow({ status: 'past_due', aiLimit: 10000, periodEnd })],
            [{ topupBalance: 0 }],
        ]);

        const result = await subscriptionsService.canUseAiReplies('user_1');

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('expired');
        // Status block takes priority over quota: the denial is a billing problem,
        // not a quota problem, so it carries subscription_inactive — never ai_limit_reached.
        expect(result.code).toBe('subscription_inactive');
    });
});

describe('Top-up consumption: incrementAiReplies', () => {
    let db: {
        select: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        insert: ReturnType<typeof vi.fn>;
        transaction: ReturnType<typeof vi.fn>;
    };
    interface TxCall {
        table: string;
        set: unknown;
    }
    let txCalls: TxCall[] = [];

    /**
     * Install a transaction stub. `usersGuardMatches=true` (default) makes the
     * `WHERE topup_balance >= overflow` guard succeed (row returned); pass
     * `false` to simulate a concurrent race that depletes the balance, which
     * makes incrementAiReplies throw QuotaExhaustedError.
     */
    function installTxStub(opts: { usersGuardMatches?: boolean } = {}) {
        const usersGuardMatches = opts.usersGuardMatches ?? true;
        const tx = {
            update: vi.fn((table: { _tableName?: string }) => {
                const tableName = table?._tableName ?? 'unknown';
                return {
                    set: vi.fn((setArgs: unknown) => ({
                        where: vi.fn(() => ({
                            returning: vi.fn().mockImplementation(() => {
                                txCalls.push({ table: tableName, set: setArgs });
                                if (tableName === 'users') {
                                    return Promise.resolve(usersGuardMatches ? [{ id: 'user_1' }] : []);
                                }
                                // usage table update returns the row for threshold notifications.
                                return Promise.resolve([{ aiRepliesCount: 5, periodStart: new Date() }]);
                            }),
                        })),
                    })),
                };
            }),
        };
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
        txCalls = [];
        installTxStub();
        // insert() is used by logUsageEvent
        db.insert.mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('count=0 → no-op (no transaction)', async () => {
        await subscriptionsService.incrementAiReplies('user_1', 0);
        expect(db.transaction).not.toHaveBeenCalled();
    });

    it('active + unlimited plan → entire count goes to plan, users table untouched', async () => {
        mockSelectSequence(db, [
            [{ aiRepliesCount: 50, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            [makeSubRow({ status: 'active', aiLimit: null })],
        ]);

        await subscriptionsService.incrementAiReplies('user_1', 5);

        // Only the usage table should be updated for an unlimited active plan.
        const tables = txCalls.map((c) => c.table);
        expect(tables).toContain('usage');
        expect(tables).not.toContain('users');
    });

    it('active + plan has room → consumes plan only (no top-up touch)', async () => {
        mockSelectSequence(db, [
            // existence check
            [{ aiRepliesCount: 100, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            // getUserSubscription
            [makeSubRow({ status: 'active', aiLimit: 10000 })],
            // recompute currentCount for room
            [{ aiRepliesCount: 100, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
        ]);

        await subscriptionsService.incrementAiReplies('user_1', 5);

        const tables = txCalls.map((c) => c.table);
        expect(tables).toEqual(['usage']);
    });

    /**
     * Regression for the renewal-vs-cancellation bug:
     * a canceled subscription still references its previous plan
     * (e.g. Pro/10k), but the merchant is no longer entitled to that quota.
     * The writer must agree with the gate that plan room = 0, otherwise the
     * merchant would burn a ghost plan counter each new usage period and the
     * top-up balance would never decrement.
     */
    it('canceled subscription + top-up balance → debits top-up, not plan counter', async () => {
        mockSelectSequence(db, [
            // existence check
            [{ aiRepliesCount: 0, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            // getUserSubscription returns a CANCELED sub still pointing at Pro
            [makeSubRow({ status: 'canceled', aiLimit: 10000 })],
        ]);

        await subscriptionsService.incrementAiReplies('user_1', 5);

        // Top-up must be the ONLY thing touched. If 'usage' shows up here,
        // the merchant got 5 free replies they didn't pay for.
        const tables = txCalls.map((c) => c.table);
        expect(tables).toEqual(['users']);
    });

    it('past_due beyond grace + top-up balance → debits top-up, not plan counter', async () => {
        const periodEnd = new Date(Date.now() - 10 * 86400000); // 10 days past grace
        mockSelectSequence(db, [
            [{ aiRepliesCount: 0, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            [makeSubRow({ status: 'past_due', aiLimit: 10000, periodEnd })],
        ]);

        await subscriptionsService.incrementAiReplies('user_1', 3);

        const tables = txCalls.map((c) => c.table);
        expect(tables).toEqual(['users']);
    });

    it('no subscription → debits top-up only', async () => {
        mockSelectSequence(db, [
            [{ aiRepliesCount: 0, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            [], // no subscription row
        ]);

        await subscriptionsService.incrementAiReplies('user_1', 2);

        const tables = txCalls.map((c) => c.table);
        expect(tables).toEqual(['users']);
    });

    it('top-up WHERE guard fails → throws QuotaExhaustedError', async () => {
        // Reinstall stub so the users.update returns [] (guard miss).
        installTxStub({ usersGuardMatches: false });
        mockSelectSequence(db, [
            [{ aiRepliesCount: 0, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000) }],
            [makeSubRow({ status: 'canceled', aiLimit: 10000 })],
        ]);

        await expect(
            subscriptionsService.incrementAiReplies('user_1', 5)
        ).rejects.toThrow(QuotaExhaustedError);
    });

    it('QuotaExhaustedError class is exported and identifiable', () => {
        const err = new QuotaExhaustedError();
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('QuotaExhaustedError');
    });
});

describe('Top-up summary aggregation: getTopupBalance / getTopupSummary', () => {
    let db: { select: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    it('getTopupBalance returns 0 when user row missing', async () => {
        mockSelectSequence(db, [[]]);
        const balance = await subscriptionsService.getTopupBalance('ghost_user');
        expect(balance).toBe(0);
    });

    it('getTopupBalance returns current balance for existing user', async () => {
        mockSelectSequence(db, [[{ topupBalance: 7500 }]]);
        const balance = await subscriptionsService.getTopupBalance('user_1');
        expect(balance).toBe(7500);
    });

    it('getTopupSummary aggregates balance + lifetime purchased', async () => {
        mockSelectSequence(db, [
            [{ topupBalance: 3000 }],
            [{ total: 15000 }], // 5k + 10k succeeded purchases
        ]);

        const summary = await subscriptionsService.getTopupSummary('user_1');

        expect(summary.balance).toBe(3000);
        expect(summary.lifetimePurchased).toBe(15000);
    });
});

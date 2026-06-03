import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    topupService,
    UnknownTopupPackError,
    TopupUserNotFoundError,
    DuplicateTopupError,
} from '../../src/services/topup';

vi.mock('../../src/db', () => ({
    db: {
        transaction: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    topupPurchases: {
        userId: 'user_id',
        stripePaymentIntentId: 'stripe_payment_intent_id',
        status: 'status',
    },
    users: {
        id: 'id',
        topupBalance: 'topup_balance',
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        topup: {
            packs: {
                '5k': { repliesAdded: 5000, priceCents: 4900 },
                '10k': { repliesAdded: 10000, priceCents: 7900 },
            },
            currency: 'usd',
            whatsappNumber: '966500000000',
        },
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...conds) => ({ conds, op: 'and' })),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

/**
 * Build a stub `tx` object that records every call and lets each test seed
 * what the queries should return. The shape matches what creditTopup uses:
 *   tx.select(cols).from(table).where(cond).limit(n) → resolves
 *   tx.insert(table).values(v).returning(cols) → resolves
 *   tx.update(table).set(v).where(cond).returning(cols) → resolves
 */
function buildTx(opts: {
    userLookup?: unknown[];
    duplicateLookup?: unknown[];
    insertedPurchase?: unknown[];
    updatedBalance?: unknown[];
}) {
    let selectCallIdx = 0;

    return {
        select: vi.fn(() => {
            const idx = selectCallIdx++;
            return {
                from: vi.fn(() => ({
                    where: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue(
                            idx === 0 ? (opts.userLookup ?? []) : (opts.duplicateLookup ?? [])
                        ),
                    })),
                })),
            };
        }),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue(opts.insertedPurchase ?? [{ id: 'purchase_1' }]),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => ({
                    returning: vi.fn().mockResolvedValue(opts.updatedBalance ?? [{ topupBalance: 0 }]),
                })),
            })),
        })),
    };
}

describe('topupService.creditTopup', () => {
    let db: { transaction: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    it('rejects unknown pack with UnknownTopupPackError', async () => {
        await expect(
            topupService.creditTopup({
                userId: 'user_1',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                pack: 'bogus' as any,
                source: 'manual',
            })
        ).rejects.toThrow(UnknownTopupPackError);

        // Transaction must not start when the pack is invalid.
        expect(db.transaction).not.toHaveBeenCalled();
    });

    it('rejects source=stripe without paymentIntentId', async () => {
        await expect(
            topupService.creditTopup({
                userId: 'user_1',
                pack: '10k',
                source: 'stripe',
            })
        ).rejects.toThrow(/stripePaymentIntentId is required/);

        expect(db.transaction).not.toHaveBeenCalled();
    });

    it('throws TopupUserNotFoundError when user row missing', async () => {
        const tx = buildTx({ userLookup: [] });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        await expect(
            topupService.creditTopup({ userId: 'ghost', pack: '5k', source: 'manual' })
        ).rejects.toThrow(TopupUserNotFoundError);

        // User lookup happened, but no insert or update should have been issued.
        expect(tx.insert).not.toHaveBeenCalled();
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('credits 5k pack successfully (manual source)', async () => {
        const tx = buildTx({
            userLookup: [{ id: 'user_1' }],
            insertedPurchase: [{ id: 'purchase_1' }],
            updatedBalance: [{ topupBalance: 5000 }],
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.creditTopup({
            userId: 'user_1',
            pack: '5k',
            source: 'manual',
            externalRef: 'BANK-TX-001',
        });

        expect(result).toEqual({
            purchaseId: 'purchase_1',
            repliesAdded: 5000,
            newBalance: 5000,
        });
        expect(tx.insert).toHaveBeenCalledTimes(1);
        expect(tx.update).toHaveBeenCalledTimes(1);
    });

    it('credits 10k pack successfully (manual source)', async () => {
        const tx = buildTx({
            userLookup: [{ id: 'user_1' }],
            insertedPurchase: [{ id: 'purchase_2' }],
            updatedBalance: [{ topupBalance: 13000 }], // prior balance 3000 + 10000
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.creditTopup({
            userId: 'user_1',
            pack: '10k',
            source: 'manual',
        });

        expect(result.repliesAdded).toBe(10000);
        expect(result.newBalance).toBe(13000);
    });

    it('throws DuplicateTopupError on PaymentIntent replay (Stripe idempotency)', async () => {
        const tx = buildTx({
            userLookup: [{ id: 'user_1' }],
            duplicateLookup: [{ id: 'existing_purchase' }], // duplicate found
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        await expect(
            topupService.creditTopup({
                userId: 'user_1',
                pack: '10k',
                source: 'stripe',
                stripePaymentIntentId: 'pi_already_processed',
            })
        ).rejects.toThrow(DuplicateTopupError);

        // No insert/update should have run — duplicate aborts the transaction.
        expect(tx.insert).not.toHaveBeenCalled();
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('credits Stripe pack with PaymentIntent ID stored', async () => {
        const tx = buildTx({
            userLookup: [{ id: 'user_1' }],
            duplicateLookup: [], // no existing purchase
            insertedPurchase: [{ id: 'purchase_3' }],
            updatedBalance: [{ topupBalance: 10000 }],
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.creditTopup({
            userId: 'user_1',
            pack: '10k',
            source: 'stripe',
            stripePaymentIntentId: 'pi_test_123',
        });

        expect(result.repliesAdded).toBe(10000);
        expect(result.newBalance).toBe(10000);
        expect(tx.insert).toHaveBeenCalledTimes(1);
    });
});

describe('topupService.createPendingStripeTopup', () => {
    let db: { insert: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    it('rejects unknown pack without inserting', async () => {
        await expect(
            topupService.createPendingStripeTopup({
                userId: 'user_1',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                pack: 'bogus' as any,
                stripePaymentIntentId: 'pi_1',
            })
        ).rejects.toThrow(UnknownTopupPackError);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts a pending stripe row and dedupes on payment intent id', async () => {
        const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
        const values = vi.fn(() => ({ onConflictDoNothing }));
        db.insert.mockReturnValue({ values });

        await topupService.createPendingStripeTopup({
            userId: 'user_1',
            pack: '5k',
            stripePaymentIntentId: 'pi_pending_1',
        });

        expect(db.insert).toHaveBeenCalledTimes(1);
        const inserted = values.mock.calls[0][0];
        expect(inserted).toMatchObject({
            userId: 'user_1',
            pack: '5k',
            repliesAdded: 5000,
            priceCents: 4900,
            source: 'stripe',
            status: 'pending',
            stripePaymentIntentId: 'pi_pending_1',
        });
        // Idempotency: webhook/double-click replays must no-op, not 500.
        expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    });
});

describe('topupService.settleStripeTopup', () => {
    let db: { transaction: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    function buildSettleTx(opts: {
        settledRow?: { userId: string; repliesAdded: number };
        existingStatus?: string;
        newBalance?: number;
    }) {
        let updateIdx = 0;
        return {
            update: vi.fn(() => {
                const idx = updateIdx++;
                return {
                    set: vi.fn(() => ({
                        where: vi.fn(() => ({
                            returning: vi.fn().mockResolvedValue(
                                idx === 0
                                    ? (opts.settledRow ? [opts.settledRow] : [])
                                    : [{ topupBalance: opts.newBalance ?? 0 }]
                            ),
                        })),
                    })),
                };
            }),
            select: vi.fn(() => ({
                from: vi.fn(() => ({
                    where: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue(
                            opts.existingStatus ? [{ status: opts.existingStatus }] : []
                        ),
                    })),
                })),
            })),
        };
    }

    it('flips the pending row to succeeded and credits the balance', async () => {
        const tx = buildSettleTx({
            settledRow: { userId: 'user_1', repliesAdded: 5000 },
            newBalance: 5000,
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.settleStripeTopup('pi_succeeded_1');

        expect(result).toEqual({
            credited: true,
            alreadySettled: false,
            userId: 'user_1',
            repliesAdded: 5000,
            newBalance: 5000,
        });
        // Two updates: the conditional status flip + the balance increment.
        expect(tx.update).toHaveBeenCalledTimes(2);
        // No disambiguation select needed when the conditional update matched.
        expect(tx.select).not.toHaveBeenCalled();
    });

    it('treats a webhook replay (already succeeded) as a no-op, not a re-credit', async () => {
        const tx = buildSettleTx({ settledRow: undefined, existingStatus: 'succeeded' });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.settleStripeTopup('pi_replay');

        expect(result).toEqual({ credited: false, alreadySettled: true });
        // Only the conditional status update ran (0 rows); balance untouched.
        expect(tx.update).toHaveBeenCalledTimes(1);
        expect(tx.select).toHaveBeenCalledTimes(1);
    });

    it('reports a missing row distinctly so the caller can reconcile', async () => {
        const tx = buildSettleTx({ settledRow: undefined, existingStatus: undefined });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.settleStripeTopup('pi_orphan');

        expect(result).toEqual({ credited: false, alreadySettled: false });
        expect(tx.update).toHaveBeenCalledTimes(1);
    });
});

describe('topupService.markStripeTopupFailed', () => {
    let db: { update: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    it('marks the pending row failed (no balance change)', async () => {
        const where = vi.fn().mockResolvedValue(undefined);
        const set = vi.fn(() => ({ where }));
        db.update.mockReturnValue({ set });

        await topupService.markStripeTopupFailed('pi_failed_1');

        expect(db.update).toHaveBeenCalledTimes(1);
        expect(set.mock.calls[0][0]).toMatchObject({ status: 'failed' });
    });
});

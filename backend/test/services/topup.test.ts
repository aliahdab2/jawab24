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
        select: vi.fn(),
    },
}));

vi.mock('../../src/db/schema', () => ({
    topupPurchases: {
        userId: 'user_id',
        stripePaymentIntentId: 'stripe_payment_intent_id',
        status: 'status',
        source: 'source',
        createdAt: 'created_at',
    },
    users: {
        id: 'id',
        topupBalance: 'topup_balance',
    },
}));

vi.mock('../../src/services/stripe', () => ({
    stripeService: { retrievePaymentIntent: vi.fn() },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
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
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
    isNotNull: vi.fn((field) => ({ field, op: 'isNotNull' })),
    inArray: vi.fn((field, values) => ({ field, values, op: 'inArray' })),
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

    it('credits a row left FAILED by an earlier declined attempt (fail-then-retry on same PI)', async () => {
        // Regression: a single PaymentIntent can fire payment_intent.payment_failed
        // (declined attempt) and then payment_intent.succeeded (retry on the same
        // PI). The settle gate must accept a 'failed' row, not only 'pending' —
        // success is authoritative that the money was captured. Gating on 'pending'
        // alone left money captured with no replies, and reconcile (pending-only)
        // could not self-heal. We assert the status gate spans BOTH statuses.
        const tx = buildSettleTx({
            settledRow: { userId: 'user_1', repliesAdded: 5000 },
            newBalance: 5000,
        });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));
        const { inArray } = await import('drizzle-orm');

        const result = await topupService.settleStripeTopup('pi_failed_then_succeeded');

        // The conditional flip must allow 'pending' OR 'failed'.
        expect(inArray).toHaveBeenCalledWith(expect.anything(), ['pending', 'failed']);
        expect(result).toMatchObject({ credited: true, alreadySettled: false, repliesAdded: 5000, newBalance: 5000 });
        expect(tx.update).toHaveBeenCalledTimes(2);
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

describe('topupService.reverseStripeTopup', () => {
    let db: { transaction: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as typeof db;
    });

    // update#0 = succeeded→refunded (returns creditedRow or []);
    // then either the balance decrement (set().where() resolves, no returning)
    // when credited, OR update#1 = pending→refunded (returns pendingRow or []).
    function buildReverseTx(opts: { creditedRow?: { userId: string; repliesAdded: number }; pendingRow?: { id: string } }) {
        let idx = 0;
        return {
            update: vi.fn(() => {
                const i = idx++;
                if (i === 0) {
                    return { set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(opts.creditedRow ? [opts.creditedRow] : []) })) })) };
                }
                if (opts.creditedRow) {
                    // balance decrement: no .returning()
                    return { set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) };
                }
                return { set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(opts.pendingRow ? [opts.pendingRow] : []) })) })) };
            }),
        };
    }

    it('claws back credits when the refunded row was already succeeded (decrement balance)', async () => {
        const tx = buildReverseTx({ creditedRow: { userId: 'user_1', repliesAdded: 5000 } });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.reverseStripeTopup('pi_succeeded_then_refunded');

        expect(result).toEqual({ reversed: true, decremented: true });
        // flip succeeded→refunded + decrement balance
        expect(tx.update).toHaveBeenCalledTimes(2);
    });

    it('marks a still-pending refunded row refunded WITHOUT decrementing (never credited)', async () => {
        const tx = buildReverseTx({ creditedRow: undefined, pendingRow: { id: 'row_1' } });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.reverseStripeTopup('pi_pending_then_refunded');

        expect(result).toEqual({ reversed: true, decremented: false });
        // succeeded-attempt (0 rows) + pending flip
        expect(tx.update).toHaveBeenCalledTimes(2);
    });

    it('is a no-op on replay (already refunded / no matching row) — never double-decrements', async () => {
        const tx = buildReverseTx({ creditedRow: undefined, pendingRow: undefined });
        db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

        const result = await topupService.reverseStripeTopup('pi_already_refunded');

        expect(result).toEqual({ reversed: false, decremented: false });
    });
});

describe('topupService.findOpenPendingStripeTopups', () => {
    let db: { select: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as unknown as typeof db;
    });

    it('returns the open pending stripe rows for the user', async () => {
        const rows = [{ stripePaymentIntentId: 'pi_pending', createdAt: new Date() }];
        const where = vi.fn().mockResolvedValue(rows);
        db.select.mockReturnValue({ from: vi.fn(() => ({ where })) });

        const result = await topupService.findOpenPendingStripeTopups('user_1');

        expect(result).toEqual(rows);
    });
});

describe('topupService.reconcileStripeTopups', () => {
    let db: { select: ReturnType<typeof vi.fn> };
    let stripeService: { retrievePaymentIntent: ReturnType<typeof vi.fn> };

    // Make db.select(...).from().where().limit() resolve to the given rows.
    function seedPendingRows(rows: unknown[]) {
        db.select.mockReturnValue({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue(rows),
                })),
            })),
        });
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        db = (await import('../../src/db')).db as unknown as typeof db;
        stripeService = (await import('../../src/services/stripe')).stripeService as unknown as typeof stripeService;
    });

    // A succeeded PaymentIntent whose money is still ours: latest_charge expanded
    // and not refunded/disputed. retrievePaymentIntent expands latest_charge, and
    // the sweep refuses to credit on pi.status alone — so the mock must carry it.
    const cleanCharge = { refunded: false, amount_refunded: 0, disputed: false };

    it('credits a pending row whose PaymentIntent already succeeded (missed webhook)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_1', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'succeeded', latest_charge: cleanCharge });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: true, alreadySettled: false });

        const r = await topupService.reconcileStripeTopups();

        expect(stripeService.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
        expect(settleSpy).toHaveBeenCalledWith('pi_1');
        expect(r).toMatchObject({ scanned: 1, credited: 1, failed: 0, stillPending: 0, errors: 0 });
        settleSpy.mockRestore();
    });

    it('does NOT double-credit when the webhook already settled it (settle → credited:false)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_2', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'succeeded', latest_charge: cleanCharge });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: false, alreadySettled: true });

        const r = await topupService.reconcileStripeTopups();

        expect(r).toMatchObject({ scanned: 1, credited: 0, alreadySettled: 1, stillPending: 0, errors: 0 });
        settleSpy.mockRestore();
    });

    it('does NOT credit a succeeded PaymentIntent whose charge was refunded while pending (money returned)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_refunded', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({
            status: 'succeeded',
            latest_charge: { refunded: true, amount_refunded: 4900, disputed: false },
        });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: true, alreadySettled: false });
        const refundSpy = vi.spyOn(topupService, 'markStripeTopupRefunded').mockResolvedValue(undefined);

        const r = await topupService.reconcileStripeTopups();

        // The whole point: NEVER call settle (which credits) for refunded money.
        expect(settleSpy).not.toHaveBeenCalled();
        expect(refundSpy).toHaveBeenCalledWith('pi_refunded');
        expect(r).toMatchObject({ scanned: 1, credited: 0, refunded: 1, errors: 0 });
        settleSpy.mockRestore();
        refundSpy.mockRestore();
    });

    it('does NOT credit a succeeded PaymentIntent whose charge is disputed (chargeback)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_disputed', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({
            status: 'succeeded',
            latest_charge: { refunded: false, amount_refunded: 0, disputed: true },
        });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: true, alreadySettled: false });
        const refundSpy = vi.spyOn(topupService, 'markStripeTopupRefunded').mockResolvedValue(undefined);

        const r = await topupService.reconcileStripeTopups();

        expect(settleSpy).not.toHaveBeenCalled();
        expect(refundSpy).toHaveBeenCalledWith('pi_disputed');
        expect(r).toMatchObject({ scanned: 1, credited: 0, refunded: 1, errors: 0 });
        settleSpy.mockRestore();
        refundSpy.mockRestore();
    });

    it('refuses to credit a succeeded PaymentIntent with no expanded charge (cannot verify money is ours)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_nocharge', createdAt: new Date() }]);
        // latest_charge missing (or an unexpanded string id) → cannot verify refund state.
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'succeeded', latest_charge: null });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: true, alreadySettled: false });

        const r = await topupService.reconcileStripeTopups();

        expect(settleSpy).not.toHaveBeenCalled();
        expect(r).toMatchObject({ scanned: 1, credited: 0, errors: 1 });
        settleSpy.mockRestore();
    });

    it('aborts the sweep early after consecutive Stripe failures (degraded Stripe) instead of hammering it', async () => {
        // 7 aged rows, every Stripe call throws → should bail after 5 consecutive errors.
        seedPendingRows(Array.from({ length: 7 }, (_, i) => ({ stripePaymentIntentId: `pi_x${i}`, createdAt: new Date() })));
        stripeService.retrievePaymentIntent.mockRejectedValue(new Error('Stripe 503'));

        const r = await topupService.reconcileStripeTopups();

        expect(r.abortedEarly).toBe(true);
        expect(r.errors).toBe(5); // stopped at the threshold, did not process all 7
        expect(stripeService.retrievePaymentIntent).toHaveBeenCalledTimes(5);
    });

    it('marks a canceled PaymentIntent as failed', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_3', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'canceled' });
        const failSpy = vi.spyOn(topupService, 'markStripeTopupFailed').mockResolvedValue(undefined);

        const r = await topupService.reconcileStripeTopups();

        expect(failSpy).toHaveBeenCalledWith('pi_3');
        expect(r).toMatchObject({ scanned: 1, failed: 1, credited: 0 });
        failSpy.mockRestore();
    });

    it('leaves a recent, not-yet-confirmed PaymentIntent pending (no churn on live attempts)', async () => {
        seedPendingRows([{ stripePaymentIntentId: 'pi_4', createdAt: new Date() }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'requires_payment_method' });
        const failSpy = vi.spyOn(topupService, 'markStripeTopupFailed').mockResolvedValue(undefined);

        const r = await topupService.reconcileStripeTopups();

        expect(failSpy).not.toHaveBeenCalled();
        expect(r).toMatchObject({ scanned: 1, stillPending: 1, failed: 0 });
        failSpy.mockRestore();
    });

    it('expires an abandoned (old, never-confirmed) PaymentIntent as failed', async () => {
        const old = new Date(Date.now() - 48 * 3600 * 1000); // 48h ago
        seedPendingRows([{ stripePaymentIntentId: 'pi_5', createdAt: old }]);
        stripeService.retrievePaymentIntent.mockResolvedValue({ status: 'requires_payment_method' });
        const failSpy = vi.spyOn(topupService, 'markStripeTopupFailed').mockResolvedValue(undefined);

        const r = await topupService.reconcileStripeTopups({ abandonAfterHours: 24 });

        expect(failSpy).toHaveBeenCalledWith('pi_5');
        expect(r).toMatchObject({ scanned: 1, failed: 1 });
        failSpy.mockRestore();
    });

    it('isolates a per-row Stripe error and continues the sweep', async () => {
        seedPendingRows([
            { stripePaymentIntentId: 'pi_err', createdAt: new Date() },
            { stripePaymentIntentId: 'pi_ok', createdAt: new Date() },
        ]);
        stripeService.retrievePaymentIntent
            .mockRejectedValueOnce(new Error('Stripe unreachable'))
            .mockResolvedValueOnce({ status: 'succeeded', latest_charge: cleanCharge });
        const settleSpy = vi.spyOn(topupService, 'settleStripeTopup').mockResolvedValue({ credited: true, alreadySettled: false });

        const r = await topupService.reconcileStripeTopups();

        expect(r).toMatchObject({ scanned: 2, credited: 1, errors: 1 });
        settleSpy.mockRestore();
    });

    it('no-ops cleanly when there are no aged pending rows', async () => {
        seedPendingRows([]);

        const r = await topupService.reconcileStripeTopups();

        expect(stripeService.retrievePaymentIntent).not.toHaveBeenCalled();
        expect(r).toMatchObject({ scanned: 0, credited: 0, failed: 0, stillPending: 0, errors: 0 });
    });
});

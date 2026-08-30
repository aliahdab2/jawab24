/**
 * Tests for the per-account free-trial anti-abuse ledger.
 *
 * Rule under test: the one-time 14-day trial is bound to the signup IDENTITY
 * (phone / Facebook id), not the account row. A returnee whose identity already
 * consumed its trial must not get a fresh one, even after a hard account delete.
 * trialLedgerService is the detection half; subscriptions.createSubscription
 * applies the expired-trial consequence (covered by the integration suite).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// JWT_SECRET keys the identity HMAC — set it before src/config loads.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret';

// db.select(...).from(...).where(...).limit() resolves to whatever we stage,
// and db.insert(...).values(...).onConflictDoNothing() is captured for assertions.
const { mockLimit, mockWhere, mockOnConflict, mockValues, mockInsert } = vi.hoisted(() => ({
    mockLimit: vi.fn(),
    mockWhere: vi.fn(),
    mockOnConflict: vi.fn().mockResolvedValue(undefined),
    mockValues: vi.fn(),
    mockInsert: vi.fn(),
}));

vi.mock('../db', () => {
    const selectChain: Record<string, ReturnType<typeof vi.fn>> = {
        from: vi.fn(),
        where: mockWhere,
        limit: mockLimit,
    };
    selectChain.from.mockReturnValue(selectChain);
    mockWhere.mockReturnValue(selectChain);

    const insertChain = { values: mockValues };
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflict });
    mockInsert.mockReturnValue(insertChain);

    return { db: { select: vi.fn().mockReturnValue(selectChain), insert: mockInsert } };
});

import { trialLedgerService } from '../services/trialLedger';
import { config } from '../config';

describe('trialLedgerService.identitiesForUser', () => {
    it('keys on whichever of phone / facebookId is present', () => {
        expect(trialLedgerService.identitiesForUser({ phone: '+966500000001' })).toEqual([
            { type: 'phone', value: '+966500000001' },
        ]);
        expect(trialLedgerService.identitiesForUser({ facebookId: 'fb-123' })).toEqual([
            { type: 'facebook', value: 'fb-123' },
        ]);
        expect(trialLedgerService.identitiesForUser({ phone: '+966500000001', facebookId: 'fb-123' })).toEqual([
            { type: 'phone', value: '+966500000001' },
            { type: 'facebook', value: 'fb-123' },
        ]);
        expect(trialLedgerService.identitiesForUser({ phone: null, facebookId: null })).toEqual([]);
    });

    it('exempts the seeded demo account (no ledger interaction)', () => {
        expect(trialLedgerService.identitiesForUser({ facebookId: config.demo.userFacebookId })).toEqual([]);
    });
});

describe('trialLedgerService.hasConsumedTrial', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWhere.mockReturnValue({ limit: mockLimit });
    });

    it('returns false for no identities without touching the db', async () => {
        const result = await trialLedgerService.hasConsumedTrial([]);
        expect(result).toBe(false);
        expect(mockLimit).not.toHaveBeenCalled();
    });

    it('returns false when the identity has no prior claim', async () => {
        mockLimit.mockResolvedValueOnce([]);
        const result = await trialLedgerService.hasConsumedTrial([{ type: 'phone', value: '+966500000001' }]);
        expect(result).toBe(false);
    });

    it('returns true when a prior claim exists (the abuse case)', async () => {
        mockLimit.mockResolvedValueOnce([{ id: 'grant-1' }]);
        const result = await trialLedgerService.hasConsumedTrial([{ type: 'phone', value: '+966500000001' }]);
        expect(result).toBe(true);
    });
});

describe('trialLedgerService.record', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflict });
    });

    it('no-ops for empty identities', async () => {
        await trialLedgerService.record([], 'user-1');
        expect(mockInsert).not.toHaveBeenCalled();
    });

    it('inserts a hashed claim with first-writer-wins (onConflictDoNothing)', async () => {
        await trialLedgerService.record([{ type: 'phone', value: '+966500000001' }], 'user-1');
        expect(mockInsert).toHaveBeenCalledTimes(1);
        const inserted = mockValues.mock.calls[0][0];
        expect(inserted).toHaveLength(1);
        expect(inserted[0].identityType).toBe('phone');
        expect(inserted[0].firstUserId).toBe('user-1');
        // Never stores the raw identity — only a 64-char hex HMAC.
        expect(inserted[0].identityHash).toMatch(/^[0-9a-f]{64}$/);
        expect(inserted[0].identityHash).not.toContain('+966500000001');
        expect(mockOnConflict).toHaveBeenCalledTimes(1);
    });

    it('is deterministic: the same identity always hashes to the same value', async () => {
        await trialLedgerService.record([{ type: 'phone', value: '+966500000001' }], 'user-1');
        await trialLedgerService.record([{ type: 'phone', value: '+966500000001' }], 'user-2');
        expect(mockValues.mock.calls[0][0][0].identityHash).toBe(mockValues.mock.calls[1][0][0].identityHash);
    });

    it('domain-separates by type: same value, different type → different hash', async () => {
        await trialLedgerService.record([{ type: 'phone', value: 'same-value' }], 'user-1');
        await trialLedgerService.record([{ type: 'facebook', value: 'same-value' }], 'user-1');
        expect(mockValues.mock.calls[0][0][0].identityHash).not.toBe(mockValues.mock.calls[1][0][0].identityHash);
    });

    it('reports (does not throw) when the insert fails', async () => {
        mockOnConflict.mockRejectedValueOnce(new Error('db down'));
        await expect(
            trialLedgerService.record([{ type: 'phone', value: '+966500000001' }], 'user-1'),
        ).resolves.toBeUndefined();
    });
});

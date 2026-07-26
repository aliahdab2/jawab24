import { describe, it, expect } from 'vitest';
import { assessToken } from '../services/whatsappTokenHealth';

/**
 * Regression coverage for the WhatsApp token expiry arithmetic.
 *
 * Meta FORCES a 60-day expiry on the "WhatsApp Embedded Signup" login variation, so
 * this maths decides whether a merchant gets warned in time or discovers the outage
 * from a customer complaint. Two traps are encoded here deliberately:
 *
 *  1. Meta reports `expires_at: 0` for a token that never expires. Mapping that to
 *     `new Date(0)` would read as "expired in 1970" and make the sweep disconnect
 *     every healthy number it inspected. `debugToken` maps it to undefined; this
 *     asserts undefined stays benign all the way through.
 *  2. `data_access_expires_at` is a SECOND, independent clock (~90 days). Either it
 *     or `expires_at` can fire first, so the EARLIER of the two must govern.
 */
describe('assessToken', () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

    it('treats an invalid token as dead regardless of dates', () => {
        expect(assessToken({ isValid: false }, now)).toEqual({ dead: true, expiringSoon: false });
        // Even with a comfortable future expiry, is_valid=false wins.
        expect(assessToken({ isValid: false, expiresAt: inDays(59) }, now).dead).toBe(true);
    });

    it('treats a token with NO expiry as healthy and never warns', () => {
        // The expires_at = 0 case, post-mapping. A regression here would disconnect
        // every non-expiring token on the first sweep.
        const verdict = assessToken({ isValid: true }, now);
        expect(verdict).toEqual({ dead: false, expiringSoon: false });
        expect(verdict.msUntilExpiry).toBeUndefined();
    });

    it('is healthy and quiet when expiry is comfortably far out', () => {
        const verdict = assessToken({ isValid: true, expiresAt: inDays(60) }, now);
        expect(verdict.dead).toBe(false);
        expect(verdict.expiringSoon).toBe(false);
    });

    it('warns inside the 7-day window without declaring the token dead', () => {
        const verdict = assessToken({ isValid: true, expiresAt: inDays(3) }, now);
        expect(verdict.dead).toBe(false);
        expect(verdict.expiringSoon).toBe(true);
    });

    it('treats an elapsed expiry as dead', () => {
        const verdict = assessToken({ isValid: true, expiresAt: inDays(-1) }, now);
        expect(verdict.dead).toBe(true);
        expect(verdict.expiringSoon).toBe(false);
    });

    it('lets the EARLIER of the two clocks govern — data access before token expiry', () => {
        // Token good for 59 more days, but data access lapses in 2 → must warn now.
        const verdict = assessToken(
            { isValid: true, expiresAt: inDays(59), dataAccessExpiresAt: inDays(2) },
            now,
        );
        expect(verdict.expiringSoon).toBe(true);
        expect(verdict.dead).toBe(false);
    });

    it('lets the EARLIER of the two clocks govern — token expiry before data access', () => {
        const verdict = assessToken(
            { isValid: true, expiresAt: inDays(1), dataAccessExpiresAt: inDays(80) },
            now,
        );
        expect(verdict.expiringSoon).toBe(true);
    });

    it('is dead when only the data-access clock has elapsed', () => {
        // The credential string is still valid but the app can no longer read the
        // customer's data — sends will fail, so this must not be reported healthy.
        const verdict = assessToken(
            { isValid: true, expiresAt: inDays(30), dataAccessExpiresAt: inDays(-2) },
            now,
        );
        expect(verdict.dead).toBe(true);
    });

    it('ignores an unparseable date rather than treating it as expired', () => {
        const verdict = assessToken({ isValid: true, expiresAt: new Date('nonsense') }, now);
        expect(verdict.dead).toBe(false);
        expect(verdict.expiringSoon).toBe(false);
    });

    it('warns exactly at the 7-day boundary', () => {
        expect(assessToken({ isValid: true, expiresAt: inDays(7) }, now).expiringSoon).toBe(true);
        // Just outside the window stays quiet.
        expect(assessToken({ isValid: true, expiresAt: inDays(7.5) }, now).expiringSoon).toBe(false);
    });
});

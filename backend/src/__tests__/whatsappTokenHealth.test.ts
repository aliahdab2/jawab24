import { describe, it, expect } from 'vitest';
import { assessToken, isDefinitiveAccessLoss } from '../services/whatsappTokenHealth';
import { WhatsAppApiError } from '../services/whatsapp';

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

    it('does NOT declare dead on the data-access clock alone', () => {
        // We have NOT verified that an elapsed data_access_expires_at blocks
        // POST /{phone-number-id}/messages. An earlier revision assumed it did and
        // would have destroyed credentials on that assumption — and because the
        // clock is anchored to the original login and is not reset by reconnecting,
        // an affected merchant would have been disconnected again every sweep,
        // forever. Only the credential's own expiry may declare a token dead.
        const verdict = assessToken(
            { isValid: true, expiresAt: inDays(30), dataAccessExpiresAt: inDays(-2) },
            now,
        );
        expect(verdict.dead).toBe(false);
    });

    it('folds in the deadline captured at Embedded Signup', () => {
        // debug_token reports expires_at: 0 for system-user tokens, so the ES-time
        // expires_in is the only place the real 60-day deadline is known. Without
        // this the warning would never fire and the merchant would go dark silently.
        const verdict = assessToken({ isValid: true }, now, inDays(3));
        expect(verdict.expiringSoon).toBe(true);
        expect(verdict.dead).toBe(false);

        expect(assessToken({ isValid: true }, now, inDays(-1)).dead).toBe(true);
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

/**
 * The sweep's WABA access probe: debug_token proves the TOKEN, not the LINK.
 * A coexistence merchant unlinking leaves the token valid while every webhook
 * stops (Z net, 27 hours dark, 2026-08-31) — so the sweep also probes the
 * number node, and this predicate decides whether a probe failure may flag the
 * merchant-visible reconnect banner. Only a definitive Graph 4xx qualifies.
 */
describe('isDefinitiveAccessLoss', () => {
    it('flags the access-loss codes — object gone / permission lost / token rejected', () => {
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Unsupported get request', 100, false))).toBe(true);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Object does not exist', 33, false))).toBe(true);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Permission denied', 10, false))).toBe(true);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Requires whatsapp_business_management', 200, false))).toBe(true);
        // 190 on the PROBE authenticates with the merchant token (not our app
        // token like debug_token), so it too is definitive here.
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Invalid OAuth access token', 190, false))).toBe(true);
    });

    it('never flags a 4xx outside the allowlist — Meta ships rate limits and deprecations as HTTP 400', () => {
        // sanitizeWhatsAppError marks every HTTP 4xx non-transient, but these are
        // NOT "this asset is no longer yours". Flagging them would banner + push
        // every number in a throttled sweep at once (the estate-wide class the
        // sweep's 190 checker-fault note documents).
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Application request limit reached', 4, false))).toBe(false);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Too many calls to this WABA', 80007, false))).toBe(false);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Rate limit hit', 130429, false))).toBe(false);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Version deprecated', 2635, false))).toBe(false);
        // A 4xx whose body Meta did not fill in is weak evidence — never a banner.
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('Bad request', undefined, false))).toBe(false);
    });

    it('never flags transient failures — network / 429 / 5xx must retry, not banner', () => {
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('timeout', undefined, true))).toBe(false);
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('rate limited', 4, true))).toBe(false);
        // Even an allowlisted code cannot flag while self-declared transient.
        expect(isDefinitiveAccessLoss(new WhatsAppApiError('flaky permission read', 10, true))).toBe(false);
    });

    it('never flags errors that are not Graph verdicts at all', () => {
        // A decrypt bug, a coding error, a thrown string — none of these are
        // Meta saying "not yours"; flagging on them re-creates the false-positive
        // class markWhatsAppNeedsReconnect exists to prevent.
        expect(isDefinitiveAccessLoss(new Error('boom'))).toBe(false);
        expect(isDefinitiveAccessLoss('boom')).toBe(false);
        expect(isDefinitiveAccessLoss(undefined)).toBe(false);
    });
});

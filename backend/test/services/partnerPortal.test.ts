import { describe, it, expect } from 'vitest';
import { deriveStatus } from '../../src/services/partnerPortal';

/**
 * The portal derives merchant status at read time because the subscription
 * state machine flips trialing→past_due lazily (only when the merchant loads
 * the app) — a trial that ended for a merchant who never came back keeps a
 * stale 'trialing' row, and those are exactly the accounts a partner chases.
 */
describe('deriveStatus', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    const past = new Date('2026-08-10T12:00:00Z');
    const future = new Date('2026-08-20T12:00:00Z');

    it('keeps trialing while the trial end is in the future', () => {
        expect(deriveStatus('trialing', future, null, now)).toBe('trialing');
    });

    it('reports trial_expired for a stale trialing row past its end date', () => {
        expect(deriveStatus('trialing', past, null, now)).toBe('trial_expired');
    });

    it('treats trialing with no end date as still trialing', () => {
        expect(deriveStatus('trialing', null, null, now)).toBe('trialing');
    });

    it('keeps active while the period end is in the future', () => {
        expect(deriveStatus('active', null, future, now)).toBe('active');
    });

    it('reports expired for an active row past its period end', () => {
        expect(deriveStatus('active', null, past, now)).toBe('expired');
    });

    it('passes through past_due, canceled, and paused unchanged', () => {
        expect(deriveStatus('past_due', null, null, now)).toBe('past_due');
        expect(deriveStatus('canceled', null, null, now)).toBe('canceled');
        expect(deriveStatus('paused', null, null, now)).toBe('paused');
    });

    it('maps a missing or unknown status to none', () => {
        expect(deriveStatus(null, null, null, now)).toBe('none');
        expect(deriveStatus('weird_status', null, null, now)).toBe('none');
    });
});

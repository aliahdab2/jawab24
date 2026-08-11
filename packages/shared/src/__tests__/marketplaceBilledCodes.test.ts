import { describe, it, expect } from 'vitest';
import {
    MARKETPLACE_BILLED_CODES,
    isMarketplaceBilledCode,
} from '../marketplaceBilledCodes';

describe('isMarketplaceBilledCode', () => {
    /**
     * The regression this file exists for: `checkout.tsx` open-coded
     * `code === 'SHOPIFY_BILLED' || code === 'SALLA_BILLED'` and never learned
     * about Zid, so a Zid merchant who reached /checkout through a stale link got
     * the GENERIC failure banner instead of a bounce to the managed banner — the
     * dead end D-073 exists to prevent, on the one surface the field-based guard
     * cannot cover.
     */
    it('recognizes every rail, including the one that was missed', () => {
        expect(isMarketplaceBilledCode('SHOPIFY_BILLED')).toBe(true);
        expect(isMarketplaceBilledCode('SALLA_BILLED')).toBe(true);
        expect(isMarketplaceBilledCode('ZID_BILLED')).toBe(true);
    });

    /** Every declared code must be recognized — no entry can drift out. */
    it('recognizes the whole declared set', () => {
        for (const code of MARKETPLACE_BILLED_CODES) {
            expect(isMarketplaceBilledCode(code)).toBe(true);
        }
    });

    it('does not swallow unrelated refusals, which must keep their own handling', () => {
        // These have distinct UX: a demo-account block shows its own message, a
        // sanctioned-country block must never bounce to /pricing, and an unknown
        // code has to reach the generic banner rather than be silently absorbed.
        expect(isMarketplaceBilledCode('DEMO_USER_STRIPE_BLOCKED')).toBe(false);
        expect(isMarketplaceBilledCode('SANCTIONED_COUNTRY')).toBe(false);
        expect(isMarketplaceBilledCode('SOMETHING_NEW')).toBe(false);
    });

    it('is safe on an absent or non-string code read off a parsed error body', () => {
        expect(isMarketplaceBilledCode(undefined)).toBe(false);
        expect(isMarketplaceBilledCode(null)).toBe(false);
        expect(isMarketplaceBilledCode(42)).toBe(false);
        expect(isMarketplaceBilledCode({ code: 'ZID_BILLED' })).toBe(false);
        expect(isMarketplaceBilledCode(['ZID_BILLED'])).toBe(false);
    });

    it('is case-sensitive — the wire codes are exact', () => {
        expect(isMarketplaceBilledCode('zid_billed')).toBe(false);
        expect(isMarketplaceBilledCode('Zid_Billed')).toBe(false);
    });

    // Not tested here: that the backend's `SHOPIFY_BILLED_CODE` etc. equal these
    // strings. Each rail's config now annotates its constant as
    // `MarketplaceBilledCode`, so drift is a COMPILE error — a stronger
    // guarantee than a test, and asserting it here would make the shared package
    // import from the backend, inverting the dependency direction.
});

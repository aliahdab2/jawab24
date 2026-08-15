import { describe, it, expect } from 'vitest';
import flagReasonAr from '../i18n/ar/flagReason.json';
import flagReasonEn from '../i18n/en/flagReason.json';

/**
 * These strings are merchant-facing on two surfaces at once — the inbox chip
 * (FlagTag) and the `flagged_reply` push body (translateFlagReason in
 * backend/src/services/notifications.ts) — which is the whole reason this file
 * is a single source of truth.
 *
 * They shipped with `ارجو` (bare alef) instead of `أرجو` on three keys and
 * nothing caught it: every existing test asserts key PRESENCE, or asserts
 * against the English map, or (in CommentCard.test.ts) against a hand-written
 * copy of the data. A value-level check over the whole map is what was missing.
 */
describe('Arabic flag reasons', () => {
    const values = Object.entries(flagReasonAr as Record<string, string>);

    it('spells أرجو with its hamza everywhere', () => {
        // Pins the specific bug and its two silent siblings.
        expect((flagReasonAr as Record<string, string>).price_not_in_kb).toBe('أرجو إضافة السعر');
        expect((flagReasonAr as Record<string, string>).info_not_in_kb).toBe('أرجو إضافة معلومة');
        expect((flagReasonAr as Record<string, string>).phone_not_in_kb).toBe('أرجو إضافة رقم الهاتف');
    });

    it('never uses a bare alef where a hamza-carrying alef is required', () => {
        // Generalises the fix to the whole class rather than the three known keys:
        // any future value with these misspellings fails here.
        // فصحى (AI_INSTRUCTIONS §5) — this rule governs OUR copy, and this file is ours.
        const misspellings = ['ارجو', 'انا ', 'اذا ', 'احتاج', 'اضافة'];
        const offenders = values.filter(([, text]) => misspellings.some(bad => text.includes(bad)));
        expect(offenders, `bare-alef spelling in: ${offenders.map(([k]) => k).join(', ')}`).toEqual([]);
    });

    it('translates every English key, so no surface can fall back to a raw code', () => {
        // A missing AR key renders the raw flag code (e.g. "price_not_in_kb") to
        // the merchant in both the chip and the push body.
        for (const key of Object.keys(flagReasonEn as Record<string, string>)) {
            expect(flagReasonAr, `missing Arabic label for "${key}"`).toHaveProperty(key);
        }
    });

    it('has no empty or whitespace-only labels', () => {
        for (const [key, text] of values) {
            expect(text.trim().length, `"${key}" is blank`).toBeGreaterThan(0);
        }
    });
});

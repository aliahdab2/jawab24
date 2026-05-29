import { describe, it, expect } from 'vitest';
import { unwrapBusinessProfile, mergedBusinessProfile } from '../index';
import type { BusinessProfile, BusinessProfileContainer, StoredBusinessProfile } from '../index';

describe('unwrapBusinessProfile', () => {
    describe('null / undefined input', () => {
        it('returns empty container for null', () => {
            expect(unwrapBusinessProfile(null)).toEqual({});
        });

        it('returns empty container for undefined', () => {
            expect(unwrapBusinessProfile(undefined)).toEqual({});
        });
    });

    describe('container shape (Stage 2.6 native)', () => {
        it('returns container as-is when both halves present', () => {
            const stored: BusinessProfileContainer = {
                merchant: { address: 'merchant-addr' },
                suggestions: { address: 'fb-addr', phones: ['+963937549674'] },
            };
            expect(unwrapBusinessProfile(stored)).toEqual(stored);
        });

        it('preserves empty merchant + populated suggestions (the prod tail)', () => {
            const stored: BusinessProfileContainer = {
                merchant: {},
                suggestions: { address: 'Damascus, Baramkeh' },
            };
            const { merchant, suggestions } = unwrapBusinessProfile(stored);
            expect(merchant).toEqual({});
            expect(suggestions?.address).toBe('Damascus, Baramkeh');
        });
    });

    describe('legacy flat shape', () => {
        it('demotes flat profile to suggestions, merchant stays empty', () => {
            const flat: BusinessProfile = { address: 'legacy-addr', phones: ['+1'] };
            expect(unwrapBusinessProfile(flat)).toEqual({
                merchant: {},
                suggestions: flat,
            });
        });
    });

    describe('double-encoded jsonb string (prod regression)', () => {
        // Prod observation 2026-05-28: pages.business_profile is jsonb-typed,
        // but jsonb_typeof(business_profile) = 'string'. Something in the
        // write path is JSON.stringify()ing the container before insert, so
        // Drizzle reads back a string instead of a parsed object.
        //
        // Today's unwrapBusinessProfile checks `typeof === 'object'` and a
        // string fails that check, so the string is treated as legacy-flat
        // and tucked into suggestions — making the merchant half UNREACHABLE
        // for every double-encoded row. These tests pin the intended fix:
        // tolerate the string form by parsing it once.
        const container = {
            merchant: { address: 'merchant-addr' },
            suggestions: { phones: ['+963937549674'] },
        };
        const doubleEncoded = JSON.stringify(container) as unknown as StoredBusinessProfile;

        it('parses a double-encoded container string back to the container', () => {
            const result = unwrapBusinessProfile(doubleEncoded);
            expect(result.merchant).toEqual({ address: 'merchant-addr' });
            expect(result.suggestions).toEqual({ phones: ['+963937549674'] });
        });

        it('parses a double-encoded legacy-flat string into suggestions', () => {
            const flat = { address: 'legacy-addr' };
            const encoded = JSON.stringify(flat) as unknown as StoredBusinessProfile;
            const result = unwrapBusinessProfile(encoded);
            expect(result.merchant).toEqual({});
            expect(result.suggestions).toEqual(flat);
        });

        it('treats malformed strings as empty rather than crashing', () => {
            const garbage = 'not json {{{' as unknown as StoredBusinessProfile;
            // A malformed string is not actionable data — return empty
            // container rather than throwing into the reply pipeline.
            expect(() => unwrapBusinessProfile(garbage)).not.toThrow();
            expect(unwrapBusinessProfile(garbage)).toEqual({});
        });
    });
});

describe('mergedBusinessProfile (chunker / KB-merge path)', () => {
    it('merchant wins on conflict', () => {
        const stored: BusinessProfileContainer = {
            merchant: { address: 'merchant-addr' },
            suggestions: { address: 'fb-addr', phones: ['+1'] },
        };
        const merged = mergedBusinessProfile(stored);
        expect(merged.address).toBe('merchant-addr');
        expect(merged.phones).toEqual(['+1']); // suggestions fill the gap
    });

    it('falls through to suggestions when merchant is empty', () => {
        const stored: BusinessProfileContainer = {
            merchant: {},
            suggestions: { address: 'fb-addr' },
        };
        expect(mergedBusinessProfile(stored).address).toBe('fb-addr');
    });

    it('handles double-encoded string the same way (regression guard)', () => {
        const encoded = JSON.stringify({
            merchant: {},
            suggestions: { address: 'fb-addr' },
        }) as unknown as StoredBusinessProfile;
        expect(mergedBusinessProfile(encoded).address).toBe('fb-addr');
    });
});

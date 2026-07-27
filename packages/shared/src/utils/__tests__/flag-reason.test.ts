import { describe, it, expect } from 'vitest';
import { parseFlagReason, hasAnyFlag } from '../flag-reason';

describe('parseFlagReason', () => {
    it('splits a comma-joined flag string', () => {
        expect(parseFlagReason('info_not_in_kb,low_confidence')).toEqual(['info_not_in_kb', 'low_confidence']);
    });

    it('trims surrounding whitespace on each token', () => {
        expect(parseFlagReason(' info_not_in_kb , low_confidence ')).toEqual(['info_not_in_kb', 'low_confidence']);
    });

    it('returns a single-element list for one flag', () => {
        expect(parseFlagReason('price_not_in_kb')).toEqual(['price_not_in_kb']);
    });

    it('returns an empty list for empty/missing input', () => {
        expect(parseFlagReason(undefined)).toEqual([]);
        expect(parseFlagReason(null)).toEqual([]);
        expect(parseFlagReason('')).toEqual([]);
    });

    // A trailing comma must not yield a phantom '' entry that could satisfy a
    // sloppy membership check.
    it('drops empty tokens from stray separators', () => {
        expect(parseFlagReason('price_not_in_kb,')).toEqual(['price_not_in_kb']);
        expect(parseFlagReason(',,price_not_in_kb,,place_not_in_kb,')).toEqual(['price_not_in_kb', 'place_not_in_kb']);
        expect(parseFlagReason(',')).toEqual([]);
        expect(parseFlagReason('   ')).toEqual([]);
    });

    it('preserves the dynamic companion flags verbatim', () => {
        expect(parseFlagReason('language_mismatch,expected_lang:en,reply_lang:ar'))
            .toEqual(['language_mismatch', 'expected_lang:en', 'reply_lang:ar']);
    });
});

describe('hasAnyFlag', () => {
    it('finds a flag anywhere in the list', () => {
        expect(hasAnyFlag('low_confidence,price_not_in_kb', ['price_not_in_kb'])).toBe(true);
        expect(hasAnyFlag('price_not_in_kb,low_confidence', ['price_not_in_kb'])).toBe(true);
    });

    it('matches when ANY wanted flag is present', () => {
        expect(hasAnyFlag('place_not_in_kb', ['price_not_in_kb', 'place_not_in_kb'])).toBe(true);
    });

    it('returns false when none are present', () => {
        expect(hasAnyFlag('low_confidence', ['price_not_in_kb'])).toBe(false);
        expect(hasAnyFlag(undefined, ['price_not_in_kb'])).toBe(false);
        expect(hasAnyFlag('', ['price_not_in_kb'])).toBe(false);
    });

    // Exact membership only — the cache gate relies on this (a flag must never be
    // matched by prefix/substring).
    it('does not match by prefix or substring', () => {
        expect(hasAnyFlag('info_not_in_kb_extra', ['info_not_in_kb'])).toBe(false);
        expect(hasAnyFlag('not_in_kb', ['info_not_in_kb'])).toBe(false);
    });

    it('returns false for an empty wanted list', () => {
        expect(hasAnyFlag('price_not_in_kb', [])).toBe(false);
    });
});

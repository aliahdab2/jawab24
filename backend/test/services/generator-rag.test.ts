import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSkipReply, shouldUseFallback, SKIP_REPLY_FLAGS, SAFE_FALLBACK_FLAGS, PRICE_FALLBACK } from '../../src/services/reply/generator';

describe('ReplyGenerator - Skip/Fallback helpers', () => {
    describe('shouldSkipReply', () => {
        it('returns false when no flags or intent', () => {
            expect(shouldSkipReply()).toBe(false);
            expect(shouldSkipReply(undefined, undefined)).toBe(false);
            expect(shouldSkipReply('', '')).toBe(false);
        });

        it('returns true for offensive_or_abusive flag', () => {
            expect(shouldSkipReply('offensive_or_abusive')).toBe(true);
        });

        it('returns true for offensive flag', () => {
            expect(shouldSkipReply('offensive')).toBe(true);
        });

        it('returns true for OFFENSIVE intent', () => {
            expect(shouldSkipReply(undefined, 'OFFENSIVE')).toBe(true);
            expect(shouldSkipReply('', 'offensive')).toBe(true); // case-insensitive
        });

        it('returns true when one of multiple flags matches', () => {
            expect(shouldSkipReply('angry_customer,offensive_or_abusive')).toBe(true);
        });

        it('returns false for non-skip flags', () => {
            expect(shouldSkipReply('price_not_in_kb')).toBe(false);
            expect(shouldSkipReply('angry_customer')).toBe(false);
        });

        it('returns false for non-skip intents', () => {
            expect(shouldSkipReply(undefined, 'QUESTION')).toBe(false);
            expect(shouldSkipReply(undefined, 'COMPLAINT')).toBe(false);
        });
    });

    describe('shouldUseFallback', () => {
        it('returns false when no flags', () => {
            expect(shouldUseFallback()).toBe(false);
            expect(shouldUseFallback('')).toBe(false);
        });

        it('returns true for price_not_in_kb flag', () => {
            expect(shouldUseFallback('price_not_in_kb')).toBe(true);
        });

        it('returns true when one of multiple flags matches', () => {
            expect(shouldUseFallback('angry_customer,price_not_in_kb')).toBe(true);
        });

        it('returns false for non-fallback flags', () => {
            expect(shouldUseFallback('offensive_or_abusive')).toBe(false);
            expect(shouldUseFallback('angry_customer')).toBe(false);
        });
    });

    describe('PRICE_FALLBACK', () => {
        it('has ar and en fallback messages', () => {
            expect(PRICE_FALLBACK.ar).toBeTruthy();
            expect(PRICE_FALLBACK.en).toBeTruthy();
            expect(typeof PRICE_FALLBACK.ar).toBe('string');
            expect(typeof PRICE_FALLBACK.en).toBe('string');
        });
    });

    describe('Constants', () => {
        it('SKIP_REPLY_FLAGS contains expected values', () => {
            expect(SKIP_REPLY_FLAGS).toContain('offensive_or_abusive');
            expect(SKIP_REPLY_FLAGS).toContain('offensive');
        });

        it('SAFE_FALLBACK_FLAGS contains price_not_in_kb', () => {
            expect(SAFE_FALLBACK_FLAGS).toContain('price_not_in_kb');
        });
    });
});

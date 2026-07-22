import { describe, it, expect } from 'vitest';
import { cacheRejectReason } from '../../src/services/cacheQualityGate';

describe('cacheRejectReason', () => {
    it('rejects low confidence regardless of flags', () => {
        expect(cacheRejectReason('low', [])).toBe('low_confidence');
        expect(cacheRejectReason('low', undefined)).toBe('low_confidence');
        expect(cacheRejectReason('low', ['price_not_in_kb'])).toBe('low_confidence');
    });

    it('rejects each blocking flag at high/medium confidence', () => {
        expect(cacheRejectReason('high', ['info_not_in_kb'])).toBe('info_not_in_kb');
        expect(cacheRejectReason('medium', ['price_not_in_kb'])).toBe('price_not_in_kb');
        expect(cacheRejectReason('high', ['language_mismatch'])).toBe('language_mismatch');
    });

    it('reports a single reason, first-tripped wins', () => {
        // Confidence outranks flags…
        expect(cacheRejectReason('low', ['price_not_in_kb', 'language_mismatch'])).toBe('low_confidence');
        // …then flags in declaration order regardless of array order.
        expect(cacheRejectReason('high', ['language_mismatch', 'info_not_in_kb'])).toBe('info_not_in_kb');
        expect(cacheRejectReason('high', ['language_mismatch', 'price_not_in_kb'])).toBe('price_not_in_kb');
    });

    it('ignores non-blocking and dynamic companion flags', () => {
        expect(cacheRejectReason('high', ['expected_lang:ar', 'reply_lang:en'])).toBeNull();
        expect(cacheRejectReason('high', ['angry_customer', 'refund_request'])).toBeNull();
        // fallback_reply is handled upstream by a throw — not this gate's business.
        expect(cacheRejectReason('high', ['fallback_reply'])).toBeNull();
        // Exact membership only — no prefix/substring matching.
        expect(cacheRejectReason('high', ['info_not_in_kb_extra'])).toBeNull();
    });

    it('fails open on missing fields (legacy/failover worker responses)', () => {
        expect(cacheRejectReason(undefined, undefined)).toBeNull();
        expect(cacheRejectReason(undefined, [])).toBeNull();
        expect(cacheRejectReason('high', undefined)).toBeNull();
    });

    it('passes medium and high confidence with clean flags', () => {
        expect(cacheRejectReason('medium', [])).toBeNull();
        expect(cacheRejectReason('high', [])).toBeNull();
        // Unknown confidence strings are not 'low' → pass (wire type not trusted).
        expect(cacheRejectReason('LOW', [])).toBeNull();
        expect(cacheRejectReason('', [])).toBeNull();
    });
});

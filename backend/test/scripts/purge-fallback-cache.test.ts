import { describe, it, expect } from 'vitest';
import { isFallbackReply, TEMPLATE_PREFIXES } from '../../src/scripts/purge-fallback-cache';

// The purge script decides per-row "delete or keep" based on isFallbackReply.
// A false positive deletes a legitimate cache entry (regenerates fine, but
// burns ai-worker quota); a false negative leaves a fallback in cache that
// keeps shipping to customers. Both failure modes deserve coverage.

describe('purge-fallback-cache: isFallbackReply', () => {
    describe('flag-based detection', () => {
        it('returns true when flags array contains "fallback_reply"', () => {
            expect(isFallbackReply('whatever the text', ['fallback_reply'])).toBe(true);
        });

        it('returns true when flags is ["fallback_reply", "other_flag"]', () => {
            expect(isFallbackReply('whatever', ['fallback_reply', 'low_confidence'])).toBe(true);
        });

        it('returns false when flags is a non-array (corrupt metadata)', () => {
            expect(isFallbackReply('A real AI reply.', 'fallback_reply')).toBe(false);
            expect(isFallbackReply('A real AI reply.', { fallback_reply: true })).toBe(false);
        });

        it('returns false when flags is empty or missing', () => {
            expect(isFallbackReply('A real AI reply.', [])).toBe(false);
            expect(isFallbackReply('A real AI reply.', undefined)).toBe(false);
            expect(isFallbackReply('A real AI reply.', null)).toBe(false);
        });
    });

    describe('text-prefix detection (recovers entries with lost/stripped metadata)', () => {
        it('matches the Arabic DM template with page name', () => {
            const reply = 'شكراً لرسالتك إلى الفريق الدمشقي للتدريب والتأهيل! سنرد عليك في أقرب وقت ممكن.';
            expect(isFallbackReply(reply, [])).toBe(true);
        });

        it('matches the Arabic comment template with page name', () => {
            const reply = 'شكراً لتواصلك مع Test Page! سيقوم فريقنا بالرد عليك قريباً.';
            expect(isFallbackReply(reply, [])).toBe(true);
        });

        it('matches the English DM template with page name', () => {
            expect(isFallbackReply('Thank you for your message to MyStore! We will respond soon.', [])).toBe(true);
        });

        it('matches the English comment template with page name', () => {
            expect(isFallbackReply('Thank you for reaching out to MyStore! Our team will get back to you.', [])).toBe(true);
        });

        it('matches the Swedish DM template', () => {
            expect(isFallbackReply('Tack för ditt meddelande till Butiken! Vi återkommer snart.', [])).toBe(true);
        });

        it('matches the Swedish comment template', () => {
            expect(isFallbackReply('Tack för att du kontaktar oss!', [])).toBe(true);
        });
    });

    describe('non-fallbacks are preserved', () => {
        it('does not match a legitimate Arabic answer that mentions thanks', () => {
            // Real customer-helping reply that begins with "شكراً" — must not be deleted
            const reply = 'شكراً لاهتمامك! دورة المكياج تبدأ يوم الخميس 7/5 بسعر 25,000 ل.س.';
            expect(isFallbackReply(reply, [])).toBe(false);
        });

        it('does not match a legitimate English answer', () => {
            const reply = 'Thank you for your interest! The makeup course starts May 7 and costs 25,000 SYP.';
            expect(isFallbackReply(reply, [])).toBe(false);
        });

        it('does not match an empty reply', () => {
            expect(isFallbackReply('', [])).toBe(false);
            expect(isFallbackReply(null, [])).toBe(false);
            expect(isFallbackReply(undefined, [])).toBe(false);
        });

        it('does not match a non-string reply (corrupt cache entry)', () => {
            expect(isFallbackReply(42 as unknown as string, [])).toBe(false);
            expect(isFallbackReply({} as unknown as string, [])).toBe(false);
        });
    });

    describe('template-prefix list invariants', () => {
        it('covers all 6 known templates (2 channels × 3 languages)', () => {
            expect(TEMPLATE_PREFIXES).toHaveLength(6);
        });

        it('every prefix matches itself', () => {
            for (const prefix of TEMPLATE_PREFIXES) {
                expect(isFallbackReply(`${prefix} TestPage!`, [])).toBe(true);
            }
        });
    });
});

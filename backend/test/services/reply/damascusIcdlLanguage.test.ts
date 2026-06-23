/**
 * Production regression: the Damascus training-institute demo merchant
 * ("الفريق الدمشقي للتدريب والتأهيل") replied in ENGLISH to the comment "Icdl"
 * on an Arabic computer-courses post.
 *
 * Mechanism: the merchant's KB (DAMASCUS_DEMO_KB, ~12.8k chars) is well over the
 * 5,000-char RAG threshold, so under RAG_MODE=on the generator sends the KB as
 * retrieved chunks and sets `effectiveKB = undefined`. `resolveCommentLanguage`
 * then saw a blank KB-language signal, the ambiguous-Latin → Arabic override
 * (which only keyed off the KB) never fired, and the bare Latin token "Icdl"
 * resolved to English — overriding the worker's own post-language fallback.
 *
 * The fix keys the override off the POST language too (always present,
 * RAG-independent). This test pins that behavior to the actual demo merchant.
 */
import { describe, it, expect } from 'vitest';
import { resolveCommentLanguage } from '../../../src/services/reply/commentPreprocess';
import { detectLanguageCode } from '../../../src/utils/language';
import { DAMASCUS_DEMO_KB } from '../../../src/plugins/demo/damascusKb';

// Faithful copy of the Arabic post from the reported screenshot.
const ICDL_POST =
    '#عرووووض 🔥💢\n' +
    'على دورات #الكومبيوتر\n' +
    '👈مع الأستاذ المتميز أنس الأشقر\n' +
    '🔴دورة icdl\n' +
    '8 جلسات لمدة شهر بكلفة 35 الف بالعملة القديمة\n' +
    '🔴أمين مبتدئ';

const RAG_THRESHOLD_CHARS = 5000; // mirrors KB_RAG_THRESHOLD_CHARS in generator.ts

describe('Damascus demo merchant — "Icdl" on Arabic post resolves to Arabic', () => {
    it('the demo KB is large enough to trigger RAG (so effectiveKB is dropped in prod)', () => {
        expect(DAMASCUS_DEMO_KB.length).toBeGreaterThanOrEqual(RAG_THRESHOLD_CHARS);
        expect(detectLanguageCode(ICDL_POST)).toBe('ar');
    });

    it('RAG active (effectiveKB undefined): "Icdl" still resolves to Arabic from the post', () => {
        // This is the exact production state: KB content lives in chunks, effectiveKB === undefined.
        expect(resolveCommentLanguage('Icdl', ICDL_POST, undefined)).toBe('ar');
    });

    it('RAG off (static KB passed): "Icdl" resolves to Arabic from the KB too', () => {
        expect(resolveCommentLanguage('Icdl', ICDL_POST, DAMASCUS_DEMO_KB)).toBe('ar');
    });
});

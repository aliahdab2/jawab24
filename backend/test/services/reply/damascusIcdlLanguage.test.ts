/**
 * Production regression: the Damascus training-institute demo merchant
 * ("الفريق الدمشقي للتدريب والتأهيل") replied in ENGLISH to the comment "Icdl"
 * on an Arabic computer-courses post.
 *
 * Original mechanism: when the merchant's KB (DAMASCUS_DEMO_KB, ~12.8k chars) was
 * RAG-chunked, the generator sent the KB as retrieved chunks and set
 * `effectiveKB = undefined`. `resolveCommentLanguage` then saw a blank KB-language
 * signal, the ambiguous-Latin → Arabic override (which only keyed off the KB) never
 * fired, and the bare Latin token "Icdl" resolved to English — overriding the
 * worker's own post-language fallback.
 *
 * The fix keys the override off the POST language too (always present,
 * RAG-independent). This test pins that behavior to the actual demo merchant.
 *
 * NOTE (D-012): non-ecommerce pages now send the FULL KB (effectiveKB defined), so the
 * `effectiveKB === undefined` case below is the LEGACY RAG path — reachable today only
 * via the KB_RAG_THRESHOLD_CHARS emergency rollback lever. Both cases are kept so
 * language resolution stays pinned whether the KB is dropped (lever on) or sent whole.
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

// The legacy RAG path engaged only for KBs above this size; the demo KB is well over it.
// Post-D-012 this is the KB_RAG_THRESHOLD_CHARS emergency-lever value, not a default ceiling.
const RAG_THRESHOLD_CHARS = 5000;

describe('Damascus demo merchant — "Icdl" on Arabic post resolves to Arabic', () => {
    it('the demo KB is large (the size that engaged the legacy RAG path)', () => {
        expect(DAMASCUS_DEMO_KB.length).toBeGreaterThanOrEqual(RAG_THRESHOLD_CHARS);
        expect(detectLanguageCode(ICDL_POST)).toBe('ar');
    });

    it('legacy RAG path (effectiveKB undefined): "Icdl" still resolves to Arabic from the post', () => {
        // Reachable today only via the KB_RAG_THRESHOLD_CHARS rollback lever; pre-D-012 this was
        // the default prod state for this KB. Language resolution must not depend on the KB.
        expect(resolveCommentLanguage('Icdl', ICDL_POST, undefined)).toBe('ar');
    });

    it('full-KB path (static KB passed — the D-012 default): "Icdl" resolves to Arabic from the KB too', () => {
        expect(resolveCommentLanguage('Icdl', ICDL_POST, DAMASCUS_DEMO_KB)).toBe('ar');
    });
});

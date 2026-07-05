/**
 * Phase-1b dual-mode regression suite for the ai-worker detector surface
 * (detectLanguageOrNull + resolveInputLanguage).
 *
 * Same contract as the backend suite: with LANG_ENGINE=tinyld the only inputs
 * allowed to change are non-ASCII Latin text the legacy branches misread —
 * the Latin→'en' fallthrough (e.g. Vietnamese/Spanish) AND the å/ä/ö→'sv'
 * umlaut quirk (which labels German 'sv'). ASCII input and all non-Latin
 * scripts are bit-identical in both modes.
 *
 * NOTE the production bug sentence "Hur kan man anmäla sig" is in the
 * IDENTITY table here: the ä-quirk means this surface already read it 'sv'.
 * The production failure lived on the BACKEND surface (en@0.5 → deferToHistory
 * → language:undefined → this module's history-first chain anchored to the
 * Arabic thread before ever consulting the current message). The fix flows
 * through the backend passing language:'sv' as the explicit override — pinned
 * in the resolveInputLanguage tests below.
 *
 * The existing test/language.test.ts pins legacy behavior (flag unset).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { detectLanguageOrNull, resolveInputLanguage } from '../src/services/language';

const inTinyldMode = <T>(fn: () => T): T => {
    process.env.LANG_ENGINE = 'tinyld';
    try {
        return fn();
    } finally {
        delete process.env.LANG_ENGINE;
    }
};

afterEach(() => {
    delete process.env.LANG_ENGINE;
});

describe('identity table — results MUST match in both modes', () => {
    const IDENTICAL_INPUTS = [
        'مرحبا كيف حالك',                        // ar — script check precedes everything
        'こんにちは',                              // ja
        'Привет мир',                             // ru
        'sho hal as3ar',                          // Arabizi — ASCII, override structurally excluded
        'bkam el course',
        'kam el se3r',
        'kam el se3r 😍',                          // Arabizi + emoji — letter-gate keeps it identical (review-found hole)
        '3ayez a3raf el se3r 🤔',
        'i want to register',                     // English tinyld under-scores (en@0.13)
        'ICDL', 'ok', 'hello',
        'Hur kan man anmäla sig',                 // 'sv' both modes: quirk (legacy) & override (tinyld) agree
        'Hej, hur mår du? Jag är från Sverige',   // genuine Swedish — 'sv' both modes
        '...', '👍', '',
    ];

    it.each(IDENTICAL_INPUTS.map(t => [t]))('detectLanguageOrNull(%j) identical in both modes', (text) => {
        expect(inTinyldMode(() => detectLanguageOrNull(text))).toBe(detectLanguageOrNull(text));
    });
});

describe('tinyld mode — fixes the misread Latin classes (flag-gated)', () => {
    it('German umlaut text: legacy å/ä/ö quirk says sv, override corrects to de', () => {
        expect(detectLanguageOrNull('Ich möchte mich anmelden')).toBe('sv'); // legacy misread
        expect(inTinyldMode(() => detectLanguageOrNull('Ich möchte mich anmelden'))).toBe('de');
    });

    it('non-quirk Latin fallthrough: legacy says en, override names the language', () => {
        expect(detectLanguageOrNull('tôi muốn đăng ký')).toBe('en');
        expect(inTinyldMode(() => detectLanguageOrNull('tôi muốn đăng ký'))).toBe('vi');
        expect(detectLanguageOrNull('¿cuánto cuesta?')).toBe('en');
        expect(inTinyldMode(() => detectLanguageOrNull('¿cuánto cuesta?'))).toBe('es');
    });

    it('when the override declines (short/ambiguous), the legacy quirk stands', () => {
        // 'anmäla sig' — 2 words, weak margin (sv@0.11 vs da@0.09) → override
        // declines → falls to the å/ä/ö quirk → 'sv' in both modes.
        expect(inTinyldMode(() => detectLanguageOrNull('anmäla sig'))).toBe('sv');
        expect(detectLanguageOrNull('anmäla sig')).toBe('sv');
    });
});

describe('resolveInputLanguage — the production fix path', () => {
    const arabicHistory = [
        { role: 'user' as const, content: 'كم سعر دورة icdl' },
        { role: 'assistant' as const, content: 'سعر الدورة ٣٥ ألف ليرة. متى تحب تبدأ؟' },
    ];

    it('explicit backend override wins over Arabic history (how the fix lands)', () => {
        // In tinyld mode the backend detector resolves 'sv' and passes it as
        // request.language — step 1 of the chain, ahead of history.
        expect(resolveInputLanguage({
            comment: 'Hur kan man anmäla sig',
            language: 'sv',
            conversationHistory: arabicHistory,
        })).toBe('sv');
    });

    it('without the override the history-first design still anchors to Arabic (unchanged)', () => {
        // This is deliberate (bot-drift protection) and identical in both modes:
        // the current message is only consulted after user+assistant history.
        const input = {
            comment: 'Hur kan man anmäla sig',
            conversationHistory: arabicHistory,
        };
        expect(resolveInputLanguage(input)).toBe('ar');
        expect(inTinyldMode(() => resolveInputLanguage(input))).toBe('ar');
    });
});

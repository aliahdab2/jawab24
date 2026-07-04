/**
 * Phase-1b dual-mode regression suite for the backend detector surface.
 *
 * Two jobs:
 *  1. IDENTITY TABLE — inputs whose detection result MUST be bit-identical in
 *     legacy and tinyld modes (Arabic, English, Arabizi, acronyms, noise, and
 *     every language the legacy branches already name). This is the flip-safety
 *     contract: with LANG_ENGINE=tinyld, the ONLY inputs allowed to change are
 *     non-ASCII Latin sentences that every legacy branch mis-floored to en@0.5.
 *  2. THE BUG — "Hur kan man anmäla sig" (Swedish DM to the Damascus institute,
 *     2026-07-04): legacy mis-floors it to en@0.5, which trips the DM
 *     deferToHistory gate (generator.ts) and anchors the reply to the Arabic
 *     thread history. In tinyld mode it must resolve to 'sv' and clear the gate.
 *
 * The existing test/utils/language.test.ts pins legacy behavior (flag unset).
 * This file toggles the flag per test — the engine reads it lazily per call.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { detectLanguage, detectLanguageCode, detectTemplateLanguage, isLowSignalLatinToken } from '../../src/utils/language';

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
    // Arabizi is the highest-stakes row: tinyld confidently mislabels it
    // (rn@1.00 / eo@1.00) and the non-ASCII gate is what keeps it safe.
    const IDENTICAL_INPUTS = [
        // Arabic (the money path — never reaches the override)
        'مرحبا كيف حالك',
        'كم السعر؟',
        'Hello مرحبا',
        // Arabizi / Franco-Arabic (ASCII → structurally excluded from override)
        'sho hal as3ar',
        'bkam el course',
        'kam el se3r',
        'salam kifak',
        'ana baddi sajjel',
        // English, incl. sentences tinyld itself scores low (en@0.13)
        'Hello, how are you doing today?',
        'i want to register',
        'which course do you offer',
        'How i can apply ?',
        // Bare tokens (the "icdl" contract)
        'ICDL', 'icdl', 'ok', 'iPhone', 'hello', 'thanks',
        // Languages legacy already names (never reach the fallthrough)
        'Merhaba, nasılsınız? Teşekkürler.',
        'Bonjour, comment allez-vous? C\'est très bien.',
        'Hola, ¿cómo estás? Es un buen día.',
        'Hej, hur mår du? Jag är från Sverige',
        'İstanbul',
        // Noise
        '...', '👍', '123 456 789 !@#$%', '',
    ];

    it.each(IDENTICAL_INPUTS.map(t => [t]))('detectLanguage(%j) identical in both modes', (text) => {
        const legacy = detectLanguage(text);
        const tinyld = inTinyldMode(() => detectLanguage(text));
        expect(tinyld).toEqual(legacy);
    });

    it('isLowSignalLatinToken identical in both modes (ASCII gate ⊃ its ASCII requirement)', () => {
        for (const t of ['icdl', 'ICDL', 'ok', 'hello', 'which course', 'sho hal as3ar', 'مرحبا', '...']) {
            expect(inTinyldMode(() => isLowSignalLatinToken(t))).toBe(isLowSignalLatinToken(t));
        }
    });
});

describe('the Swedish bug — fixed in tinyld mode only', () => {
    const SWEDISH_DM = 'Hur kan man anmäla sig';

    it('legacy mode reproduces the bug (mis-floored to en@0.5)', () => {
        const r = detectLanguage(SWEDISH_DM);
        expect(r.language).toBe('en');
        expect(r.confidence).toBe(0.5);
    });

    it('tinyld mode resolves it to Swedish', () => {
        const r = inTinyldMode(() => detectLanguage(SWEDISH_DM));
        expect(r.language).toBe('sv');
        expect(r.script).toBe('Latin');
        expect(r.isRTL).toBe(false);
    });

    it('clears the DM deferToHistory gate (the exact generator.ts computation)', () => {
        // Replicates generator.ts generateForMessage: with prior Arabic history,
        // a low-confidence-Latin read sends language:undefined to the ai-worker,
        // whose history-first chain anchors to Arabic — the production failure.
        const gate = (text: string) => {
            const { language: msgLang, confidence: msgConfidence } = detectLanguage(text);
            const isLowConfidenceLatin = msgLang === 'en' && msgConfidence < 0.6;
            return { defersToHistory: isLowConfidenceLatin, msgLang };
        };

        // Legacy: defers → Arabic history wins → Arabic reply to Swedish question.
        expect(gate(SWEDISH_DM)).toEqual({ defersToHistory: true, msgLang: 'en' });

        // tinyld: resolves 'sv' → gate keyed on 'en' never fires → 'sv' is passed
        // as the explicit language override and wins the ai-worker chain.
        expect(inTinyldMode(() => gate(SWEDISH_DM))).toEqual({ defersToHistory: false, msgLang: 'sv' });

        // Contract check: bare tokens still defer in BOTH modes.
        expect(gate('icdl').defersToHistory).toBe(true);
        expect(inTinyldMode(() => gate('icdl')).defersToHistory).toBe(true);
    });

    it('more mis-floored diacritic sentences get named in tinyld mode', () => {
        expect(inTinyldMode(() => detectLanguageCode('när börjar kursen'))).toBe('sv');
        expect(inTinyldMode(() => detectLanguageCode('tôi muốn đăng ký'))).toBe('vi');
        expect(inTinyldMode(() => detectLanguageCode('¿cuánto cuesta?'))).toBe('es');
    });

    it('detectTemplateLanguage follows: sv for the sentence, unknown for bare tokens', () => {
        expect(inTinyldMode(() => detectTemplateLanguage(SWEDISH_DM))).toBe('sv');
        expect(inTinyldMode(() => detectTemplateLanguage('icdl'))).toBe('unknown');
    });
});

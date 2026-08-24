import { describe, it, expect, afterEach } from 'vitest';
import { detectLanguage, isLowSignalLatinToken, resolveDmLanguageHint } from '../../src/utils/language';

/**
 * Pins the DM language gate — `resolveDmLanguageHint` in
 * packages/shared/src/language/detector.ts (re-exported via utils/language),
 * the single choke point shared by generateForMessage (production) and
 * generateForPlayground (eval/test tool).
 *
 * It decides whether the customer's current message sets the reply language or
 * whether the ai-worker's history-first chain does (hint `undefined` = defer).
 *
 * WHY THIS SUITE EXISTS: on 2026-07-29 that gate was replaced with
 * `isLowSignalLatinToken` — which looked strictly better, since it adds
 * ASCII-only and <=3 words on top of the same confidence floor — and the change
 * was REVERTED after end-to-end probing. These tests encode both halves of the
 * trade-off so the swap is not attempted a third time. (This file previously
 * re-implemented the gate expression inline; it now calls the production
 * helper directly, so it can no longer drift from what ships.)
 *
 * Every assertion runs against the real detector at prod parity
 * (LANG_ENGINE=tinyld).
 */

/** True when the production helper defers to the thread anchor (no hint sent). */
const gate = (text: string): boolean => resolveDmLanguageHint(text, true) === undefined;

afterEach(() => {
    delete process.env.LANG_ENGINE;
});

describe('the DM defer-to-history gate — Arabizi protection (do not narrow this)', () => {
    it('defers every Arabizi shape, including the ones isLowSignalLatinToken misses', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // All of these must defer: on an Arabic thread the customer is writing Arabic
        // in Latin letters, and the thread anchor is the only correct signal. Letting
        // them through is what once had the bot answering Arab customers in Spanish
        // (see packages/shared/src/language/__tests__/engine.test.ts).
        for (const arabizi of [
            'sho hal as3ar',
            'kam el se3r 😍',        // emoji → fails isLowSignalLatinToken's ASCII-only test
            '3ayez a3raf el se3r',   // 4 words → fails its <=3 word cap
            'bkam el course',
            'salam kifak habibi',
        ]) {
            expect(gate(arabizi)).toBe(true);
        }
    });

    it('shows exactly which Arabizi still loses its anchor under isLowSignalLatinToken', () => {
        process.env.LANG_ENGINE = 'tinyld';

        // The EMOJI half of the original objection is GONE: isLowSignalLatinToken now
        // discounts non-ASCII symbols before its shape checks, so these agree.
        for (const agreed of ['kam el se3r 😍', 'sho hal as3ar 😀', 'ok 👍']) {
            expect(gate(agreed)).toBe(true);
            expect(isLowSignalLatinToken(agreed)).toBe(true);
        }

        // Two gaps still separate them, and together they are why the DM gate was NOT
        // switched over:
        //   1. the <=3 word cap — 4+ word Arabizi defers under the blunt confidence
        //      gate but is out of scope for the predicate;
        //   2. ASCII punctuation, kept on purpose (see language.test.ts measurement).
        // Closing either needs its own decision and its own prod measurement.
        for (const stillLost of [
            '3ayez a3raf el se3r',
            'kifak ya 3ammi shu el akhbar',
            'kam el se3r?',
        ]) {
            expect(gate(stillLost)).toBe(true);
            expect(isLowSignalLatinToken(stillLost)).toBe(false);
        }
    });

    it('still defers bare tokens — the "ICDL" case the gate was written for', () => {
        expect(gate('ICDL')).toBe(true);
        expect(gate('ok')).toBe(true);
    });
});

describe('the DM defer-to-history gate — the accent-free French blind spot', () => {
    it('now tells clear accent-free French from a low-signal token (the ASCII-foreign promotion)', () => {
        process.env.LANG_ENGINE = 'tinyld';
        const french = detectLanguage('Bonjour Madame merci beaucoup pour les photos');
        const token = detectLanguage('ok');

        // Until 2026-08-24 these two were indistinguishable at this layer (both
        // en@0.5), so the French sentence deferred and inherited the thread's
        // language — the mechanism behind the prod rows where a French-speaking
        // Nourva customer was answered in English and Arabic (flag_reason
        // language_mismatch), and behind the Salla-test replay where «Quelles
        // tailles avez-vous ?» was answered in Arabic 4/4. The ASCII-foreign
        // promotion (engine.ts) now names a clear-margin tinyld call, so the
        // sentence resolves fr and clears the gate; the token still defers.
        expect(french.language).toBe('fr');
        expect(token.language).toBe('en');
        expect(gate('Bonjour Madame merci beaucoup pour les photos')).toBe(false);
        expect(gate('ok')).toBe(true);
    });

    it('RESIDUAL blind spots, unchanged by the promotion (accepted misses)', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // Mixed-language: "in" is an ENGLISH_COMMON word, so this scores a
        // POSITIVE English reading (en@0.6, identical in legacy mode) and never
        // reaches the override at all — it doesn't defer, it asserts English.
        // Pre-existing behavior, not a regression of this fix.
        expect(detectLanguage('Je voudrais hotel in tartous city').language).toBe('en');
        expect(gate('Je voudrais hotel in tartous city')).toBe(false);
        // es@0.07: genuine Spanish below the 0.12 floor still defers. Accepted
        // miss — raising recall here means lowering the floor, which re-admits
        // the junk residue (cs@0.04, pl@0.09, fi@0.09 Arabizi guesses).
        expect(gate('hola buenos dias')).toBe(true);
    });

    it('does NOT defer French once it carries a diacritic — that path already works', () => {
        process.env.LANG_ENGINE = 'tinyld';
        for (const accented of ['Ok merci beaucoup à vous', 'Où vous trouvez-vous ?']) {
            expect(detectLanguage(accented).language).toBe('fr');
            expect(gate(accented)).toBe(false);
        }
    });

    it('does not defer confident English or any non-Latin script', () => {
        expect(gate('How much is the price')).toBe(false);
        expect(gate('The price is too much')).toBe(false);
        expect(gate('كم سعر التوصيل؟')).toBe(false);
    });
});

describe('resolveDmLanguageHint — the hint values both reply paths send', () => {
    it('sends no hint for a Latin-floor message on a thread with history (the playground-drift regression)', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // The exact shape that exposed the drift: a bare Latin-script name
        // mid-Arabic-thread. Production deferred (Arabic reply); the playground
        // asserted 'en' and replied in English until both paths shared this helper.
        expect(resolveDmLanguageHint('Weaam Aldoukha', true)).toBeUndefined();
        expect(resolveDmLanguageHint('ICDL', true)).toBeUndefined();
    });

    it('keeps the en floor as the default when there is no history to defer to', () => {
        process.env.LANG_ENGINE = 'tinyld';
        expect(resolveDmLanguageHint('Weaam Aldoukha', false)).toBe('en');
        expect(resolveDmLanguageHint('ok', false)).toBe('en');
    });

    it('passes confident reads through regardless of history', () => {
        process.env.LANG_ENGINE = 'tinyld';
        expect(resolveDmLanguageHint('كم سعر التوصيل؟', true)).toBe('ar');
        expect(resolveDmLanguageHint('How much is the price', true)).toBe('en');
    });

    it('stops deferring for English the customer plainly wrote (prod 2026-08-16)', () => {
        // These sit at the en@0.5 floor (no ENGLISH_COMMON word matched), so on an
        // Arabic thread the hint used to be dropped and the reply came back in
        // Arabic. 39 such messages on Arabic threads in the prod corpus, including
        // customers asking, in English, to be answered in English.
        process.env.LANG_ENGINE = 'tinyld';
        expect(resolveDmLanguageHint('Speak English pls', true)).toBe('en');
        expect(resolveDmLanguageHint('No ARAB only ENGLISH', true)).toBe('en');
        expect(resolveDmLanguageHint('Good night', true)).toBe('en');
    });
});

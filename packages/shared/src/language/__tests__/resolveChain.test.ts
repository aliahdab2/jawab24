import { describe, it, expect, afterEach } from 'vitest';
import { detectLanguageOrNull, resolveInputLanguage, resolveInputLanguageWithSource } from '../resolveChain';

/**
 * First coverage for `resolveInputLanguage` — the function that decides the
 * language of EVERY reply. It had none before 2026-07-29.
 *
 * Written from a prod defect: a French-speaking Nourva customer asked
 * «Où vous trouvez-vous ?» twice and was answered in English both times.
 * `messages.flag_reason LIKE '%language_mismatch%'` = 156 all-time / 27 in the
 * trailing 30 days.
 *
 * The chain is history-first (see resolveChain.ts header). Its own comment says
 * user history precedes assistant history "so that bot drift … does not lock the
 * resolved language away from the customer's expressed preference" — but the
 * customer's OLDEST turn also outranked their NEWEST, so a genuine mid-thread
 * language switch could never take effect. Script-certain input now outranks the
 * anchor; Latin-script input deliberately does not.
 *
 * The Arabizi block is the load-bearing half of this suite. Arabic written in
 * Latin letters resolves to 'en' by construction (Latin is this module's default),
 * so it is INDISTINGUISHABLE from real English here and must always defer to
 * context. tinyld confidently mislabels it (es@0.75, rn@1.00), which once had the
 * bot answering Arab customers in Spanish — so any future change that promotes
 * Latin-script input past the anchor has to keep this block green.
 */

const ARABIC_THREAD = [
    { role: 'user' as const, content: 'مرحبا، عندكم توصيل؟' },
    { role: 'assistant' as const, content: 'أهلاً! نعم عندنا توصيل' },
];

const ENGLISH_THREAD = [
    { role: 'user' as const, content: 'Hello, do you deliver?' },
    { role: 'assistant' as const, content: 'Yes, we deliver everywhere.' },
];

/** Real shapes from Arabic social traffic, including the ones that broke before. */
const ARABIZI = [
    'sho hal as3ar',
    'kam el se3r 😍',          // emoji: a non-ASCII codepoint that is NOT a letter
    '3ayez a3raf el se3r',
    'bkam el course',
    'salam kifak habibi',
    '3aleena eh el prices 💰',
    'habibi kifak، please',    // Arabic comma (Script=Common) among Latin letters
    'kifak ya 3ammi shu el akhbar',
];

afterEach(() => {
    delete process.env.LANG_ENGINE;
});

describe('resolveInputLanguage — Arabizi must never re-anchor a thread', () => {
    it('keeps every Arabizi shape on the thread language', () => {
        process.env.LANG_ENGINE = 'tinyld';
        for (const comment of ARABIZI) {
            expect(resolveInputLanguage({ comment, conversationHistory: ARABIC_THREAD }))
                .toBe('ar');
        }
    });

    it('never resolves to a MISLABELLED Latin language, whatever the context', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // The invariant that matters: tinyld calls these Spanish/Kirundi/Esperanto with
        // high confidence, and none of that may ever reach the reply. 'en' (the Latin
        // default) or the context language are the only acceptable outcomes.
        const allowed = new Set(['ar', 'en']);
        for (const comment of ARABIZI) {
            for (const input of [
                { comment },
                { comment, conversationHistory: ARABIC_THREAD },
                { comment, postMessage: 'منشور بالعربية' },
                { comment, kbText: 'نص عربي عن المنتجات' },
                { comment, defaultReplyLanguage: 'ar' },
            ]) {
                expect(allowed).toContain(resolveInputLanguage(input));
            }
        }
    });

    it('KNOWN GAP: multi-word Arabizi with no history resolves en, ignoring post/KB/default', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // Pre-existing, NOT introduced by the 2026-07-29 change and deliberately not
        // fixed by it. `effectiveCommentLang` sits above post/KB/default in the chain,
        // and only a bare token (no whitespace, <=10 chars) is deferred past them — so
        // the "ICDL" fix never covered multi-word Arabizi. A first-contact Arabizi
        // comment on an Arabic post therefore gets an English reply.
        //
        // Not a one-line reorder: deferring all 'en' past post/KB would also send a
        // genuine English first comment on an Arabic post to Arabic. Needs prod
        // measurement of the two populations before changing.
        for (const comment of ARABIZI) {
            expect(resolveInputLanguage({ comment, postMessage: 'منشور بالعربية' })).toBe('en');
            expect(resolveInputLanguage({ comment, kbText: 'نص عربي عن المنتجات' })).toBe('en');
            expect(resolveInputLanguage({ comment, defaultReplyLanguage: 'ar' })).toBe('en');
        }
        // A bare token IS covered — this is what the "ICDL" fix protects.
        expect(resolveInputLanguage({ comment: 'ICDL', postMessage: 'منشور بالعربية' })).toBe('ar');
    });

    it('is identical in legacy and tinyld mode — the guard is structural, not statistical', () => {
        for (const comment of ARABIZI) {
            delete process.env.LANG_ENGINE;
            const legacy = resolveInputLanguage({ comment, conversationHistory: ARABIC_THREAD });
            process.env.LANG_ENGINE = 'tinyld';
            const tinyld = resolveInputLanguage({ comment, conversationHistory: ARABIC_THREAD });
            expect(tinyld).toBe(legacy);
            expect(tinyld).toBe('ar');
        }
    });
});

describe('resolveInputLanguage — a customer switching language mid-thread', () => {
    it('answers an Arabic question in Arabic, not the thread\'s English', () => {
        // Script-certain: no Latin in the message, so the language came from a Unicode
        // script property and cannot be a mis-guess. This is the case the change fixes.
        expect(resolveInputLanguage({
            comment: 'كم سعر التوصيل إلى طرابلس؟',
            conversationHistory: ENGLISH_THREAD,
        })).toBe('ar');
    });

    it('promotes any script-certain language, not just Arabic', () => {
        expect(resolveInputLanguage({
            comment: 'Сколько стоит доставка?',
            conversationHistory: ENGLISH_THREAD,
        })).toBe('ru');
        expect(resolveInputLanguage({
            comment: '配送料はいくらですか',
            conversationHistory: ARABIC_THREAD,
        })).toBe('ja');
    });

    it('does NOT promote Latin-script input, even when a language is named — KNOWN LIMITATION', () => {
        process.env.LANG_ENGINE = 'tinyld';
        // «Où vous trouvez-vous ?» is correctly detected 'fr' in isolation, yet resolves
        // to the thread's Arabic. Promoting named Latin languages was tried on
        // 2026-07-29 and reverted: tinyld called «Oui ça va mien et la famill ??»
        // TURKISH, so the promotion would have replaced a correct anchor with a wrong
        // guess — and the same door is what lets Arabizi through as Spanish.
        //
        // NOTE: an earlier version of this comment claimed production is unaffected
        // because "the backend detects it 'fr' with high confidence". That is only true
        // in tinyld mode, which this test enables. In the LEGACY mode that production
        // actually runs, the backend reads «Où vous trouvez-vous ?» as en@0.5 — measured
        // 2026-07-29 — so production IS affected, and the fix is at the prompt layer
        // (the read is uncertain ⇒ soft directive ⇒ the model mirrors French), not here.
        expect(resolveInputLanguage({
            comment: 'Où vous trouvez-vous ?',
            conversationHistory: ARABIC_THREAD,
        })).toBe('ar');
    });

    it('treats mixed Arabic + a Latin brand name as not script-certain', () => {
        // «كم سعر Nourva؟» contains Latin, so it defers to the anchor. Conservative on
        // purpose: any Latin at all reopens the Arabizi ambiguity above.
        expect(resolveInputLanguage({
            comment: 'كم سعر Nourva؟',
            conversationHistory: ENGLISH_THREAD,
        })).toBe('en');
    });
});

describe('resolveInputLanguage — the rest of the chain', () => {
    it('lets an explicit language win outright', () => {
        expect(resolveInputLanguage({
            comment: 'كم سعر التوصيل؟',
            language: 'tr',
            conversationHistory: ARABIC_THREAD,
        })).toBe('tr');
    });

    it('prefers user history over assistant history (no bot drift)', () => {
        expect(resolveInputLanguage({
            comment: '...',
            conversationHistory: [
                { role: 'user', content: 'مرحبا، عندكم توصيل؟' },
                { role: 'assistant', content: 'Sorry, we deliver everywhere.' },
            ],
        })).toBe('ar');
    });

    it('keeps bare Latin tokens on the thread language (the "ICDL" bug)', () => {
        for (const comment of ['ok', 'ICDL', 'Hi', 'Yes']) {
            expect(resolveInputLanguage({ comment, conversationHistory: ARABIC_THREAD }))
                .toBe('ar');
        }
    });

    it('keeps English-detected input deferring to history', () => {
        // A real English sentence and an Arabizi sentence both detect 'en', so 'en' is
        // weak evidence and must not re-anchor. Production passes an explicit
        // `language` for confident English, which is the test above.
        expect(resolveInputLanguage({
            comment: 'How much is the price',
            conversationHistory: ARABIC_THREAD,
        })).toBe('ar');
    });

    it('falls through to post, then KB, then the merchant default, then en', () => {
        expect(resolveInputLanguage({ comment: '...', postMessage: 'منشور بالعربية' })).toBe('ar');
        expect(resolveInputLanguage({ comment: '...', kbText: 'نص عربي' })).toBe('ar');
        expect(resolveInputLanguage({ comment: '...', defaultReplyLanguage: 'fr' })).toBe('fr');
        expect(resolveInputLanguage({ comment: '...' })).toBe('en');
    });

    it('defers a bare token past post and KB, but still uses it as a last resort', () => {
        expect(resolveInputLanguage({ comment: 'ICDL', postMessage: 'منشور بالعربية' })).toBe('ar');
        expect(resolveInputLanguage({ comment: 'ICDL' })).toBe('en');
    });

    it('names Bengali and Tamil, so they outrank an Arabic post (prod 2026-08-16)', () => {
        // «অনেক সুন্দর» on an Arabic post was answered in Arabic: this module had no
        // Bengali branch, so the script named nothing and the chain fell through to
        // the post. Script-certain input (no Latin at all) outranks post and history.
        expect(detectLanguageOrNull('অনেক সুন্দর')).toBe('bn');
        expect(detectLanguageOrNull('வணக்கம்')).toBe('ta');
        expect(resolveInputLanguage({ comment: 'অনেক সুন্দর', postMessage: 'منشور بالعربية' })).toBe('bn');
        expect(resolveInputLanguage({ comment: 'অনেক সুন্দর', conversationHistory: ARABIC_THREAD })).toBe('bn');
    });

    it('reads a named script as a POSITIVE signal, so the prompt may assert it', () => {
        // fromCurrentMessage gates the strong reply-language directive. A script
        // property cannot be a mis-guess, so these must be positive reads.
        for (const [comment, lang] of [['অনেক সুন্দর', 'bn'], ['வணக்கம்', 'ta']] as const) {
            const r = resolveInputLanguageWithSource({ comment, postMessage: 'منشور بالعربية' });
            expect(r).toMatchObject({ language: lang, source: 'current-message-script-certain', fromCurrentMessage: true });
        }
    });
});

/**
 * Provenance (added 2026-07-29). The prompt may only assert "the customer wrote in X"
 * when X is a POSITIVE reading of the current message; otherwise it must present X as
 * the thread default and let the model mirror the customer. See languageDirective.
 */
describe('resolveInputLanguageWithSource — provenance', () => {
    it('reports the same language as resolveInputLanguage for every input', () => {
        const inputs: Parameters<typeof resolveInputLanguage>[0][] = [
            { comment: 'Quels cours proposez-vous ?', conversationHistory: ARABIC_THREAD },
            { comment: 'ما هي الدورات؟', conversationHistory: ARABIC_THREAD },
            { comment: 'ICDL', postMessage: 'منشور بالعربية' },
            { comment: '...', defaultReplyLanguage: 'fr' },
            { comment: 'How much is the price', conversationHistory: ARABIC_THREAD },
            { comment: 'anything', language: 'tr' },
            { comment: '...' },
        ];
        for (const input of inputs) {
            expect(resolveInputLanguageWithSource(input).language).toBe(resolveInputLanguage(input));
        }
    });

    it('an explicit caller language is a positive read only when the MESSAGE is identifiable', () => {
        // Evidenced Turkish (chars + the function word "için") → the caller's 'tr' is real.
        expect(resolveInputLanguageWithSource({ comment: 'Bu kurs için fiyat ne kadar?', language: 'tr' }))
            .toMatchObject({ language: 'tr', source: 'explicit', fromCurrentMessage: true });

        // Char-only Turkish (a bare `ı`, no Turkish word) is a characters-only guess. 'tr'
        // stays the default but must not be asserted as what the customer wrote.
        expect(resolveInputLanguageWithSource({ comment: 'Hangi kurslarınız var?', language: 'tr' }))
            .toMatchObject({ language: 'tr', source: 'explicit', fromCurrentMessage: false });

        // The backend passes 'en' for the en@0.5 floor — accent-free French included.
        expect(resolveInputLanguageWithSource({ comment: 'Quels cours proposez-vous ?', language: 'en' }))
            .toMatchObject({ language: 'en', source: 'explicit', fromCurrentMessage: false });

        // …and the POST's language for a low-signal comment token, which is a sensible
        // default but not a reading of the customer's words.
        expect(resolveInputLanguageWithSource({ comment: 'ICDL', language: 'ar' }))
            .toMatchObject({ language: 'ar', source: 'explicit', fromCurrentMessage: false });
    });

    it('a real English message IS a positive read (the Arabic-drift guard must stay hard)', () => {
        // en@0.7 — "the", "is", "too" are real English stopwords. 114 of 156 historical
        // language_mismatch flags were expected:en → reply:ar on exactly this shape, so
        // this case must keep the hard "You MUST reply in English" directive.
        expect(resolveInputLanguageWithSource({ comment: 'The price is too much', language: 'en' }))
            .toMatchObject({ language: 'en', source: 'explicit', fromCurrentMessage: true });
    });

    it('script-certain input is a positive read', () => {
        expect(resolveInputLanguageWithSource({ comment: 'ما هي الدورات؟', conversationHistory: ENGLISH_THREAD }))
            .toMatchObject({ language: 'ar', source: 'current-message-script-certain', fromCurrentMessage: true });
    });

    it('THE BUG: accent-free French on an English thread resolves en from the ANCHOR, not the message', () => {
        expect(resolveInputLanguageWithSource({
            comment: 'Quels cours proposez-vous ?',
            conversationHistory: ENGLISH_THREAD,
        })).toMatchObject({ language: 'en', source: 'user-history', fromCurrentMessage: false });
    });

    it('a Latin-script en read off the current message is NOT positive (no positive English rule exists here)', () => {
        // Nothing else claimed it, so line 88 returned the generic Latin default.
        expect(resolveInputLanguageWithSource({ comment: 'Quels cours proposez-vous ?' }))
            .toMatchObject({ language: 'en', source: 'current-message', fromCurrentMessage: false });
    });

    it('post, KB and merchant default are never positive reads', () => {
        expect(resolveInputLanguageWithSource({ comment: '...', postMessage: 'منشور بالعربية' }))
            .toMatchObject({ source: 'post', fromCurrentMessage: false });
        expect(resolveInputLanguageWithSource({ comment: '...', kbText: 'نص عربي' }))
            .toMatchObject({ source: 'kb', fromCurrentMessage: false });
        expect(resolveInputLanguageWithSource({ comment: '...', defaultReplyLanguage: 'fr' }))
            .toMatchObject({ source: 'merchant-default', fromCurrentMessage: false });
    });

    it('a bare ambiguous token is not a positive read even as the last resort', () => {
        expect(resolveInputLanguageWithSource({ comment: 'ICDL' }))
            .toMatchObject({ language: 'en', source: 'current-message-ambiguous', fromCurrentMessage: false });
    });
});

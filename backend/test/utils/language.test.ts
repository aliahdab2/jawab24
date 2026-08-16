import { describe, it, expect } from 'vitest';
import {
    detectLanguage,
    detectLanguageCode,
    detectTemplateLanguage,
    isLowSignalLatinToken,
    isRTL,
    getLanguageName,
    isCertainDetection,
    MIN_CERTAIN_CONFIDENCE,
    SupportedLanguage,
} from '../../src/utils/language';

describe('Language Detection Utility', () => {
    describe('detectLanguage', () => {
        it('should detect Arabic text', () => {
            const result = detectLanguage('مرحبا كيف حالك');
            expect(result.language).toBe('ar');
            expect(result.isRTL).toBe(true);
            expect(result.script).toBe('Arabic');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should detect Arabic with mixed content', () => {
            const result = detectLanguage('Hello مرحبا');
            // Should still detect Arabic if Arabic chars are significant
            expect(result.language).toBe('ar');
            expect(result.isRTL).toBe(true);
        });

        it('should detect English text', () => {
            const result = detectLanguage('Hello, how are you doing today?');
            expect(result.language).toBe('en');
            expect(result.isRTL).toBe(false);
            expect(result.script).toBe('Latin');
        });

        it('should detect English with common words', () => {
            const result = detectLanguage('The quick brown fox jumps over the lazy dog');
            expect(result.language).toBe('en');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should detect Swedish text with special characters', () => {
            const result = detectLanguage('Hej, hur mår du? Jag är från Sverige');
            expect(result.language).toBe('sv');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Swedish text using common words', () => {
            const result = detectLanguage('Det är en bra dag och jag har det bra');
            expect(result.language).toBe('sv');
        });

        it('should detect Swedish text with å character', () => {
            const result = detectLanguage('Vi går till parken');
            expect(result.language).toBe('sv');
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should detect Swedish by common words without special chars', () => {
            // Needs at least 2 Swedish common words (och, det, att, som, etc.)
            const result = detectLanguage('det och att som test');
            expect(result.language).toBe('sv');
        });

        it('should handle empty text', () => {
            const result = detectLanguage('');
            expect(result.language).toBe('unknown');
            expect(result.confidence).toBe(0);
        });

        it('should handle whitespace only', () => {
            const result = detectLanguage('   \t\n  ');
            expect(result.language).toBe('unknown');
        });

        it('should detect Turkish text', () => {
            const result = detectLanguage('Merhaba, nasılsınız? Teşekkürler.');
            expect(result.language).toBe('tr');
        });

        it('should detect Turkish text with common words and unique chars', () => {
            const result = detectLanguage('Bu bir şey için ve bu da güzel');
            expect(result.language).toBe('tr');
            expect(result.confidence).toBeGreaterThanOrEqual(0.85);
        });

        it('should detect German text', () => {
            // Use ß (sharp s) which is unique to German
            const result = detectLanguage('Das ist sehr schön und ich bin sehr glücklich darüber');
            expect(result.language).toBe('de');
        });

        it('should detect French text', () => {
            const result = detectLanguage('Bonjour, comment allez-vous? C\'est très bien.');
            expect(result.language).toBe('fr');
        });

        it('should detect Spanish text', () => {
            const result = detectLanguage('Hola, ¿cómo estás? Es un buen día.');
            expect(result.language).toBe('es');
        });

        it('should detect Hebrew script as unknown RTL', () => {
            const result = detectLanguage('שלום עולם');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Hebrew');
            expect(result.isRTL).toBe(true);
            expect(result.confidence).toBe(0.8);
        });

        it('should detect CJK characters as unknown', () => {
            const result = detectLanguage('你好世界');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('CJK');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Japanese text as unknown', () => {
            // Pure hiragana/katakana without kanji (CJK) to hit the Japanese branch
            const result = detectLanguage('こんにちは');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Japanese');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Korean text as unknown', () => {
            const result = detectLanguage('안녕하세요');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Korean');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Cyrillic text as unknown', () => {
            const result = detectLanguage('Привет мир');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Cyrillic');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Thai text as unknown', () => {
            const result = detectLanguage('สวัสดีครับ');
            expect(result.language).toBe('unknown');
            expect(result.script).toBe('Thai');
            expect(result.isRTL).toBe(false);
        });

        it('should detect Turkish by unique chars without common words (fallback)', () => {
            // İ is a unique Turkish char; no Turkish common words present. Turkish is still
            // the answer at the same 0.75, but it is now marked as a GUESS — a place name is
            // not proof of the sentence's language, and the same branch fires on French
            // «Combien ça coûte ?» off a bare cedilla.
            const result = detectLanguage('İstanbul');
            expect(result.language).toBe('tr');
            expect(result.confidence).toBe(0.75);
            expect(result.evidence).toBe('characters-only');
            expect(isCertainDetection(result)).toBe(false);
        });

        it('should handle numbers and symbols', () => {
            const result = detectLanguage('123 456 789 !@#$%');
            // No alphabetic characters — language is indeterminate
            expect(result.language).toBe('unknown');
        });

        it('should handle emojis with text', () => {
            const result = detectLanguage('Hello! 👋 How are you? 😊');
            expect(result.language).toBe('en');
        });

        it('should handle Arabic emojis with text', () => {
            const result = detectLanguage('مرحبا! 👋 كيف حالك؟ 😊');
            expect(result.language).toBe('ar');
        });
    });

    describe('detectLanguageCode', () => {
        it('should return just the language code', () => {
            expect(detectLanguageCode('Hello world')).toBe('en');
            expect(detectLanguageCode('مرحبا')).toBe('ar');
            expect(detectLanguageCode('Hej på dig')).toBe('sv');
        });
    });

    describe('isRTL', () => {
        it('should return true for Arabic', () => {
            expect(isRTL('مرحبا')).toBe(true);
        });

        it('should return false for English', () => {
            expect(isRTL('Hello')).toBe(false);
        });

        it('should return false for Swedish', () => {
            expect(isRTL('Hej')).toBe(false);
        });
    });

    describe('getLanguageName', () => {
        it('should return correct language names', () => {
            expect(getLanguageName('ar')).toBe('Arabic');
            expect(getLanguageName('en')).toBe('English');
            expect(getLanguageName('sv')).toBe('Swedish');
            expect(getLanguageName('de')).toBe('German');
            expect(getLanguageName('fr')).toBe('French');
            expect(getLanguageName('es')).toBe('Spanish');
            expect(getLanguageName('tr')).toBe('Turkish');
            expect(getLanguageName('unknown')).toBe('Unknown');
        });
    });

    describe('Real-world examples', () => {
        it('should handle typical Facebook comments in Arabic', () => {
            const comments = [
                'كم السعر؟',
                'متى التوصيل؟',
                'شكرا جزيلا',
                'هل يوجد خصم؟',
                'ممتاز جدا 👍',
            ];
            
            for (const comment of comments) {
                const result = detectLanguage(comment);
                expect(result.language).toBe('ar');
            }
        });

        it('should handle typical Facebook comments in English', () => {
            const comments = [
                'What is the price?',
                'When can you deliver?',
                'Thanks a lot!',
                'Is there a discount?',
                'Great product! 👍',
            ];
            
            for (const comment of comments) {
                const result = detectLanguage(comment);
                expect(result.language).toBe('en');
            }
        });

        it('should handle short one-word comments', () => {
            // Short comments are harder to detect accurately
            expect(detectLanguage('شكرا').language).toBe('ar');
            expect(detectLanguage('Thanks').language).toBe('en');
        });
    });

    describe('Punctuation-only comments (trigger keyword scenarios)', () => {
        // These comments are common in engagement posts ("comment . to get details")
        // Language detection returns "unknown" — callers should fall back to post language

        it('should return unknown for single dot', () => {
            expect(detectLanguageCode('.')).toBe('unknown');
        });

        it('should return unknown for multiple dots', () => {
            expect(detectLanguageCode('..')).toBe('unknown');
            expect(detectLanguageCode('...')).toBe('unknown');
            expect(detectLanguageCode('....')).toBe('unknown');
        });

        it('should return unknown for other punctuation', () => {
            expect(detectLanguageCode('!!!')).toBe('unknown');
            expect(detectLanguageCode('???')).toBe('unknown');
            expect(detectLanguageCode('#')).toBe('unknown');
        });

        it('should return unknown for emoji-only', () => {
            expect(detectLanguageCode('👍')).toBe('unknown');
            expect(detectLanguageCode('🔥🔥')).toBe('unknown');
            expect(detectLanguageCode('❤️')).toBe('unknown');
        });

        it('post language fallback: Arabic post detectable from content', () => {
            // This simulates the generator fallback logic
            const commentLang = detectLanguageCode('.');
            const postMessage = 'يعلن الفريق الدمشقي عن استمرار التسجيل على كورس المكياج';
            const effectiveLang = commentLang !== 'unknown' ? commentLang
                : detectLanguageCode(postMessage);
            expect(effectiveLang).toBe('ar');
        });

        it('post language fallback: Turkish post detectable from content', () => {
            const commentLang = detectLanguageCode('.');
            const postMessage = 'Makyaj kursuna kayıt için lütfen iletişime geçin';
            const effectiveLang = commentLang !== 'unknown' ? commentLang
                : detectLanguageCode(postMessage);
            expect(effectiveLang).toBe('tr');
        });

        it('post language fallback: English post detectable from content', () => {
            const commentLang = detectLanguageCode('..');
            const postMessage = 'Register for our makeup course now and get a discount';
            const effectiveLang = commentLang !== 'unknown' ? commentLang
                : detectLanguageCode(postMessage);
            expect(effectiveLang).toBe('en');
        });

        it('post language fallback: comment with real text ignores post', () => {
            // When the comment has detectable language, post language is not used
            const commentLang = detectLanguageCode('كم السعر؟');
            const postMessage = 'Register for our makeup course';
            const effectiveLang = commentLang !== 'unknown' ? commentLang
                : detectLanguageCode(postMessage);
            expect(effectiveLang).toBe('ar');
        });
    });

    describe('isLowSignalLatinToken (the "icdl" gate)', () => {
        it('is true for a bare Latin acronym / product name with no language signal', () => {
            expect(isLowSignalLatinToken('icdl')).toBe(true);
            expect(isLowSignalLatinToken('ICDL')).toBe(true);
            expect(isLowSignalLatinToken('iPhone')).toBe(true);
            expect(isLowSignalLatinToken('Excel')).toBe(true);
            expect(isLowSignalLatinToken('  icdl  ')).toBe(true); // trims first
        });

        it('is false for a genuine short English phrase (matched function word → confidence > 0.5)', () => {
            expect(isLowSignalLatinToken('which course')).toBe(false);
            expect(isLowSignalLatinToken('how much')).toBe(false);
            expect(isLowSignalLatinToken('hello')).toBe(false); // "hello" ∈ ENGLISH_COMMON
        });

        it('is false for non-Latin scripts (they carry a real signal)', () => {
            expect(isLowSignalLatinToken('مرحبا')).toBe(false);
            expect(isLowSignalLatinToken('دورة')).toBe(false);
        });

        it('is false for punctuation / emoji / empty (unknown, not English)', () => {
            expect(isLowSignalLatinToken('...')).toBe(false);
            expect(isLowSignalLatinToken('👍')).toBe(false);
            expect(isLowSignalLatinToken('')).toBe(false);
            expect(isLowSignalLatinToken('   ')).toBe(false);
        });

        it('is false for a longer Latin sentence (word-count safety cap)', () => {
            expect(isLowSignalLatinToken('please send me the price list now')).toBe(false);
        });
    });

    describe('isLowSignalLatinToken — letters WITH punctuation or emoji', () => {
        /**
         * The gate above tests punctuation and emoji in ISOLATION ('...', '👍'), which
         * correctly return false: no letters means no language at all. Letters PLUS
         * punctuation was never covered, and that is where it breaks — the ASCII test
         * is /^[a-zA-Z0-9\s]+$/, so one '?' or one emoji disqualifies the whole string.
         *
         * This is the failure mode the authors already called "accidental" about the
         * PREVIOUS gate (see commentPreprocess.ts: "flipped 'which course' to Arabic yet
         * kept 'what course?' English purely because of the trailing '?'"). The
         * confidence floor was added to fix it, but the ASCII cap carried it forward.
         *
         * Live blast radius: resolveCommentLanguage (comment replies) and
         * resolveFallbackLanguage (away / quota templates) both key on this predicate.
         */
        it('treats a token the same with or without a trailing emoji', () => {
            expect(isLowSignalLatinToken('ok')).toBe(true);
            expect(isLowSignalLatinToken('ok 👍')).toBe(true);
            expect(isLowSignalLatinToken('Excel 🙏')).toBe(true);
            expect(isLowSignalLatinToken('DONE 🙏🌷')).toBe(true);
        });

        it('treats Arabizi the same with or without an emoji', () => {
            // Extremely common real traffic. Losing the token classification here sent
            // the reply to English on an Arabic post.
            expect(isLowSignalLatinToken('kam el se3r')).toBe(true);
            expect(isLowSignalLatinToken('kam el se3r 😍')).toBe(true);
            expect(isLowSignalLatinToken('sho hal as3ar 😀')).toBe(true);
            expect(isLowSignalLatinToken('Allah mma barik 💖💕❤️🌹')).toBe(true);
        });

        it('KEEPS ASCII punctuation significant — deliberate, and measured', () => {
            // Stripping ASCII punctuation too was tried and rejected: measured against
            // 7,500 real prod messages it flipped 58.5% of traffic (vs 1.5% for the
            // emoji-only rule), and it broke genuine English prose — "I don't
            // understand" and "I'm coming" became "tokens" once the apostrophe went,
            // which would have answered them in the merchant's default language.
            // The apostrophe/bracket is an effective proxy for "prose, not a product
            // name", so the safety cap keeps it.
            expect(isLowSignalLatinToken("I don't understand")).toBe(false);
            expect(isLowSignalLatinToken("I'm coming")).toBe(false);
            expect(isLowSignalLatinToken('[Sticker]')).toBe(false);
            expect(isLowSignalLatinToken('[Image]')).toBe(false);

            // Consequence, accepted: a trailing '?' still disqualifies a real token.
            // Not worth widening the rule for — see the measurement above.
            expect(isLowSignalLatinToken('ICDL?')).toBe(false);
            expect(isLowSignalLatinToken('kam el se3r?')).toBe(false);
        });

        it('still keeps genuine English questions out, punctuation or not', () => {
            // The confidence floor (<=0.5) is the real discriminator and is unaffected by
            // stripping punctuation: every one of these sits at 0.6+.
            for (const t of [
                'how much', 'how much?',
                'which course', 'which course?',
                'what is the price?', 'do you deliver?', 'hello!',
            ]) {
                expect(isLowSignalLatinToken(t)).toBe(false);
            }
        });

        it('still returns false when there are no letters at all', () => {
            for (const t of ['...', '👍', '', '   ', '?!', '123', '?123?']) {
                expect(isLowSignalLatinToken(t)).toBe(false);
            }
        });

        it('still respects the word-count cap once punctuation is discounted', () => {
            // 4+ real words remain out of scope for this predicate by design.
            expect(isLowSignalLatinToken('3ayez a3raf el se3r')).toBe(false);
            expect(isLowSignalLatinToken('please send me the price list now!')).toBe(false);
        });
    });

    describe('genuine short English is NOT a low-signal token (prod 2026-08-16)', () => {
        /**
         * "Very nice" on Jawab24's own Arabic boosted post was answered in Arabic.
         * It matches no ENGLISH_COMMON word, so it scored en@0.5 — the same score as
         * the acronym "ICDL" — and resolveCommentLanguage mirrored the post.
         *
         * The detector now consults tinyld for pure-ASCII text at that floor
         * (isConfidentAsciiEnglish), which raises BOTH gates: the token predicate
         * below and isCertainDetection, so the prompt asserts English instead of
         * hinting at it. The guards that make this safe are pinned right after.
         */
        it('reads praise / short prose as certain English', () => {
            for (const t of ['Very nice', 'Good morning man', 'Speak English pls', 'Good job']) {
                expect(isLowSignalLatinToken(t)).toBe(false);
                expect(detectLanguage(t).language).toBe('en');
                expect(isCertainDetection(detectLanguage(t))).toBe(true);
            }
        });

        it('leaves Arabizi, names and bare tokens exactly where they were', () => {
            // Each of these keeps deferring to conversation / post context.
            for (const t of ['kam el se3r', 'sho hal as3ar', 'Weaam Aldoukha', 'Kawthar Mohammed', 'icdl', 'ok']) {
                expect(isLowSignalLatinToken(t)).toBe(true);
                expect(isCertainDetection(detectLanguage(t))).toBe(false);
            }
        });

        it('cannot overrule a positive reading — only the "recognized nothing" floor', () => {
            // englishMatches > 0 short-circuits before the promotion, so text legacy
            // already scored stays bit-identical.
            expect(detectLanguage('how much').confidence).toBe(0.6);
            expect(detectLanguage('what is the price?').confidence).toBeGreaterThanOrEqual(0.7);
            // Arabic and other named scripts never reach the Latin branch at all.
            expect(detectLanguage('مرحبا كيف حالك').language).toBe('ar');
        });
    });

    describe('detectTemplateLanguage (away / greeting / fallback variant picker)', () => {
        it('returns "unknown" for a bare Latin token so callers use the merchant default', () => {
            expect(detectTemplateLanguage('icdl')).toBe('unknown');
            expect(detectTemplateLanguage('iPhone')).toBe('unknown');
        });

        it('preserves a genuine language signal', () => {
            expect(detectTemplateLanguage('كم السعر؟')).toBe('ar');
            expect(detectTemplateLanguage('how much is it?')).toBe('en');
            expect(detectTemplateLanguage('hello')).toBe('en');
        });
    });

    /**
     * The single source of truth for "did we actually identify this text?" — consumed by
     * the DM deferToHistory gate AND by the reply-language directive's certainty signal,
     * so the two can never drift. Rows are real shapes from the 30-day prod corpus.
     */
    describe('isCertainDetection', () => {
        const certainty = (text: string) => isCertainDetection(detectLanguage(text));

        it('is FALSE for the en@0.5 floor — "Latin script, recognized nothing"', () => {
            // 68.77% of Latin-script inbound traffic looks like this. None of it may be
            // asserted to the model as "the customer wrote in English".
            expect(certainty('Quels cours proposez-vous ?')).toBe(false); // accent-free French
            expect(certainty('13k lang po Yung marketing management')).toBe(false); // Tagalog
            expect(certainty('160 dinar right')).toBe(false);
            expect(certainty('kam el se3r')).toBe(false); // Arabizi
            expect(certainty('ICDL')).toBe(false);
        });

        it('is FALSE for text with no language signal at all', () => {
            expect(certainty('...')).toBe(false);
            expect(certainty('👍')).toBe(false);
            expect(certainty('')).toBe(false);
        });

        it('is TRUE for English with real English stopwords', () => {
            expect(certainty('What is the price of the nursing course please?')).toBe(true);
            expect(certainty('Hello, how are you doing today?')).toBe(true);
        });

        it('is TRUE for a named non-English language with real evidence', () => {
            expect(certainty('ما هي الدورات المتوفرة؟')).toBe(true); // Arabic script
            expect(certainty('Bu kurs için fiyat ne kadar?')).toBe(true); // Turkish chars + "için"
        });

        it('is FALSE for a language named from CHARACTERS ALONE', () => {
            // These still resolve to 'tr' — they just stop being asserted as the
            // customer's language. The cedilla cases are why: the same branch called
            // «Combien ça coûte ?» Turkish and the bot answered a French customer in
            // Turkish (prod, 30-day corpus, 2026-07-29).
            expect(certainty('Hangi kurslarınız var?')).toBe(false);
            expect(certainty('Merhaba, nasılsınız? Teşekkürler.')).toBe(false);
            expect(certainty('Combien ça coûte ?')).toBe(false);
            expect(certainty('Française')).toBe(false);
            expect(certainty('Ahmet Çelebi')).toBe(false);
        });

        it('applies the confidence threshold to en ONLY, and reads `evidence` for the rest', () => {
            expect(isCertainDetection({ language: 'en', confidence: MIN_CERTAIN_CONFIDENCE, script: 'Latin', isRTL: false })).toBe(true);
            expect(isCertainDetection({ language: 'en', confidence: MIN_CERTAIN_CONFIDENCE - 0.1, script: 'Latin', isRTL: false })).toBe(false);
            expect(isCertainDetection({ language: 'unknown', confidence: 1, script: 'unknown', isRTL: false })).toBe(false);
            // `evidence` — not a numeric threshold — is what marks a guess. It has to be a
            // separate field: Arabic's confidence is a character RATIO, so ANY blanket
            // threshold would mark genuine Arabic uncertain and soften the hard directive
            // on the money path (441 rows of a 30-day corpus, e.g. `دورة ICDL` → ar@0.545).
            expect(isCertainDetection({ language: 'tr', confidence: 0.75, script: 'Latin', isRTL: false, evidence: 'characters-only' })).toBe(false);
            expect(isCertainDetection({ language: 'ar', confidence: 0.545, script: 'Arabic', isRTL: true })).toBe(true);
            expect(isCertainDetection({ language: 'ar', confidence: 0.03, script: 'Arabic', isRTL: true })).toBe(true);
            expect(isCertainDetection({ language: 'fr', confidence: 0.5, script: 'Latin', isRTL: false })).toBe(true);
        });
    });
});

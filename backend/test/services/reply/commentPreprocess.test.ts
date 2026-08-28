import { describe, it, expect } from 'vitest';
import {
    buildCommentRagQuery,
    preprocessCommentText,
    resolveCommentLanguage,
    rewriteContentFreeCta,
} from '../../../src/services/reply/commentPreprocess';
import { detectCommentLanguage } from '../../../src/utils/language';
import type { FacebookMessageTag } from '../../../src/utils/commentText';

const userTag = (name: string, offset: number): FacebookMessageTag => ({
    id: 'u', name, type: 'user', offset, length: name.length,
});
const pageTag = (id: string, name: string, offset: number): FacebookMessageTag => ({
    id, name, type: 'page', offset, length: name.length,
});

describe('preprocessCommentText', () => {
    describe('user-tag rule', () => {
        it('skips a pure user-tag comment (no @ prefix in text)', () => {
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae',
                messageTags: [userTag('Khadeja Alrefae', 0)],
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
            expect(r.commentForAI).toBe('');
        });

        it('skips a user-tag comment even when trailing Arabic text is present', () => {
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae شو السعر؟',
                messageTags: [userTag('Khadeja Alrefae', 0)],
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });

        it('does NOT skip when a page-tag of our own page is also present', () => {
            // Text: "Jawab كم السعر؟" — page tag at start covers "Jawab" (5 chars), Arabic question follows
            const text = 'Jawab كم السعر؟';
            const tags: FacebookMessageTag[] = [
                pageTag('OUR_PAGE', 'Jawab', 0),
                userTag('Nobody', 100), // malformed offset — ignored
            ];
            const r = preprocessCommentText({
                text,
                messageTags: tags,
                ourFacebookPageId: 'OUR_PAGE',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toContain('كم السعر');
        });

        it('skips when a page-tag matches a different page (not ours)', () => {
            const tags: FacebookMessageTag[] = [userTag('Khadeja Alrefae', 0)];
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae شو السعر؟',
                messageTags: tags,
                ourFacebookPageId: 'OUR_PAGE',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });

        it('user-tag rule wins when both structured tag AND regex @mention are present', () => {
            // Belt-and-suspenders case: the same commenter used both a structured
            // user-tag AND typed an @handle. We must never down-classify to the
            // regex path once a user-tag is confirmed — it could reply if the
            // regex path found >3 words of trailing content.
            const tags: FacebookMessageTag[] = [userTag('Khadeja Alrefae', 0)];
            const r = preprocessCommentText({
                text: 'Khadeja Alrefae @ahmad this is actually a real question about pricing',
                messageTags: tags,
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('user_tag');
        });
    });

    describe('regex @mention fallback (no structured tags)', () => {
        it('skips a pure @mention', () => {
            const r = preprocessCommentText({
                text: '@Ahmad',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('friend_mention');
            expect(r.hadMention).toBe(true);
        });

        it('skips @mention + ≤3 chatter words', () => {
            const r = preprocessCommentText({
                text: '@Ahmad check this',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('friend_mention');
        });

        it('does not skip @mention + >3 words (real question)', () => {
            const r = preprocessCommentText({
                text: '@Ahmad can you please tell me the price of the course',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
        });
    });

    describe('punctuation-only skip', () => {
        it('skips punctuation-only comment when no post context', () => {
            const r = preprocessCommentText({ text: '...', hasPostContext: false });
            expect(r.skipReason).toBe('punctuation_no_context');
        });

        it('does NOT skip punctuation-only when post context is present (AI judges)', () => {
            const r = preprocessCommentText({ text: '...', hasPostContext: true });
            expect(r.skipReason).toBe(null);
        });

        it('skips empty-after-strip comment with no post context', () => {
            const r = preprocessCommentText({
                text: 'https://example.com',
                hasPostContext: false,
            });
            expect(r.skipReason).toBe('punctuation_no_context');
        });
    });

    describe('external promo URL skip', () => {
        // Pattern-level coverage lives in spamPatterns.test.ts. This test only verifies
        // that preprocessCommentText routes the signal to the expected skip reason.
        it('routes external-promo URLs to skipReason="external_promo_url"', () => {
            const r = preprocessCommentText({
                text: '#تعاون يعلن الفريق ❤️ https://www.facebook.com/groups/1416016389339694',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe('external_promo_url');
            expect(r.commentForAI).toBe('');
        });
    });

    describe('normal comments pass through', () => {
        it('returns cleaned text for a normal Arabic question', () => {
            const r = preprocessCommentText({
                text: 'كم سعر الدورة؟',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toBe('كم سعر الدورة؟');
        });

        it('returns cleaned text after stripping URLs', () => {
            const r = preprocessCommentText({
                text: 'شو السعر https://example.com',
                hasPostContext: true,
            });
            expect(r.skipReason).toBe(null);
            expect(r.commentForAI).toBe('شو السعر');
        });
    });
});

describe('resolveCommentLanguage', () => {
    it('returns Arabic for Arabic comment regardless of KB language', () => {
        expect(resolveCommentLanguage('كم السعر؟', undefined, 'English KB')).toBe('ar');
    });

    it('returns English for English comment on English KB', () => {
        expect(resolveCommentLanguage('how much is it?', undefined, 'English KB')).toBe('en');
    });

    it('flips short Latin-only comment to Arabic when KB is Arabic (ambiguous brand/product name)', () => {
        expect(resolveCommentLanguage('ICDL', undefined, 'دورات تدريبية متنوعة')).toBe('ar');
        expect(resolveCommentLanguage('Excel', undefined, 'دورات تدريبية متنوعة')).toBe('ar');
    });

    it('flips short Latin-only comment to Arabic from the POST when the KB is absent (RAG active)', () => {
        // Production regression: under RAG_MODE=on the generator passes effectiveKB=undefined
        // (the KB content lives in retrievedChunks instead), so the KB-language signal is blank.
        // The Arabic post the customer commented on must still drive the reply language.
        const arabicPost = '#عروض على دورات #الكومبيوتر مع الأستاذ أنس الأشقر دورة icdl';
        expect(resolveCommentLanguage('Icdl', arabicPost, undefined)).toBe('ar');
        expect(resolveCommentLanguage('Icdl', arabicPost, '')).toBe('ar');
    });

    it('does NOT mirror the post for genuine English prose (prod 2026-08-16)', () => {
        // The reported bug: an English comment under Jawab24's own Arabic boosted
        // post was answered in Arabic. "Very nice" matches no ENGLISH_COMMON word,
        // so it used to score en@0.5 — identical to the acronym "ICDL" — and got
        // mirrored. The dual-mode public nudge, which resolves via
        // detectCommentLanguage, said English on the SAME comment.
        const arabicPost = '🤖 جواب24 بيرد على تعليقات ورسائل عملائك تلقائيًا باستخدام الذكاء الصناعي';
        expect(resolveCommentLanguage('Very nice', arabicPost, undefined)).toBe('en');
        expect(resolveCommentLanguage('Good morning man', arabicPost, undefined)).toBe('en');
    });

    it('still mirrors the post for a name-shaped or Arabizi comment', () => {
        // The two classes that must keep deferring: a tagged friend's display name
        // (tinyld reads transliterated names as en@1.00) and romanized Arabic.
        const arabicPost = '#عروض على دورات #الكومبيوتر دورة icdl';
        expect(resolveCommentLanguage('Weaam Aldoukha', arabicPost, undefined)).toBe('ar');
        expect(resolveCommentLanguage('Kawthar Mohammed', arabicPost, undefined)).toBe('ar');
        expect(resolveCommentLanguage('kam el se3r', arabicPost, undefined)).toBe('ar');
        expect(resolveCommentLanguage('sho hal as3ar', arabicPost, undefined)).toBe('ar');
    });

    it('mirrors the post language for a Latin token in ANY detector-named language (not just Arabic)', () => {
        // French post → French reply
        expect(resolveCommentLanguage('iPhone', 'Découvrez les nouvelles offres à prix réduit', undefined)).toBe('fr');
        // Turkish post → Turkish reply
        expect(resolveCommentLanguage('iPhone', 'Yeni ürünlerimizi mağazamızda görebilirsiniz', undefined)).toBe('tr');
        // Swedish post → Swedish reply
        expect(resolveCommentLanguage('iPhone', 'Vi har öppet hela veckan välkommen', undefined)).toBe('sv');
    });

    it('defers a COMMENT written in a script the backend cannot name (prod 2026-08-16)', () => {
        // The Bengali case: «অনেক সুন্দر» on Jawab24's Arabic boosted post was
        // answered in Arabic. The backend has no name for these scripts, so
        // detectCommentLanguage fell back to the POST — and that travelled as an
        // EXPLICIT hint, which outranks the worker's own script detection. Every
        // one of these is nameable BY THE WORKER, so the backend must stand aside.
        const arabicPost = '🤖 جواب24 بيرد على تعليقات ورسائل عملائك تلقائيًا';
        for (const comment of [
            'অনেক সুন্দর',                    // Bengali — the reported case
            'ยินดีต้อนรับสู่ร้านของเรา',        // Thai
            'Сколько это стоит',              // Cyrillic
            '这个多少钱',                       // Chinese
            'כמה זה עולה',                    // Hebrew
            'வணக்கம்',                        // Tamil
        ]) {
            expect(resolveCommentLanguage(comment, arabicPost, undefined)).toBe('unknown');
        }
    });

    it('leaves the PUBLIC NUDGE language untouched — it is a different decision', () => {
        // The dual-mode nudge resolves through detectCommentLanguage directly
        // (facebookCommentAdapter / instagramCommentAdapter), NOT through this
        // function, and it deliberately keeps mirroring the post: the nudge is a
        // public comment under the merchant's own post, and we ship variations in
        // Arabic and English only — resolving a Bengali comment to 'bn' here would
        // fall through pickNudgeVariation to the Arabic default anyway on an Arabic
        // post, and would flip an English post's nudge to Arabic. Whether an
        // unnameable language should get the English nudge instead is an open
        // product question, deliberately NOT decided by this change.
        const arabicPost = '🤖 جواب24 بيرد على تعليقات ورسائل عملائك تلقائيًا';
        const englishPost = 'Jawab24 replies to your customers automatically';
        expect(detectCommentLanguage('অনেক সুন্দর', arabicPost)).toBe('ar');
        expect(detectCommentLanguage('অনেক সুন্দর', englishPost)).toBe('en');
    });

    it('still mirrors the post for comments with NO letters at all', () => {
        // The documented purpose of the post fallback, and what the engagement-post
        // CTA cases depend on: "." / "0" / an emoji is the customer following the
        // post's instruction, not a language signal. Deferring these would strand
        // the reply on the merchant default instead of the post's language.
        const arabicPost = '#عروض على دورات #الكومبيوتر دورة icdl';
        for (const comment of ['👍👍', '...', '٠', '!!']) {
            expect(resolveCommentLanguage(comment, arabicPost, undefined)).toBe('ar');
        }
    });

    it('defers (returns "unknown") for a foreign script the backend cannot name, so the worker resolves it', () => {
        // Thai / Russian aren't in the backend SupportedLanguage set → detectLanguageCode = "unknown".
        // Returning "unknown" makes the generator omit the explicit override; the ai-worker's
        // Unicode-based resolveInputLanguage then names the post language downstream.
        expect(resolveCommentLanguage('iPhone', 'ยินดีต้อนรับสู่ร้านของเรา', undefined)).toBe('unknown');
        expect(resolveCommentLanguage('iPhone', 'Добро пожаловать в наш магазин', undefined)).toBe('unknown');
    });

    it('keeps English when the context is English or absent', () => {
        expect(resolveCommentLanguage('Icdl', 'Check out our new computer courses', undefined)).toBe('en');
        expect(resolveCommentLanguage('Icdl', undefined, undefined)).toBe('en');
    });

    it('keeps a genuine short English question English on an Arabic post (not just a bare token)', () => {
        // These carry real English function words (which/how/the) → confidence ≥ 0.6,
        // so they must NOT be mistaken for a signal-less brand token and flipped to Arabic.
        // Regression for the old gate, which flipped "which course" (no punctuation) to Arabic
        // while keeping "what course?" English only by accident of the trailing "?".
        const arabicPost = '#عروض على دورات #الكومبيوتر مع الأستاذ أنس الأشقر دورة icdl';
        expect(resolveCommentLanguage('which course', arabicPost, undefined)).toBe('en');
        expect(resolveCommentLanguage('what course?', arabicPost, undefined)).toBe('en');
        expect(resolveCommentLanguage('how much?', arabicPost, undefined)).toBe('en');
        expect(resolveCommentLanguage('what is the course?', arabicPost, undefined)).toBe('en');
    });

    it('still mirrors a signal-less bare token to the Arabic post', () => {
        const arabicPost = '#عروض على دورات #الكومبيوتر مع الأستاذ أنس الأشقر دورة icdl';
        // Acronym / product name — zero English function words (confidence floor) → Arabic.
        expect(resolveCommentLanguage('Icdl', arabicPost, undefined)).toBe('ar');
        expect(resolveCommentLanguage('iPhone', arabicPost, undefined)).toBe('ar');
    });

    describe('Arabizi and punctuation on an Arabic post', () => {
        // Arabic written in Latin letters. The detector floors it at English by
        // construction (Latin is its default), so the ONLY correct signal is the post,
        // exactly as for a bare token. Emoji-laden Arabizi is extremely common real
        // traffic — engine.test.ts calls it out by name — and the ASCII cap inside
        // isLowSignalLatinToken was disqualifying it, sending these to English.
        const arabicPost = '#عروض على دورات #الكومبيوتر مع الأستاذ أنس الأشقر دورة icdl';

        it('mirrors the Arabic post for plain Arabizi', () => {
            expect(resolveCommentLanguage('kam el se3r', arabicPost, undefined)).toBe('ar');
            expect(resolveCommentLanguage('sho hal as3ar', arabicPost, undefined)).toBe('ar');
            expect(resolveCommentLanguage('bkam el course', arabicPost, undefined)).toBe('ar');
        });

        it('mirrors the Arabic post for Arabizi carrying an emoji', () => {
            expect(resolveCommentLanguage('kam el se3r 😍', arabicPost, undefined)).toBe('ar');
            expect(resolveCommentLanguage('sho hal as3ar 😀', arabicPost, undefined)).toBe('ar');
        });

        it('mirrors the Arabic post for a signal-less affirmative with an emoji', () => {
            expect(resolveCommentLanguage('ok 👍', arabicPost, undefined)).toBe('ar');
            expect(resolveCommentLanguage('DONE 🙏🌷', arabicPost, undefined)).toBe('ar');
        });

        it('mirrors the Arabic KB when the post is absent (RAG active)', () => {
            expect(resolveCommentLanguage('kam el se3r 😍', undefined, 'دورات وأسعار')).toBe('ar');
            expect(resolveCommentLanguage('ok 👍', undefined, 'دورات وأسعار')).toBe('ar');
        });

        it('KNOWN LIMITATION: ASCII punctuation still disqualifies a token', () => {
            // Deliberate. Discounting ASCII punctuation as well flipped 58.5% of real
            // prod traffic (vs 1.5% for emoji-only) and misread English contractions as
            // tokens — see backend/test/utils/language.test.ts for the measurement.
            expect(resolveCommentLanguage('Icdl?', arabicPost, undefined)).toBe('en');
            expect(resolveCommentLanguage('kam el se3r?', arabicPost, undefined)).toBe('en');
        });

        it('KNOWN GAP: 4+ word Arabizi still goes to English (word-count cap)', () => {
            // Out of scope for isLowSignalLatinToken by design — its <=3 word cap is a
            // deliberate guard against catching real English sentences. Raising it needs
            // its own decision and prod measurement, so this documents the boundary.
            expect(resolveCommentLanguage('3ayez a3raf el se3r', arabicPost, undefined)).toBe('en');
        });

        it('does not drag a genuine English question to Arabic, punctuation or not', () => {
            // The confidence floor still separates these from Arabizi.
            for (const c of ['how much?', 'which course', 'what is the price?', 'hello!']) {
                expect(resolveCommentLanguage(c, arabicPost, undefined)).toBe('en');
            }
        });
    });

    it('keeps English for long English comments even when KB is Arabic', () => {
        expect(
            resolveCommentLanguage('can you send me the full price list please', undefined, 'دورات'),
        ).toBe('en');
    });

    it('falls back to post language for script-less (empty/punctuation) comments', () => {
        expect(resolveCommentLanguage('', 'كم سعر الدورة؟', '')).toBe('ar');
    });
});

describe('rewriteContentFreeCta', () => {
    it('rewrites dot on Arabic CTA post to "أريد التفاصيل"', () => {
        const out = rewriteContentFreeCta({
            commentForAI: '.',
            rawText: '.',
            postMessage: 'علق بنقطة لتصلك تفاصيل الدورة',
        });
        expect(out).toBe('أريد التفاصيل');
    });

    it('rewrites emoji on English post to "I want the details"', () => {
        const out = rewriteContentFreeCta({
            commentForAI: '👍',
            rawText: '👍',
            postMessage: 'Comment to get pricing on iPhone 15',
        });
        expect(out).toBe('I want the details');
    });

    it('does not rewrite when post message is missing', () => {
        const out = rewriteContentFreeCta({
            commentForAI: '.',
            rawText: '.',
            postMessage: undefined,
        });
        expect(out).toBe('.');
    });

    it('does not rewrite real-text comments', () => {
        const out = rewriteContentFreeCta({
            commentForAI: 'كم السعر؟',
            rawText: 'كم السعر؟',
            postMessage: 'علق بنقطة',
        });
        expect(out).toBe('كم السعر؟');
    });

    // Regression for eval #324 (لامار الشام resurfacing on the PUBLIC channel):
    // the rewrite is channel-agnostic — the old `effectiveChannel !== 'dm'` gate
    // left public-mode merchants unprotected and the model's spam verdict on
    // "٠٠٠" silently dropped solicited engagement comments.
    it('rewrites Arabic-Indic digit CTA "٠٠٠" on Arabic post (لامار الشام case)', () => {
        const out = rewriteContentFreeCta({
            commentForAI: '٠٠٠',
            rawText: '٠٠٠',
            postMessage: '#عروض 🔥 دورات بكلفة 25 الف فقط — ICDL، إسعافات، محاسبة الأمين. علق بنقطة ❤️⭕️',
        });
        expect(out).toBe('أريد التفاصيل');
    });

    it('rewrites ASCII-digit CTA "000" on English post', () => {
        const out = rewriteContentFreeCta({
            commentForAI: '000',
            rawText: '000',
            postMessage: 'New iPhone 15 — comment 0 to get pricing!',
        });
        expect(out).toBe('I want the details');
    });

    // ── The merchant's configured language is the authority for THIS sentence ──
    //
    // Shipped defect (measured 2026-08-28): a page whose captions are styled Latin
    // ("P O O L", "M L U E") answered every emoji comment with an English brochure —
    // 238 of 240 content-free AI comment replies over 30 days on Shahin Resort, plus
    // 11 on مزة جبل 86 and 2 on BAMBO LIBYA, all on pages configured
    // default_reply_language = 'ar'. The cause was deriving this sentence's language
    // from `detectLanguageCode(postMessage)`: the detector floors decorative spaced
    // Latin at English, and `isLowSignalLatinToken` cannot rescue it (its ≤3-word cap
    // admits "A R C" but not "P O O L"). The post is the merchant's styling choice,
    // not evidence about the commenter — and a content-free comment carries no
    // customer language signal at all, which is exactly what a default is for.
    describe('language comes from the merchant default, not the post', () => {
        const ARABIC_KB = 'منتجع شاهين يقع على بعد 8.5 كم من وسط المدينة. للحجز اتصل 0982414141.';

        // Every caption below is a REAL Shahin Resort caption, with the number of
        // English replies it produced in 30 days of production traffic.
        it.each([
            ['P O O L', 127, 'decorative spaced letters'],
            ['P O O L +', 38, 'decorative spaced letters'],
            ['Amazing atmosphere at Shahin Resort 👌🔥', 22, 'genuine English prose'],
            ['M L U E', 16, 'decorative spaced letters'],
            ['NADER AL ATAT', 14, 'Arabic proper name in Latin'],
            ['Summer at Arc Beach is a special summer', 14, 'genuine English prose'],
            ['YAZAN RASHID', 5, 'Arabic proper name in Latin'],
        ])('answers an emoji on %j in Arabic (%i prod replies, %s)', (postMessage) => {
            const out = rewriteContentFreeCta({
                commentForAI: '🔥🔥',
                rawText: '🔥🔥',
                postMessage: postMessage as string,
                knowledgeBase: ARABIC_KB,
                defaultReplyLanguage: 'ar',
            });
            expect(out).toBe('أريد التفاصيل');
            // The read path that actually decides the reply: this sentence is fed back
            // as the explicit language hint, so it must resolve to Arabic too.
            expect(resolveCommentLanguage(out, postMessage as string, ARABIC_KB)).toBe('ar');
        });

        it('honours an English default even on an Arabic post (no Arabic bias)', () => {
            const out = rewriteContentFreeCta({
                commentForAI: '❤️',
                rawText: '❤️',
                postMessage: 'علق بنقطة لتصلك تفاصيل الدورة',
                knowledgeBase: ARABIC_KB,
                defaultReplyLanguage: 'en',
            });
            expect(out).toBe('I want the details');
        });

        it('falls back to the post/KB ladder when no default is configured', () => {
            expect(rewriteContentFreeCta({
                commentForAI: '.', rawText: '.',
                postMessage: 'علق بنقطة لتصلك التفاصيل',
            })).toBe('أريد التفاصيل');
            expect(rewriteContentFreeCta({
                commentForAI: '.', rawText: '.',
                postMessage: 'P O O L',
            })).toBe('I want the details');
        });

        it('still does not touch a comment that carries real text', () => {
            expect(rewriteContentFreeCta({
                commentForAI: 'how much is the suite?',
                rawText: 'how much is the suite?',
                postMessage: 'P O O L',
                knowledgeBase: ARABIC_KB,
                defaultReplyLanguage: 'ar',
            })).toBe('how much is the suite?');
        });

        // The sentence is resolved through `t()`, so a locale the backend has no authored
        // strings for degrades to English rather than emitting a language the reply
        // pipeline would then mirror with an English prompt. Guards the invariant
        // documented on resolveAuthoredCtaLanguage; flips the day sv.json lands.
        it('degrades an unauthored locale to English rather than guessing', () => {
            for (const locale of ['sv', 'de', 'fr', 'tr']) {
                expect(rewriteContentFreeCta({
                    commentForAI: '🔥', rawText: '🔥',
                    postMessage: 'P O O L',
                    knowledgeBase: ARABIC_KB,
                    defaultReplyLanguage: locale,
                })).toBe('I want the details');
            }
        });
    });
});

describe('buildCommentRagQuery', () => {
    const POST = 'دورة icdl على الكمبيوتر مع الأستاذ أنس';

    it('enriches a short/vague comment with the post (so a bare token retrieves the topic)', () => {
        expect(buildCommentRagQuery('icdl', 'icdl', POST)).toBe(`${POST} icdl`);
    });

    it('enriches a vague Arabic price question with the post', () => {
        expect(buildCommentRagQuery('شو السعر؟', 'شو السعر؟', POST)).toBe(`${POST} شو السعر؟`);
    });

    it('leaves a long comment (>6 words) unenriched even when a post is present', () => {
        const long = 'can you please send me the full price list and the schedule today';
        expect(buildCommentRagQuery(long, long, POST)).toBe(long);
    });

    it('returns the comment as-is when there is no post context', () => {
        expect(buildCommentRagQuery('icdl', 'icdl', undefined)).toBe('icdl');
    });

    it('falls back to rawText as the body when the cleaned comment is empty (symbol-only)', () => {
        // Word-character count is 0 → vague → enriched, with rawText as the body.
        expect(buildCommentRagQuery('', '٠٠٠', POST)).toBe(`${POST} ٠٠٠`);
    });

    it('counts only letter-words, so digits/symbols stay vague and get enriched', () => {
        expect(buildCommentRagQuery('000', '000', POST)).toBe(`${POST} 000`);
    });

    it('caps the prepended post at 200 chars', () => {
        const longPost = 'ا'.repeat(500);
        const out = buildCommentRagQuery('icdl', 'icdl', longPost);
        expect(out).toBe(`${'ا'.repeat(200)} icdl`);
    });
});

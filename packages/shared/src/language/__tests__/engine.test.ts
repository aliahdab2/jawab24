import { describe, it, expect, afterEach } from 'vitest';
import {
    langEngineMode,
    tinyldLatinOverride,
    maybeLatinOverride,
    displayLanguageName,
    isConfidentAsciiEnglish,
    isNameShaped,
} from '../engine';

/**
 * Unit tests for the Phase-1b tinyld override rule. These pin the SAFETY
 * properties the design rests on (see engine.ts header):
 *  - Arabizi / ASCII input can never be overridden (tinyld confidently
 *    mislabels it — Kirundi@1.00 on "sho hal as3ar" — so the gate is
 *    structural, not statistical)
 *  - only allowlisted, well-resourced Latin-script languages can be named
 *  - the flag defaults to legacy (inert)
 * Expected values below come from probing the pinned tinyld (1.3.4) directly
 * (2026-07-04); if a tinyld upgrade shifts its accuracy scale, these are the
 * tripwire.
 */
afterEach(() => {
    delete process.env.LANG_ENGINE;
    delete process.env.LANG_ENGINE_SHADOW;
});

describe('langEngineMode', () => {
    it('defaults to legacy (unset, empty, or unknown values)', () => {
        delete process.env.LANG_ENGINE;
        expect(langEngineMode()).toBe('legacy');
        process.env.LANG_ENGINE = '';
        expect(langEngineMode()).toBe('legacy');
        process.env.LANG_ENGINE = 'typo';
        expect(langEngineMode()).toBe('legacy');
    });

    it('is tinyld only for the exact string', () => {
        process.env.LANG_ENGINE = 'tinyld';
        expect(langEngineMode()).toBe('tinyld');
    });
});

describe('tinyldLatinOverride — the hardened rule', () => {
    it('fixes the production bug: Swedish sentence without å', () => {
        expect(tinyldLatinOverride('Hur kan man anmäla sig')).toBe('sv');
    });

    it('names diacritic-bearing foreign sentences', () => {
        expect(tinyldLatinOverride('när börjar kursen')).toBe('sv');
        expect(tinyldLatinOverride('Ich möchte mich anmelden')).toBe('de');
        expect(tinyldLatinOverride('kursa kayıt olmak istiyorum')).toBe('tr');
        expect(tinyldLatinOverride('¿cuánto cuesta?')).toBe('es');
        expect(tinyldLatinOverride('combien ça coûte')).toBe('fr');
        expect(tinyldLatinOverride('tôi muốn đăng ký')).toBe('vi');
    });

    it('NEVER fires on ASCII Arabizi, English, acronyms or names (the load-bearing guard)', () => {
        // Arabizi that tinyld confidently mislabels (rn@1.00, eo@1.00, es@0.23):
        // digit-fusion is blocked structurally, the rest by allowlist/floor/margin.
        expect(tinyldLatinOverride('sho hal as3ar')).toBeNull();
        expect(tinyldLatinOverride('bkam el course')).toBeNull();
        expect(tinyldLatinOverride('kam el se3r')).toBeNull();
        expect(tinyldLatinOverride('salam kifak')).toBeNull();
        expect(tinyldLatinOverride('shu 3ndkon')).toBeNull();
        expect(tinyldLatinOverride('inshallah bukra')).toBeNull();
        expect(tinyldLatinOverride('yalla habibi')).toBeNull();
        // English (incl. low-tinyld-accuracy English) and tokens ('en' is not
        // in the allowlist — English stays legacy's own business):
        expect(tinyldLatinOverride('i want to register')).toBeNull();
        expect(tinyldLatinOverride('hello')).toBeNull();
        expect(tinyldLatinOverride('ICDL')).toBeNull();
        expect(tinyldLatinOverride('ok')).toBeNull();
        // Transliterated display names (name-shape guard):
        expect(tinyldLatinOverride('Mohammed Alahmad')).toBeNull();
    });

    it('names accent-free French/Spanish with a clear-margin call (the 2026-08-24 Salla-test fix)', () => {
        // The class that was an accepted miss until the ASCII-foreign promotion:
        // zero non-ASCII letters, yet tinyld is unambiguous about the language.
        expect(tinyldLatinOverride('Quelles tailles avez-vous ?')).toBe('fr'); // fr@1.00 — answered in Arabic in prod
        expect(tinyldLatinOverride('Donne moi hotel a tartous')).toBe('fr');   // fr@0.14 vs la@0.01 — the Joelle/Shahin class
        expect(tinyldLatinOverride("c'est combien")).toBe('fr');               // 2 words at top-of-scale
        expect(tinyldLatinOverride('cuanto cuesta el vestido')).toBe('es');
    });

    it('ASCII promotion is fr/es ONLY — other languages junk-dominate the corpus (accepted misses)', () => {
        // 60-day corpus (14,710 Latin texts): outside fr/es, ASCII promotions are
        // mostly romanized Arabic ("Asalam aleikum warahmatullahi wabarakatu" →
        // lv@1.00 ×23, "Ana achkourak min kol kalbi" → de@1.00), Tagalog (→ ro/vi),
        // and typo'd English. Genuine ASCII German/Swedish keeps deferring — the
        // price of never asserting Latvian at a customer.
        expect(tinyldLatinOverride('vad kostar det')).toBeNull();       // sv@0.16 — genuine, accepted miss
        expect(tinyldLatinOverride('wie viel kostet das')).toBeNull();  // de@0.22 — genuine, accepted miss
        expect(tinyldLatinOverride('Asalam aleikum warahmatullahi wabarakatu')).toBeNull(); // lv@1.00 junk
        expect(tinyldLatinOverride('Ana achkourak min kol kalbi')).toBeNull();              // de@1.00 junk
        expect(tinyldLatinOverride('yes po galing po xa sa public school')).toBeNull();     // vi@1.00 Tagalog
    });

    it('2-word ASCII texts must be unambiguous — typo\'d English must not become Spanish', () => {
        // "Hw much" reads es@0.17 and "Main courses" fr@0.18 — real prod traffic
        // (17 "Hw much" DMs in the 60-day corpus). The 2-word tier demands 1.00.
        expect(tinyldLatinOverride('Hw much')).toBeNull();
        expect(tinyldLatinOverride('Main courses')).toBeNull();
    });

    it('keeps deferring ASCII near-ties — a Scandinavian coin flip must not be asserted (the margin guard)', () => {
        // no@0.21 vs da@0.20: promoting the top guess would name Norwegian for a
        // Swedish customer AS CERTAIN. The 1.5× margin keeps it on the thread.
        expect(tinyldLatinOverride('var bor du manen ?')).toBeNull();
    });

    it('emoji / symbols / non-ASCII punctuation do NOT open the gate (the letter-gate guard)', () => {
        // Regression for the review finding: a non-ASCII EMOJI on ASCII Arabizi used
        // to open the codepoint gate → tinyld → es@0.75 → the bot answered Arab
        // customers in Spanish. The gate now requires a non-ASCII LETTER, so the
        // emoji is stripped and these correctly decline. Extremely common traffic.
        expect(tinyldLatinOverride('kam el se3r 😍')).toBeNull();
        expect(tinyldLatinOverride('3ayez a3raf el se3r 🤔')).toBeNull();
        expect(tinyldLatinOverride('3aleena eh el prices 💰')).toBeNull();
        expect(tinyldLatinOverride('sho hal as3ar 😀')).toBeNull();
        expect(tinyldLatinOverride('thanks 🙏')).toBeNull();
        // Non-ASCII punctuation (curly quotes / Arabic comma) with ASCII letters, too:
        expect(tinyldLatinOverride('habibi kifak، please')).toBeNull();
        expect(tinyldLatinOverride('“kam el se3r”')).toBeNull();
    });

    it('never fires on single tokens, even with diacritics', () => {
        expect(tinyldLatinOverride('anmäla')).toBeNull();
        expect(tinyldLatinOverride('tack')).toBeNull();
    });

    it('rejects weak-margin guesses (2-word Swedish at sv@0.11 vs da@0.09)', () => {
        expect(tinyldLatinOverride('anmäla sig')).toBeNull();
    });
});

describe('maybeLatinOverride — flag awareness', () => {
    it('is inert in legacy mode (default)', () => {
        expect(maybeLatinOverride('Hur kan man anmäla sig')).toBeNull();
    });

    it('runs the rule in tinyld mode', () => {
        process.env.LANG_ENGINE = 'tinyld';
        expect(maybeLatinOverride('Hur kan man anmäla sig')).toBe('sv');
        expect(maybeLatinOverride('sho hal as3ar')).toBeNull();
    });
});

describe('isNameShaped', () => {
    it('is true for display names — every token capitalized', () => {
        expect(isNameShaped('Weaam Aldoukha')).toBe(true);
        expect(isNameShaped('Kawthar Mohammed')).toBe(true);
        expect(isNameShaped('Rana AL Akhras')).toBe(true);
    });

    it('is false for prose, which capitalizes its first word only', () => {
        expect(isNameShaped('Very nice')).toBe(false);
        expect(isNameShaped('Good morning man')).toBe(false);
        expect(isNameShaped("I don't understand arabic")).toBe(false);
    });

    it('ignores leading non-letters, and is false for caseless scripts', () => {
        expect(isNameShaped('@Ali (Sara')).toBe(true);
        // Arabic has no uppercase letters at all — the predicate must not claim
        // a name-shape it cannot see (matters as more languages are added).
        expect(isNameShaped('مرحبا كيف حالك')).toBe(false);
        expect(isNameShaped('')).toBe(false);
    });
});

describe('isConfidentAsciiEnglish — the ASCII half of the en@0.5 floor', () => {
    it('accepts genuine English prose that matched no ENGLISH_COMMON word', () => {
        // The production case: an English comment under an Arabic post was
        // answered in Arabic because this text scored en@0.5 (2026-08-16).
        expect(isConfidentAsciiEnglish('Very nice')).toBe(true);
        expect(isConfidentAsciiEnglish('Good morning man')).toBe(true);
        expect(isConfidentAsciiEnglish('Speak English pls')).toBe(true);
    });

    it('refuses Arabizi — the class the whole design protects', () => {
        // tinyld mislabels these confidently (Kirundi@1.00, Esperanto@1.00,
        // Spanish@0.23), so the guard is structural: never 'en' => never promoted.
        expect(isConfidentAsciiEnglish('sho hal as3ar')).toBe(false);
        expect(isConfidentAsciiEnglish('bkam el course')).toBe(false);
        expect(isConfidentAsciiEnglish('kam el se3r')).toBe(false);
        // Digit fused to letters is romanized-Arabic orthography, whatever tinyld says.
        expect(isConfidentAsciiEnglish('el se3r please tell')).toBe(false);
    });

    it('refuses display names — tinyld reads transliterated names as en@1.00', () => {
        expect(isConfidentAsciiEnglish('Weaam Aldoukha')).toBe(false);
        expect(isConfidentAsciiEnglish('Kawthar Mohammed')).toBe(false);
    });

    it('refuses bare tokens and diacritic-bearing text (other rules own those)', () => {
        expect(isConfidentAsciiEnglish('ICDL')).toBe(false);
        expect(isConfidentAsciiEnglish('Nice')).toBe(false);
        // Non-ASCII letters are tinyldLatinOverride's business, not this rule's.
        expect(isConfidentAsciiEnglish('Hur kan man anmäla sig')).toBe(false);
        expect(isConfidentAsciiEnglish('   ')).toBe(false);
    });

    it('KNOWN LIMITATION: ASCII-only non-English reads as English', () => {
        // Taglish scores en@1.00 in tinyld's normal AND heavy models. Harmless
        // today (those threads are English), but this is the tripwire for when
        // this product supports a romanized non-English language — see the
        // "WHEN THIS PRODUCT ADDS MORE LANGUAGES" note in engine.ts.
        expect(isConfidentAsciiEnglish('Mag kano naman po down payment kung sakali?')).toBe(true);
    });
});

describe('displayLanguageName', () => {
    it('names any ISO code via Intl.DisplayNames', () => {
        expect(displayLanguageName('sv')).toBe('Swedish');
        expect(displayLanguageName('ar')).toBe('Arabic');
        expect(displayLanguageName('vi')).toBe('Vietnamese');
        expect(displayLanguageName('da')).toBe('Danish');
    });

    it('falls back to English for unknown/unnamed codes (the prompt contract)', () => {
        expect(displayLanguageName('unknown')).toBe('English');
        expect(displayLanguageName('')).toBe('English');
        expect(displayLanguageName('zz')).toBe('English');
    });
});

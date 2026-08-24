import { describe, it, expect, afterEach } from 'vitest';
import { resolveDmLanguageHint } from '../../src/utils/language';

/**
 * Prod-replay pin: the "Jawab24 Salla Test" Messenger conversation of
 * 2026-08-24 (~01:45), verified turn-by-turn against the live pipeline via the
 * admin playground the same night. One customer switched language every few
 * messages — Swedish → English → Arabic → French — and every turn mirrored
 * correctly EXCEPT the French one: «Quelles tailles avez-vous ?» happens to
 * contain zero accented characters, so it read as en@0.5 ("Latin script,
 * recognized nothing"), tripped the defer-to-history gate, and was answered
 * in Arabic (4/4 in the playground replay).
 *
 * Runs in tinyld mode — production parity: the prod containers set
 * LANG_ENGINE=tinyld (verified in-container 2026-08-16). Legacy-mode behavior
 * is pinned elsewhere (test/utils/language.test.ts) and is NOT what prod runs.
 *
 * The hint values assert what the backend sends the ai-worker per turn:
 * a language code = explicit hint (strong reply-language directive);
 * undefined = defer, the model resolves from conversation history.
 */

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

describe('the Salla-test multilingual conversation — every turn resolves to the customer\'s language', () => {
    it('turn 1 — Swedish opener («Hur mår du ?», no history) names Swedish', () => {
        expect(inTinyldMode(() => resolveDmLanguageHint('Hur mår du ?', false))).toBe('sv');
    });

    it('turn 2 — accent-free Swedish («var bor du manen ?») defers to the (Swedish) thread, and is NEVER promoted to Norwegian', () => {
        // tinyld reads this no@0.21 / da@0.20 / sv@0.19 — a coin flip between
        // Scandinavian siblings. The ASCII promotion's margin requirement
        // (top ≥ 1.5× runner-up) exists precisely so a near-tie like this can
        // never assert the wrong sibling as CERTAIN; deferring to the thread
        // (which is Swedish here) answers the customer correctly instead.
        expect(inTinyldMode(() => resolveDmLanguageHint('var bor du manen ?', true))).toBeUndefined();
    });

    it('turn 3 — English mid-thread («I thought you live in Germany») names English', () => {
        expect(inTinyldMode(() => resolveDmLanguageHint('I thought you live in Germany', true))).toBe('en');
    });

    it('turns 4–5 — Arabic script is script-certain regardless of the thread', () => {
        expect(inTinyldMode(() => resolveDmLanguageHint('ابوا معناتا انت ماعندك مكتب شغل', true))).toBe('ar');
        expect(inTinyldMode(() => resolveDmLanguageHint('شو عندك منتجات', true))).toBe('ar');
    });

    it('turn 6 — THE BUG: accent-free French («Quelles tailles avez-vous ?») names French, not the Arabic thread', () => {
        // Red before the ASCII-foreign promotion: this sentence has no accented
        // letter, so the tinyld override's non-ASCII gate never opened, the text
        // floored at en@0.5, deferred to history, and the customer got Arabic.
        // tinyld itself reads it fr@1.00 — unambiguous, just structurally ignored.
        expect(inTinyldMode(() => resolveDmLanguageHint('Quelles tailles avez-vous ?', true))).toBe('fr');
    });

    it('the degraded-French prod corpus (Shahin/Joelle class) also names French', () => {
        // «Donne moi hotel a tartous» — the paying-merchant complaint that
        // survived PR #677 (its fix mirrored clean French only). fr@0.14 with a
        // clear margin over the runner-up (la@0.01) clears the ASCII floor.
        expect(inTinyldMode(() => resolveDmLanguageHint('Donne moi hotel a tartous', true))).toBe('fr');
        expect(inTinyldMode(() => resolveDmLanguageHint('S il vous plait', true))).toBe('fr');
    });

    it('Arabizi is untouched by the promotion — every shape keeps deferring to the thread', () => {
        // The exact false-friend classes the 2026-08-09 shootout measured:
        // digit-fusion (se3r → es@0.23 passes the margin, blocked structurally),
        // allowlist junk (rn/eo/id at 1.00), and sub-threshold residue.
        for (const arabizi of [
            'kam el se3r', '3ayez a3raf el se3r', 'shu 3ndkon',      // digit-fusion guard
            'sho hal as3ar', 'bkam el course', 'shu akhbarak',       // rn/eo/id — not in the allowlist
            'inshallah bukra', 'kifak ya zalame', 'wen el mahal',    // rn/ber junk guesses
            'yalla habibi', 'shlonak habibi', 'mashallah alek',      // fi/hu below the 0.12 floor
        ]) {
            expect(inTinyldMode(() => resolveDmLanguageHint(arabizi, true)), arabizi).toBeUndefined();
        }
    });

    it('transliterated names are never promoted', () => {
        expect(inTinyldMode(() => resolveDmLanguageHint('Mohammed Alahmad', true))).toBeUndefined();
        expect(inTinyldMode(() => resolveDmLanguageHint('Weaam Aldoukha', true))).toBeUndefined();
    });
});

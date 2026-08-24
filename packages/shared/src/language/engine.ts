/**
 * Phase-1b statistical Latin-language override (tinyld), behind the
 * LANG_ENGINE flag. Default is 'legacy' = the engine is fully inert and both
 * detector surfaces behave byte-identically to the pre-tinyld code.
 *
 * WHY AN OVERRIDE AND NOT A REPLACEMENT ————————————————————————————————————
 * The original plan was "replace the Latin branch with tinyld, accept top
 * guess at accuracy >= 0.5". Probing tinyld against real traffic shapes
 * (2026-07-04) disproved two assumptions:
 *
 *   1. tinyld's `accuracy` is NOT a probability. Genuine short foreign
 *      sentences score low ("Hur kan man anmäla sig" → sv@0.16, the exact
 *      production bug this exists to fix), and genuine English can too
 *      ("i want to register" → en@0.13). A 0.5 threshold fixes nothing.
 *   2. Arabizi / Franco-Arabic — a large share of this product's real
 *      traffic — gets CONFIDENTLY mislabeled: "sho hal as3ar" → Kirundi@1.00,
 *      "bkam el course" → Esperanto@1.00, "kam el se3r" → Spanish@0.23.
 *      Any rule trusting tinyld's numbers alone would have the bot answer
 *      Arab customers in Spanish. Legacy behavior (fall through to the
 *      low-confidence-English sentinel → defer to conversation context) is
 *      CORRECT for Arabizi and must be preserved.
 *
 * So instead: the legacy Latin heuristics stay the baseline in BOTH modes,
 * and tinyld is consulted only at the exact fallthrough where legacy had
 * zero signal (the `en @ 0.5` floor / the ai-worker Latin→'en' guess), and
 * only when the text passes gates that structurally exclude the dangerous
 * classes:
 *
 *   - ≥2 words: bare tokens stay context-deferred (the "icdl" contract).
 *   - Allowlist: only well-resourced Latin-script languages; blocks tinyld's
 *     low-resource junk guesses (Kirundi, Esperanto, Klingon, Berber …).
 *
 * The letters are then split by script, TWO branches with separate bars:
 *
 *   - NON-ASCII LETTER PRESENT (diacritic-bearing European/Vietnamese text —
 *     ä, ö, é, ı, đ …, the class legacy mis-floors): accept a clear call
 *     (accuracy >= 0.5), or for >=3 words a moderate call with a clear margin
 *     over the runner-up (accuracy >= 0.10 && >= 1.5× second place). The split
 *     strips every non-letter first, so emoji / currency signs / curly quotes
 *     (non-ASCII but carrying no language signal) cannot open this branch —
 *     an earlier codepoint-based gate let "kam el se3r 😍" through to a wrong
 *     Spanish guess; review-caught.
 *   - PURE-ASCII LETTERS (accent-free French/Spanish — «Quelles tailles
 *     avez-vous ?» detects fr@1.00 yet carries not one non-ASCII letter; a
 *     paying merchant's French customers were answered in Arabic for a whole
 *     conversation, prod 2026-08-09 + replayed 2026-08-24): promoted only for
 *     ASCII_OVERRIDE_LANGS (fr/es — see its docstring for the corpus evidence
 *     that every other language's ASCII promotions are junk-dominated), and
 *     only behind STRUCTURAL guards that exclude the dangerous classes first —
 *     no Arabizi digit-fusion (se3r/3ayez read es@0.15–0.23, which would pass
 *     any numeric bar), not name-shaped (transliterated names read at 1.00) —
 *     then a clear-margin call (>= 1.5× second place) at a length-keyed tier:
 *     >=3 words need the corpus-measured 0.12 floor ("Donne moi hotel a
 *     tartous" fr@0.14 clears; cs@0.04/pl@0.09 junk residue does not), while
 *     2-word texts must be UNAMBIGUOUS at 1.00 ("c'est combien" fr@1.00
 *     clears; "Hw much" es@0.17 and "Main courses" fr@0.18 — real prod
 *     traffic — keep deferring). The margin term is what keeps Scandinavian
 *     near-ties safe: "var bor du manen ?" reads no@0.21/da@0.20 and must
 *     keep deferring to its (Swedish) thread rather than be asserted
 *     Norwegian.
 *
 * Net contract (the flip-safety argument): with LANG_ENGINE=tinyld, the ONLY
 * DETECTOR outputs that differ from legacy are Latin-script sentences that
 * every legacy branch mis-floored to en@0.5 AND that name an allowlisted
 * language with a clear margin — the broken class. Arabizi (digit-fused, or
 * junk-coded, or below the floor), names, acronyms, emoji decoration, and
 * ASCII text of every non-fr/es language keep legacy behavior by
 * construction. NOTE this is about detector OUTPUT; the prompt-directive
 * LABEL also
 * changes at flip for already-named non-Latin scripts (ru/ja/… render
 * "Russian"/"Japanese" instead of "English") — see promptBuilder + D-017; that
 * is intended (all-languages) but is a separate, larger blast radius the
 * Latin-only shadow log does not capture.
 */
export type LangEngineMode = 'legacy' | 'tinyld';

/**
 * tinyld is loaded LAZILY on first use, not at module import. Both apps import
 * this module at boot via the detector surfaces, but in legacy mode (the
 * default) tinyld is never called — eagerly parsing its language-profile data
 * would tax every cold start (and test-worker spawn) for an inert feature.
 */
type Guess = { lang: string; accuracy: number };
type DetectAllFn = (text: string) => Guess[];
let detectAllFn: DetectAllFn | undefined;
function getDetectAll(): DetectAllFn {
    if (!detectAllFn) {
        detectAllFn = (require('tinyld') as { detectAll: DetectAllFn }).detectAll;
    }
    return detectAllFn;
}

/**
 * Single-slot memo of the last tinyld call. `detectLanguage` asks tinyld the
 * SAME question about the SAME string twice in immediate succession on the
 * ASCII floor path — once through tinyldLatinOverride, then again through
 * isConfidentAsciiEnglish — and tinyld dominates this path's cost (measured
 * 2026-08-24 over 14,710 real prod texts: the second pass alone was +16 µs
 * per message, an 88% increase on detector time). One slot is all that is
 * needed: the two calls are adjacent, so nothing else can evict between them.
 *
 * Safe because detectAll is a pure function of its input — this is a
 * memoization, not a cache with an invalidation story. It never grows (one
 * entry) and never crosses a request boundary in a way that could matter,
 * since the value depends on nothing but the text.
 */
let lastText: string | undefined;
let lastGuesses: Guess[] | undefined;
function guessesFor(text: string): Guess[] {
    if (lastText === text && lastGuesses) return lastGuesses;
    const guesses = getDetectAll()(text);
    lastText = text;
    lastGuesses = guesses;
    return guesses;
}

/**
 * Read the mode LAZILY (per call, never at module load) so legacy-mode and
 * tinyld-mode tests can coexist in one vitest run, and so a container picks
 * up the env without a code change. Anything but the exact string 'tinyld'
 * (including unset) is legacy — fail-safe default.
 */
export function langEngineMode(): LangEngineMode {
    return process.env.LANG_ENGINE === 'tinyld' ? 'tinyld' : 'legacy';
}

/**
 * Latin-script languages the override may name. Well-resourced orthographies
 * whose real-world text carries diacritics tinyld keys on. Deliberately
 * excludes low-resource codes tinyld hallucinates on Arabizi (rn, eo, ber,
 * tlh, tk, tl …) and excludes 'en' (English is legacy's own default — an
 * en override would be a no-op with different confidence).
 */
const OVERRIDE_LANGS = new Set([
    'sv', 'da', 'no', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'fi', 'is',
    'tr', 'pl', 'cs', 'sk', 'sl', 'hr', 'ro', 'hu', 'et', 'lv', 'lt',
    'ca', 'vi',
]);

/**
 * Confidence assigned to an accepted override. Only 'en' confidences are
 * load-bearing downstream (isLowSignalLatinToken ≤0.5, DM deferToHistory
 * <0.6 — both key on language === 'en' first), so this value is
 * informational; 0.75 slots between legacy's named-language range (0.7–0.9).
 */
export const OVERRIDE_CONFIDENCE = 0.75;

/**
 * Languages the PURE-ASCII branch may name — deliberately far narrower than
 * OVERRIDE_LANGS. Measured over 14,710 real Latin-script prod texts
 * (60 days, 2026-08-24): fr and es flips were ~90% genuine customers
 * (French from the Libya/Cameroon audience, Latin-American Spanish), while
 * EVERY other language's ASCII promotions were dominated by junk — romanized
 * Arabic greetings read lv/et/nl/de/fi at 1.00 («Asalam aleikum warahmatullahi
 * wabarakatu» → lv@1.00 ×23), Tagalog read ro/vi/cs, typo'd English read es/fr.
 * This is the promotion-allowlist mechanism the Taglish note below already
 * prescribes: keyed on languages we actually see genuine ASCII traffic in,
 * not a threshold (tinyld's accuracy is a ranking — junk scores 1.00).
 */
const ASCII_OVERRIDE_LANGS = new Set(['fr', 'es']);

/**
 * Minimum tinyld accuracy for naming a foreign language on PURE-ASCII text of
 * ≥3 words. The 2026-08-09 shootout floor: at 0.12 (with the 1.5× margin) the
 * low-conf junk residue (cs@0.04, pl@0.09, fi@0.09) stays deferred while the
 * degraded-French class ("Donne moi hotel a tartous" fr@0.14) clears it.
 * Two-word ASCII texts get no such leniency — they must score top-of-scale
 * (see ASCII_TWO_WORD_MIN_ACCURACY): "Hw much" reads es@0.17 and "Main
 * courses" fr@0.18, and both must keep deferring.
 */
export const ASCII_FOREIGN_MIN_ACCURACY = 0.12;

/** Two-word ASCII texts must be unambiguous: "c'est combien" reads fr@1.00. */
export const ASCII_TWO_WORD_MIN_ACCURACY = 1;

/**
 * Arabizi orthography: a digit adjacent to a letter INSIDE a token, where the
 * digit stands in for an Arabic letter — se3r (ع), 3ayez, 2ana, 7abibi. A
 * structural property of the text, NOT a word list (the banned approach).
 * Plain numbers ("Sun 4 o'clock", "Year 2027") are untouched — separate
 * tokens, no fusion.
 */
export function hasArabiziDigitFusion(text: string): boolean {
    return /[a-zA-Z][0-9]|[0-9][a-zA-Z]/.test(text);
}

/**
 * The raw override rule. Exported for direct unit testing; production code
 * goes through maybeLatinOverride (which is flag-aware).
 */
export function tinyldLatinOverride(text: string): string | null {
    const trimmed = text.trim();
    // Split on a non-ASCII LETTER — not any non-ASCII codepoint. Emoji, symbols,
    // currency signs, curly quotes and non-ASCII punctuation are all non-ASCII
    // but carry NO language signal; if they picked the branch, emoji-laden
    // Arabizi ("kam el se3r 😍" — extremely common in real Arabic social
    // traffic) would take the lenient diacritic bar and get mislabeled Spanish.
    // Strip everything that isn't a letter, THEN branch on a non-ASCII letter
    // (ä, é, ı, đ, …): only its presence buys the lower confidence bar below.
    const letters = trimmed.replace(/[^\p{L}]/gu, '');
    if (!letters) return null;
    // eslint-disable-next-line no-control-regex
    const hasNonAsciiLetter = /[^\x00-\x7F]/.test(letters);
    const words = trimmed.split(/\s+/).length;
    if (words < 2) return null;

    // Pure-ASCII text gets no diacritic corroboration, so the dangerous classes
    // are excluded STRUCTURALLY before tinyld is even consulted: digit-fused
    // Arabizi reads es@0.15–0.23 (would pass any numeric bar), and transliterated
    // names read at 1.00 (tinyld's accuracy is a ranking, not a probability —
    // no threshold separates them; same rationale as isConfidentAsciiEnglish).
    if (!hasNonAsciiLetter && (hasArabiziDigitFusion(trimmed) || isNameShaped(trimmed))) return null;

    let guesses: { lang: string; accuracy: number }[];
    try {
        guesses = guessesFor(trimmed);
    } catch {
        return null; // detector failure (incl. load failure) must never break reply generation
    }
    const top = guesses[0];
    if (!top || !OVERRIDE_LANGS.has(top.lang)) return null;
    const second = guesses[1]?.accuracy ?? 0;

    if (hasNonAsciiLetter) {
        if (top.accuracy >= 0.5) return top.lang;
        if (words >= 3 && top.accuracy >= 0.1 && top.accuracy >= second * 1.5) return top.lang;
        return null;
    }

    // Pure ASCII: only the narrow allowlist, then a clear-margin call at a
    // tier keyed on length. The margin term is load-bearing — "var bor du
    // manen ?" reads no@0.21/da@0.20 (a Scandinavian coin flip) and must keep
    // deferring to its thread rather than be asserted Norwegian.
    if (!ASCII_OVERRIDE_LANGS.has(top.lang)) return null;
    if (top.accuracy < second * 1.5) return null;
    if (words === 2) return top.accuracy >= ASCII_TWO_WORD_MIN_ACCURACY ? top.lang : null;
    return top.accuracy >= ASCII_FOREIGN_MIN_ACCURACY ? top.lang : null;
}

/**
 * Minimum tinyld accuracy for reading pure-ASCII text as genuine English.
 * Deliberately far above `tinyldLatinOverride`'s thresholds: that rule picks a
 * language among many candidates, this one only ever confirms the language
 * legacy already defaulted to, so it can afford to accept nothing but a
 * top-of-scale call. Measured over the whole prod corpus (2026-08-16): at 0.9
 * the promoted set is genuine English prose with zero transliterated names and
 * zero Arabizi; lowering it buys nothing (every promotion in that corpus scores
 * 1.00) and only widens the door.
 */
export const ASCII_ENGLISH_MIN_ACCURACY = 0.9;

/**
 * True when every token starts with a capital letter — how a display name is
 * written ("Weaam Aldoukha", "Kawthar Mohammed"), and how prose is not.
 *
 * Script-agnostic by construction: `\p{Lu}` is "uppercase letter in ANY script",
 * and scripts without case (Arabic, Thai, CJK) have no `\p{Lu}` at all, so this
 * returns false for them rather than mislabelling them. That matters for the
 * languages this product has not added yet — the predicate does not need
 * revisiting when it does.
 */
export function isNameShaped(text: string): boolean {
    const words = text.trim().split(/\s+/).filter(w => /\p{L}/u.test(w));
    // Leading non-letters are skipped so "@Ali", "(Sara" still read as capitalized.
    return words.length > 0 && words.every(w => /^[^\p{L}]*\p{Lu}/u.test(w));
}

/**
 * True when pure-ASCII Latin text is CONFIDENTLY English — the half of the
 * `en @ 0.5` floor that is real English prose rather than "Latin script,
 * recognized nothing".
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `tinyldLatinOverride` ————————————————————
 * The override above requires a NON-ASCII letter, which makes "ASCII input is
 * never overridden" true by construction and keeps Arabizi safe. The cost of
 * that gate is that ASCII English gets no help either: legacy scores English by
 * counting ENGLISH_COMMON function words, so a short phrase that contains none
 * — "Very nice", "Good morning man", "I don't understand arabic" — lands on the
 * same 0.5 floor as the acronym "ICDL". `isLowSignalLatinToken` then reads that
 * floor as "no language signal", and `resolveCommentLanguage` mirrors the POST's
 * language: an English comment on an Arabic post was answered in Arabic
 * (production, 2026-08-16 — Jawab24's own boosted post).
 *
 * This predicate is therefore the mirror image of the override's gate, narrowed
 * on every axis that could let the dangerous classes in:
 *
 *   - ASCII LETTERS ONLY: the exact complement of `tinyldLatinOverride`, so the
 *     two rules partition the input space and neither can shadow the other. A
 *     diacritic-bearing sentence stays that rule's business.
 *   - ENGLISH ONLY: the single language legacy already defaults to for Latin
 *     script, so a promotion can only ever change our CERTAINTY, never the
 *     language. This is what makes the Arabizi mislabels harmless — "sho hal
 *     as3ar" → Kirundi@1.00 and "kam el se3r" → Spanish@0.23 are not 'en', so
 *     they keep deferring to context exactly as before.
 *   - ≥2 words: a bare token ("ICDL", "Nice", "Up") carries no sentence
 *     structure to read, and is precisely what the low-signal rule protects.
 *   - NO DIGIT FUSED TO LETTERS: a structural (not lexical) marker of romanized
 *     Arabic, where digits stand in for Arabic letters — se3r (ع), 3ayez, 2ana,
 *     7abibi. A word list would be the banned approach here; orthography is a
 *     property of the text itself.
 *   - NOT NAME-SHAPED: every token capitalized is how a display name is written
 *     ("Weaam Aldoukha", "Kawthar Mohammed"), and tinyld reads transliterated
 *     Arabic names as en@1.00 — its `accuracy` is a ranking, not a probability,
 *     so no threshold can separate them. Prose capitalizes its first word, not
 *     all of them. This guard is why the 2026-08-01 defer-to-history contract
 *     survives (backend/test/services/deferToHistory.test.ts pins it, and caught
 *     this rule's first draft). It fails SAFE in both directions: an excluded
 *     phrase ("Good Morning", "ONE LOVE") simply keeps today's behaviour.
 *   - accuracy ≥ {@link ASCII_ENGLISH_MIN_ACCURACY}.
 *
 * Unlike the override this is NOT flag-gated: the class it fixes is live in
 * production today, and the promotion is confined to text legacy scored as
 * "recognized nothing" (see the `englishMatches === 0` caller in detector.ts),
 * so it can never overrule a positive reading.
 *
 * WHEN THIS PRODUCT ADDS MORE LANGUAGES ——————————————————————————————————————
 * English here is NOT a product preference; it is the one language legacy
 * already assigns to any unrecognized Latin script, which is why confirming it
 * can change certainty but never the language. Other Latin-script languages are
 * named by {@link tinyldLatinOverride} + OVERRIDE_LANGS (24 codes today) — that
 * is the list to extend, not this rule.
 *
 * The hazard this rule DOES carry into a wider language set is ASCII-only
 * non-English text that tinyld reads as English. Real traffic already has it:
 * Taglish ("Mag kano naman po down payment kung sakali?") scores en@1.00 in both
 * the normal and heavy models. Today that is harmless — those merchants' threads
 * are English anyway — but a merchant replying in Tagalog (or any romanized
 * language we later support) would have this assert English over their thread.
 * The fix at that point is a promotion allowlist keyed on the languages we
 * actually support, not a threshold change: tinyld's `accuracy` is a ranking,
 * not a probability, and reads 1.00 for all of these.
 */
export function isConfidentAsciiEnglish(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.split(/\s+/).length < 2) return false;

    const letters = trimmed.replace(/[^\p{L}]/gu, '');
    if (!letters) return false;
    // \x00-\x7F is an ASCII-range bound, not a control-character match — same
    // pattern and same suppression as the gate in tinyldLatinOverride.
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(letters)) return false;

    if (hasArabiziDigitFusion(trimmed)) return false;

    if (isNameShaped(trimmed)) return false;

    let guesses: { lang: string; accuracy: number }[];
    try {
        guesses = guessesFor(trimmed);
    } catch {
        return false; // detector failure (incl. load failure) must never break reply generation
    }
    const top = guesses[0];
    return !!top && top.lang === 'en' && top.accuracy >= ASCII_ENGLISH_MIN_ACCURACY;
}

/**
 * Flag-aware entry point for the detector surfaces.
 *
 * - LANG_ENGINE=tinyld → run the override.
 * - legacy (default)   → inert, UNLESS LANG_ENGINE_SHADOW=1: then compute
 *   what tinyld WOULD have said and log the disagreement (fire-and-forget,
 *   never throws, no message content — only codes and shape) so prod can
 *   accumulate flip evidence while still serving legacy behavior.
 *   console.info is deliberate: this shared module has no logger, and both
 *   consumers ship container logs (mirrors the aiMetrics never-block rule).
 */
export function maybeLatinOverride(text: string): string | null {
    if (langEngineMode() === 'tinyld') return tinyldLatinOverride(text);
    if (process.env.LANG_ENGINE_SHADOW === '1') {
        try {
            const wouldBe = tinyldLatinOverride(text);
            if (wouldBe) {
                // Deliberate console: this shared module has no logger; both consumers ship container logs (see docstring).
                // eslint-disable-next-line no-console
                console.info(JSON.stringify({
                    evt: 'lang_engine_shadow_disagreement',
                    legacy: 'en',
                    tinyld: wouldBe,
                    chars: text.length,
                    words: text.trim().split(/\s+/).length,
                }));
            }
        } catch { /* shadow must never affect the reply path */ }
    }
    return null;
}

// Lazily-created singleton; Node 22 ships full ICU so this names any ISO code.
let displayNames: Intl.DisplayNames | undefined;

/**
 * Human-readable English name for a language code, for the prompt's
 * "Reply language: X" directive. Unknown/unnamed codes fall back to
 * 'English' — same terminal fallback the legacy 7-entry map used
 * ("For unrecognized languages, default to English (NOT Arabic)").
 */
export function displayLanguageName(code: string): string {
    if (!code || code === 'unknown') return 'English';
    try {
        displayNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
        const name = displayNames.of(code);
        // Intl returns the input code itself when it has no name for it.
        return name && name.toLowerCase() !== code.toLowerCase() ? name : 'English';
    } catch {
        return 'English';
    }
}

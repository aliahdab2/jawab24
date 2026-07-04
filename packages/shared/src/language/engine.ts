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
 *   - NON-ASCII REQUIRED: Arabizi, English, and acronyms are pure ASCII —
 *     they can never be overridden, by construction. Diacritic-bearing
 *     European/Vietnamese text (ä, ö, é, ı, đ …) is what legacy mis-floors.
 *   - ≥2 words: bare tokens stay context-deferred (the "icdl" contract).
 *   - Allowlist: only well-resourced Latin-script languages; blocks tinyld's
 *     low-resource junk guesses (Kirundi, Esperanto, Klingon, Berber …).
 *   - Confidence: accept a clear call (accuracy >= 0.5), or for >=3 words a
 *     moderate call with a clear margin over the runner-up
 *     (accuracy >= 0.10 && >= 1.5× second place).
 *
 * Net contract (the flip-safety argument): with LANG_ENGINE=tinyld, the ONLY
 * inputs that resolve differently from legacy are non-ASCII Latin sentences
 * that every legacy branch missed — precisely the broken class. ASCII input
 * of any kind is bit-identical in both modes.
 */
import { detectAll } from 'tinyld';

export type LangEngineMode = 'legacy' | 'tinyld';

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
 * The raw override rule. Exported for direct unit testing; production code
 * goes through maybeLatinOverride (which is flag-aware).
 */
export function tinyldLatinOverride(text: string): string | null {
    const trimmed = text.trim();
    // ASCII-only input (English, Arabizi, acronyms, prices) is never overridden.
    // eslint-disable-next-line no-control-regex
    if (!/[^\x00-\x7F]/.test(trimmed)) return null;
    const words = trimmed.split(/\s+/).length;
    if (words < 2) return null;

    let guesses: { lang: string; accuracy: number }[];
    try {
        guesses = detectAll(trimmed);
    } catch {
        return null; // detector failure must never break reply generation
    }
    const top = guesses[0];
    if (!top || !OVERRIDE_LANGS.has(top.lang)) return null;

    if (top.accuracy >= 0.5) return top.lang;
    const second = guesses[1]?.accuracy ?? 0;
    if (words >= 3 && top.accuracy >= 0.1 && top.accuracy >= second * 1.5) return top.lang;
    return null;
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

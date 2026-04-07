import { normalizeArabic } from './arabic-normalize';

const ARABIC_RE = /[\u0600-\u06FF]/;

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip alif (ا) from a string — used to compare Arabic root consonants */
function stripAlif(s: string): string {
    return s.replace(/\u0627/g, '');
}

/**
 * Match a keyword against text with proper boundary handling.
 *
 * English keywords: word-boundary regex (\b) to avoid "price" matching "surprise".
 *
 * Arabic keywords (two-tier):
 *  1. Substring match (fast path) — works for most cases including prefixed forms.
 *  2. Root-consonant match — handles broken plurals where alif is inserted
 *     between root letters (e.g., سعر ↔ اسعار, ثمن ↔ اثمان).
 *     We strip the definite article "ال" and all alif characters, then
 *     compare consonant skeletons. Requires ≥ 3 root consonants remaining
 *     to avoid false positives.
 *
 * Both sides are pre-normalized with normalizeArabic() before this is called.
 */
export function matchesKeyword(normalizedText: string, normalizedKeyword: string): boolean {
    if (!normalizedKeyword) return false;

    if (ARABIC_RE.test(normalizedKeyword)) {
        // Tier 1: direct substring matching (handles prefixed forms, exact stems)
        if (normalizedText.includes(normalizedKeyword)) return true;

        // Tier 2: root-consonant matching for broken plurals
        // Only for keywords with ≥ 3 chars (avoids matching very short words)
        if (normalizedKeyword.length >= 3) {
            const keywordRoot = stripAlif(normalizedKeyword);
            // After stripping alif, require ≥ 3 consonants to prevent loose matches
            if (keywordRoot.length >= 3) {
                const words = normalizedText.split(/\s+/);
                for (const word of words) {
                    // Strip definite article "ال" prefix, then strip alif
                    const wordRoot = stripAlif(word.replace(/^ال/, ''));
                    if (wordRoot.includes(keywordRoot)) return true;
                }
            }
        }

        return false;
    }

    // Non-word keywords (punctuation, symbols, emoji like ".", "...", "❤️"):
    // \b doesn't apply to non-word characters so use a whole-message check —
    // the entire trimmed comment must consist only of repetitions of the keyword.
    // This handles "write a dot" engagement tactics where followers comment "." or "..."
    if (!/\w/.test(normalizedKeyword)) {
        const trimmed = normalizedText.trim();
        return new RegExp(`^${escapeRegex(normalizedKeyword)}+$`).test(trimmed);
    }

    // English/Latin keywords: word-boundary matching
    const pattern = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`, 'i');
    return pattern.test(normalizedText);
}

/**
 * Test a list of keywords against a text and return the match result.
 * Convenience wrapper for use in the frontend "Test your rule" feature.
 */
export function testKeywordsMatch(
    text: string,
    keywords: string[],
): { matches: boolean; matchedKeyword?: string } {
    if (!text.trim() || keywords.length === 0) {
        return { matches: false };
    }

    const normalizedText = normalizeArabic(text.toLowerCase());

    for (const kw of keywords) {
        const trimmed = kw.trim();
        if (!trimmed) continue;
        if (matchesKeyword(normalizedText, normalizeArabic(trimmed.toLowerCase()))) {
            return { matches: true, matchedKeyword: trimmed };
        }
    }

    return { matches: false };
}

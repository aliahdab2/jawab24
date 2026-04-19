import { normalizeArabic } from './arabic-normalize';

const ARABIC_RE = /[\u0600-\u06FF]/;

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip leading particle + definite article from each word:
 *   optional و/ف/ب/ك/ل, followed by ال.
 * So: العنوان → عنوان, والسعر → سعر, بالمنتج → منتج.
 * Input must already be normalizeArabic()'d.
 */
function stripArabicPrefixes(s: string): string {
    return s
        .split(/\s+/)
        .map(w => w.replace(/^(?:و|ف|ب|ك|ل)?ال/, ''))
        .join(' ');
}

/**
 * Match a keyword against text with proper boundary handling.
 *
 * English keywords: word-boundary regex (\b) to avoid "price" matching "surprise".
 *
 * Arabic keywords: strip ال-family prefixes from both sides, then substring match.
 * Handles prefixed forms (العنوان ↔ عنوان, والسعر ↔ سعر) without the false-positive
 * risk of alif-stripping (which would conflate roots like كتاب/كتب, باب/بب).
 *
 * Broken plurals (سعر ↔ أسعار) are intentionally NOT matched — users should
 * configure both forms. Silent false positives are worse than silent misses
 * in a keyword router since wrong replies go out without review.
 *
 * Both sides are pre-normalized with normalizeArabic() before this is called.
 */
export function matchesKeyword(normalizedText: string, normalizedKeyword: string): boolean {
    if (!normalizedKeyword) return false;

    if (ARABIC_RE.test(normalizedKeyword)) {
        if (normalizedText.includes(normalizedKeyword)) return true;

        const strippedKeyword = stripArabicPrefixes(normalizedKeyword);
        if (strippedKeyword === normalizedKeyword) return false;
        if (strippedKeyword.length < 3) return false;

        return stripArabicPrefixes(normalizedText).includes(strippedKeyword);
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
 * Parse a comma-separated trigger keyword string into a cleaned array.
 * Used consistently across backend (controller, commentProcessor) and frontend.
 */
export function parseKeywords(raw: string | null | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map(k => k.trim()).filter(Boolean);
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

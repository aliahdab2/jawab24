/**
 * Heuristic classifier that flags raw KB text containing a price list, which
 * should ideally live in the structured catalog rather than free text.
 *
 * Shared so both consumers run the SAME detector (single source of truth):
 * - backend `PUT /pages/:id` → `kbWarnings` in the save response
 * - the KB editor's live (pre-save) notice in `KnowledgeBasePanel`
 *
 * Shape only: a price is a number next to a currency token, and a list is
 * three or more of them. The three-price threshold is deliberate — single
 * price mentions appear legitimately in policy text (delivery thresholds,
 * refund caps), where restructuring would be inappropriate.
 *
 * It used to carry a second, vocabulary-driven signal ("course catalog":
 * two words like دورة/كورس/workshop plus one price). Jawab24 serves every
 * kind of business, and a detector that knows the words of one vertical is
 * calibrated to it — a software vendor's subscription plans read as courses
 * (2026-08-29). A detector that knows no words cannot favour anyone.
 */

import { normalizeArabicIndic } from './utils/validation';

// Arabic currency tokens — JS `\b` doesn't treat Arabic chars as word chars,
// so word-boundary anchors don't work on these. Substring matches inside
// longer Arabic words (e.g. `ريالات` = riyals) are still correct hits.
const CURRENCY_TOKENS_AR = [
    'ريال', 'ر\\.س', 'ر\\.ع',
    'درهم', 'د\\.إ',
    'دولار', 'يورو', 'جنيه', 'ج\\.م',
    'ليرة', 'ل\\.س', 'ل\\.ل',
    'دينار', 'د\\.ل', 'د\\.ك', 'د\\.ب', 'د\\.أ', 'د\\.ع',
].join('|');

// Latin abbreviations — anchor with `\b` to avoid substring matches inside
// longer English words.
const CURRENCY_TOKENS_EN = [
    'SAR', 'AED', 'USD', 'EUR', 'EGP', 'SYP', 'LYD',
    'JOD', 'QAR', 'KWD', 'OMR', 'BHD', 'IQD',
].join('|');

/** Number followed by Arabic currency token: `1500 ريال`, `300 ر.س`. */
const NUMBER_BEFORE_CURRENCY_AR = new RegExp(
    `(\\d{2,7}(?:[.,]\\d{1,3})?)\\s*(?:${CURRENCY_TOKENS_AR})`,
    'gi',
);

/** Number followed by Latin currency abbreviation: `2000 SAR`, `99 USD`. */
const NUMBER_BEFORE_CURRENCY_EN = new RegExp(
    `(\\d{2,7}(?:[.,]\\d{1,3})?)\\s*(?:${CURRENCY_TOKENS_EN})\\b`,
    'gi',
);

/** Currency symbol prefix: `$1500`, `€200`, `£300`. */
const SYMBOL_BEFORE_NUMBER = /(?:[$€£])\s*\d{2,7}(?:[.,]\d{1,3})?/g;

/** Minimum body length before classification is meaningful. */
const MIN_TEXT_LENGTH = 50;

/** Three or more priced lines indicates a price list, not policy text. */
const PRICE_LIST_THRESHOLD = 3;

export type CatalogReason = 'price_list';

export interface CatalogDetection {
    hasCatalog: boolean;
    reasons: CatalogReason[];
    priceCount: number;
}

/**
 * Inspect raw KB text for catalog-like patterns.
 *
 * Arabic-Indic digits (٠-٩) are normalized to ASCII before matching, so
 * `١٥٠٠ ريال` counts as a price. Digit-only normalization on purpose: full
 * `normalizeArabic` folds hamza forms (`د.إ` → `د.ا`) and would break the
 * currency-token patterns above.
 *
 * Returns `hasCatalog: false` (with empty reasons) when the text is too short,
 * empty, or below all heuristic thresholds. Never throws.
 */
export function detectCatalogLikePatterns(text: string): CatalogDetection {
    if (!text || text.trim().length < MIN_TEXT_LENGTH) {
        return { hasCatalog: false, reasons: [], priceCount: 0 };
    }

    const comparable = normalizeArabicIndic(text);

    const priceMatches = [
        ...comparable.matchAll(NUMBER_BEFORE_CURRENCY_AR),
        ...comparable.matchAll(NUMBER_BEFORE_CURRENCY_EN),
        ...comparable.matchAll(SYMBOL_BEFORE_NUMBER),
    ];
    const priceCount = priceMatches.length;

    const reasons: CatalogReason[] = priceCount >= PRICE_LIST_THRESHOLD ? ['price_list'] : [];

    return {
        hasCatalog: reasons.length > 0,
        reasons,
        priceCount,
    };
}

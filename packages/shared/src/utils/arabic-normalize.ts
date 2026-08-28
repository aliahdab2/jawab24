/**
 * Arabic text normalization utility for Jawab24
 *
 * Used everywhere Arabic text is stored, searched, or compared:
 * - KB chunk storage (content_normalized, title_normalized)
 * - Cache key generation
 * - Search query normalization before embedding/retrieval
 */

export interface NormalizeOptions {
  /** Normalize taa marbuta ة → ه (default: false — can harm some names) */
  normalizeTaaMarbuta?: boolean;
  /** Normalize Arabic-Indic digits ٠-٩ → 0-9 (default: true) */
  normalizeDigits?: boolean;
}

// Diacritics / tashkeel ranges
const DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g;

// Alef variants: أ (U+0623), إ (U+0625), آ (U+0622) → ا (U+0627)
const ALEF_VARIANTS_RE = /[\u0622\u0623\u0625]/g;

// Tatweel (kashida): ـ (U+0640)
const TATWEEL_RE = /\u0640/g;

// Taa marbuta: ة (U+0629) → ه (U+0647)
const TAA_MARBUTA_RE = /\u0629/g;

// Arabic-Indic digits: ٠١٢٣٤٥٦٧٨٩ → 0123456789
const ARABIC_DIGIT_MAP: Record<string, string> = {
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
};
const ARABIC_DIGITS_RE = /[\u0660-\u0669]/g;

// Extended Arabic-Indic (Persian/Urdu keyboards): ۰۱۲۳۴۵۶۷۸۹ → 0123456789.
// Merchants on those layouts type them into price and reference fields.
const EXTENDED_ARABIC_DIGITS_RE = /[\u06F0-\u06F9]/g;

/**
 * Fold BOTH Arabic-Indic digit ranges to ASCII, and nothing else.
 *
 * The one definition — a reference or a price typed «١٢٣», «۱۲۳» and "123"
 * must compare equal wherever we compare them, and three private copies of
 * this mapping is how they stop doing that.
 *
 * NOTE: `normalizeArabic` below keeps its own basic-range fold as one step of a
 * larger pipeline whose output is a cache/search key — widening it to the
 * extended range would silently re-key existing KB chunks, so that call is
 * deliberately left alone.
 */
export function foldArabicDigits(text: string): string {
  if (!text) return text;
  return text
    .replace(ARABIC_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * Normalize Arabic text for consistent storage, search, and comparison.
 *
 * Steps (in order):
 * 1. Remove diacritics (tashkeel)
 * 2. Normalize alef variants (أ/إ/آ → ا)
 * 3. Remove tatweel (ـ)
 * 4. Optional: taa marbuta (ة → ه)
 * 5. Normalize Arabic-Indic digits (٠-٩ → 0-9)
 * 6. Collapse whitespace, trim
 */
export function normalizeArabic(text: string, options?: NormalizeOptions): string {
  if (!text) return text;

  const normalizeTaaMarbuta = options?.normalizeTaaMarbuta ?? false;
  const normalizeDigits = options?.normalizeDigits ?? true;

  let result = text;

  // 1. Remove diacritics
  result = result.replace(DIACRITICS_RE, '');

  // 2. Normalize alef variants
  result = result.replace(ALEF_VARIANTS_RE, '\u0627');

  // 3. Remove tatweel
  result = result.replace(TATWEEL_RE, '');

  // 4. Optional: taa marbuta
  if (normalizeTaaMarbuta) {
    result = result.replace(TAA_MARBUTA_RE, '\u0647');
  }

  // 5. Arabic-Indic digits → Western digits
  if (normalizeDigits) {
    result = result.replace(ARABIC_DIGITS_RE, (ch) => ARABIC_DIGIT_MAP[ch] || ch);
  }

  // 6. Collapse whitespace, trim
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * matchCatalogLinesInKb — Phase C core (Business Surface milestone).
 *
 * Finds the KB free-text lines that talk about catalog items so the merchant
 * can be OFFERED their removal after an import/scan («نقلنا N منتجاً — نحذف
 * أسطرها؟»). Matching is deliberately cowardly (بوابة المطابقة in the test
 * plan): it only PROPOSES — nothing is removed without explicit merchant
 * confirmation, and doubt lowers confidence instead of widening the match.
 *
 * Rules:
 * - A line is proposed only when EVERY name token of some item appears
 *   standalone in the line (ال prefix tolerated) AND the line carries a
 *   number — price-shaped lines are the cleanup scope; prose mentions stay.
 * - 'exact' confidence = the whole normalized item name appears contiguously
 *   AND the name is distinctive (≥2 tokens or ≥4 chars). The review sheet
 *   pre-checks these. 'tokens' = scattered/short matches, offered UNCHECKED.
 */

import { normalizeArabic } from './utils/arabic-normalize';

export interface CatalogMatchItem {
  id: string;
  name: string;
}

export type KbLineMatchConfidence = 'exact' | 'tokens';

export interface KbLineMatch {
  /** 0-based index into kbText.split('\n') — stable for removal by index. */
  lineIndex: number;
  /** The ORIGINAL line text, untouched. */
  line: string;
  /** Items this line talks about (deduped, in input order). */
  itemIds: string[];
  /** Highest confidence among the matched items. */
  confidence: KbLineMatchConfidence;
}

/** Punctuation/bullets folded to spaces before standalone-token checks. */
const PUNCT_RE = /[-–—ـ:؛،,.()[\]{}«»"'`*•·|/\\!؟?+=~#٪%]/g;

function comparable(text: string): string {
  const normalized = normalizeArabic(text, { normalizeTaaMarbuta: true })
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? ` ${normalized} ` : '';
}

function containsStandalone(paddedLine: string, token: string): boolean {
  return paddedLine.includes(` ${token} `) || paddedLine.includes(` ال${token} `);
}

/**
 * Pure. Returns the KB lines safe to PROPOSE for removal, in their original
 * KB order (each carries its own `confidence`; callers pre-check 'exact' and
 * leave 'tokens' unchecked). Never touches the text itself.
 */
export function matchCatalogLinesInKb(
  kbText: string,
  items: CatalogMatchItem[],
): KbLineMatch[] {
  if (!kbText || !items.length) return [];

  const prepared = items
    .map((item) => {
      const padded = comparable(item.name);
      const tokens = padded.trim().split(' ').filter((t) => t.length >= 2);
      if (!tokens.length) return null;
      // Single very short names («زيت») are too generic to pre-check —
      // cap them at 'tokens' so the merchant explicitly opts in.
      const distinctive = tokens.length >= 2 || tokens[0].length >= 4;
      return { id: item.id, padded: padded.trim(), tokens, distinctive };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  if (!prepared.length) return [];

  const lines = kbText.split('\n');
  const matches: KbLineMatch[] = [];

  lines.forEach((line, lineIndex) => {
    const paddedLine = comparable(line);
    if (!paddedLine) return;
    // Cleanup scope is price-shaped lines only (digits already normalized
    // from Arabic-Indic by comparable()). Prose mentions are never proposed.
    if (!/\d/.test(paddedLine)) return;

    const itemIds: string[] = [];
    let confidence: KbLineMatchConfidence | null = null;

    for (const item of prepared) {
      if (!item.tokens.every((t) => containsStandalone(paddedLine, t))) continue;
      itemIds.push(item.id);
      const isExact = item.distinctive && paddedLine.includes(` ${item.padded} `);
      if (isExact) confidence = 'exact';
      else confidence = confidence ?? 'tokens';
    }

    if (itemIds.length && confidence) {
      matches.push({ lineIndex, line, itemIds, confidence });
    }
  });

  return matches;
}

// ─────────────────────────────────────────────────────────────────────────
// Structured-field cleanup (the actual #720 fix).
//
// The catalog matcher above cleans PRODUCT lines. But #720 is a structured
// FIELD conflict — a confirmed address (حي النسيم) losing to a stale narrative
// line («العنوان: حي العزيزية»). An address has no "item name" to match, so it
// needs its own matcher: find KB lines that STATE a field we already hold as a
// confirmed structured value, and offer their removal so the authoritative
// BUSINESS_INFO field can't be contradicted.
//
// Cowardice, stricter than the catalog matcher because a false positive here
// deletes a fact, not a price:
//  - Propose a line for field K ONLY when (a) it carries a standalone label
//    token for K, AND (b) the merchant actually HAS a confirmed value for K.
//    No confirmed value → nothing more authoritative exists → never propose.
//  - phone/hours lines must also carry a digit; an address line need not.
//  - These are inherently lower-confidence than a product name+price line
//    (a line may hold a SECOND branch address the field can't). The UI MUST
//    show field matches UNCHECKED by default — explicit merchant opt-in.
// ─────────────────────────────────────────────────────────────────────────

export type StructuredFieldKind = 'address' | 'phone' | 'hours';

/** Which fields the merchant holds as CONFIRMED structured values. */
export type PresentFields = Partial<Record<StructuredFieldKind, boolean>>;

export interface StructuredFieldLineMatch {
  lineIndex: number;
  line: string;
  fields: StructuredFieldKind[];
}

// Label tokens per field. Listed WITHOUT the ال prefix where the ال-tolerance
// in containsStandalone covers it; possessive/variant forms listed explicitly
// (Arabic clitics make them distinct tokens: موقعنا ≠ موقع).
//
// Deliberately EXCLUDES over-broad tokens that collide with unrelated lines:
// bare «رقم» (matches «رقم الطلب» = order number) and bare «موقع» (matches
// «موقعنا الإلكتروني» = website). We keep the possessive «موقعنا» (their
// physical location) but not standalone «موقع». Fewer false proposals in the
// sheet; the merchant still confirms every one.
const FIELD_LABELS: Record<StructuredFieldKind, string[]> = {
  address: ['عنوان', 'عنواننا', 'موقعنا', 'address', 'location'],
  phone: ['هاتف', 'هاتفنا', 'رقمنا', 'موبايل', 'جوال', 'للتواصل', 'phone', 'tel', 'mobile'],
  hours: ['دوام', 'دوامنا', 'اوقات', 'ساعات', 'مواعيد', 'نفتح', 'hours', 'open'],
};

/**
 * Pure. Returns KB lines that duplicate a CONFIRMED structured field and are
 * therefore safe to PROPOSE for removal. Never touches the text. Callers must
 * default these to UNCHECKED — a field line is riskier to remove than a price.
 */
export function matchStructuredFieldLinesInKb(
  kbText: string,
  present: PresentFields,
): StructuredFieldLineMatch[] {
  if (!kbText) return [];
  const kinds = (Object.keys(FIELD_LABELS) as StructuredFieldKind[]).filter((k) => present[k]);
  if (!kinds.length) return [];

  const labelTokens: Record<StructuredFieldKind, string[]> = {
    address: FIELD_LABELS.address.map((l) => comparable(l).trim()).filter(Boolean),
    phone: FIELD_LABELS.phone.map((l) => comparable(l).trim()).filter(Boolean),
    hours: FIELD_LABELS.hours.map((l) => comparable(l).trim()).filter(Boolean),
  };

  const lines = kbText.split('\n');
  const out: StructuredFieldLineMatch[] = [];

  lines.forEach((line, lineIndex) => {
    const paddedLine = comparable(line);
    if (!paddedLine) return;

    const fields: StructuredFieldKind[] = [];
    for (const kind of kinds) {
      const hasLabel = labelTokens[kind].some((t) => containsStandalone(paddedLine, t));
      if (!hasLabel) continue;
      // A phone/hours claim is numeric; an address usually is not.
      if ((kind === 'phone' || kind === 'hours') && !/\d/.test(paddedLine)) continue;
      fields.push(kind);
    }
    if (fields.length) out.push({ lineIndex, line, fields });
  });

  return out;
}

/**
 * Pure. Removes the confirmed lines by index and tidies leftover blank runs.
 * Callers must guard the empty-result case themselves (an emptied KB skips
 * re-ingestion upstream — see the plan's Phase C trap list).
 */
export function removeKbLines(kbText: string, lineIndices: number[]): string {
  if (!lineIndices.length) return kbText;
  const drop = new Set(lineIndices);
  return kbText
    .split('\n')
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

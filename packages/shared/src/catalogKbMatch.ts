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
 *   number THAT IS NOT PART OF THE ITEM'S OWN NAME — price-shaped lines are the
 *   cleanup scope; prose mentions stay.
 * - 'exact' confidence = the whole normalized item name appears contiguously,
 *   the name is distinctive (≥2 tokens or ≥4 chars), AND the line reads like a
 *   catalog row rather than a sentence. The review sheet pre-checks these.
 *   'tokens' = scattered/short/prose matches, offered UNCHECKED.
 *
 * Two holes closed 2026-08-19, after a merchant was offered two FAQ lines —
 * neither carrying a price — pre-checked for deletion from Business Info:
 *
 *  1. The digit gate counted digits INSIDE the matched name. A brand-shaped item
 *     («جواب24») made every prose line that merely mentions it look price-shaped,
 *     because the "price" it found was the 24 in its own name. The gate now runs
 *     on the line with that item's name removed, which is what it always meant.
 *  2. Nothing distinguished a price row from a sentence. «الطريقة بسيطة من خلال
 *     تحميل تطبيق جواب٢٤ … صفحة جواب ٢٤» has a genuine standalone number, so (1)
 *     alone still lets it through — and it was PRE-CHECKED, one tap from deleting
 *     the merchant's own copy. A row is short by nature; a sentence is not, so a
 *     long tail beyond the name caps confidence at 'tokens'.
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
 * The line with every standalone occurrence of `tokens` removed — the same
 * ال-tolerance `containsStandalone` applies, so what the matcher counted as
 * present is exactly what is taken away. Stays padded, so callers can keep
 * using `containsStandalone` on the result.
 */
function withoutTokens(paddedLine: string, tokens: string[]): string {
  let rest = paddedLine;
  for (const token of tokens) {
    for (const form of [` ${token} `, ` ال${token} `]) {
      // Loop: removing ` a ` from ` a a ` consumes the shared separator, so a
      // single pass would leave the second occurrence behind.
      while (rest.includes(form)) rest = rest.replace(form, ' ');
    }
  }
  return rest;
}

/**
 * How many words a line still has once every catalog name it mentions is taken
 * out. A catalog row is mostly its names plus prices («زيت موتول ١٨ ألف» → 2),
 * while a sentence that happens to mention the item carries a long tail
 * («… تحميل تطبيق جواب٢٤ على اندرويد او من خلال صفحة جواب ٢٤» → 11).
 *
 * Measured per LINE, against ALL the items it matches, not per item: "is this a
 * catalog row?" is a property of the line, and a row listing three products
 * would otherwise read as prose to each of them in turn.
 *
 * 6 clears the wordiest REAL rows seen in merchant price lists — name + amount
 * + currency + a two-or-three-word qualifier («شهرياً للمتجر الواحد») — with
 * room to spare, while a prose sentence is far above it. It is a cowardice
 * threshold, not a classifier: crossing it does not reject the line, it only
 * stops it being PRE-CHECKED, so the merchant opts in by hand.
 */
const MAX_ROW_TAIL_TOKENS = 6;

function countTokens(padded: string): number {
  const trimmed = padded.trim();
  return trimmed ? trimmed.split(' ').length : 0;
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
    // Cheap early-out only (digits already normalized from Arabic-Indic by
    // comparable()). The REAL price gate is per item, below: a digit that comes
    // from the item's own name is not a price.
    if (!/\d/.test(paddedLine)) return;

    // Cleanup scope is price-shaped lines only. «كيف يعمل الذكاء الاصطناعي في
    // جواب24؟» carries a digit, but take «جواب24» out and nothing numeric is
    // left — the line states no price, so it is prose and stays.
    const priced = prepared.filter(
      (item) =>
        item.tokens.every((t) => containsStandalone(paddedLine, t)) &&
        /\d/.test(withoutTokens(paddedLine, item.tokens)),
    );
    if (!priced.length) return;

    // One line-level measurement, shared by every item on the line.
    const looksLikeRow =
      countTokens(withoutTokens(paddedLine, priced.flatMap((i) => i.tokens))) <=
      MAX_ROW_TAIL_TOKENS;

    const itemIds: string[] = [];
    let confidence: KbLineMatchConfidence | null = null;

    for (const item of priced) {
      itemIds.push(item.id);
      const isExact = item.distinctive && paddedLine.includes(` ${item.padded} `) && looksLikeRow;
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
//  - bare «رقم» (matches «رقم الطلب» = order number).
//  - «جوال»/«موبايل»/«mobile» — these are PRODUCT words (a phone-accessory line
//    «حامل جوال» would be proposed as a phone-field duplicate). Keep «هاتف».
//  - «مواعيد» — appears in delivery prose («مواعيد التوصيل خلال ٣ أيام»). Keep
//    «دوام»/«ساعات» which specifically name business hours.
// Fewer false proposals in the sheet; the merchant still confirms every one.
const FIELD_LABELS: Record<StructuredFieldKind, string[]> = {
  // «موقع» is AMBIGUOUS, not over-broad: «الموقع: الرياض، حي كذا» is the shop's
  // place, «الموقع الإلكتروني» is the website. It was excluded outright until
  // 2026-08-03, which made this matcher a no-op on the commonest way merchants
  // actually write their address — «📍 الموقع:» — so the cleanup proposed
  // nothing and the stale line survived (eval #720). It is admitted here and
  // disambiguated per line by WEBSITE_MARKERS below.
  address: ['عنوان', 'عنواننا', 'موقع', 'موقعنا', 'address', 'location'],
  phone: ['هاتف', 'هاتفنا', 'رقمنا', 'للتواصل', 'phone', 'tel'],
  hours: ['دوام', 'دوامنا', 'اوقات', 'ساعات', 'نفتح', 'hours', 'open'],
};

/**
 * Labels that name the field only when nothing else on the line contradicts
 * them. Unambiguous labels («عنوان», «موقعنا») are never subjected to this.
 */
const AMBIGUOUS_LABELS: Record<StructuredFieldKind, string[]> = {
  address: ['موقع'],
  phone: [],
  hours: [],
};

/**
 * Evidence that a line is about the WEBSITE rather than the shop's location.
 * Note `comparable()` folds «.» and «/» to spaces, so a URL arrives as the
 * tokens it is made of — hence `www` / `http` / `com` rather than a URL regex.
 * Alef normalization maps «إلكتروني» → «الكتروني», so one token covers both.
 */
const WEBSITE_MARKERS = ['الكتروني', 'website', 'www', 'http', 'https', 'com'];

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
  const ambiguousTokens: Record<StructuredFieldKind, Set<string>> = {
    address: new Set(AMBIGUOUS_LABELS.address.map((l) => comparable(l).trim())),
    phone: new Set(AMBIGUOUS_LABELS.phone.map((l) => comparable(l).trim())),
    hours: new Set(AMBIGUOUS_LABELS.hours.map((l) => comparable(l).trim())),
  };
  const websiteTokens = WEBSITE_MARKERS.map((t) => comparable(t).trim()).filter(Boolean);

  const lines = kbText.split('\n');
  const out: StructuredFieldLineMatch[] = [];

  lines.forEach((line, lineIndex) => {
    const paddedLine = comparable(line);
    if (!paddedLine) return;

    // «الموقع الإلكتروني: example.com» names a website, not a place. An
    // ambiguous label on such a line is NOT address evidence; an explicit one
    // («عنواننا») still is.
    const looksLikeWebsite = websiteTokens.some((t) => containsStandalone(paddedLine, t));

    const fields: StructuredFieldKind[] = [];
    for (const kind of kinds) {
      const hasLabel = labelTokens[kind].some((t) => {
        if (!containsStandalone(paddedLine, t)) return false;
        return !(looksLikeWebsite && ambiguousTokens[kind].has(t));
      });
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

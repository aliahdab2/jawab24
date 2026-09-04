import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js';
import { stripBidiMarks } from '../bidi';

/** E.164 international phone format: +[1-9] followed by 1–14 digits */
export const PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

/** Basic email format */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPhone(value: string): boolean {
  return PHONE_REGEX.test(value);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

/**
 * True when `value` is a syntactically valid http(s) URL — the only schemes Meta accepts
 * for a URL button. Single source of truth for the Post Reply CTA button, used by both the
 * backend validator and the frontend modal so their notions of "valid" can't drift.
 */
export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize merchant-typed link input to a valid http(s) URL, or null when it can't
 * be one. Merchants routinely paste bare domains («mystore.com/offer»); rather than
 * reject those with a "must start with https://" error, prepend the scheme when the
 * input plausibly is a web address (a hostname containing a dot). Explicit non-http
 * schemes (tel:, whatsapp:, ftp:) are NOT rewritten — Meta URL buttons only accept
 * http(s), so those must fail validation loudly instead of being mangled.
 */
export function normalizeHttpUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (isValidHttpUrl(v)) return v;
  // An explicit scheme that isn't http(s) — don't second-guess it into https://.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  try {
    const u = new URL(`https://${v}`);
    // Require a dotted hostname so free text («صفحتنا») isn't "rescued" into a
    // syntactically-valid-but-nonsense URL.
    return u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
}

/** Returns whether a string is a valid email or E.164 phone number. */
export function isValidContact(value: string): boolean {
  return isValidEmail(value) || isValidPhone(value);
}

/**
 * E.164 dial-code prefixes NO messaging provider can deliver a verification code
 * to, because the region is sanctions-blocked — not because of any one vendor.
 * Syria (+963) is barred from the WhatsApp Business Platform outright (D-045:
 * Meta blocks both Syrian businesses and Syrian recipients), and was equally
 * undeliverable over the retired SMS rail. Lives here (not just backend) so the
 * frontend can pre-empt a doomed request instead of funnelling users into a
 * guaranteed failure.
 *
 * ⛔ This list does NOT expire with the SMS rail. It must survive any future
 * change of verification transport — see .planning/WHATSAPP_PLAN.md.
 */
export const SANCTIONED_DIAL_PREFIXES = ['+963'] as const; // Syria

/** True if an E.164 phone is in a region no verification transport can reach. */
export function isSanctionedPhone(phoneE164: string): boolean {
  return SANCTIONED_DIAL_PREFIXES.some(prefix => phoneE164.startsWith(prefix));
}

/** Splits a contact string into its email/phone components for storage. */
export function detectContactType(contact: string): { email: string | null; phone: string | null } {
  if (isValidPhone(contact)) {
    return { email: null, phone: contact };
  }
  return { email: contact, phone: null };
}

/** Arabic-speaking country calling codes (E.164 prefixes without the +). */
const ARABIC_CALLING_CODES = [
  '966', '971', '970', '962', '961', '963', '964', '965',
  '968', '967', '974', '973', '218', '216', '213', '212', '20',
  '249', '253',
];

const ARABIC_PREFIX_RE = new RegExp(`^\\+(?:${ARABIC_CALLING_CODES.join('|')})`);

/** Returns true if the E.164 phone number belongs to an Arabic-speaking country. */
export function isArabicPhone(phone: string): boolean {
  return ARABIC_PREFIX_RE.test(phone);
}

/**
 * Normalize Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩, U+0660–0669) AND Extended
 * Arabic-Indic digits (۰۱۲۳۴۵۶۷۸۹, U+06F0–06F9 — Persian/Urdu keyboards)
 * to ASCII before matching. Both classes reach us in real customer and
 * merchant text; treating only one is the digit-blindness bug class twice.
 */
export function normalizeArabicIndic(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = '٠١٢٣٤٥٦٧٨٩'.indexOf(d);
    return String(i !== -1 ? i : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  });
}

/** A phone number extracted from free text. */
export interface ExtractedPhone {
  /** Faithful digits as the customer typed them (Arabic-Indic→ASCII, formatting
   *  stripped, leading `+`/`00`→`+` preserved). Dials everywhere; what the merchant reads. */
  raw: string;
  /** Canonical E.164 when libphonenumber confidently validates the number against
   *  a real numbering plan; null when it can't (unknown region / exotic plan). */
  e164: string | null;
  /** True when the number validates against a real numbering plan. */
  valid: boolean;
}

/**
 * Permissive safety-net shapes used ONLY when libphonenumber can't resolve a run
 * (no region hint, or a plan it doesn't recognise) — so a real lead is never
 * silently dropped. libphonenumber is the primary, plan-validating extractor.
 *
 *  - CONTIGUOUS: a single run, no internal whitespace (`- . ( )` allowed). Keeps
 *    two space-separated numbers from welding (#81): each block matches alone.
 *  - GROUPED: a number written with spaces between ≤4-digit groups (`050 123 4567`).
 *    A contiguous 10-digit block can't parse as ≤4-digit groups, so #81 still holds.
 *
 * The fallback digit floor (9) is intentionally stricter than a real phone's
 * minimum: without a region we can't validate, and an 8-digit space-grouped run
 * is far more likely a size/price sequence ("75 80 85 90") than a phone. Known
 * regions still resolve genuine 8-digit national numbers via libphonenumber.
 */
const CONTIGUOUS_PHONE_REGEX = /(?<!\d)(?:\+|00)?\d[\d\-().]{6,14}\d(?!\d)/g;
const GROUPED_PHONE_REGEX = /(?<!\d)(?:\+|00)?\d{1,4}(?:[ \-.]\d{1,4}){1,6}(?!\d)/g;
const FALLBACK_DIGIT_MIN = 9;
const DIGIT_MAX = 15; // E.164 maximum

/** Strip the formatting characters allowed inside the regexes (incl. spaces), preserve `+`. */
function stripFormatting(s: string): string {
  return s.replace(/[\s\-().]/g, '');
}

/** Count digits only — the phone-plausibility bound is on digits, not characters.
 *  Exported for `isUsablePhoneEntry`, which asks a DIFFERENT question of the same
 *  text (see `businessPhone.ts`) and must not re-implement the count. */
export function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

/** Normalise text before phone matching: drop bidi marks, Arabic-Indic→ASCII,
 *  and rewrite a leading `00<cc>` international prefix to `+<cc>` (libphonenumber's
 *  findNumbers ignores a bare `00`). */
export function preNormalizeForPhones(text: string): string {
  let t = stripBidiMarks(text);
  t = normalizeArabicIndic(t);
  t = t.replace(/(?<![\d+])00(\d{7,})/g, '+$1');
  return t;
}

/**
 * Extract phone numbers from free text, validated against real numbering plans.
 *
 * Primary engine is libphonenumber-js: it parses every country's formats (spaces,
 * dashes, `+CC`, national `0…`), validates against the actual plan — which is what
 * rejects size/price/date sequences the old regex mistook for phones — and won't
 * weld two adjacent numbers. `opts.defaultCountry` (the merchant's region) only
 * resolves bare national numbers; an explicit `+CC` the customer types wins.
 *
 * A permissive fallback captures phone-plausible runs libphonenumber can't resolve
 * (no region / exotic plan) so a real lead is never silently dropped — those come
 * back with `e164: null, valid: false`. Results are de-duplicated (by E.164 when
 * known, else raw digits) and ordered by position in the text.
 */
export function extractPhones(text: string, opts?: { defaultCountry?: string }): ExtractedPhone[] {
  const normalized = preNormalizeForPhones(text);
  const defaultCountry = opts?.defaultCountry as CountryCode | undefined;

  interface Cand { start: number; end: number; raw: string; e164: string | null; valid: boolean }
  const candidates: Cand[] = [];

  // 1. libphonenumber — the validated primary. Keeps only numbers that match a
  //    real plan, so non-phone digit runs (sizes, prices, dates) are excluded here.
  const found = findPhoneNumbersInText(normalized, defaultCountry ? { defaultCountry } : undefined);
  for (const f of found) {
    if (!f.number.isValid()) continue;
    candidates.push({
      start: f.startsAt,
      end: f.endsAt,
      raw: stripFormatting(normalized.slice(f.startsAt, f.endsAt)),
      e164: f.number.number,
      valid: true,
    });
  }

  // 2. Permissive fallback — never drop a lead libphonenumber couldn't resolve.
  for (const regex of [CONTIGUOUS_PHONE_REGEX, GROUPED_PHONE_REGEX]) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(normalized)) !== null) {
      const d = digitCount(m[0]);
      if (d < FALLBACK_DIGIT_MIN || d > DIGIT_MAX) continue;
      candidates.push({ start: m.index, end: m.index + m[0].length, raw: stripFormatting(m[0]), e164: null, valid: false });
    }
  }

  // Earliest first; at the same span prefer the validated (libphonenumber) candidate,
  // then the longer match — so a validated number wins over a raw fallback of itself.
  candidates.sort((a, b) =>
    a.start - b.start || Number(b.valid) - Number(a.valid) || b.end - a.end,
  );

  const result: ExtractedPhone[] = [];
  const seen = new Set<string>();
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue; // overlaps an already-accepted span
    const key = c.e164 ?? c.raw;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ raw: c.raw, e164: c.e164, valid: c.valid });
    lastEnd = c.end;
  }
  return result;
}

/**
 * Back-compat: every phone-like run as raw digit strings, in order, de-duplicated.
 * Region-less (relies on `+CC` + the permissive fallback). Prefer `extractPhones`
 * for new code — it returns validation + E.164.
 */
export function extractPhonesFromText(text: string): string[] {
  return extractPhones(text).map(p => p.raw);
}

/**
 * First phone in the text as a raw string, or null. The cheap gate before AI lead
 * extraction. Pass `opts.defaultCountry` (from the merchant's timezone) to let
 * libphonenumber validate national numbers.
 */
export function extractPhoneFromText(text: string, opts?: { defaultCountry?: string }): string | null {
  return extractPhones(text, opts)[0]?.raw ?? null;
}

/**
 * Phone-shaped spans WITH their positions in the RAW text — for a caller that must
 * locate the number to wrap it in place (RTL bidi isolation), not merely read it.
 *
 * Unlike `extractPhones`, this runs the permissive regexes on the text UNCHANGED
 * (no `preNormalizeForPhones`), because that step strips bidi marks and rewrites
 * `00→+`, both of which shift offsets so a position could no longer point at the
 * original characters. Deciding whether a span is a real, wanted number is the
 * caller's job (e.g. `samePhoneNumber` against the merchant's own lines) — this
 * only bounds candidates to phone-plausible digit counts and drops overlaps so no
 * character is wrapped twice. ASCII digits only, which is what the regexes match
 * and what merchants store; an Arabic-Indic-digit number is left for the caller's
 * fallback, exactly as elsewhere.
 */
export function findPhoneSpans(text: string): { start: number; end: number; raw: string }[] {
  const spans: { start: number; end: number; raw: string }[] = [];
  for (const base of [CONTIGUOUS_PHONE_REGEX, GROUPED_PHONE_REGEX]) {
    // Own instance so the shared `/g` lastIndex is never carried between calls.
    const re = new RegExp(base.source, base.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const d = digitCount(m[0]);
      if (d < FALLBACK_DIGIT_MIN || d > DIGIT_MAX) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
    }
  }
  // Earliest first, longer first at a tie; then drop anything overlapping an
  // already-accepted span so the two regexes never wrap the same number twice.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: typeof spans = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd) continue;
    out.push(s);
    lastEnd = s.end;
  }
  return out;
}

/**
 * The last-9-significant-digit tail that identifies a phone line across the
 * `+CC` / leading-`0` / spaced representations (national numbers run ~9–10
 * significant digits). Empty string when the run is too short to identify one.
 */
export function phoneDigitsTail(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

/**
 * Whether two strings denote the SAME real-world number regardless of how it
 * was written (`+963…` vs `0…` vs spaced): equal identity tails. Runs too short
 * for a tail fall back to exact digit equality.
 */
export function samePhoneNumber(a: string, b: string): boolean {
  const ta = phoneDigitsTail(a);
  const tb = phoneDigitsTail(b);
  if (ta && tb) return ta === tb;
  return a.replace(/\D/g, '') === b.replace(/\D/g, '');
}

/**
 * Cross-format identity keys for an extracted phone, so the SAME real number
 * written as `+963…`, `0…`, or with spaces compares equal. Prefers E.164 (set
 * when libphonenumber validates the number under the same region on both sides);
 * always also emits a last-significant-digits tail so a validated `+963…` matches
 * an unvalidated paste of the same line. Module-private helper for extractCustomerPhones.
 */
function phoneIdentityKeys(p: ExtractedPhone): string[] {
  const keys: string[] = [];
  if (p.e164) keys.push(`e164:${p.e164}`);
  const tail = phoneDigitsTail(p.raw);
  if (tail) keys.push(`tail:${tail}`);
  return keys;
}

/**
 * Phones the CUSTOMER genuinely shared in `text`, excluding any number that also
 * appears in `businessTexts` — the merchant's own messages (our auto-replies,
 * the post, the deflection lines that publish the business's contact number).
 *
 * Why this exists: a customer who quotes or copy-pastes our reply back (e.g. to
 * ask us to translate it) drags the business's own published phone into their
 * incoming message. Without this filter the lead gate captures the merchant's
 * own line and spawns a bogus lead whose call/WhatsApp buttons dial the
 * merchant themselves. A lead must be built only from the customer's own input,
 * never from our answers. Match the SAME `defaultCountry` on both sides so the
 * customer's `0…` paste and our `+963…` reply resolve to the same E.164.
 */
export function extractCustomerPhones(
  text: string,
  businessTexts: string[],
  opts?: { defaultCountry?: string },
): ExtractedPhone[] {
  const businessKeys = new Set<string>();
  for (const bt of businessTexts) {
    if (!bt) continue;
    for (const bp of extractPhones(bt, opts)) {
      for (const k of phoneIdentityKeys(bp)) businessKeys.add(k);
    }
  }
  if (businessKeys.size === 0) return extractPhones(text, opts);
  return extractPhones(text, opts).filter(
    p => !phoneIdentityKeys(p).some(k => businessKeys.has(k)),
  );
}

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

/** Returns whether a string is a valid email or E.164 phone number. */
export function isValidContact(value: string): boolean {
  return isValidEmail(value) || isValidPhone(value);
}

/**
 * E.164 dial-code prefixes the OTP provider cannot deliver to. Syria (+963) is
 * sanctions-blocked at the provider level (Vonage errorCode 15, non-whitelisted
 * destination — confirmed via dashboard CSV). Lives here (not just backend) so
 * the frontend can pre-empt a doomed OTP request instead of funnelling users
 * into a guaranteed failure.
 *
 * NOTE: WhatsApp Business Platform is ALSO sanctions-blocked for Syria, so +963
 * stays blocked when OTP moves to WhatsApp. Changes are tracked with the
 * WhatsApp Cloud API OTP work — see .planning/WHATSAPP_PLAN.md.
 */
export const SMS_BLOCKED_DIAL_PREFIXES = ['+963'] as const; // Syria

/** True if an E.164 phone is in a region the OTP provider cannot deliver to. */
export function isSmsBlockedPhone(phoneE164: string): boolean {
  return SMS_BLOCKED_DIAL_PREFIXES.some(prefix => phoneE164.startsWith(prefix));
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

/** Normalize Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to ASCII before phone matching. */
export function normalizeArabicIndic(text: string): string {
  return text.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * Match a phone-like digit run anywhere in text — no country, no plan validation.
 *
 * Both the customer typing the number and the merchant reading it know what
 * country it belongs to; we have no business second-guessing them. Storing
 * exactly what the customer wrote (digits only, formatting stripped) keeps
 * the lead record faithful and works with `tel:` everywhere. For WhatsApp
 * click-to-chat the customer needs to have included `+countrycode` themselves.
 *
 * Shape: optional `+` or `00`, then 8–16 chars of digits / `- . ( )` bounded
 * by digits on both ends. Whitespace is NOT permitted inside the digit run —
 * that's the only thing that distinguishes this from the pre-#81 regex and
 * is what prevented two adjacent numbers from being welded into a 19-digit
 * garbage string. The size bound (8–16) is wide enough for every real-world
 * national/international format and tight enough to reject overlong digit
 * strings.
 */
// Two complementary shapes, both bounded to a phone-plausible digit count in
// code (see DIGIT_MIN/MAX) rather than by character count, so internal spaces
// don't break the bound:
//
//  1. CONTIGUOUS — a single run with no internal whitespace (formatting chars
//     `- . ( )` allowed). This is the original #81 shape and is what keeps two
//     numbers separated by a space from welding: each 10-digit block matches on
//     its own, the space ends the run.
//  2. GROUPED — a number written with internal spaces between short digit groups
//     (e.g. `050 123 4567`, `+966 50 123 4567`). Each group is 1–4 digits — the
//     real-world grouping width. A contiguous 10-digit block can NOT be parsed as
//     ≤4-digit groups, so the #81 welding case (`0935924472 0112124470`) is still
//     immune: there's no internal space within either block for GROUPED to latch
//     onto, so it never spans the gap between them.
//
// Before this, GROUPED didn't exist and CONTIGUOUS forbade internal whitespace,
// so a single phone typed with spaces (very common in Arabic markets) produced
// only sub-8-digit fragments and was dropped entirely — silently losing the lead.
const CONTIGUOUS_PHONE_REGEX = /(?<!\d)(?:\+|00)?\d[\d\-().]{6,14}\d(?!\d)/g;
const GROUPED_PHONE_REGEX = /(?<!\d)(?:\+|00)?\d{1,4}(?:[ \-.]\d{1,4}){1,6}(?!\d)/g;
const DIGIT_MIN = 8;
const DIGIT_MAX = 16;

/** Strip the formatting characters allowed inside the regexes (incl. spaces), preserve `+`. */
function stripFormatting(s: string): string {
  return s.replace(/[\s\-().]/g, '');
}

/** Count digits only — the phone-plausibility bound is on digits, not characters. */
function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

/**
 * Extract every phone-like digit run from free text, in the order they appear.
 *
 * Returns the strings exactly as the customer wrote them (Arabic-Indic digits
 * normalized to ASCII, formatting characters removed, `+` and `00` prefixes
 * preserved). Duplicates within the same message are de-duplicated. Handles both
 * contiguous numbers and numbers written with spaces between digit groups,
 * without welding two adjacent numbers into one (#81).
 */
export function extractPhonesFromText(text: string): string[] {
  const normalized = normalizeArabicIndic(text);

  // Collect candidates from both shapes, each tagged with its position so we can
  // resolve overlaps (a GROUPED match may cover the same span as a CONTIGUOUS one).
  const candidates: Array<{ start: number; end: number; raw: string }> = [];
  for (const regex of [CONTIGUOUS_PHONE_REGEX, GROUPED_PHONE_REGEX]) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(normalized)) !== null) {
      const d = digitCount(m[0]);
      if (d >= DIGIT_MIN && d <= DIGIT_MAX) {
        candidates.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
      }
    }
  }

  // Earliest first; on a tie prefer the longer span (the fully-grouped match over
  // a contiguous fragment of it).
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  const seen = new Set<string>();
  const result: string[] = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue; // overlaps an already-accepted match
    const cleaned = stripFormatting(c.raw);
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    lastEnd = c.end;
  }
  return result;
}

/**
 * Extract the first phone-like digit run from free text.
 * Returns null if no phone-like sequence is present.
 * Used as the cheap gate before AI lead extraction.
 */
export function extractPhoneFromText(text: string): string | null {
  return extractPhonesFromText(text)[0] ?? null;
}

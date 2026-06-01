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
const PHONE_LIKE_REGEX = /(?<!\d)(?:\+|00)?\d[\d\-().]{6,14}\d(?!\d)/g;

/** Strip the formatting characters allowed inside the regex, preserve `+`. */
function stripFormatting(s: string): string {
  return s.replace(/[-().]/g, '');
}

/**
 * Extract every phone-like digit run from free text, in the order they appear.
 *
 * Returns the strings exactly as the customer wrote them (Arabic-Indic digits
 * normalized to ASCII, formatting characters removed, `+` and `00` prefixes
 * preserved). Duplicates within the same message are de-duplicated.
 */
export function extractPhonesFromText(text: string): string[] {
  const normalized = normalizeArabicIndic(text);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of normalized.matchAll(PHONE_LIKE_REGEX)) {
    const cleaned = stripFormatting(m[0]);
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
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

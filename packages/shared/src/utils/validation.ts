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

import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js';

/**
 * Default country used to interpret nationally-formatted phone numbers
 * (e.g. "0935924472" → "+963935924472"). The lead extractor's customer base
 * is predominantly Syrian; callers can override per-workspace later.
 */
const DEFAULT_PHONE_COUNTRY: CountryCode = 'SY';

/**
 * Extract every phone-like string from free text and return them as E.164.
 *
 * Why this exists: customers regularly share both a mobile and a landline in
 * one message (Levant convention). The previous regex-based implementation
 * spanned whitespace between numbers and welded them into a single bogus
 * 19-digit string. libphonenumber-js tokenizes correctly and validates each
 * candidate against country-specific number plans.
 */
export function extractPhonesFromText(
  text: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string[] {
  const normalized = normalizeArabicIndic(text);
  const matches = findPhoneNumbersInText(normalized, defaultCountry);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of matches) {
    const e164 = m.number.number;
    if (!seen.has(e164)) {
      seen.add(e164);
      result.push(e164);
    }
  }
  return result;
}

/**
 * Extract the first valid phone from free text as E.164 (e.g. "+963935924472").
 * Returns null if no valid number is found.
 * Used for lead detection only.
 */
export function extractPhoneFromText(
  text: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  return extractPhonesFromText(text, defaultCountry)[0] ?? null;
}

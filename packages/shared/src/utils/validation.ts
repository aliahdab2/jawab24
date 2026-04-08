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

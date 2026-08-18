import { parsePhoneNumber } from 'libphonenumber-js';
import { PHONE_REGEX } from '@jawab24/shared';

/**
 * Format an E.164 phone number for display as a grouped international number,
 * e.g. `"46700224720"` or `"+46700224720"` → `"+46 70 022 47 20"`.
 *
 * Primary use: WhatsApp's `wa_id` is the customer's number in E.164 digits
 * WITHOUT the leading `+`, and it is the only stable identity WhatsApp gives
 * us (display names are self-set and often blank). We show it in the inbox.
 *
 * Uses `libphonenumber-js` (already bundled for the login PhoneInput) for
 * correct per-country grouping; falls back to a bare `"+<digits>"` when the
 * number can't be parsed, and returns `""` for empty/garbage input so callers
 * can chain a fallback (name → number → "unknown").
 *
 * IMPORTANT: render the result inside `dir="ltr"` / `<bdi>`. Phone numbers are
 * LTR and get visually mangled (sign/grouping reordered) in the Arabic layout.
 */
export function formatInternationalPhone(input: string): string {
  const digits = (input || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  try {
    const parsed = parsePhoneNumber(`+${digits}`);
    if (parsed) return parsed.formatInternational();
  } catch {
    // Unparseable number — fall through to the canonical E.164 form.
  }
  return `+${digits}`;
}

export interface CustomerLabel {
  /** The text to render for the customer. */
  label: string;
  /**
   * True when `label` is the phone number (name was missing). The caller MUST
   * render it inside `dir="ltr"` — a phone number is bidi-mangled in the Arabic
   * (RTL) layout. Keeping this here couples the LTR rule to the decision that
   * produced it, so the two inbox surfaces can't drift apart.
   */
  isPhone: boolean;
}

/**
 * Resolve the label for a conversation's customer: display name first, else the
 * (already-formatted) phone number, else `fallback`. Shared by the inbox list
 * (`MessageCard`) and the detail header (`MessageDetailModal`) so the name→
 * number→fallback precedence and the LTR rule live in exactly one place.
 */
export function resolveCustomerLabel(
  name: string | null | undefined,
  phone: string,
  fallback: string,
): CustomerLabel {
  if (name) return { label: name, isPhone: false };
  if (phone) return { label: phone, isPhone: true };
  return { label: fallback, isPhone: false };
}

/**
 * Normalize a merchant-typed phone number to E.164 (`+<country><number>`), or
 * null when it can't be a valid international number. Accepts the messy forms
 * merchants actually paste — `+963 944 123 456`, `00963-944123456`,
 * `963944123456` — but rejects local formats (leading 0 without a country
 * code), because wa.me requires the country code. Validation itself is the
 * shared E.164 rule (PHONE_REGEX) so frontend and backend can't drift.
 */
export function normalizeInternationalPhone(input: string): string | null {
  let v = input.trim().replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  else if (/^[1-9]\d+$/.test(v)) v = `+${v}`;
  return PHONE_REGEX.test(v) ? v : null;
}

import { parsePhoneNumber } from 'libphonenumber-js';

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

/**
 * The merchant contact standard — one phone entry's shape, and the rules that
 * keep it stable.
 *
 * A merchant's number often carries a PURPOSE («الإدارة», «قسم الجملة»,
 * «للشكاوى»). Before this module the structured field held bare strings, so the
 * purpose had nowhere to live and leaked into whatever free text accepted it:
 * the persona, the knowledge base, or the number slot itself (a real page
 * stored «رقم الجملة فقط يطلب مبيعات جملة» AS a phone number, and the prompt
 * published it to customers as one).
 *
 * The model follows schema.org `ContactPoint`: the number, plus a free-text
 * description of what it is for. Deliberately NOT an enum — the standard itself
 * defines `contactType` as free text with suggested values, and a closed list
 * cannot survive contact with real businesses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐ THE CANONICAL-FORM INVARIANT — the load-bearing rule of this file
 *
 *   An entry is stored as a bare `string` IF AND ONLY IF it has no non-empty
 *   description. `{number:'x'}`, `{number:'x',description:''}` and
 *   `{number:'x',description:'   '}` all canonicalize to `'x'`.
 *
 * Why it matters, concretely: `applyMerchantEdit` decides whether a field
 * CHANGED by deep-comparing the incoming patch against what is stored
 * (`valueEquals`), and the editor sends a FULL-REPLACE patch on every save — so
 * saving the address re-sends the phones untouched. If the stored shape were
 * remembered rather than derived, `['0911…']` could echo back as
 * `[{number:'0911…'}]`; `valueEquals` would read that as a change and stamp
 * `{source:'editor', confirmedAt: now}` on a field the merchant never touched —
 * laundering an unconfirmed Facebook-synced number into the authoritative
 * prompt block. That is a bug this codebase has already shipped once and fixed
 * (2026-08-08). Deriving the shape from (number, description) makes the round
 * trip a pure function, so the class cannot recur.
 *
 * Enforced at BOTH write boundaries — the backend Zod preprocess and the editor
 * serializer — so no client can store a non-canonical value.
 *
 * Machine producers (Facebook sync, the KB fact extractor) keep emitting plain
 * `string[]`, which is already canonical. They need no changes.
 */

import { digitCount, preNormalizeForPhones } from './utils/validation';

/** A contact line with an optional purpose. schema.org `ContactPoint` reduced
 *  to what a merchant actually types. */
export interface BusinessPhoneEntry {
    number: string;
    /** What this line is for («الإدارة — عند الطلب فقط»). Free text by design. */
    description?: string;
}

/** Stored form: a bare string when there is no description (see the canonical-
 *  form invariant above), an object when there is. */
export type BusinessPhone = string | BusinessPhoneEntry;

/** Cap on one description. Matches the per-entry `phones` cap so a line stays
 *  something a person can read at a glance, and bounds the rendered phones line
 *  well under the prompt's BUSINESS_INFO budget even at the 10-entry maximum. */
export const MAX_PHONE_DESCRIPTION_LENGTH = 40;

/**
 * Characters that must not survive into the rendered description, by code point
 * (a regex class would need literal control characters in the source).
 *
 *  - C0/C1 controls and DEL: a newline would let a description forge an extra
 *    `- Label: value` line inside the authoritative BUSINESS_INFO block.
 *  - Bidi controls: they reorder a line visually without changing its text.
 */
function isStrippedChar(code: number): boolean {
    return code <= 0x1f
        || code === 0x7f
        || (code >= 0x200e && code <= 0x200f)
        || (code >= 0x202a && code <= 0x202e)
        || (code >= 0x2066 && code <= 0x2069);
}

/** The render's own delimiter, ASCII and full-width. */
const PAREN_CHARS = /[()（）]/g;

/**
 * Make a merchant-typed description safe to render inside the authoritative
 * BUSINESS_INFO block.
 *
 * Everything here REPLACES rather than rejects — a merchant must never be
 * blocked from saving over punctuation. Rejection is reserved for the number
 * slot, where the content is genuinely wrong (see `isUsablePhoneEntry`).
 */
export function sanitizePhoneDescription(raw: string): string {
    return Array.from(raw)
        .map((ch) => (isStrippedChar(ch.codePointAt(0) ?? 0) ? ' ' : ch))
        .join('')
        .replace(PAREN_CHARS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_PHONE_DESCRIPTION_LENGTH)
        .trim();
}

/**
 * Canonicalize one entry of unknown provenance (client body, stored JSONB,
 * machine producer). Returns `null` for anything with no usable number, so
 * callers can filter in one pass.
 */
export function normalizePhoneEntry(raw: unknown): BusinessPhone | null {
    if (typeof raw === 'string') {
        const number = raw.trim();
        return number === '' ? null : number;
    }
    if (!raw || typeof raw !== 'object') return null;

    const entry = raw as { number?: unknown; description?: unknown };
    const number = typeof entry.number === 'string' ? entry.number.trim() : '';
    if (number === '') return null;

    const description = typeof entry.description === 'string'
        ? sanitizePhoneDescription(entry.description)
        : '';

    // The invariant: no description ⇒ a bare string, never `{number}`.
    return description === '' ? number : { number, description };
}

/**
 * Canonicalize a whole `phones` value. Non-array input yields `[]` rather than
 * throwing — this runs inside a Zod preprocess, where the schema is what
 * reports the shape error.
 */
export function normalizePhoneEntries(raw: unknown): BusinessPhone[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map(normalizePhoneEntry)
        .filter((e): e is BusinessPhone => e !== null);
}

/** The number of an entry in either form. */
export function phoneEntryNumber(entry: BusinessPhone): string {
    return typeof entry === 'string' ? entry : entry.number;
}

/** The description of an entry, or `''` when it has none. */
export function phoneEntryDescription(entry: BusinessPhone): string {
    return typeof entry === 'string' ? '' : (entry.description ?? '');
}

/** Below this, the content is not a number at all — it is prose or punctuation.
 *  3 because the shortest dialable numbers in existence are emergency/short
 *  codes (911, 112, 999); nothing shorter is a phone anywhere. */
const MIN_ENTRY_DIGITS = 3;
/** E.164's maximum. Above it, the content is not one phone number. */
const MAX_ENTRY_DIGITS = 15;

/**
 * Is this string usable as a phone number at all?
 *
 * ⚠️ This asks a DIFFERENT QUESTION from `extractPhones`, and conflating the two
 * is what made this guard lock a paying merchant out of Business Info entirely.
 *
 *   `extractPhones`      — "is a phone hidden somewhere in this PROSE?"
 *                          Used by lead capture on customer messages. Its
 *                          `FALLBACK_DIGIT_MIN = 9` floor is CORRECT there and
 *                          must not be lowered: it is what stops prices, dates
 *                          and sizes from reading as phone numbers.
 *   `isUsablePhoneEntry` — "is what the merchant typed in the phone FIELD a
 *                          phone?" The merchant already declared intent by using
 *                          the slot; there is no prose to disambiguate from, so
 *                          importing the 9-digit floor imports a constraint this
 *                          question never had.
 *
 * Measured 2026-08-13 over the whole fleet — all 44 entries on 40 pages, the
 * population and not a sample: 41 pass either way, 2 are correctly rejected
 * (instruction sentences with ZERO digits, a real editor-confirmed profile), and
 * exactly 1 was wrongly rejected — `0189955`, a real 7-digit Syrian landline on a
 * paying page. Because a no-op Save re-validates every stored entry, that one
 * false reject blocked EVERY Business Info save for that merchant, including
 * edits to unrelated fields.
 *
 * ⭐ The floor errs permissive on purpose, and the asymmetry is the reason: a
 * false ACCEPT is a data-quality nit the merchant can see in their own editor and
 * fix, and PR B's inline hint offers to move stray prose into the description. A
 * false REJECT is a LOCKOUT. Those costs are not comparable, so the guard is
 * narrow by design — it rejects only content with no number in it at all.
 *
 * Region-LESS by design, unchanged: the frontend runs this inline to disable
 * Save and cannot obtain the workspace timezone without gating the editor behind
 * a settings fetch, and a predicate that disagreed between the two sides would be
 * worse than a permissive one. Digits are region-free, so this now holds without
 * the `defaultCountry` caveat the previous implementation needed.
 */
export function isUsablePhoneEntry(value: string): boolean {
    // preNormalizeForPhones strips the bidi marks Facebook wraps RTL numbers in
    // and folds Arabic-Indic digits to ASCII, so «٠٩١١٠٠٠٢١٠» counts like
    // «0911000210». Shared with extractPhones rather than re-implemented.
    const digits = digitCount(preNormalizeForPhones(value));
    return digits >= MIN_ENTRY_DIGITS && digits <= MAX_ENTRY_DIGITS;
}

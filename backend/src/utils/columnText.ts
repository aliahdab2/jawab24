import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * The slice of a Drizzle column this module reads. `length` is declared by the
 * bounded string types (varchar/char) and absent on unbounded ones (text), so
 * an unbounded column simply skips the clamp.
 */
type BoundedColumn = { length?: number };

/**
 * Coerce a value that came from an external API into something a bounded string
 * column can physically store.
 *
 * The problem this solves: a platform's JSON is *unvalidated* no matter what our
 * TypeScript interface claims. When Zid's `/managers/account/profile` started
 * returning `currency` as an object (`{id,name,code,symbol,country}`) instead of
 * the documented string, the declared `currency?: string` silently passed the
 * object through to a `varchar(10)`, Postgres raised `22001`, and the entire
 * App Market install aborted — on a purely decorative field. See
 * `services/zid.ts#fetchStoreInfo`.
 *
 * Rules, in order:
 * - `undefined` stays `undefined` — "no opinion", so a caller spreading this
 *   into a Drizzle `.set()` leaves the stored value untouched.
 * - `null` stays `null` — an explicit clear, which Shopify's GraphQL scalars
 *   legitimately send. Preserved so this guard changes no existing semantics.
 * - Strings are trimmed; an empty result is `undefined`, not `''`.
 * - Finite numbers, bigints and booleans stringify (an id-shaped field arriving
 *   as a number is a shape drift we can represent faithfully).
 * - Anything else — objects, arrays, functions, symbols, NaN — yields
 *   `undefined`. Deliberately NOT `JSON.stringify`: a serialized envelope in a
 *   display column is unreadable to the merchant, useless to the AI, and would
 *   bury the drift under a value that looks stored-and-fine. Absence is the
 *   honest representation; callers log the drop.
 *
 * @returns a value guaranteed to fit `column`, or undefined/null per above.
 */
export function fitVarchar(value: unknown, column: AnyPgColumn): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const text = toPlainText(value);
    if (text === undefined) return undefined;

    // Only a real column OBJECT with a numeric width clamps. The guard matters
    // beyond paranoia: several suites partially mock the schema as plain strings
    // ('storeName'), and a string has a `.length` too — trusting it silently
    // clamped a value to the column NAME's length under test. An unbounded or
    // unrecognisable column means "no width to enforce", never a guessed one.
    const max = typeof column === 'object' && column !== null
        ? (column as unknown as BoundedColumn).length
        : undefined;
    if (typeof max !== 'number' || max <= 0) return text;
    return clampToChars(text, max);
}

/**
 * True when `value` carried content but `fitVarchar` refused it — i.e. the
 * payload had a shape we cannot represent. The signal callers log on; keeping it
 * here means the "what counts as dropped" rule lives beside the rule that drops.
 */
export function wasDropped(value: unknown, fitted: string | null | undefined): boolean {
    return value !== undefined && value !== null && fitted === undefined;
}

function toPlainText(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
    return undefined;
}

/**
 * Postgres `varchar(n)` bounds CHARACTERS (code points); JS string indexing
 * counts UTF-16 code units. Slicing by code point is what keeps an Arabic store
 * name or an emoji whole — a `.slice()` that lands mid-surrogate leaves a lone
 * surrogate, which is not valid UTF-8 and which Postgres rejects outright. That
 * would turn a truncation guard back into the very write failure it exists to
 * prevent.
 */
function clampToChars(text: string, max: number): string {
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join('');
}

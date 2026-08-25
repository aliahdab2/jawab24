/**
 * Business-hours canonicalizer (Stage 2.6).
 *
 * Merchants type hours in many shapes: "9am-6pm", "9-6", "٩-٦", "9:30 ص - 6 م",
 * "Closed", "مغلق", "24/7". This module normalizes all of them into a single
 * canonical string per day, which is what gets stored in `business_profile.hours`
 * and injected into the AI prompt:
 *
 *   "HH:MM-HH:MM"  // e.g. "09:00-18:00"
 *   "closed"
 *   "all day"
 *
 * Single-window per day in v1. Verified 2026-05-23: zero prod merchants use
 * split-window hours, so the multi-window path is deferred (Stage 2.6.1).
 */

export type CanonicalHoursEntry = string;

export interface ParseSuccess { ok: true; value: CanonicalHoursEntry }
export interface ParseFailure { ok: false; error: string }
export type ParseResult = ParseSuccess | ParseFailure;

// ─── Arabic-Indic digit normalization ─────────────────────────────────────
// Many merchants type "٩:٠٠-١٨:٠٠" — we treat it as identical to "9:00-18:00".

const ARABIC_INDIC_DIGITS: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function normalizeDigits(input: string): string {
    return input.replace(/[٠-٩]/g, (ch) => ARABIC_INDIC_DIGITS[ch] ?? ch);
}

// ─── Lexical recognition ──────────────────────────────────────────────────

const CLOSED_PATTERNS: RegExp[] = [
    /^\s*closed\s*$/i,
    /^\s*off\s*$/i,
    /^\s*مغلق\s*$/,
    /^\s*مقفل\s*$/,
    /^\s*\s*-\s*$/,        // bare hyphen, common in spreadsheet pastes
];

const ALL_DAY_PATTERNS: RegExp[] = [
    /^\s*all\s*day\s*$/i,
    /^\s*24\s*\/\s*7\s*$/,
    /^\s*24\s*h(ours?)?\s*$/i,
    /^\s*طوال\s+اليوم\s*$/,
    /^\s*24\s*ساعة\s*$/,
    /^\s*مفتوح\s*دائماً\s*$/,
];

// Range separators: ASCII hyphen, en-dash, em-dash, " to ", " إلى ", " حتى "
const RANGE_SEPARATOR = /\s*(?:[-–—]|to|إلى|حتى)\s*/i;

// ─── Day keys ──────────────────────────────────────────────────────────────
// The canonical day-key sets accepted in `business_profile.hours`. Facebook
// sync emits the short form (mon…sun); the KB extractor also targets short.
// Long names are accepted for forward-compat with hand-authored / imported
// data. Both are rendered by `formatBusinessInfoPrompt` (businessInfoPrompt.ts).
//
// ORDER IS MEANINGFUL: Saturday-first. Our markets start the week on Saturday
// (CLDR week data — ar-SY/ar-EG/ar-LY firstDay = Saturday, weekend = Fri+Sat),
// so every rendered week (prompt blocks, KB chunks, the hours editor) must
// enumerate sat→fri. Monday-first is ISO-8601 interchange order and
// Sunday-first is US display order — neither belongs in anything a merchant
// or customer reads, and a Sunday-first week in the prompt is exactly what
// produced the «من الأحد للسبت» reply on the Damascus institute page.

export const SHORT_DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
export const LONG_DAY_KEYS = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
const ALLOWED_DAY_KEYS = new Set<string>([...SHORT_DAY_KEYS, ...LONG_DAY_KEYS]);

/**
 * Position of a day key (short or long, any case) in the Saturday-first week.
 * Unknown keys sort last (returns SHORT_DAY_KEYS.length) so callers can order
 * mixed/dirty key sets without dropping data.
 */
export function dayOrderIndex(day: string): number {
    const k = day.trim().toLowerCase();
    const short = SHORT_DAY_KEYS.indexOf(k as typeof SHORT_DAY_KEYS[number]);
    if (short !== -1) return short;
    const long = LONG_DAY_KEYS.indexOf(k as typeof LONG_DAY_KEYS[number]);
    if (long !== -1) return long;
    return SHORT_DAY_KEYS.length;
}

/** True if `day` is a recognized day key (short mon…sun or long monday…sunday, case-insensitive). */
export function isValidDayKey(day: string): boolean {
    return ALLOWED_DAY_KEYS.has(day.trim().toLowerCase());
}

// ─── Day labels ────────────────────────────────────────────────────────────
// Rendered day names, keyed by BOTH short and long day keys (lowercase),
// aligned with the Saturday-first order above. The single source for every
// surface that prints a weekday (prompt block, KB chunks, FB-import text) —
// do not hand-write day-name maps elsewhere.

const EN_NAMES = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const AR_NAMES = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;

function buildLabelMap(names: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    SHORT_DAY_KEYS.forEach((k, i) => { out[k] = names[i]; });
    LONG_DAY_KEYS.forEach((k, i) => { out[k] = names[i]; });
    return out;
}

export const DAY_LABELS_EN: Record<string, string> = buildLabelMap(EN_NAMES);
export const DAY_LABELS_AR: Record<string, string> = buildLabelMap(AR_NAMES);

/**
 * Reverse of the label maps above: a rendered day name (Arabic or English,
 * any case, e.g. Salla's working-hours `name: "السبت"`) OR an existing day
 * key → the canonical short key. Built from the SAME name arrays so a label
 * change cannot drift. `الاثنين` (bare alif) is accepted alongside the
 * canonical `الإثنين` — both spellings are standard.
 */
const LABEL_TO_SHORT_KEY: Record<string, typeof SHORT_DAY_KEYS[number]> = (() => {
    const out: Record<string, typeof SHORT_DAY_KEYS[number]> = {};
    SHORT_DAY_KEYS.forEach((k, i) => {
        out[k] = k;
        out[LONG_DAY_KEYS[i]] = k;
        out[EN_NAMES[i].toLowerCase()] = k;
        out[AR_NAMES[i]] = k;
        // Hamza-tolerant Arabic variant (إ → ا) — covers «الاثنين» etc.
        out[AR_NAMES[i].replace(/[أإآ]/g, 'ا')] = k;
    });
    return out;
})();

export function dayKeyFromLabel(label: string): typeof SHORT_DAY_KEYS[number] | undefined {
    return LABEL_TO_SHORT_KEY[label.trim().toLowerCase().replace(/[أإآ]/g, 'ا')];
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Convert merchant-typed input into a canonical hours entry, or report why
 * it can't be parsed. Pure function — safe to call from frontend or backend.
 *
 * Examples:
 *   "9am-6pm"     → { ok: true,  value: "09:00-18:00" }
 *   "٩:٣٠-١٨:٠٠" → { ok: true,  value: "09:30-18:00" }
 *   "9-6"         → { ok: true,  value: "09:00-18:00" }  (heuristic: end<start ⇒ end is PM)
 *   "9-22"        → { ok: true,  value: "09:00-22:00" }  (24h interpretation)
 *   "Closed"      → { ok: true,  value: "closed" }
 *   "24/7"        → { ok: true,  value: "all day" }
 *   "25:00-30:00" → { ok: false, error: "..." }
 *   ""            → { ok: false, error: "empty" }
 */
export function canonicalizeHoursEntry(input: unknown): ParseResult {
    if (typeof input !== 'string') return { ok: false, error: 'not_a_string' };

    const normalized = normalizeDigits(input).trim();
    if (!normalized) return { ok: false, error: 'empty' };

    for (const pat of CLOSED_PATTERNS) {
        if (pat.test(normalized)) return { ok: true, value: 'closed' };
    }
    for (const pat of ALL_DAY_PATTERNS) {
        if (pat.test(normalized)) return { ok: true, value: 'all day' };
    }

    // Strict canonical form passes through (idempotency).
    const strict = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(normalized);
    if (strict) {
        const [, h1, m1, h2, m2] = strict;
        if (validTime(h1, m1) && validTime(h2, m2)) {
            return { ok: true, value: `${h1}:${m1}-${h2}:${m2}` };
        }
        return { ok: false, error: `out_of_range: ${normalized}` };
    }

    // Loose forms: "9am-6pm" / "9-6" / "9:30 to 18:00" / "٩ ص - ٦ م"
    const parts = normalized.split(RANGE_SEPARATOR).map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) return { ok: false, error: `expected_start_end_format: "${input}"` };

    const startParsed = parseTimeToken(parts[0]);
    const endParsed = parseTimeToken(parts[1]);
    if (!startParsed || !endParsed) {
        return { ok: false, error: `couldnt_parse_time: "${input}"` };
    }

    // Disambiguation heuristic for bare 12-hour ranges (no AM/PM markers).
    // If both endpoints fit in 1..12 and the parsed end ≤ start, we assume the
    // merchant meant "AM to PM" (e.g. "9-6" ⇒ 9:00 to 18:00). Anything else
    // (mixed AM/PM, end > start, or hour > 12) is taken at face value.
    const startHour = startParsed.hour;
    let endHour = endParsed.hour;
    if (!startParsed.hadMeridiem && !endParsed.hadMeridiem &&
        startHour >= 1 && startHour <= 12 &&
        endHour >= 1 && endHour <= 12 &&
        endHour <= startHour
    ) {
        if (endHour !== 12) endHour += 12;
    }
    if (startHour > 23 || endHour > 23) {
        return { ok: false, error: `out_of_range: "${input}"` };
    }

    const start = `${pad(startHour)}:${pad(startParsed.minute)}`;
    const end = `${pad(endHour)}:${pad(endParsed.minute)}`;
    return { ok: true, value: `${start}-${end}` };
}

/**
 * Canonicalize a full week (Record<day, raw>). Stops at the first invalid
 * entry and returns the error — caller decides whether to bubble it up to
 * the form or accept partial. Use this on PATCH /pages/:id business_profile.
 *
 * Returns the same array shape as `BusinessProfile.hours` for backwards
 * compatibility with the existing chunker + formatter (v1 emits length-1
 * arrays; multi-window is Stage 2.6.1 if needed).
 */
export function canonicalizeHoursWeek(
    input: Record<string, string | string[] | undefined>,
): { ok: true; value: Record<string, string[]> } | { ok: false; day: string; error: string } {
    const out: Record<string, string[]> = {};
    for (const [day, raw] of Object.entries(input)) {
        if (raw === undefined || raw === null) continue;
        if (!isValidDayKey(day)) return { ok: false, day, error: 'invalid_day_key' };
        // Already-array shape (e.g. legacy FB sync data) — canonicalize each.
        const tokens = Array.isArray(raw) ? raw : [raw];
        const canonicalEntries: string[] = [];
        for (const token of tokens) {
            if (!token || !token.trim()) continue;
            const result = canonicalizeHoursEntry(token);
            if (!result.ok) return { ok: false, day, error: result.error };
            canonicalEntries.push(result.value);
        }
        // Normalize the key to lowercase: isValidDayKey accepts any case, but
        // formatBusinessInfoPrompt looks up fixed lowercase keys — a capitalized
        // key ("Mon"/"MONDAY") would otherwise pass here yet render blank there.
        if (canonicalEntries.length > 0) out[day.trim().toLowerCase()] = canonicalEntries;
    }
    return { ok: true, value: out };
}

// ─── Internals ───────────────────────────────────────────────────────────

interface ParsedTime { hour: number; minute: number; hadMeridiem: boolean }

function parseTimeToken(s: string): ParsedTime | null {
    // Strip an optional meridiem suffix (ASCII or Arabic).
    // "9am" / "9 am" / "6 pm" / "9 ص" / "6 م" / "9:30am"
    const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م)?$/i.exec(s.trim());
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    const meridiemRaw = m[3];
    const meridiem = meridiemRaw?.toLowerCase();
    if (minute > 59) return null;

    if (meridiem === 'pm' || meridiem === 'م') {
        if (hour < 12) hour += 12;
    } else if (meridiem === 'am' || meridiem === 'ص') {
        if (hour === 12) hour = 0;
    }
    if (hour > 23) return null;

    return { hour, minute, hadMeridiem: !!meridiem };
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function validTime(h: string, m: string): boolean {
    const hh = parseInt(h, 10);
    const mm = parseInt(m, 10);
    return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

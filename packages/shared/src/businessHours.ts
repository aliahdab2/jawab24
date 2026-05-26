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
        // Already-array shape (e.g. legacy FB sync data) — canonicalize each.
        const tokens = Array.isArray(raw) ? raw : [raw];
        const canonicalEntries: string[] = [];
        for (const token of tokens) {
            if (!token || !token.trim()) continue;
            const result = canonicalizeHoursEntry(token);
            if (!result.ok) return { ok: false, day, error: result.error };
            canonicalEntries.push(result.value);
        }
        if (canonicalEntries.length > 0) out[day] = canonicalEntries;
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

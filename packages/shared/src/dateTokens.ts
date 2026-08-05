/**
 * Date tokens in free prose — extraction and past/future classification.
 *
 * WHY THIS IS SHARED, AND WHY IT IS THE ONLY COPY
 * -----------------------------------------------
 * Two consumers must agree, byte for byte, on "is there a date in this reply and
 * is it in the past":
 *   1. the reply-path guard (ai-worker `replyValidator`) — decides whether a reply
 *      quotes a date the merchant's records do not support;
 *   2. the measurement battery (`scripts/schedule-fabrication-probe.ts`) — judges the
 *      stale-date class deterministically, because the grounding verifier is blind to
 *      a date that IS in the source but has already passed.
 * A judge with its own private notion of "date" measures a different thing than the
 * guard enforces. This module was LIFTED from the battery's proven scanner rather than
 * rewritten, and the battery now imports it (the standing rule: tests import production
 * predicates, never copy them).
 *
 * WHAT COUNTS AS A DATE
 * ---------------------
 *   • `D/M` and `D/M/YY(YY)` — DAY-FIRST, the order Levantine merchants write.
 *   • ISO `YYYY-MM-DD` — what our own fact rows store.
 *   • `D <month-name>` with optional year — what the model actually writes to
 *     customers («3 أغسطس 2026», «26 تموز»).
 * A bare year, a time range («12-2», «3-4:30») and a phone number all carry no slash
 * and no month name, so none of them match. That is deliberate: the cheapest way to
 * keep this guard's false-positive surface near zero is to require a date-shaped
 * separator or a calendar word, never a lone number.
 *
 * MONTH NAMES COME FROM `Intl`, NEVER A HAND LIST
 * -----------------------------------------------
 * Arabic has two live Gregorian month systems and merchants use both: Levantine
 * (كانون الثاني … آب … كانون الأول, from `ar-SY`) and transliterated (يناير … أغسطس …
 * ديسمبر, from `ar-EG`). Enumerating them by hand is the hand-maintained-linguistic-list
 * anti-pattern this codebase forbids, and it also silently misses spelling variants.
 * Instead both the calendar names and the input text are folded through
 * `normalizeArabic`, which maps أ/إ/آ → ا and strips diacritics/tatweel — so «أبريل» and
 * «ابريل», «آب» and «اب», «تشرين الأول» and «تشرين الاول» all collapse to one key with no
 * list to maintain. English names come from `en` for replies written in English.
 */
import { normalizeArabic } from './utils/arabic-normalize';

/** Locales whose month vocabulary our merchants and their customers actually write in.
 *  `ar-SY` yields the Levantine system, `ar-EG` the transliterated one — they are
 *  disjoint, so both are needed; `ar` alone returns only the transliterated set. */
const MONTH_LOCALES = ['ar-SY', 'ar-EG', 'en'] as const;

/** Fold a calendar word or a stretch of prose to one comparable form. Digits are
 *  normalized here too (`normalizeArabic` does it by default), so an Arabic-Indic
 *  «٢٦/٧» is already ASCII by the time the numeric patterns run. */
function fold(text: string): string {
    return normalizeArabic(text);
}

/** normalized month name → 1-12, built once from the calendar rather than typed out. */
const MONTH_INDEX: Map<string, number> = (() => {
    const index = new Map<string, number>();
    for (const locale of MONTH_LOCALES) {
        const fmt = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
        for (let month = 1; month <= 12; month++) {
            // Day 15 avoids any month-length or timezone edge entirely.
            const name = fmt.format(new Date(Date.UTC(2026, month - 1, 15)));
            const key = fold(name).toLowerCase();
            if (key) index.set(key, month);
        }
    }
    return index;
})();

/** Longest-first so «تشرين الاول» wins over a shorter name it contains. */
const MONTH_NAME_PATTERN = [...MONTH_INDEX.keys()]
    .sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

const DAY_MONTH_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DAY_MONTH_NAME_RE = new RegExp(`(\\d{1,2})\\s+(${MONTH_NAME_PATTERN})(?:\\s+(\\d{4}))?`, 'gi');

/** One date found in prose. */
export interface DateToken {
    /** The matched text, as it appeared in the folded input — diagnostic only. */
    raw: string;
    /** Calendar date as `YYYY-MM-DD`, so callers compare strings, not Date objects. */
    iso: string;
}

/** Resolve a 2- or 4-digit year, or fall back to the year of `todayIso` when the
 *  merchant/model omitted it («تبدأ 26/7») — the common case in real replies. */
function resolveYear(raw: string | undefined, todayIso: string): number {
    if (!raw) return Number(todayIso.slice(0, 4));
    return raw.length === 2 ? 2000 + Number(raw) : Number(raw);
}

function toIso(year: number, month: number, day: number): string | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const stamp = new Date(Date.UTC(year, month - 1, day));
    // Rejects impossible days (31 February rolls over to March).
    if (stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null;
    return stamp.toISOString().slice(0, 10);
}

/**
 * Every date-shaped token in `text`, de-duplicated by calendar date.
 * `todayIso` supplies the implied year for year-less dates — pass the merchant's
 * local today (the reply prompt's own "Today's date" line), never the server's.
 */
export function extractDateTokens(text: string, todayIso: string): DateToken[] {
    if (!text) return [];
    const folded = fold(text);
    const seen = new Set<string>();
    const out: DateToken[] = [];

    const push = (raw: string, iso: string | null): void => {
        if (!iso || seen.has(iso)) return;
        seen.add(iso);
        out.push({ raw, iso });
    };

    for (const m of folded.matchAll(DAY_MONTH_RE)) {
        push(m[0], toIso(resolveYear(m[3], todayIso), Number(m[2]), Number(m[1])));
    }
    for (const m of folded.matchAll(ISO_RE)) {
        push(m[0], toIso(Number(m[1]), Number(m[2]), Number(m[3])));
    }
    for (const m of folded.matchAll(DAY_MONTH_NAME_RE)) {
        const month = MONTH_INDEX.get(m[2].toLowerCase());
        if (month) push(m[0], toIso(resolveYear(m[3], todayIso), month, Number(m[1])));
    }
    return out;
}

/**
 * Split the dates in `text` into already-passed and still-to-come, relative to
 * `todayIso`. `todayIso` itself counts as upcoming — a course starting today is not
 * a stale quote.
 */
export function classifyDateTokens(
    text: string,
    todayIso: string,
): { stale: DateToken[]; upcoming: DateToken[] } {
    const stale: DateToken[] = [];
    const upcoming: DateToken[] = [];
    for (const token of extractDateTokens(text, todayIso)) {
        (token.iso < todayIso ? stale : upcoming).push(token);
    }
    return { stale, upcoming };
}

import { normalizeArabic } from '@jawab24/shared';
import type { FactStructuredFieldValue } from '@jawab24/shared';
import type { FactCollectionWithRows } from '@/lib/api';
import { sessionValueKind } from './factListLayout';
import { SUPPORTED_LOCALES } from './locale';

/**
 * Structured-entry support for schedule-like fact fields (round 7 — the
 * write-back contract). Everything here is derived from platform locale data
 * (Intl) or from the merchant's own rows — never from hand-maintained word
 * lists (the standing rule). The generated STRING is what gets stored and
 * quoted; the structured value only rides shadow.
 */

const norm = (text: string): string =>
  normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase().trim();

export interface WeekdayInfo {
  /** JS `Date#getDay()` numbering: 0 = Sunday … 6 = Saturday. */
  index: number;
  long: string;
  narrow: string;
}

const weekdayInfoCache = new Map<string, WeekdayInfo[]>();

/** The 7 weekdays for a locale, Sunday-first, names from Intl. */
export function weekdayInfo(locale: string): WeekdayInfo[] {
  const cached = weekdayInfoCache.get(locale);
  if (cached) return cached;
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const info = Array.from({ length: 7 }, (_, d) => {
    // 2024-01-07 was a Sunday; +d walks one full week.
    const date = new Date(Date.UTC(2024, 0, 7 + d));
    return { index: d, long: long.format(date), narrow: narrow.format(date) };
  });
  weekdayInfoCache.set(locale, info);
  return info;
}

/** normalized day name (long + short, every supported locale) → day index. */
const dayNameIndex: Map<string, number> = (() => {
  const map = new Map<string, number>();
  for (const locale of SUPPORTED_LOCALES) {
    for (const width of ['long', 'short'] as const) {
      const fmt = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' });
      for (let d = 0; d < 7; d++) {
        map.set(norm(fmt.format(new Date(Date.UTC(2024, 0, 7 + d)))), d);
      }
    }
  }
  return map;
})();

/** Connective tokens («و», "and") learned from Intl.ListFormat literals —
 *  the platform's own joiner, not a vocabulary list. */
const connectiveTokens: Set<string> = (() => {
  const tokens = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const parts = new Intl.ListFormat(locale, { type: 'conjunction' })
      .formatToParts(['a', 'b', 'c']);
    for (const p of parts) {
      if (p.type !== 'literal') continue;
      for (const tok of p.value.split(/[^\p{L}]+/u)) if (tok) tokens.add(norm(tok));
    }
  }
  return tokens;
})();

export type ScheduleFieldKind = 'weekday' | 'time' | 'other';

/**
 * What a session field IS, decided from the merchant's own data: an existing
 * structured shadow under this label is authoritative; otherwise the majority
 * shape of the field's non-empty values across the collection's rows. A field
 * only earns a control when at least half its values agree.
 */
export function classifyCollectionField(
  collection: FactCollectionWithRows,
  label: string,
): ScheduleFieldKind {
  let weekday = 0;
  let time = 0;
  let nonEmpty = 0;
  for (const row of collection.rows) {
    const shadow = row.structured?.[label];
    if (shadow) return shadow.kind === 'weekdays' ? 'weekday' : 'time';
    const value = row.attributes?.find((a) => a.label === label)?.value?.trim();
    if (!value) continue;
    nonEmpty += 1;
    const kind = sessionValueKind(value);
    if (kind === 'weekday') weekday += 1;
    else if (kind === 'time') time += 1;
  }
  if (nonEmpty === 0) return 'other';
  if (weekday >= time && weekday * 2 >= nonEmpty && weekday > 0) return 'weekday';
  if (time > weekday && time * 2 >= nonEmpty) return 'time';
  return 'other';
}

/**
 * COMPLETE parse of a weekday string into day indices — every token must be a
 * platform-known day name (Arabic proclitics fused: «والثلاثاء») or a
 * platform-known connective. Anything else («الأحد فقط») returns null: seeding
 * chips from a partial parse and regenerating would silently drop the
 * merchant's words, so we refuse and fall back to free text.
 */
export function parseWeekdays(value: string): number[] | null {
  const tokens = norm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return null;
  const days = new Set<number>();
  for (const token of tokens) {
    if (connectiveTokens.has(token)) continue;
    let resolved = dayNameIndex.get(token);
    if (resolved === undefined) {
      for (const [name, idx] of dayNameIndex) {
        if (name.length >= 4 && token.endsWith(name)) { resolved = idx; break; }
      }
    }
    if (resolved === undefined) return null;
    days.add(resolved);
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}

const ARABIC_SCRIPT_RE = /[؀-ۿ]/;

/**
 * The locale the STORED string must be generated in — decided by the DATA's
 * script, never by the viewer's UI language: an English-UI admin editing an
 * Arabic page must regenerate «الأحد والثلاثاء», not "Sunday and Tuesday".
 * Falls back to the UI locale only when the field has no values anywhere.
 */
export function generationLocale(
  collection: FactCollectionWithRows,
  label: string,
  fallback: string,
): string {
  let sawValue = false;
  for (const row of collection.rows) {
    const value = row.attributes?.find((a) => a.label === label)?.value;
    if (!value?.trim()) continue;
    if (ARABIC_SCRIPT_RE.test(value)) return 'ar';
    sawValue = true;
  }
  return sawValue ? 'en' : fallback;
}

/** «الأحد والثلاثاء» — long day names joined by the locale's own conjunction.
 *  This is the STORED string, so it must read exactly like what merchants
 *  already write. */
export function formatWeekdays(days: number[], locale: string): string {
  const info = weekdayInfo(locale);
  const names = [...days].sort((a, b) => a - b).map((d) => info[d]?.long).filter(Boolean) as string[];
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
}

const parseHM = (hm: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Merchant-style compact 12-hour storage form: "13:00"→"1", "13:30"→"1:30".
 *  Matches how the pilot's rows are already written («12-1»). */
export function formatTimeStorage(hm: string): string | null {
  const mins = parseHM(hm);
  if (mins === null) return null;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 || 12;
  return m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, '0')}`;
}

/** The stored string for a time range: «12-1», «12:30-2». */
export function formatTimeRangeStorage(start: string, end: string): string | null {
  const s = formatTimeStorage(start);
  const e = formatTimeStorage(end);
  return s && e ? `${s}-${e}` : null;
}

/** Display form with the ambiguity resolved: «12:00–1:00 ظهرًا» — the start
 *  drops its day period, the end carries Intl's flexible one. Display only;
 *  storage stays the compact merchant form. */
export function formatTimeRangeDisplay(start: string, end: string, intlLocale: string): string | null {
  const s = parseHM(start);
  const e = parseHM(end);
  if (s === null || e === null) return null;
  const fmt = new Intl.DateTimeFormat(intlLocale, {
    hour: 'numeric', minute: '2-digit', dayPeriod: 'long', timeZone: 'UTC',
  });
  const at = (mins: number) => new Date(Date.UTC(2024, 0, 7, Math.floor(mins / 60), mins % 60));
  const bare = fmt.formatToParts(at(s))
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value).join('').trim().replace(/[،,]$/, '').trim();
  return `${bare}–${fmt.format(at(e))}`;
}

/** Session length in minutes; null when the range is empty or inverted —
 *  the live-duration hint simply doesn't render then. */
export function durationMinutes(start: string, end: string): number | null {
  const s = parseHM(start);
  const e = parseHM(end);
  if (s === null || e === null || e <= s) return null;
  return e - s;
}

/** Display for a structured shadow, used by summaries: weekdays render their
 *  stored string form; time ranges render the disambiguated display form. */
export function structuredDisplay(value: FactStructuredFieldValue, intlLocale: string): string | null {
  if (value.kind === 'timeRange') return formatTimeRangeDisplay(value.start, value.end, intlLocale);
  return formatWeekdays(value.days, intlLocale);
}

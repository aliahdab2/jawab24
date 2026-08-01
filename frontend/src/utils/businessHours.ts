import { canonicalizeHoursEntry, SHORT_DAY_KEYS, LONG_DAY_KEYS } from '@jawab24/shared';

/**
 * Week model for the working-hours editor.
 *
 * `business_profile.hours` is stored as `Record<day, string[]>` — an ARRAY of
 * canonical entries per day. That shape already carries everything a real
 * merchant needs and the rest of the stack already honours it:
 *   - `parseBusinessHours` (backend/src/services/pages.ts) imports Facebook's
 *     `mon_1_open` / `mon_2_open` slots as multiple ranges per day,
 *   - `formatHours` (packages/shared/src/businessInfoPrompt.ts) renders each
 *     day on its own line and joins split shifts with " / ".
 *
 * These helpers are the UI's half of that contract: read the stored week
 * WITHOUT flattening it, and write it back in the same canonical vocabulary
 * ("HH:MM-HH:MM" / "closed" / "all day").
 */

// Saturday-first — the single source of truth for week order lives in
// @jawab24/shared (CLDR ar-SY/ar-EG week data; see businessHours.ts there).
export const DAY_KEYS = SHORT_DAY_KEYS;
export type DayKey = typeof DAY_KEYS[number];

/** Default working week for the region: Friday off. */
export const DEFAULT_OPEN_DAYS: readonly DayKey[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'];

export const DEFAULT_RANGE: TimeRange = { from: '09:00', to: '17:00' };

/** Long day keys are an accepted storage form. Derived from the aligned
 *  shared arrays so the mapping can never drift. */
const LONG_BY_SHORT = Object.fromEntries(
  SHORT_DAY_KEYS.map((k, i) => [k, LONG_DAY_KEYS[i]]),
) as Record<DayKey, string>;

export interface TimeRange { from: string; to: string }

/** One day's schedule. `allDay` is preserved on read but not creatable here —
 *  it reaches us from Facebook / KB extraction and must survive a round-trip. */
export type DayState =
  | { kind: 'closed' }
  | { kind: 'allDay' }
  | { kind: 'ranges'; ranges: TimeRange[] };

export type WeekState = Record<DayKey, DayState>;

const RANGE_RE = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;

/** Read a day's entries under either the short or the long key form. */
function readDayEntries(
  hours: Record<string, string[]> | undefined,
  day: DayKey,
): string[] | undefined {
  const raw = hours?.[day] ?? hours?.[LONG_BY_SHORT[day]];
  return Array.isArray(raw) ? raw : undefined;
}

function parseDay(entries: string[] | undefined): DayState {
  if (!entries || entries.length === 0) return { kind: 'closed' };

  const ranges: TimeRange[] = [];
  for (const entry of entries) {
    const trimmed = (entry ?? '').trim();
    if (!trimmed || trimmed === 'closed') continue;
    if (trimmed === 'all day') return { kind: 'allDay' };
    const m = RANGE_RE.exec(trimmed);
    if (m) ranges.push({ from: m[1], to: m[2] });
  }
  return ranges.length ? { kind: 'ranges', ranges } : { kind: 'closed' };
}

/**
 * Stored hours → editor state. Never collapses a per-day or split-shift week
 * into a single schedule; an absent/empty week falls back to the regional
 * default so a first-time merchant starts somewhere sensible.
 */
export function parseWeek(hours: Record<string, string[]> | undefined): WeekState {
  const hasAny = DAY_KEYS.some((d) => (readDayEntries(hours, d)?.length ?? 0) > 0);
  const week = {} as WeekState;
  for (const day of DAY_KEYS) {
    week[day] = hasAny
      ? parseDay(readDayEntries(hours, day))
      : DEFAULT_OPEN_DAYS.includes(day)
        ? { kind: 'ranges', ranges: [{ ...DEFAULT_RANGE }] }
        : { kind: 'closed' };
  }
  return week;
}

/**
 * Editor state → stored hours, in the canonical vocabulary. Returns null when
 * a range can't be canonicalized, so the caller can block the save rather than
 * persist something the AI will read back wrong.
 */
export function serializeWeek(week: WeekState): Record<string, string[]> | null {
  const out: Record<string, string[]> = {};
  for (const day of DAY_KEYS) {
    const state = week[day];
    if (state.kind === 'closed') { out[day] = ['closed']; continue; }
    if (state.kind === 'allDay') { out[day] = ['all day']; continue; }

    const entries: string[] = [];
    // Store periods in clock order: a merchant may add the evening shift first,
    // and "17:00-22:00 / 09:00-14:00" reads wrong wherever it is rendered.
    const ordered = [...state.ranges].sort((a, b) => toMinutes(a.from) - toMinutes(b.from));
    for (const range of ordered) {
      // Reuse the shared canonicalizer — never re-implement time parsing.
      const parsed = canonicalizeHoursEntry(`${range.from}-${range.to}`);
      if (!parsed.ok) return null;
      entries.push(parsed.value);
    }
    if (entries.length === 0) return null;
    out[day] = entries;
  }
  return out;
}

/** True when at least one day is open — an all-closed week is not a schedule. */
export function hasOpenDay(week: WeekState): boolean {
  return DAY_KEYS.some((d) => week[d].kind !== 'closed');
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const toClock = (min: number): string => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/** Periods as minute intervals, sorted by start. A period whose end is at or
 *  before its start runs past midnight (20:00-02:00 is a real late-night
 *  schedule), so it is extended into the next day rather than rejected. */
function toIntervals(ranges: TimeRange[]): { start: number; end: number }[] {
  return ranges
    .map((r) => {
      const start = toMinutes(r.from);
      let end = toMinutes(r.to);
      if (end <= start) end += 1440;
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * True when a day's periods collide. Two periods that overlap aren't a
 * schedule — they'd reach the AI as "09:00-17:00 / 11:00-18:00" and it would
 * quote a customer something incoherent, so the editor must refuse to save it.
 */
export function dayHasOverlap(state: DayState): boolean {
  if (state.kind !== 'ranges' || state.ranges.length < 2) return false;
  const iv = toIntervals(state.ranges);
  for (let i = 1; i < iv.length; i++) {
    if (iv[i].start < iv[i - 1].end) return true;
  }
  // A late-night tail must not wrap back into the first period of the day.
  return iv[iv.length - 1].end - 1440 > iv[0].start;
}

/** Days whose periods collide — the sheet blocks saving while any exist. */
export function overlappingDays(week: WeekState): DayKey[] {
  return DAY_KEYS.filter((d) => dayHasOverlap(week[d]));
}

/**
 * Where a newly added period should start. Defaulting it to the SAME hours as
 * the existing one guaranteed an overlap on every tap of "add another period" —
 * the invalid state was the default. An hour after the previous period ends is
 * the shape merchants actually mean (09:00-14:00, then 15:00-18:00).
 */
export function nextPeriodDefault(ranges: TimeRange[]): TimeRange {
  if (ranges.length === 0) return { ...DEFAULT_RANGE };
  const iv = toIntervals(ranges);
  const lastEnd = iv[iv.length - 1].end;
  const start = Math.min(lastEnd + 60, 22 * 60);
  const end = Math.min(start + 180, 23 * 60 + 59);
  return { from: toClock(start), to: toClock(end) };
}

export interface DayLabels {
  closed: string;
  allDay: string;
}

export interface SummaryLabels extends DayLabels {
  /** Localized short day name, e.g. "السبت" / "Sat". */
  day: (key: DayKey) => string;
}

/** Render one day's schedule, e.g. "09:00-14:00 / 17:00-22:00". */
export function describeDay(state: DayState, labels: DayLabels): string {
  if (state.kind === 'closed') return labels.closed;
  if (state.kind === 'allDay') return labels.allDay;
  return state.ranges.map((r) => `${r.from}-${r.to}`).join(' / ');
}

/**
 * One-line summary for the facts row, e.g.
 *   "السبت–الخميس ٠٩:٠٠-١٧:٠٠ · الجمعة مغلق"
 *
 * Consecutive days that share a schedule are grouped, the way merchants are
 * used to reading opening hours — otherwise a seven-line week is unreadable in
 * a 56px row, which is why the row used to just say "Saved".
 */
export function summarizeWeek(week: WeekState, labels: SummaryLabels): string {
  const groups: { days: DayKey[]; text: string }[] = [];
  for (const day of DAY_KEYS) {
    const text = describeDay(week[day], labels);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.days.push(day);
    else groups.push({ days: [day], text });
  }

  return groups
    .map(({ days, text }) => {
      const span = days.length === 1
        ? labels.day(days[0])
        : `${labels.day(days[0])}–${labels.day(days[days.length - 1])}`;
      return `${span} ${text}`;
    })
    .join(' · ');
}

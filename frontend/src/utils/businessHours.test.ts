import { describe, it, expect } from 'vitest';
import {
  parseWeek,
  serializeWeek,
  summarizeWeek,
  hasOpenDay,
  dayHasOverlap,
  overlappingDays,
  nextPeriodDefault,
  DAY_KEYS,
  type DayKey,
  type WeekState,
} from './businessHours';

const labels = {
  closed: 'Closed',
  allDay: '24h',
  day: (k: DayKey) => k,
};

/** A week where Friday genuinely differs — the case the old editor flattened. */
const PER_DAY_WEEK: Record<string, string[]> = {
  sat: ['09:00-17:00'],
  sun: ['09:00-17:00'],
  mon: ['09:00-17:00'],
  tue: ['09:00-17:00'],
  wed: ['09:00-17:00'],
  thu: ['09:00-17:00'],
  fri: ['14:00-20:00'],
};

describe('parseWeek / serializeWeek round-trip', () => {
  it('preserves different hours per day', () => {
    const round = serializeWeek(parseWeek(PER_DAY_WEEK));
    expect(round).toEqual(PER_DAY_WEEK);
  });

  it('preserves a split shift (multiple periods in one day)', () => {
    const split = { ...PER_DAY_WEEK, sat: ['09:00-14:00', '17:00-22:00'] };
    const round = serializeWeek(parseWeek(split));
    expect(round?.sat).toEqual(['09:00-14:00', '17:00-22:00']);
  });

  it('preserves "all day" rather than rewriting it as office hours', () => {
    const round = serializeWeek(parseWeek({ ...PER_DAY_WEEK, sun: ['all day'] }));
    expect(round?.sun).toEqual(['all day']);
  });

  it('preserves closed days', () => {
    const round = serializeWeek(parseWeek({ ...PER_DAY_WEEK, fri: ['closed'] }));
    expect(round?.fri).toEqual(['closed']);
  });

  it('reads LONG day keys — "saturday", not "satday"', () => {
    const long = {
      saturday: ['08:00-12:00'],
      tuesday: ['10:00-13:00'],
      wednesday: ['10:00-13:00'],
      thursday: ['10:00-13:00'],
    };
    const week = parseWeek(long);
    expect(week.sat).toEqual({ kind: 'ranges', ranges: [{ from: '08:00', to: '12:00' }] });
    expect(week.tue).toEqual({ kind: 'ranges', ranges: [{ from: '10:00', to: '13:00' }] });
    // Days absent from the stored record read as closed, not as a default.
    expect(week.sun).toEqual({ kind: 'closed' });
  });

  it('falls back to the regional default week when nothing is stored', () => {
    const week = parseWeek(undefined);
    expect(week.fri).toEqual({ kind: 'closed' });
    expect(week.sat).toEqual({ kind: 'ranges', ranges: [{ from: '09:00', to: '17:00' }] });
  });

  it('writes every day explicitly so the AI never sees a gap', () => {
    const round = serializeWeek(parseWeek({ sat: ['09:00-17:00'] }));
    expect(Object.keys(round ?? {}).sort()).toEqual([...DAY_KEYS].sort());
  });
});

describe('hasOpenDay', () => {
  it('is false for an all-closed week', () => {
    const week = {} as WeekState;
    for (const d of DAY_KEYS) week[d] = { kind: 'closed' };
    expect(hasOpenDay(week)).toBe(false);
    expect(hasOpenDay(parseWeek(PER_DAY_WEEK))).toBe(true);
  });
});

// Google Business Profile's rule for split hours: "if your first slot ends at
// 2 PM, your second slot should begin at 2 PM or later" — adjacent is fine,
// overlapping is not. Google's day-part API calls it TIME_PERIODS_OVERLAP.
describe('dayHasOverlap', () => {
  const ranges = (...rs: [string, string][]) =>
    ({ kind: 'ranges', ranges: rs.map(([from, to]) => ({ from, to })) }) as const;

  it('accepts a normal split shift', () => {
    expect(dayHasOverlap(ranges(['09:00', '14:00'], ['17:00', '22:00']))).toBe(false);
  });

  it('accepts adjacent periods that touch exactly', () => {
    expect(dayHasOverlap(ranges(['09:00', '14:00'], ['14:00', '18:00']))).toBe(false);
  });

  it('rejects overlapping periods', () => {
    expect(dayHasOverlap(ranges(['09:00', '17:00'], ['11:00', '18:00']))).toBe(true);
  });

  it('rejects an overlap regardless of the order they were entered', () => {
    expect(dayHasOverlap(ranges(['11:00', '18:00'], ['09:00', '17:00']))).toBe(true);
  });

  it('allows a single late-night period that crosses midnight', () => {
    expect(dayHasOverlap(ranges(['20:00', '02:00']))).toBe(false);
  });

  it('allows a day shift plus a late-night one', () => {
    expect(dayHasOverlap(ranges(['09:00', '14:00'], ['22:00', '02:00']))).toBe(false);
  });

  it('rejects a late-night tail that wraps into the morning period', () => {
    expect(dayHasOverlap(ranges(['09:00', '14:00'], ['22:00', '10:00']))).toBe(true);
  });

  it('never flags a closed or single-period day', () => {
    expect(dayHasOverlap({ kind: 'closed' })).toBe(false);
    expect(dayHasOverlap({ kind: 'allDay' })).toBe(false);
    expect(dayHasOverlap(ranges(['09:00', '17:00']))).toBe(false);
  });

  it('lists the offending days across a week', () => {
    const week = parseWeek({ ...PER_DAY_WEEK, sun: ['09:00-17:00', '11:00-18:00'] });
    expect(overlappingDays(week)).toEqual(['sun']);
  });
});

describe('nextPeriodDefault', () => {
  // Defaulting a new period to the existing hours made every "add period" tap
  // produce an overlap — the invalid state was the default.
  it('starts an hour after the previous period ends', () => {
    expect(nextPeriodDefault([{ from: '09:00', to: '14:00' }])).toEqual({ from: '15:00', to: '18:00' });
  });

  it('never overlaps what is already there', () => {
    const existing = [{ from: '09:00', to: '14:00' }];
    const next = nextPeriodDefault(existing);
    expect(dayHasOverlap({ kind: 'ranges', ranges: [...existing, next] })).toBe(false);
  });

  it('stays inside the day when the previous period ends late', () => {
    const next = nextPeriodDefault([{ from: '08:00', to: '23:00' }]);
    expect(next.from).toBe('22:00');
    expect(next.to).toBe('23:59');
  });
});

describe('serializeWeek ordering', () => {
  it('stores periods in clock order however they were entered', () => {
    const week = parseWeek(PER_DAY_WEEK);
    week.sun = { kind: 'ranges', ranges: [{ from: '17:00', to: '22:00' }, { from: '09:00', to: '14:00' }] };
    expect(serializeWeek(week)?.sun).toEqual(['09:00-14:00', '17:00-22:00']);
  });
});

describe('summarizeWeek', () => {
  it('groups consecutive days that share a schedule', () => {
    expect(summarizeWeek(parseWeek(PER_DAY_WEEK), labels))
      .toBe('sat–thu 09:00-17:00 · fri 14:00-20:00');
  });

  it('renders a split shift with a separator', () => {
    const split = parseWeek({ ...PER_DAY_WEEK, sat: ['09:00-14:00', '17:00-22:00'] });
    expect(summarizeWeek(split, labels)).toContain('09:00-14:00 / 17:00-22:00');
  });

  it('names closed and all-day states', () => {
    const week = parseWeek({ ...PER_DAY_WEEK, fri: ['closed'], sun: ['all day'] });
    const text = summarizeWeek(week, labels);
    expect(text).toContain('fri Closed');
    expect(text).toContain('sun 24h');
  });
});

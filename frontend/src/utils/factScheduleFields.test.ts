import { describe, it, expect } from 'vitest';
import {
  classifyCollectionField, parseWeekdays, formatWeekdays, generationLocale,
  formatTimeStorage, formatTimeRangeStorage, formatTimeRangeDisplay,
  durationMinutes, weekdayInfo,
} from './factScheduleFields';
import type { FactCollectionWithRows, FactRowDto } from '@/lib/api';

let seq = 0;
const row = (attrs: Record<string, string>, structured?: FactRowDto['structured']): FactRowDto => ({
  id: `row-${++seq}`,
  name: 'دورة',
  attributes: Object.entries(attrs).map(([label, value]) => ({ label, value })),
  structured: structured ?? null,
  price: null, currency: null, startsAt: null, endsAt: null, isAvailable: true,
});
const collection = (rows: FactRowDto[]): FactCollectionWithRows => ({
  id: 'c1', label: 'مواعيد', keyAttr: null, isComplete: null, rowCount: rows.length, rows,
});

describe('classifyCollectionField', () => {
  it('classifies by the majority shape of the field values — merchant data, not label words', () => {
    const c = collection([
      row({ 'الأيام': 'الأحد والثلاثاء', 'الساعة': '12-1' }),
      row({ 'الأيام': 'السبت', 'الساعة': '5-6' }),
      row({ 'الأيام': 'الاثنين', 'الساعة': 'حسب التنسيق' }),
    ]);
    expect(classifyCollectionField(c, 'الأيام')).toBe('weekday');
    expect(classifyCollectionField(c, 'الساعة')).toBe('time');
  });

  it('an existing structured shadow is authoritative over value shapes', () => {
    const c = collection([
      row({ 'الموعد': 'نص حر تماماً' }, { 'الموعد': { kind: 'timeRange', start: '12:00', end: '13:00' } }),
    ]);
    expect(classifyCollectionField(c, 'الموعد')).toBe('time');
  });

  it('mostly free-form fields stay plain text', () => {
    const c = collection([
      row({ 'ملاحظة': 'تبدأ عند اكتمال العدد' }),
      row({ 'ملاحظة': '8 جلسات' }),
      row({ 'ملاحظة': 'السبت' }),
    ]);
    expect(classifyCollectionField(c, 'ملاحظة')).toBe('other');
  });
});

describe('parseWeekdays — complete parses only, never lossy', () => {
  it('parses fused-conjunction Arabic day lists', () => {
    expect(parseWeekdays('الأحد والثلاثاء')).toEqual([0, 2]);
    expect(parseWeekdays('الاثنين والأربعاء والخميس')).toEqual([1, 3, 4]);
    expect(parseWeekdays('Sunday and Tuesday')).toEqual([0, 2]);
  });

  it('refuses any token it cannot account for — a partial parse would drop merchant words', () => {
    expect(parseWeekdays('السبت فقط')).toBeNull();
    expect(parseWeekdays('تبدأ عند اكتمال العدد')).toBeNull();
    expect(parseWeekdays('')).toBeNull();
  });

  it('round-trips through formatWeekdays byte-identically for ar', () => {
    for (const original of ['الأحد والثلاثاء', 'الاثنين والأربعاء', 'الخميس']) {
      const days = parseWeekdays(original);
      expect(days).not.toBeNull();
      expect(formatWeekdays(days as number[], 'ar')).toBe(original);
    }
  });
});

describe('generationLocale — the stored string follows the DATA script', () => {
  it('Arabic values force ar generation even under an English UI', () => {
    const c = collection([row({ 'الأيام': 'الأحد والثلاثاء' })]);
    expect(generationLocale(c, 'الأيام', 'en-US')).toBe('ar');
  });
  it('Latin values generate in en; empty fields fall back to the UI locale', () => {
    const c = collection([row({ days: 'Sunday and Tuesday' })]);
    expect(generationLocale(c, 'days', 'ar-SA')).toBe('en');
    expect(generationLocale(c, 'empty', 'ar-SA')).toBe('ar-SA');
  });
});

describe('time formatting', () => {
  it('stores the compact merchant form («12-1»), display resolves the ambiguity', () => {
    expect(formatTimeStorage('13:00')).toBe('1');
    expect(formatTimeStorage('13:30')).toBe('1:30');
    expect(formatTimeStorage('00:15')).toBe('12:15');
    expect(formatTimeRangeStorage('12:00', '13:00')).toBe('12-1');
    const display = formatTimeRangeDisplay('12:00', '13:00', 'ar-SA-u-nu-latn');
    // Exact day-period wording belongs to Intl — assert the structure only.
    expect(display).toContain('12:00');
    expect(display).toContain('1:00');
    expect(display).toMatch(/–/);
  });

  it('duration is minutes across the range, null when empty or inverted', () => {
    expect(durationMinutes('12:00', '13:00')).toBe(60);
    expect(durationMinutes('12:00', '13:30')).toBe(90);
    expect(durationMinutes('13:00', '12:00')).toBeNull();
    expect(durationMinutes('12:00', '12:00')).toBeNull();
  });
});

describe('weekdayInfo', () => {
  it('is Sunday-first with Intl narrow letters', () => {
    const ar = weekdayInfo('ar');
    expect(ar).toHaveLength(7);
    expect(ar[0].long).toBe('الأحد');
    expect(ar.map((d) => d.narrow).join(' ')).toBe('ح ن ث ر خ ج س');
  });
});

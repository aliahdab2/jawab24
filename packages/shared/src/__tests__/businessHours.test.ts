import { describe, it, expect } from 'vitest';
import { canonicalizeHoursEntry, canonicalizeHoursWeek, isValidDayKey, dayOrderIndex, dayKeyFromLabel, SHORT_DAY_KEYS, LONG_DAY_KEYS } from '../businessHours';

describe('canonicalizeHoursEntry — strict canonical pass-through (idempotency)', () => {
    it('passes through already-canonical HH:MM-HH:MM', () => {
        expect(canonicalizeHoursEntry('09:00-18:00')).toEqual({ ok: true, value: '09:00-18:00' });
        expect(canonicalizeHoursEntry('00:00-23:59')).toEqual({ ok: true, value: '00:00-23:59' });
    });

    it('passes through "closed"', () => {
        expect(canonicalizeHoursEntry('closed')).toEqual({ ok: true, value: 'closed' });
    });

    it('passes through "all day"', () => {
        expect(canonicalizeHoursEntry('all day')).toEqual({ ok: true, value: 'all day' });
    });
});

describe('canonicalizeHoursEntry — meridiem (AM/PM)', () => {
    it('converts "9am-6pm" → "09:00-18:00"', () => {
        expect(canonicalizeHoursEntry('9am-6pm')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('converts "9 AM - 6 PM" → "09:00-18:00"', () => {
        expect(canonicalizeHoursEntry('9 AM - 6 PM')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('handles minutes with meridiem: "9:30am-6:15pm"', () => {
        expect(canonicalizeHoursEntry('9:30am-6:15pm')).toEqual({ ok: true, value: '09:30-18:15' });
    });

    it('handles 12am (midnight) and 12pm (noon) correctly', () => {
        expect(canonicalizeHoursEntry('12am-12pm')).toEqual({ ok: true, value: '00:00-12:00' });
        expect(canonicalizeHoursEntry('12pm-12am')).toEqual({ ok: true, value: '12:00-00:00' });
    });
});

describe('canonicalizeHoursEntry — ambiguous bare ranges (no meridiem)', () => {
    it('"9-6" → "09:00-18:00" (heuristic: end ≤ start ≤ 12 ⇒ PM)', () => {
        expect(canonicalizeHoursEntry('9-6')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('"9-22" → "09:00-22:00" (24h interpretation when end > 12)', () => {
        expect(canonicalizeHoursEntry('9-22')).toEqual({ ok: true, value: '09:00-22:00' });
    });

    it('"10-14" → "10:00-14:00" (end > start, plain 24h)', () => {
        expect(canonicalizeHoursEntry('10-14')).toEqual({ ok: true, value: '10:00-14:00' });
    });

    it('"9:30-6" → "09:30-18:00" (heuristic still triggers with minutes)', () => {
        expect(canonicalizeHoursEntry('9:30-6')).toEqual({ ok: true, value: '09:30-18:00' });
    });
});

describe('canonicalizeHoursEntry — Arabic input', () => {
    it('converts Arabic-Indic digits: "٩:٠٠-١٨:٠٠" → "09:00-18:00"', () => {
        expect(canonicalizeHoursEntry('٩:٠٠-١٨:٠٠')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('handles Arabic meridiem: "٩ ص - ٦ م" → "09:00-18:00"', () => {
        expect(canonicalizeHoursEntry('٩ ص - ٦ م')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('recognizes "مغلق" → "closed"', () => {
        expect(canonicalizeHoursEntry('مغلق')).toEqual({ ok: true, value: 'closed' });
    });

    it('recognizes "طوال اليوم" → "all day"', () => {
        expect(canonicalizeHoursEntry('طوال اليوم')).toEqual({ ok: true, value: 'all day' });
    });

    it('accepts Arabic "إلى" / "حتى" as a range separator', () => {
        expect(canonicalizeHoursEntry('9 إلى 18')).toEqual({ ok: true, value: '09:00-18:00' });
        expect(canonicalizeHoursEntry('9 حتى 18')).toEqual({ ok: true, value: '09:00-18:00' });
    });
});

describe('canonicalizeHoursEntry — separators + spacing', () => {
    it('accepts en-dash and em-dash range separators', () => {
        expect(canonicalizeHoursEntry('9am – 6pm')).toEqual({ ok: true, value: '09:00-18:00' });
        expect(canonicalizeHoursEntry('9am — 6pm')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('accepts " to " as a range separator', () => {
        expect(canonicalizeHoursEntry('9am to 6pm')).toEqual({ ok: true, value: '09:00-18:00' });
    });

    it('tolerates extra whitespace', () => {
        expect(canonicalizeHoursEntry('  9:00  -  18:00  ')).toEqual({ ok: true, value: '09:00-18:00' });
    });
});

describe('canonicalizeHoursEntry — closed/all-day variants', () => {
    it('case-insensitive closed: "CLOSED", "Closed", "off"', () => {
        expect(canonicalizeHoursEntry('CLOSED')).toEqual({ ok: true, value: 'closed' });
        expect(canonicalizeHoursEntry('Closed')).toEqual({ ok: true, value: 'closed' });
        expect(canonicalizeHoursEntry('off')).toEqual({ ok: true, value: 'closed' });
    });

    it('recognizes "24/7" and "24h" as all day', () => {
        expect(canonicalizeHoursEntry('24/7')).toEqual({ ok: true, value: 'all day' });
        expect(canonicalizeHoursEntry('24h')).toEqual({ ok: true, value: 'all day' });
        expect(canonicalizeHoursEntry('24 hours')).toEqual({ ok: true, value: 'all day' });
    });
});

describe('canonicalizeHoursEntry — invalid inputs', () => {
    it('rejects empty / whitespace-only', () => {
        expect(canonicalizeHoursEntry('')).toMatchObject({ ok: false });
        expect(canonicalizeHoursEntry('   ')).toMatchObject({ ok: false });
    });

    it('rejects non-string', () => {
        expect(canonicalizeHoursEntry(42 as unknown as string)).toMatchObject({ ok: false });
        expect(canonicalizeHoursEntry(null as unknown as string)).toMatchObject({ ok: false });
    });

    it('rejects out-of-range hours: "25:00-30:00"', () => {
        expect(canonicalizeHoursEntry('25:00-30:00')).toMatchObject({ ok: false });
    });

    it('rejects out-of-range minutes: "09:99-18:00"', () => {
        expect(canonicalizeHoursEntry('09:99-18:00')).toMatchObject({ ok: false });
    });

    it('rejects free-form garbage', () => {
        expect(canonicalizeHoursEntry('every monday at noon ish')).toMatchObject({ ok: false });
    });

    it('rejects three-part range like "9-6-12"', () => {
        // After splitting by "-", we get [9, 6, 12] which fails the 2-parts check.
        expect(canonicalizeHoursEntry('9-6-12')).toMatchObject({ ok: false });
    });
});

describe('canonicalizeHoursEntry — round-trip stability', () => {
    // Each canonical value, when fed back in, must canonicalize to itself.
    it.each([
        '09:00-18:00',
        '00:00-23:59',
        '12:00-13:00',
        'closed',
        'all day',
    ])('round-trips %s', (canonical) => {
        const r1 = canonicalizeHoursEntry(canonical);
        expect(r1).toEqual({ ok: true, value: canonical });
        // Re-canonicalize the output → still the same.
        if (r1.ok) {
            const r2 = canonicalizeHoursEntry(r1.value);
            expect(r2).toEqual(r1);
        }
    });
});

describe('canonicalizeHoursWeek — full-week parsing', () => {
    it('canonicalizes a typical merchant week', () => {
        const result = canonicalizeHoursWeek({
            monday: '9am-6pm',
            tuesday: '9-6',
            wednesday: '9:00-18:00',
            thursday: '9am-6pm',
            friday: 'مغلق',
            saturday: '10-14',
            sunday: '10:00-14:00',
        });
        expect(result).toEqual({
            ok: true,
            value: {
                monday: ['09:00-18:00'],
                tuesday: ['09:00-18:00'],
                wednesday: ['09:00-18:00'],
                thursday: ['09:00-18:00'],
                friday: ['closed'],
                saturday: ['10:00-14:00'],
                sunday: ['10:00-14:00'],
            },
        });
    });

    it('passes through legacy array shape (single-window arrays)', () => {
        const result = canonicalizeHoursWeek({
            monday: ['09:00-18:00'],
            friday: ['closed'],
        });
        expect(result).toEqual({
            ok: true,
            value: {
                monday: ['09:00-18:00'],
                friday: ['closed'],
            },
        });
    });

    it('skips undefined and empty values rather than treating as closed', () => {
        const result = canonicalizeHoursWeek({
            monday: '9am-6pm',
            tuesday: undefined,
            wednesday: '',
            thursday: '   ',
        });
        expect(result).toEqual({
            ok: true,
            value: { monday: ['09:00-18:00'] },
        });
    });

    it('reports the first invalid day with its error', () => {
        const result = canonicalizeHoursWeek({
            monday: '9am-6pm',
            tuesday: '25:00-30:00',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.day).toBe('tuesday');
            expect(result.error).toContain('out_of_range');
        }
    });

    it('accepts short day keys (FB-sync / extractor shape)', () => {
        const result = canonicalizeHoursWeek({
            sat: ['09:00-20:00'],
            sun: '9am-8pm',
            fri: 'مغلق',
        });
        expect(result).toEqual({
            ok: true,
            value: { sat: ['09:00-20:00'], sun: ['09:00-20:00'], fri: ['closed'] },
        });
    });

    it('normalizes capitalized/mixed-case day keys to lowercase (formatBusinessInfoPrompt reads lowercase)', () => {
        const result = canonicalizeHoursWeek({ Monday: '9am-6pm', FRIDAY: 'closed', Sat: '10-14' });
        expect(result).toEqual({
            ok: true,
            value: { monday: ['09:00-18:00'], friday: ['closed'], sat: ['10:00-14:00'] },
        });
    });

    it('rejects an unknown day key', () => {
        const result = canonicalizeHoursWeek({ monday: '9am-6pm', funday: '10-14' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.day).toBe('funday');
            expect(result.error).toBe('invalid_day_key');
        }
    });
});

describe('isValidDayKey', () => {
    it('accepts short and long keys, case-insensitively', () => {
        for (const k of ['mon', 'fri', 'sun', 'Monday', 'FRIDAY', 'sunday']) {
            expect(isValidDayKey(k)).toBe(true);
        }
    });
    it('rejects junk keys', () => {
        for (const k of ['funday', 'mondayyy', '', 'm', 'الأحد']) {
            expect(isValidDayKey(k)).toBe(false);
        }
    });
});

// Week order is a product decision, not an implementation detail: our markets
// start the week on Saturday with a Friday(+Saturday) weekend (CLDR
// ar-SY/ar-EG/ar-LY). These pins keep anyone from "fixing" the arrays back to
// ISO Monday-first or US Sunday-first.
describe('Saturday-first week order (CLDR ar-SY)', () => {
    it('SHORT_DAY_KEYS and LONG_DAY_KEYS enumerate sat→fri', () => {
        expect([...SHORT_DAY_KEYS]).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
        expect([...LONG_DAY_KEYS]).toEqual(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    });

    it('dayOrderIndex agrees for short and long keys, any case', () => {
        expect(dayOrderIndex('sat')).toBe(0);
        expect(dayOrderIndex('Saturday')).toBe(0);
        expect(dayOrderIndex('SUN')).toBe(1);
        expect(dayOrderIndex('sunday')).toBe(1);
        expect(dayOrderIndex('thu')).toBe(5);
        expect(dayOrderIndex('fri')).toBe(6);
        expect(dayOrderIndex('friday')).toBe(6);
    });

    it('sorts unknown keys last instead of dropping them', () => {
        expect(dayOrderIndex('funday')).toBe(SHORT_DAY_KEYS.length);
        const sorted = ['funday', 'fri', 'sat'].sort((a, b) => dayOrderIndex(a) - dayOrderIndex(b));
        expect(sorted).toEqual(['sat', 'fri', 'funday']);
    });
});

describe('dayKeyFromLabel (D-102 — Salla working-hours day names)', () => {
    it('resolves Arabic day labels (the shape Salla store/info sends)', () => {
        expect(dayKeyFromLabel('السبت')).toBe('sat');
        expect(dayKeyFromLabel('الجمعة')).toBe('fri');
        expect(dayKeyFromLabel('الإثنين')).toBe('mon');
    });

    it('accepts the bare-alif spelling «الاثنين» (hamza-tolerant)', () => {
        expect(dayKeyFromLabel('الاثنين')).toBe('mon');
    });

    it('resolves English names and existing keys, any case, trimmed', () => {
        expect(dayKeyFromLabel('Saturday')).toBe('sat');
        expect(dayKeyFromLabel(' friday ')).toBe('fri');
        expect(dayKeyFromLabel('SUN')).toBe('sun');
        expect(dayKeyFromLabel('tuesday')).toBe('tue');
    });

    it('returns undefined for anything that is not a weekday', () => {
        expect(dayKeyFromLabel('عطلة')).toBeUndefined();
        expect(dayKeyFromLabel('funday')).toBeUndefined();
        expect(dayKeyFromLabel('')).toBeUndefined();
    });
});

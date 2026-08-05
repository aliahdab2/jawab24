import { describe, it, expect } from 'vitest';
import { extractDateTokens, classifyDateTokens } from '../dateTokens';

/** Every date in this file is anchored to one "today" so the past/future split is
 *  readable at a glance. 2026-08-05 is the day the two real defects below were measured. */
const TODAY = '2026-08-05';

const isos = (text: string, today = TODAY): string[] =>
    extractDateTokens(text, today).map(t => t.iso);

describe('extractDateTokens — the shapes merchants and the model actually write', () => {
    it('reads D/M/YYYY DAY-FIRST, not month-first', () => {
        // 7/5/2026 is 7 May, not 5 July — day-first is the Levantine convention.
        expect(isos('دورة التصوير الفوتوغرافي تبدأ بتاريخ 7/5/2026')).toEqual(['2026-05-07']);
    });

    it('reads a year-less D/M against the year of todayIso', () => {
        expect(isos('تبدأ الأحد 26/7', '2026-07-30')).toEqual(['2026-07-26']);
    });

    it('expands a 2-digit year', () => {
        expect(isos('تبدأ 18/8/26')).toEqual(['2026-08-18']);
    });

    it('reads ISO, the shape our own fact rows store', () => {
        expect(isos('الدورة تبدأ 2026-08-18')).toEqual(['2026-08-18']);
    });

    it('reads Arabic-Indic digits — the shape ASCII scans go blind to', () => {
        expect(isos('تبدأ ٢٦/٧/٢٠٢٦')).toEqual(['2026-07-26']);
    });

    it('de-duplicates by calendar date, not by spelling', () => {
        expect(isos('تبدأ 18/8/2026 ونعيدها 2026-08-18')).toEqual(['2026-08-18']);
    });
});

describe('month names — derived from Intl, so both Arabic systems and their spellings work', () => {
    it('reads the transliterated system (يناير…أغسطس), what the model writes to customers', () => {
        expect(isos('3 أغسطس 2026')).toEqual(['2026-08-03']);
    });

    it('reads the Levantine system (كانون الثاني…آب), what Syrian merchants write', () => {
        expect(isos('26 تموز 2026')).toEqual(['2026-07-26']);
    });

    it('reads hamza-less spellings without any hand-maintained variant list', () => {
        // «آب»→«اب», «أغسطس»→«اغسطس», «تشرين الأول»→«تشرين الاول»: normalizeArabic folds
        // the alef variants on BOTH the Intl name and the input, so no list is needed.
        expect(isos('12 اب 2026')).toEqual(['2026-08-12']);
        expect(isos('12 اغسطس 2026')).toEqual(['2026-08-12']);
        expect(isos('9 تشرين الاول 2026')).toEqual(['2026-10-09']);
    });

    it('prefers the longest month name so a two-word name is not cut short', () => {
        // «تشرين الثاني» is November; a shorter-first match would read it as October.
        expect(isos('9 تشرين الثاني 2026')).toEqual(['2026-11-09']);
    });

    it('reads English month names for English replies', () => {
        expect(isos('starts 18 August 2026')).toEqual(['2026-08-18']);
    });

    it('falls back to todayIso year when the month name carries none', () => {
        expect(isos('تبدأ 26 تموز', '2026-07-30')).toEqual(['2026-07-26']);
    });
});

describe('what must NEVER be read as a date — the false-positive surface', () => {
    it('ignores time ranges', () => {
        expect(isos('الدورة من 12-2 والثانية 3-4:30')).toEqual([]);
    });

    it('ignores phone numbers', () => {
        expect(isos('أرقامنا: 0935924472, 0112124472, 0937549674')).toEqual([]);
    });

    it('ignores prices and bare counts', () => {
        expect(isos('السعر 35000 ل.س والدورة 8 جلسات لمدة شهر')).toEqual([]);
    });

    it('rejects impossible calendar dates instead of rolling them over', () => {
        // 31 February would silently become 2/3 with naive Date arithmetic.
        expect(isos('31/2/2026')).toEqual([]);
        expect(isos('45/13/2026')).toEqual([]);
    });

    it('returns nothing for empty or dateless text', () => {
        expect(isos('')).toEqual([]);
        expect(isos('مرحبا كيف فيني ساعدك')).toEqual([]);
    });
});

describe('classifyDateTokens — the stale-date class the grounding verifier cannot see', () => {
    it('buckets a past date as stale — the measured الدمشقي defect', () => {
        const { stale, upcoming } = classifyDateTokens('دورة التصوير تبدأ 7/5/2026', TODAY);
        expect(stale.map(t => t.iso)).toEqual(['2026-05-07']);
        expect(upcoming).toEqual([]);
    });

    it('buckets a future date as upcoming', () => {
        const { stale, upcoming } = classifyDateTokens('تبدأ 2026-08-18', TODAY);
        expect(upcoming.map(t => t.iso)).toEqual(['2026-08-18']);
        expect(stale).toEqual([]);
    });

    it('counts today itself as upcoming — a course starting today is not a stale quote', () => {
        const { stale, upcoming } = classifyDateTokens(`تبدأ ${TODAY}`, TODAY);
        expect(upcoming.map(t => t.iso)).toEqual([TODAY]);
        expect(stale).toEqual([]);
    });

    it('splits a reply that mixes both', () => {
        const { stale, upcoming } = classifyDateTokens('كانت 26/7 والقادمة 18/8', TODAY);
        expect(stale.map(t => t.iso)).toEqual(['2026-07-26']);
        expect(upcoming.map(t => t.iso)).toEqual(['2026-08-18']);
    });
});

import { describe, it, expect } from 'vitest';
import { isolateNumericTokens, stripBidiMarks, LRI, PDI } from '../bidi';

/**
 * The expectations here are pinned to a MEASUREMENT, not to intuition: each
 * "flips" case below was rendered in Chrome with `dir="auto"` inside Arabic
 * text and its per-character x-positions read back, on 2026-08-31. jsdom does
 * no bidi layout, so a unit test can never prove the visual outcome — it can
 * only prove that the tokens the measurement found fragile are the ones we
 * isolate, and that the ones it found safe are left alone.
 */
const AR = (t: string) => `سعرها ${t} شامل`;
const iso = (t: string) => `سعرها ${LRI}${t}${PDI} شامل`;

describe('isolateNumericTokens', () => {
    describe('isolates the tokens measured to render in the wrong order', () => {
        it.each([
            ['+963989811511', 'phone with a leading + displayed as 963989811511+'],
            ['75$', 'trailing currency displayed as $75'],
            ['100 $', 'spaced trailing currency displayed as $ 100'],
            ['$15', 'leading currency displayed as 15$'],
            ['20%', 'trailing percent displayed as %20'],
            ['5-10', 'range displayed reversed as 10-5'],
            ['5 - 10', 'spaced range displayed reversed as 10 - 5'],
            ['٧٥$', 'Arabic-Indic digits with currency displayed as $٧٥'],
            ['2026-08-31', 'date segments displayed in reverse order'],
        ])('%s — %s', (token) => {
            expect(isolateNumericTokens(AR(token))).toBe(iso(token));
        });
    });

    describe('leaves alone the tokens measured to render correctly', () => {
        it.each([
            ['3.5', 'decimal — CS between two Arabic numbers keeps its place'],
            ['1,200', 'thousands separator — same rule'],
            ['9:30', 'time'],
            ['12/5', 'slashed date'],
            ['00963989811511', 'phone in 00 form — no sign to misplace'],
            ['2024', 'a bare number'],
            ['٧٥', 'bare Arabic-Indic digits'],
        ])('%s — %s', (token) => {
            expect(isolateNumericTokens(AR(token))).toBe(AR(token));
        });
    });

    it('repairs every fragile token in one reply, and only those', () => {
        const reply =
            'رحلة الغوص ب75$، والطيران ب100$ مع التصوير مشمول. للحجز تواصل معنا على +963989811511.';
        expect(isolateNumericTokens(reply)).toBe(
            `رحلة الغوص ب${LRI}75$${PDI}، والطيران ب${LRI}100$${PDI} مع التصوير مشمول. ` +
            `للحجز تواصل معنا على ${LRI}+963989811511${PDI}.`,
        );
    });

    it('is a no-op on text with no RTL letter — Latin layout is already correct', () => {
        const en = 'Call us on +963989811511, the trip is 75$ and the deposit is 20%.';
        expect(isolateNumericTokens(en)).toBe(en);
    });

    it('is idempotent — a second render adds no second isolate', () => {
        const once = isolateNumericTokens(AR('+963989811511'));
        expect(isolateNumericTokens(once)).toBe(once);
    });

    it('leaves URLs byte-identical — a mark inside a link travels with a copy-paste', () => {
        const reply = 'اطلبها من https://shop.example/items/5-10?ref=a-1 بسعر 75$';
        expect(isolateNumericTokens(reply)).toBe(
            `اطلبها من https://shop.example/items/5-10?ref=a-1 بسعر ${LRI}75$${PDI}`,
        );
    });

    it('leaves email addresses byte-identical', () => {
        const reply = 'راسلنا على sales-24@shop.example أو اتصل على +963989811511';
        expect(isolateNumericTokens(reply)).toBe(
            `راسلنا على sales-24@shop.example أو اتصل على ${LRI}+963989811511${PDI}`,
        );
    });

    it('never lets a token straddle a newline, so a bulleted list is not wrapped as one range', () => {
        // `75\n- 100` is a price then a bullet, NOT the range «75-100»: a separator
        // that may swallow a newline welds the two lines into one isolate.
        const list = 'الأسعار:\n75\n- 100 ليرة';
        expect(isolateNumericTokens(list)).toBe(list);
    });

    it('handles empty input', () => {
        expect(isolateNumericTokens('')).toBe('');
    });
});

describe('stripBidiMarks', () => {
    it('removes the isolates this module inserts, restoring the plain text', () => {
        const reply = AR('+963989811511');
        expect(stripBidiMarks(isolateNumericTokens(reply))).toBe(reply);
    });

    it('removes the LRM/RLM/ALM and embedding marks Meta wraps RTL numbers in', () => {
        expect(stripBidiMarks('‎07‏0؜1‪2‬3')).toBe('070123');
    });

    it('leaves ordinary text untouched', () => {
        expect(stripBidiMarks('رقمنا 0989811511')).toBe('رقمنا 0989811511');
    });
});

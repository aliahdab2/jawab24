import { describe, it, expect } from 'vitest';
import { fitVarchar, wasDropped } from '../../src/utils/columnText';
import { ecommerceStores } from '../../src/db/schema';

/**
 * `fitVarchar` is the last line of defence between an unvalidated third-party
 * payload and a bounded Postgres column. It exists because on 2026-08-11 a Zid
 * `currency` OBJECT reached `store_currency varchar(10)`, Postgres raised 22001,
 * and a merchant's whole App Market install was lost to a display field.
 */
describe('fitVarchar', () => {
    const currency = ecommerceStores.storeCurrency; // varchar(10)
    const name = ecommerceStores.storeName;         // varchar(255)

    describe('absence semantics (must not change what callers already rely on)', () => {
        it('passes undefined through, so a Drizzle .set() leaves the column untouched', () => {
            expect(fitVarchar(undefined, name)).toBeUndefined();
        });

        it('passes null through, so an explicit clear still clears', () => {
            // Shopify's GraphQL scalars send real nulls; this guard must not
            // quietly turn "clear this field" into "leave it alone".
            expect(fitVarchar(null, name)).toBeNull();
        });

        it('treats a blank / whitespace-only string as absent rather than storing ""', () => {
            expect(fitVarchar('   ', name)).toBeUndefined();
            expect(fitVarchar('', name)).toBeUndefined();
        });
    });

    describe('shapes that must never reach the database', () => {
        it('drops the exact object that broke the Zid install', () => {
            const zidCurrency = { id: 4, name: 'ريال سعودي', code: 'SAR', symbol: ' ر.س ' };

            expect(fitVarchar(zidCurrency, currency)).toBeUndefined();
        });

        it('drops arrays and functions too', () => {
            expect(fitVarchar(['SAR'], currency)).toBeUndefined();
            expect(fitVarchar(() => 'SAR', currency)).toBeUndefined();
        });

        it('does NOT stringify an object into the column', () => {
            // Storing `{"id":4,...}` (or `[object Object]`) would "work" and be far
            // worse: unreadable to the merchant, useless to the AI, and it would
            // hide the drift behind a value that looks stored-and-fine.
            const fitted = fitVarchar({ code: 'SAR' }, currency);

            expect(fitted).toBeUndefined();
            expect(typeof fitted).not.toBe('string');
        });

        it('drops NaN and Infinity, which stringify to garbage', () => {
            expect(fitVarchar(NaN, name)).toBeUndefined();
            expect(fitVarchar(Infinity, name)).toBeUndefined();
        });
    });

    describe('shapes we can represent faithfully', () => {
        it('trims strings', () => {
            expect(fitVarchar('  Test  ', name)).toBe('Test');
        });

        it('stringifies a finite number (an id-shaped field arriving unquoted)', () => {
            expect(fitVarchar(130216, name)).toBe('130216');
        });

        it('stringifies booleans and bigints', () => {
            expect(fitVarchar(true, name)).toBe('true');
            expect(fitVarchar(10n, name)).toBe('10');
        });
    });

    describe('clamping to the column width', () => {
        it('reads the real width from the schema, not a hardcoded number', () => {
            // The whole point: if someone widens store_currency in a migration,
            // this guard follows automatically instead of silently over-clamping.
            expect((currency as unknown as { length?: number }).length).toBe(10);
            expect((name as unknown as { length?: number }).length).toBe(255);
        });

        it('truncates an over-long value instead of letting Postgres reject the write', () => {
            expect(fitVarchar('X'.repeat(300), name)).toHaveLength(255);
        });

        it('leaves a value that already fits untouched', () => {
            expect(fitVarchar('SAR', currency)).toBe('SAR');
        });

        it('counts CHARACTERS like Postgres does, keeping Arabic intact', () => {
            // varchar(n) bounds code points, so 10 Arabic characters fit exactly.
            expect(fitVarchar('ريال سعودي', currency)).toBe('ريال سعودي');
        });

        it('never splits a surrogate pair, which would be invalid UTF-8', () => {
            // A naive .slice() here leaves half an emoji and Postgres rejects the
            // row — turning the truncation guard back into the write failure it
            // exists to prevent.
            const emoji = '👍'.repeat(20);
            const fitted = fitVarchar(emoji, currency) as string;

            expect(Array.from(fitted)).toHaveLength(10);
            expect(fitted).toBe('👍'.repeat(10));
            expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fitted)).toBe(false);
        });
    });
});

describe('wasDropped', () => {
    it('reports a value that had content but could not be represented', () => {
        expect(wasDropped({ code: 'SAR' }, undefined)).toBe(true);
    });

    it('does not report absence that was already absent', () => {
        expect(wasDropped(undefined, undefined)).toBe(false);
        expect(wasDropped(null, null)).toBe(false);
    });

    it('does not report a value that came through fine', () => {
        expect(wasDropped('SAR', 'SAR')).toBe(false);
    });
});

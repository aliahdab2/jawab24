import { describe, it, expect } from 'vitest';
import { isRowLive, type FactRowSchedule } from '../factSchedule';

const TODAY = '2026-07-28';

/** The rule this PR REPLACES. Kept here solely so the equivalence claim below is
 *  executable rather than asserted in a PR description. Do not use in product code. */
const legacyIsRowLive = (row: FactRowSchedule, todayIso: string): boolean =>
    !row.endsAt || row.endsAt >= todayIso;

const row = (startsAt: string | null, endsAt: string | null): FactRowSchedule => ({ startsAt, endsAt });

describe('isRowLive — the start-date rule (D-057)', () => {
    describe('undated rows', () => {
        it('a row with no dates lives forever', () => {
            expect(isRowLive(row(null, null), TODAY)).toBe(true);
        });

        it('an end-dated row retires the day AFTER its end date', () => {
            expect(isRowLive(row(null, '2026-07-27'), TODAY)).toBe(false); // yesterday
            expect(isRowLive(row(null, TODAY), TODAY)).toBe(true);         // today — still live
            expect(isRowLive(row(null, '2026-07-29'), TODAY)).toBe(true);  // tomorrow
        });
    });

    describe('start-dated rows — the start date owns visibility', () => {
        it('retires the day AFTER it starts', () => {
            expect(isRowLive(row('2026-07-27', null), TODAY)).toBe(false); // started yesterday
            expect(isRowLive(row(TODAY, null), TODAY)).toBe(true);         // starts today — announceable
            expect(isRowLive(row('2026-07-29', null), TODAY)).toBe(true);  // starts tomorrow
        });

        it('IGNORES a future end date once the start has passed — the ruling', () => {
            // A course running 20 Jul → 1 Sep is no longer announceable on 28 Jul,
            // even though it is still running. This is the behaviour change.
            expect(isRowLive(row('2026-07-20', '2026-09-01'), TODAY)).toBe(false);
        });

        it('ignores endsAt entirely when startsAt is set, in both directions', () => {
            expect(isRowLive(row('2026-07-29', '2026-07-01'), TODAY)).toBe(true);  // ends < starts
            expect(isRowLive(row('2026-07-27', '2027-01-01'), TODAY)).toBe(false);
        });
    });

    describe('equivalence with the legacy rule on every row shape that exists today', () => {
        // The migration-safety claim: every dated row written by the one-date-field
        // era has startsAt === endsAt, and every other row is undated. For BOTH
        // shapes the old and new rules must agree — otherwise this change would
        // alter what the AI sees for existing merchants on the day it deploys.
        const probeDates = ['2026-01-01', '2026-07-27', TODAY, '2026-07-29', '2027-12-31'];

        it.each(probeDates)('startsAt === endsAt behaves identically at %s', (date) => {
            for (const probe of probeDates) {
                const r = row(date, date);
                expect(isRowLive(r, probe)).toBe(legacyIsRowLive(r, probe));
            }
        });

        it.each(probeDates)('undated rows behave identically at %s', (probe) => {
            expect(isRowLive(row(null, null), probe)).toBe(legacyIsRowLive(row(null, null), probe));
            for (const end of probeDates) {
                const r = row(null, end);
                expect(isRowLive(r, probe)).toBe(legacyIsRowLive(r, probe));
            }
        });

        it('DIVERGES only for the shape no existing row has (startsAt !== endsAt)', () => {
            // Guards the equivalence tests above from becoming vacuous: if someone
            // "simplifies" isRowLive back to the endsAt rule, this fails.
            const divergent = row('2026-07-20', '2026-09-01');
            expect(isRowLive(divergent, TODAY)).toBe(false);
            expect(legacyIsRowLive(divergent, TODAY)).toBe(true);
        });
    });

    it('compares dates lexicographically across year and month boundaries', () => {
        expect(isRowLive(row('2026-12-31', null), '2027-01-01')).toBe(false);
        expect(isRowLive(row('2027-01-01', null), '2026-12-31')).toBe(true);
        expect(isRowLive(row(null, '2026-09-01'), '2026-10-01')).toBe(false);
    });
});

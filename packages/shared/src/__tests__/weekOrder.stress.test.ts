import { describe, it, expect } from 'vitest';
import { formatBusinessInfoPrompt } from '../businessInfoPrompt';
import {
    canonicalizeHoursWeek,
    dayOrderIndex,
    SHORT_DAY_KEYS,
    LONG_DAY_KEYS,
} from '../businessHours';

/**
 * Stress suite for the Saturday-first week-order delivery (PR #588).
 *
 * Every renderer that turns a `business_profile.hours` map into text must
 * enumerate days sat→fri REGARDLESS of the insertion order of the input
 * object — merchants, Facebook sync, KB extraction, and legacy rows all
 * produce different key orders, key forms (short/long), casings, and junk.
 * Deterministic by construction (enumerated permutations, no randomness).
 */

const LABELS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

function rotate<T>(arr: readonly T[], k: number): T[] {
    return [...arr.slice(k), ...arr.slice(0, k)];
}

/** Insertion orders to stress: all 7 rotations, full reversal, an interleave. */
function insertionOrders<T>(week: readonly T[]): T[][] {
    const orders: T[][] = [];
    for (let k = 0; k < week.length; k++) orders.push(rotate(week, k));
    orders.push([...week].reverse());
    orders.push([week[3], week[0], week[5], week[1], week[6], week[2], week[4]]);
    return orders;
}

/** Positions of the given labels in the rendered block, present-only. */
function labelPositions(block: string, labels: readonly string[]): number[] {
    return labels.map((l) => block.indexOf(l)).filter((i) => i !== -1);
}

function expectAscending(positions: number[]): void {
    for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
}

describe('stress: formatBusinessInfoPrompt hours ordering', () => {
    it('renders sat→fri for every insertion order of a full short-key week', () => {
        for (const order of insertionOrders(SHORT_DAY_KEYS)) {
            const hours: Record<string, string[]> = {};
            for (const day of order) hours[day] = ['09:00-18:00'];
            hours.fri = ['closed'];
            const block = formatBusinessInfoPrompt({ hours });
            expect(block).not.toBeNull();
            const positions = labelPositions(block!, LABELS);
            expect(positions).toHaveLength(7);
            expectAscending(positions);
            expect(block!.indexOf('Saturday')).toBeLessThan(block!.indexOf('Friday'));
        }
    });

    it('renders sat→fri for every insertion order of a full long-key week', () => {
        for (const order of insertionOrders(LONG_DAY_KEYS)) {
            const hours: Record<string, string[]> = {};
            for (const day of order) hours[day] = ['10:00-20:00'];
            const block = formatBusinessInfoPrompt({ hours });
            expect(block).not.toBeNull();
            const positions = labelPositions(block!, LABELS);
            expect(positions).toHaveLength(7);
            expectAscending(positions);
        }
    });

    it('keeps relative order for every partial week (each day-pair, both insertion orders)', () => {
        for (let a = 0; a < SHORT_DAY_KEYS.length; a++) {
            for (let b = 0; b < SHORT_DAY_KEYS.length; b++) {
                if (a === b) continue;
                const block = formatBusinessInfoPrompt({
                    hours: {
                        [SHORT_DAY_KEYS[a]]: ['09:00-12:00'],
                        [SHORT_DAY_KEYS[b]]: ['13:00-17:00'],
                    },
                });
                expect(block).not.toBeNull();
                const first = LABELS[Math.min(a, b)];
                const second = LABELS[Math.max(a, b)];
                expect(block!.indexOf(first)).toBeGreaterThan(-1);
                expect(block!.indexOf(first)).toBeLessThan(block!.indexOf(second));
            }
        }
    });

    it('survives the merchant-typed pipeline end to end: raw strings → canonicalize → sat→fri block', () => {
        // Real-world merchant vocabulary: Arabic-Indic digits, meridiem forms,
        // closed variants, 24/7 — typed in a hostile insertion order.
        const raw: Record<string, string> = {
            fri: 'مغلق',
            tue: '٩:٣٠ ص - ٦ م',
            sun: '9am-6pm',
            wed: '24/7',
            sat: '10 - 2',
            thu: '09:00-21:00',
            mon: 'Closed',
        };
        const canonical = canonicalizeHoursWeek(raw);
        expect(canonical.ok).toBe(true);
        if (!canonical.ok) return;
        const block = formatBusinessInfoPrompt({ hours: canonical.value });
        expect(block).not.toBeNull();
        const positions = labelPositions(block!, LABELS);
        expect(positions).toHaveLength(7);
        expectAscending(positions);
        expect(block).toContain('Saturday: 10:00-14:00');
        expect(block).toContain('Tuesday: 09:30-18:00');
        expect(block).toContain('Wednesday: all day');
        expect(block).toContain('Friday: closed');
    });

    it('multi-window days keep their windows on one correctly-placed line', () => {
        const block = formatBusinessInfoPrompt({
            hours: {
                mon: ['09:00-12:00', '16:00-22:00'],
                sat: ['08:00-14:00'],
            },
        });
        expect(block).not.toBeNull();
        expect(block).toContain('Monday: 09:00-12:00 / 16:00-22:00');
        expect(block!.indexOf('Saturday')).toBeLessThan(block!.indexOf('Monday'));
    });
});

describe('stress: dayOrderIndex total order', () => {
    it('is a bijection onto 0..6 for each key form, and forms agree', () => {
        const shortIdx = SHORT_DAY_KEYS.map(dayOrderIndex);
        const longIdx = LONG_DAY_KEYS.map(dayOrderIndex);
        expect(shortIdx).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(longIdx).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('is case- and whitespace-insensitive for all 14 keys', () => {
        for (let i = 0; i < SHORT_DAY_KEYS.length; i++) {
            for (const variant of [
                SHORT_DAY_KEYS[i].toUpperCase(),
                ` ${SHORT_DAY_KEYS[i]} `,
                LONG_DAY_KEYS[i].toUpperCase(),
                LONG_DAY_KEYS[i].charAt(0).toUpperCase() + LONG_DAY_KEYS[i].slice(1),
            ]) {
                expect(dayOrderIndex(variant)).toBe(i);
            }
        }
    });

    it('sends every junk key after every real day', () => {
        for (const junk of ['funday', 'mondayyy', '', 'm', 'الأحد', 'week', '0']) {
            expect(dayOrderIndex(junk)).toBe(SHORT_DAY_KEYS.length);
        }
    });

    it('sorting any mixed short/long/cased/junk key set yields the sat→fri week with junk last', () => {
        const keys = ['friday', 'MON', 'junk-a', 'sat', 'Thursday', 'sun', 'junk-b', 'wed', 'tue'];
        const sorted = [...keys].sort((a, b) => dayOrderIndex(a) - dayOrderIndex(b));
        expect(sorted.slice(0, 7).map((k) => dayOrderIndex(k))).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(sorted.slice(7)).toEqual(['junk-a', 'junk-b']);
    });
});

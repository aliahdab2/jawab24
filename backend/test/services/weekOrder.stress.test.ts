import { describe, it, expect } from 'vitest';
import { chunkBusinessProfile } from '../../src/services/kb/chunker';
import { formatBusinessHours } from '../../src/services/pages';
import { SHORT_DAY_KEYS } from '@jawab24/shared';

/**
 * Stress suite for the Saturday-first week-order delivery (PR #588) —
 * backend renderers. Deterministic by construction (enumerated permutations).
 *
 * - chunkBusinessProfile: KB hours chunk must list days sat→fri no matter the
 *   insertion order / key form / casing of `business_profile.hours`, keeping
 *   unknown keys at the end instead of dropping them.
 * - formatBusinessHours: Facebook's flat `mon_1_open`-style payload must
 *   render Arabic day lines sat→fri regardless of key order and slot gaps.
 */

const ARABIC_LABELS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;

function rotate<T>(arr: readonly T[], k: number): T[] {
    return [...arr.slice(k), ...arr.slice(0, k)];
}

function insertionOrders<T>(week: readonly T[]): T[][] {
    const orders: T[][] = [];
    for (let k = 0; k < week.length; k++) orders.push(rotate(week, k));
    orders.push([...week].reverse());
    orders.push([week[3], week[0], week[5], week[1], week[6], week[2], week[4]]);
    return orders;
}

function expectAscending(positions: number[]): void {
    for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
}

describe('stress: chunkBusinessProfile hours chunk ordering', () => {
    it('renders سبت→جمعة for every insertion order of a full week', () => {
        for (const order of insertionOrders(SHORT_DAY_KEYS)) {
            const hours: Record<string, string[]> = {};
            for (const day of order) hours[day] = ['09:00-18:00'];
            hours.fri = ['closed'];
            const chunk = chunkBusinessProfile({ hours }).find((c) => c.type === 'hours');
            expect(chunk).toBeDefined();
            const positions = ARABIC_LABELS.map((l) => chunk!.contentOriginal.indexOf(l));
            expect(positions.every((p) => p !== -1)).toBe(true);
            expectAscending(positions);
        }
    });

    it('orders mixed short/long/cased keys correctly and keeps junk keys last', () => {
        const chunk = chunkBusinessProfile({
            hours: {
                'friday': ['closed'],
                'not-a-day': ['08:00-09:00'],
                'MON': ['09:00-18:00'],
                'sat': ['10:00-14:00'],
                'Thursday': ['09:00-21:00'],
            },
        }).find((c) => c.type === 'hours');
        expect(chunk).toBeDefined();
        const lines = chunk!.contentOriginal.split('\n');
        // Long/cased keys have no Arabic label mapping (labels are keyed by
        // lowercase short form) so they render raw — but they must still SORT
        // into their weekday position.
        expect(lines[0]).toContain('السبت');
        expect(lines[1]).toContain('MON');
        expect(lines[2]).toContain('Thursday');
        expect(lines[3]).toContain('friday');
        expect(lines[4]).toContain('not-a-day');
    });

    it('multi-window days survive with windows joined on one line', () => {
        const chunk = chunkBusinessProfile({
            hours: {
                mon: ['09:00-12:00', '16:00-22:00'],
                sat: ['08:00-14:00'],
            },
        }).find((c) => c.type === 'hours');
        expect(chunk).toBeDefined();
        expect(chunk!.contentOriginal.indexOf('السبت')).toBeLessThan(chunk!.contentOriginal.indexOf('الإثنين'));
        expect(chunk!.contentOriginal).toContain('09:00-12:00, 16:00-22:00');
    });
});

describe('stress: formatBusinessHours (Facebook import) ordering', () => {
    /** Build the flat FB payload with per-day slots, in the given key order. */
    function fbPayload(days: readonly string[], slots = 1): Record<string, string> {
        const out: Record<string, string> = {};
        for (const day of days) {
            for (let s = 1; s <= slots; s++) {
                out[`${day}_${s}_open`] = `0${8 + s}:00`;
                out[`${day}_${s}_close`] = `${14 + s}:00`;
            }
        }
        return out;
    }

    it('renders السبت→الجمعة for every insertion order of a full FB week', () => {
        for (const order of insertionOrders(SHORT_DAY_KEYS)) {
            const text = formatBusinessHours(fbPayload(order));
            expect(text).not.toBeNull();
            const positions = ARABIC_LABELS.map((l) => text!.indexOf(l));
            expect(positions.every((p) => p !== -1)).toBe(true);
            expectAscending(positions);
        }
    });

    it('renders multi-slot days in place, and interleaved slot keys do not disturb order', () => {
        // Interleave slot 2 keys of every day BEFORE any slot 1 key.
        const days = [...SHORT_DAY_KEYS].reverse();
        const payload: Record<string, string> = {};
        for (const day of days) {
            payload[`${day}_2_open`] = '16:00';
            payload[`${day}_2_close`] = '22:00';
        }
        for (const day of days) {
            payload[`${day}_1_open`] = '09:00';
            payload[`${day}_1_close`] = '12:00';
        }
        const text = formatBusinessHours(payload);
        expect(text).not.toBeNull();
        const positions = ARABIC_LABELS.map((l) => text!.indexOf(l));
        expect(positions.every((p) => p !== -1)).toBe(true);
        expectAscending(positions);
        expect(text).toContain('09:00 - 12:00, 16:00 - 22:00');
    });

    it('skips days with incomplete slots without disturbing the order of the rest', () => {
        const payload: Record<string, string> = {
            ...fbPayload(['wed', 'sat', 'mon']),
            tue_1_open: '09:00', // no close → dropped
            fri_1_close: '18:00', // no open → dropped
        };
        const text = formatBusinessHours(payload);
        expect(text).not.toBeNull();
        expect(text).not.toContain('الثلاثاء');
        expect(text).not.toContain('الجمعة');
        const positions = ['السبت', 'الإثنين', 'الأربعاء'].map((l) => text!.indexOf(l));
        expect(positions.every((p) => p !== -1)).toBe(true);
        expectAscending(positions);
    });

    it('returns null for empty/undefined payloads', () => {
        expect(formatBusinessHours(undefined)).toBeNull();
        expect(formatBusinessHours({})).toBeNull();
    });
});

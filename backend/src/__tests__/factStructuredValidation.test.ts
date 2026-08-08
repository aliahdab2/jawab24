import { describe, it, expect } from 'vitest';
import { FactEntitySaveSchema, FactRowUpdateSchema } from '../utils/validation';

/** Round-7 structured shadows: the zod boundary is the only guard between the
 *  editor and the jsonb column, so shape violations must die here. */
describe('FactEntitySaveSchema — structured shadow validation', () => {
    const upsert = (structured: unknown) => ({
        upserts: [{
            collectionId: '00000000-0000-4000-8000-000000000001',
            name: 'دورة',
            structured,
        }],
        deletes: [],
    });

    it('accepts weekdays and timeRange shadows keyed by merchant labels', () => {
        const parsed = FactEntitySaveSchema.safeParse(upsert({
            'الأيام': { kind: 'weekdays', days: [0, 2, 6] },
            'الساعة': { kind: 'timeRange', start: '12:00', end: '13:30' },
        }));
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.upserts[0].structured).toEqual({
                'الأيام': { kind: 'weekdays', days: [0, 2, 6] },
                'الساعة': { kind: 'timeRange', start: '12:00', end: '13:30' },
            });
        }
    });

    it('normalizes an EMPTY shadow object to null', () => {
        const parsed = FactEntitySaveSchema.safeParse(upsert({}));
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.upserts[0].structured).toBeNull();
    });

    it('rejects out-of-range days, malformed times and unknown kinds', () => {
        expect(FactEntitySaveSchema.safeParse(upsert({ d: { kind: 'weekdays', days: [7] } })).success).toBe(false);
        expect(FactEntitySaveSchema.safeParse(upsert({ d: { kind: 'weekdays', days: [] } })).success).toBe(false);
        expect(FactEntitySaveSchema.safeParse(upsert({ t: { kind: 'timeRange', start: '25:00', end: '13:00' } })).success).toBe(false);
        expect(FactEntitySaveSchema.safeParse(upsert({ t: { kind: 'timeRange', start: '12-1', end: '13:00' } })).success).toBe(false);
        expect(FactEntitySaveSchema.safeParse(upsert({ x: { kind: 'moon', phase: 'full' } })).success).toBe(false);
    });

    it('caps the shadow map at 12 labels — same ceiling as the attribute list', () => {
        const big = Object.fromEntries(
            Array.from({ length: 13 }, (_, i) => [`field-${i}`, { kind: 'weekdays', days: [0] }]),
        );
        expect(FactEntitySaveSchema.safeParse(upsert(big)).success).toBe(false);
    });
});

/**
 * The row PATCH is built from the SAME sparse field map as the entity save,
 * so it gained the {}→null normalization with PR #673 (review finding M2).
 * Pinned here so a "simplification" of the shared map cannot silently
 * regress the PATCH side while the entity tests stay green.
 */
describe('FactRowUpdateSchema — structured shadow through the shared sparse map', () => {
    it('normalizes an EMPTY shadow object to null, same as the entity save', () => {
        const parsed = FactRowUpdateSchema.safeParse({ structured: {} });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.structured).toBeNull();
    });

    it('absence stays ABSENT — the normalization must never turn "not sent" into a write', () => {
        const parsed = FactRowUpdateSchema.safeParse({ name: 'دورة' });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect('structured' in parsed.data).toBe(false);
    });
});

import { describe, it, expect } from 'vitest';
import { CatalogItemSchema, FactEntitySaveSchema, FactRowUpdateSchema } from '../utils/validation';

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

/**
 * Attribute VALUE length + COUNT — the fact schemas cap at the fact-engine
 * limits, not the catalog's. Regression for the 2026-08-16 merchant bug
 * (الفريق الدمشقي): a 152-char note («محاور الدورة: …») died on the catalog's
 * 100-char value cap with a misleading «check price and dates» toast, and the
 * entity form's 12 fields were silently sliced to the catalog's 6.
 */
describe('Fact attribute caps — value 600 / count 12, catalog untouched', () => {
    const NOTE_152 =
        'محاور الدورة: مفهوم الجودة وإدارة الجودة، رواد الجودة، مفاهيم أساسية ضبط وتأكيد الجودة وإدارة الجودة الشاملة، ادوات الجودة، مقاييس الجودة، تكاليف الجودة';
    const entityWithNote = (value: string) => ({
        upserts: [{
            collectionId: '00000000-0000-4000-8000-000000000001',
            name: 'دورة إدارة الجودة',
            attributes: [{ label: 'ملاحظة', value }],
        }],
        deletes: [],
    });

    it('accepts the exact 152-char note that used to fail (entity save + row PATCH)', () => {
        expect(NOTE_152.length).toBe(152);
        expect(FactEntitySaveSchema.safeParse(entityWithNote(NOTE_152)).success).toBe(true);
        expect(FactRowUpdateSchema.safeParse({ attributes: [{ label: 'ملاحظة', value: NOTE_152 }] }).success).toBe(true);
    });

    it('accepts a value AT the 600 cap and rejects one past it', () => {
        expect(FactEntitySaveSchema.safeParse(entityWithNote('م'.repeat(600))).success).toBe(true);
        expect(FactEntitySaveSchema.safeParse(entityWithNote('م'.repeat(601))).success).toBe(false);
    });

    it('keeps all 12 attributes the entity form can author — no silent slice to 6', () => {
        const attrs = Array.from({ length: 12 }, (_, i) => ({ label: `حقل-${i}`, value: `قيمة-${i}` }));
        const parsed = FactEntitySaveSchema.safeParse({
            upserts: [{
                collectionId: '00000000-0000-4000-8000-000000000001',
                name: 'دورة',
                attributes: attrs,
            }],
            deletes: [],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.upserts[0].attributes).toHaveLength(12);
    });

    it('catalog attrs keep THEIR caps: value 100, count sliced to 6', () => {
        const item = (attributes: unknown) => ({ name: 'منتج', attributes });
        expect(CatalogItemSchema.safeParse(item([{ label: 'ملاحظة', value: 'م'.repeat(100) }])).success).toBe(true);
        expect(CatalogItemSchema.safeParse(item([{ label: 'ملاحظة', value: 'م'.repeat(101) }])).success).toBe(false);
        const seven = Array.from({ length: 7 }, (_, i) => ({ label: `ح-${i}`, value: `ق-${i}` }));
        const parsed = CatalogItemSchema.safeParse(item(seven));
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.attributes).toHaveLength(6);
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { isRowLive } from '@jawab24/shared';
import { testDb, createTestUser, createTestPage } from './setup';
import { factCollectionsService, MAX_COLLECTIONS_PER_PAGE } from '../../src/services/factCollections';
import * as schema from '../../src/db/schema';

/**
 * End-to-end coverage for the fact engine: real tables, real transaction, real
 * render. The unit tests prove the renderer's logic; this proves the whole path
 * a merchant's outlet list actually travels — insert → read → prompt block —
 * and that a write bumps the reply caches (without which a confirmed list would
 * keep serving the pre-confirmation wording for up to 30 days).
 *
 * The fixture is BAMBO-shaped on purpose: a keyed directory whose rows carry no
 * price, plus a district that the customer will ask about and that is NOT in the
 * list — the exact production shape that fired on 28% of that page's replies.
 */
const OUTLETS = [
    { name: 'صيدلية النرجس المركزية', attributes: [{ label: 'المدينة', value: 'حي الرمال' }] },
    { name: 'صيدلية الياقوتة', attributes: [{ label: 'المدينة', value: 'حي الرمال' }] },
    { name: 'صيدلية الفيروز', attributes: [{ label: 'المدينة', value: 'تلة الريح' }] },
    { name: 'صيدلية نبع الدالية', attributes: [{ label: 'المدينة', value: 'عين الدالية' }] },
];

describe('fact collections — the engine end to end', () => {
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'Distributor', knowledgeBase: 'وكيل حصري' });
        pageId = page.id;
    });

    it('creates a keyed collection and renders it with the derived coverage line', async () => {
        await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات التي تتوفر فيها منتجاتنا',
            keyAttr: 'المدينة',
            rows: OUTLETS,
        });

        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block;
        expect(block).toBeDefined();
        // the list itself
        expect(block).toContain('صيدلية النرجس المركزية');
        // the boundary — every district, deduplicated
        expect(block).toContain('حي الرمال');
        expect(block).toContain('تلة الريح');
        expect(block).toContain('عين الدالية');
        // and the honest absence directive, because nobody has confirmed completeness
        expect(block).toContain('غير مسجّل لدينا');
        expect(block).not.toContain('كاملة ونهائية');
        // no money wording on a collection that prices nothing
        expect(block).not.toContain('price on request');
    });

    it('an import may NEVER claim completeness — it starts unconfirmed', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        expect(c.isComplete).toBeNull();
        expect(c.completenessConfirmedAt).toBeNull();
        expect(c.source).toBe('kb_extract');
    });

    // The single merchant action that upgrades the wording customers hear.
    it('merchant confirmation unlocks the confident negative', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });

        await factCollectionsService.setCompleteness(pageId, c.id, true);

        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block;
        expect(block).toContain('كاملة ونهائية');
        expect(block).toContain('غير متوفر لدينا');
    });

    it('"my list is partial" is a real answer that pins the honest wording', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });

        await factCollectionsService.setCompleteness(pageId, c.id, false);

        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block;
        expect(block).toContain('غير مسجّل لدينا');
        expect(block).not.toContain('كاملة ونهائية');
    });

    // Without this, confirming a list keeps serving the previous absence wording
    // from the reply cache for up to 30 days.
    it('every write bumps kb_active_version so the reply caches retire', async () => {
        const before = await readKbVersion(pageId);

        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        const afterCreate = await readKbVersion(pageId);
        expect(afterCreate).toBeGreaterThan(before);

        await factCollectionsService.setCompleteness(pageId, c.id, true);
        expect(await readKbVersion(pageId)).toBeGreaterThan(afterCreate);
    });

    it('expired rows leave the prompt while staying in the table for the merchant UI', async () => {
        await factCollectionsService.createCollection(pageId, {
            label: 'العروض', keyAttr: null, rows: [
                { name: 'عرض ساري', endsAt: '2026-12-31' },
                { name: 'عرض منتهي', endsAt: '2026-07-01' },
            ],
        });

        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block;
        expect(block).toContain('عرض ساري');
        expect(block).not.toContain('عرض منتهي');

        // still present in the data — expiry silences a row, it never deletes it
        const [collection] = await factCollectionsService.listCollections(pageId);
        expect(collection.rowCount).toBe(2);
    });

    /**
     * THE LOCKSTEP TEST. `isRowLive` exists in TypeScript (@jawab24/shared, used by
     * the renderer and the merchant editor) and, unavoidably, a second time as a SQL
     * WHERE clause in buildFactCollectionsContext — SQL cannot import a function.
     *
     * Two hand-written expressions of one rule drift. This asserts they agree over
     * the FULL date matrix, so a change to either side fails here until the other
     * follows. Without it the SQL branch added by the start-date ruling is exercised
     * by no test at all, and a divergence is invisible: SQL over-fetching is masked
     * by the renderer's own filter, while SQL under-fetching silently drops rows the
     * merchant can still see in the editor.
     */
    it('isRowLive — SQL and TS agree over the full date matrix', async () => {
        const TODAY = '2026-07-28';
        const DATES = [null, '2026-07-27', TODAY, '2026-07-29'] as const;
        const label = (d: string | null) => (d === null ? 'null' : d);

        // 16 rows: every (startsAt, endsAt) combination, each named after its shape
        // so a failure message says exactly which combination diverged.
        const rows = DATES.flatMap(startsAt =>
            DATES.map(endsAt => ({
                name: `row s=${label(startsAt)} e=${label(endsAt)}`,
                startsAt,
                endsAt,
            })),
        );

        await factCollectionsService.createCollection(pageId, {
            label: 'مصفوفة التواريخ', keyAttr: null, rows,
        });

        // What the QUERY returned (SQL predicate) — the block only ever contains
        // rows the WHERE clause let through.
        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, TODAY)).block ?? '';
        const sqlLive = rows.filter(r => block.includes(r.name)).map(r => r.name).sort();

        // What the SHARED PREDICATE says (TS) — the single source of truth.
        const tsLive = rows.filter(r => isRowLive(r, TODAY)).map(r => r.name).sort();

        expect(sqlLive).toEqual(tsLive);

        // Guard against the assertion passing vacuously (e.g. an empty block, or a
        // predicate that says "everything"): the matrix must genuinely split.
        expect(tsLive.length).toBeGreaterThan(0);
        expect(tsLive.length).toBeLessThan(rows.length);
    });

    it('each collection carries its OWN completeness — they do not leak into each other', async () => {
        const outlets = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        await factCollectionsService.createCollection(pageId, {
            label: 'مناطق التوصيل', keyAttr: 'المدينة', rows: [
                { name: 'توصيل بنغازي', attributes: [{ label: 'المدينة', value: 'بنغازي' }], price: '10.00', currency: 'دينار' },
            ],
        });

        await factCollectionsService.setCompleteness(pageId, outlets.id, true);

        const block = (await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block ?? '';
        // both blocks present
        expect(block).toContain('الصيدليات:');
        expect(block).toContain('مناطق التوصيل:');
        // the confirmed one is confident, the unconfirmed one is not
        expect(block).toContain('كاملة ونهائية');
        expect(block).toContain('غير مسجّل لدينا');
        // and the priced collection shows its price without decimals padding
        expect(block).toContain('10 دينار');
    });

    // M2: two collections sharing a label would emit two contradictory coverage
    // statements for the same list; the DB now refuses it outright.
    it('refuses a second collection with the same label on the same page', async () => {
        await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        await expect(factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'الحي', rows: OUTLETS,
        })).rejects.toThrow();
        expect(await factCollectionsService.listCollections(pageId)).toHaveLength(1);
    });

    // M1: 'source' is a trust label the wording depends on — only merchant
    // authorship may create a collection (D-046 bars Facebook from asserting
    // operational facts).
    it('refuses a collection sourced from Facebook sync', async () => {
        await expect(testDb.insert(schema.factCollections).values({
            pageId, label: 'من فيسبوك', source: 'fb_sync',
        })).rejects.toThrow();
    });

    it('enforces the per-page collection limit', async () => {
        for (let i = 0; i < MAX_COLLECTIONS_PER_PAGE; i++) {
            await factCollectionsService.createCollection(pageId, {
                label: `قائمة ${i}`, keyAttr: null, rows: [{ name: `عنصر ${i}` }],
            });
        }
        await expect(factCollectionsService.createCollection(pageId, {
            label: 'واحدة أخرى', keyAttr: null, rows: [{ name: 'عنصر' }],
        })).rejects.toThrow(/12 collections/);
    });

    it('a page with no collections contributes no block at all', async () => {
        expect((await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block).toBeUndefined();
    });

    // A partially-written collection would render a coverage statement over an
    // incomplete list — asserting a boundary that is wrong, which is worse than
    // having no collection.
    it('creation is atomic — a rejected oversized import leaves nothing behind', async () => {
        const tooMany = Array.from({ length: 501 }, (_, i) => ({ name: `صيدلية ${i}` }));
        await expect(factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: null, rows: tooMany,
        })).rejects.toThrow(/500 rows/);

        expect(await factCollectionsService.listCollections(pageId)).toHaveLength(0);
        expect((await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block).toBeUndefined();
    });

    it('deleting a collection removes its rows and retires the caches', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        const beforeDelete = await readKbVersion(pageId);

        await factCollectionsService.deleteCollection(pageId, c.id);

        expect(await factCollectionsService.getRows(c.id)).toHaveLength(0);
        expect((await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28')).block).toBeUndefined();
        expect(await readKbVersion(pageId)).toBeGreaterThan(beforeDelete);
    });

    // ── Row-level CRUD (G1b list editor) ─────────────────────────────────

    it('addRow appends after existing rows and bumps the reply caches', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        const before = await readKbVersion(pageId);

        const row = await factCollectionsService.addRow(pageId, c.id, {
            name: 'صيدلية الجديدة', attributes: [{ label: 'المدينة', value: 'حي الورود' }],
        });
        expect(row?.sortOrder).toBe(OUTLETS.length);
        expect(await readKbVersion(pageId)).toBeGreaterThan(before);

        const rows = await factCollectionsService.getRows(c.id);
        expect(rows.map(r => r.name)).toContain('صيدلية الجديدة');
    });

    it('updateRow patches only the provided keys and bumps the caches', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'المواعيد', keyAttr: null, rows: [
                { name: 'دورة ICDL', attributes: [{ label: 'الساعة', value: '12-1' }], startsAt: '2026-08-03', endsAt: '2026-08-03' },
            ],
        });
        const [target] = await factCollectionsService.getRows(c.id);
        const before = await readKbVersion(pageId);

        const updated = await factCollectionsService.updateRow(pageId, c.id, target.id, {
            attributes: [{ label: 'الساعة', value: '12-1:30' }],
        });
        expect(updated?.attributes).toEqual([{ label: 'الساعة', value: '12-1:30' }]);
        // untouched fields survive a partial patch
        expect(updated?.startsAt).toBe('2026-08-03');
        expect(updated?.name).toBe('دورة ICDL');
        expect(await readKbVersion(pageId)).toBeGreaterThan(before);
    });

    // The per-field schema cannot see the OTHER date on a partial patch — the
    // service must validate the MERGED row, or a date edit births an
    // instantly-expired row that silently vanishes from the prompt.
    it('updateRow refuses a patch whose merged result has endsAt before startsAt', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'المواعيد', keyAttr: null, rows: [
                { name: 'دورة ICDL', startsAt: '2026-08-03', endsAt: '2026-08-03' },
            ],
        });
        const [target] = await factCollectionsService.getRows(c.id);

        await expect(
            factCollectionsService.updateRow(pageId, c.id, target.id, { startsAt: '2026-09-01' }),
        ).rejects.toThrow(/End date/);

        // the row is untouched after the refusal
        const [still] = await factCollectionsService.getRows(c.id);
        expect(still.startsAt).toBe('2026-08-03');
    });

    it('deleteRow removes a row but refuses the LAST one — an empty collection would silently drop its boundary', async () => {
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'العروض', keyAttr: null, rows: [{ name: 'عرض أ' }, { name: 'عرض ب' }],
        });
        const rows = await factCollectionsService.getRows(c.id);

        expect(await factCollectionsService.deleteRow(pageId, c.id, rows[0].id)).toBeTruthy();
        await expect(
            factCollectionsService.deleteRow(pageId, c.id, rows[1].id),
        ).rejects.toThrow(/last row/);
        expect((await factCollectionsService.getRows(c.id)).length).toBe(1);
    });

    it('row writes from another page bounce off the collection ownership check', async () => {
        const other = await createTestPage((await createTestUser()).id, { name: 'Other' });
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        const [target] = await factCollectionsService.getRows(c.id);

        expect(await factCollectionsService.addRow(other.id, c.id, { name: 'دخيل' })).toBeNull();
        expect(await factCollectionsService.updateRow(other.id, c.id, target.id, { name: 'مخترق' })).toBeNull();
        expect(await factCollectionsService.deleteRow(other.id, c.id, target.id)).toBeNull();

        const rows = await factCollectionsService.getRows(c.id);
        expect(rows.length).toBe(OUTLETS.length);
        expect(rows[0].name).toBe(OUTLETS[0].name);
    });

    it('listCollectionsWithRows returns every collection with its rows in one shape', async () => {
        await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });
        await factCollectionsService.createCollection(pageId, {
            label: 'العروض', keyAttr: null, rows: [{ name: 'عرض أ' }],
        });

        const all = await factCollectionsService.listCollectionsWithRows(pageId);
        expect(all.map(c => [c.label, c.rows.length])).toEqual([
            ['الصيدليات', OUTLETS.length],
            ['العروض', 1],
        ]);
    });

    // Cross-tenant safety: collection ids are opaque, so the page scope is the
    // only thing standing between two merchants' data.
    it('another page cannot confirm or delete this page\'s collection', async () => {
        const other = await createTestPage((await createTestUser()).id, { name: 'Other' });
        const c = await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات', keyAttr: 'المدينة', rows: OUTLETS,
        });

        expect(await factCollectionsService.setCompleteness(other.id, c.id, true)).toBeNull();
        expect(await factCollectionsService.deleteCollection(other.id, c.id)).toBeNull();

        // untouched
        const [still] = await factCollectionsService.listCollections(pageId);
        expect(still.isComplete).toBeNull();
        expect(still.rowCount).toBe(OUTLETS.length);
    });
});

describe('fact collections — atomic entity save (single-form editor)', () => {
    let pageId: string;
    let pricesId: string;
    let slotsId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'Institute', knowledgeBase: 'معهد' });
        pageId = page.id;
        const prices = await factCollectionsService.createCollection(pageId, {
            label: 'أسعار الدورات', keyAttr: null,
            rows: [
                { name: 'دورة الأمين', attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00' },
                { name: 'دورة الريزن', price: '100000.00' },
            ],
        });
        const slots = await factCollectionsService.createCollection(pageId, {
            label: 'مواعيد الدورات', keyAttr: 'الدورة',
            rows: [
                { name: 'دورة الأمين', attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'الأيام', value: 'السبت' }], startsAt: '2027-08-04', endsAt: null },
            ],
        });
        pricesId = prices.id;
        slotsId = slots.id;
    });

    const rowsOf = async (collectionId: string) => factCollectionsService.getRows(collectionId);

    it('applies upserts across TWO collections and a delete in one call, bumping the caches once', async () => {
        const [priceRow] = await rowsOf(pricesId);
        const [slotRow] = await rowsOf(slotsId);
        const before = await readKbVersion(pageId);

        const result = await factCollectionsService.saveEntityRows(pageId, {
            upserts: [
                { collectionId: pricesId, rowId: priceRow.id, name: 'دورة الأمين', attributes: priceRow.attributes, price: '40000.00', currency: 'ل.س قديمة', startsAt: null, endsAt: null },
                { collectionId: slotsId, name: 'دورة الأمين', attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'الأيام', value: 'الخميس' }], price: null, currency: null, startsAt: '2027-09-01', endsAt: null },
            ],
            deletes: [{ collectionId: slotsId, rowId: slotRow.id }],
        });

        expect(result).not.toBeNull();
        expect(result?.upserted).toHaveLength(2);
        expect(result?.deletedIds).toEqual([slotRow.id]);

        const prices = await rowsOf(pricesId);
        expect(prices.find(r => r.id === priceRow.id)?.price).toBe('40000.00');
        const slots = await rowsOf(slotsId);
        expect(slots).toHaveLength(1);
        expect(slots[0].startsAt).toBe('2027-09-01');
        expect(await readKbVersion(pageId)).toBeGreaterThan(before);
    });

    it('persists the structured SHADOW alongside the untouched attribute string, and clears it on a free-text save', async () => {
        const [slotRow] = await rowsOf(slotsId);

        // Structured save: the string is what the editor generated; the shadow
        // rides along in the same upsert.
        await factCollectionsService.saveEntityRows(pageId, {
            upserts: [{
                collectionId: slotsId, rowId: slotRow.id, name: 'دورة الأمين',
                attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'الأيام', value: 'الأحد والثلاثاء' }, { label: 'الساعة', value: '12-1' }],
                structured: {
                    'الأيام': { kind: 'weekdays', days: [0, 2] },
                    'الساعة': { kind: 'timeRange', start: '12:00', end: '13:00' },
                },
                price: null, currency: null, startsAt: '2027-08-04', endsAt: null,
            }],
            deletes: [],
        });

        let [saved] = await rowsOf(slotsId);
        expect(saved.attributes).toEqual(expect.arrayContaining([{ label: 'الأيام', value: 'الأحد والثلاثاء' }]));
        expect(saved.structured).toEqual({
            'الأيام': { kind: 'weekdays', days: [0, 2] },
            'الساعة': { kind: 'timeRange', start: '12:00', end: '13:00' },
        });

        // The editor list read exposes the shadow to the frontend.
        const collections = await factCollectionsService.listCollectionsWithRows(pageId);
        const slotsCollection = collections.find(c => c.id === slotsId);
        expect(slotsCollection?.rows[0]?.structured?.['الأيام']).toEqual({ kind: 'weekdays', days: [0, 2] });

        // Free-text save (escape hatch): the shadow is REPLACED by null —
        // never left stale against a string it no longer describes.
        await factCollectionsService.saveEntityRows(pageId, {
            upserts: [{
                collectionId: slotsId, rowId: slotRow.id, name: 'دورة الأمين',
                attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'الأيام', value: 'حسب التنسيق المسبق' }],
                structured: null,
                price: null, currency: null, startsAt: '2027-08-04', endsAt: null,
            }],
            deletes: [],
        });
        [saved] = await rowsOf(slotsId);
        expect(saved.structured).toBeNull();
    });

    it('is ATOMIC — one stale row id aborts everything, nothing half-saves', async () => {
        const [priceRow] = await rowsOf(pricesId);
        await expect(factCollectionsService.saveEntityRows(pageId, {
            upserts: [
                { collectionId: pricesId, rowId: priceRow.id, name: 'دورة الأمين', attributes: null, price: '99999.00', currency: null, startsAt: null, endsAt: null },
                { collectionId: slotsId, rowId: '00000000-0000-4000-8000-000000000000', name: 'شبح', attributes: null, price: null, currency: null, startsAt: null, endsAt: null },
            ],
            deletes: [],
        })).rejects.toThrow('Row not found');

        const prices = await rowsOf(pricesId);
        expect(prices.find(r => r.id === priceRow.id)?.price).toBe('35000.00');
    });

    it('refuses to EMPTY a collection through the batch (boundary guard) and rolls back', async () => {
        const [slotRow] = await rowsOf(slotsId);
        const before = await readKbVersion(pageId);
        await expect(factCollectionsService.saveEntityRows(pageId, {
            upserts: [],
            deletes: [{ collectionId: slotsId, rowId: slotRow.id }],
        })).rejects.toThrow('Cannot delete the last row');
        expect(await rowsOf(slotsId)).toHaveLength(1);
        expect(await readKbVersion(pageId)).toBe(before);
    });

    it('a delete offset by an insert in the SAME call passes the boundary guard', async () => {
        const [slotRow] = await rowsOf(slotsId);
        const result = await factCollectionsService.saveEntityRows(pageId, {
            upserts: [
                { collectionId: slotsId, name: 'دورة الأمين', attributes: [{ label: 'الدورة', value: 'الأمين' }], price: null, currency: null, startsAt: '2027-10-01', endsAt: null },
            ],
            deletes: [{ collectionId: slotsId, rowId: slotRow.id }],
        });
        expect(result?.upserted).toHaveLength(1);
        expect(await rowsOf(slotsId)).toHaveLength(1);
    });

    it('bounces the whole save when ANY referenced collection belongs to another page', async () => {
        const other = await createTestPage((await createTestUser()).id, { name: 'Other' });
        const foreign = await factCollectionsService.createCollection(other.id, {
            label: 'قائمة أجنبية', keyAttr: null, rows: [{ name: 'صف' }],
        });
        const [priceRow] = await rowsOf(pricesId);
        const result = await factCollectionsService.saveEntityRows(pageId, {
            upserts: [
                { collectionId: pricesId, rowId: priceRow.id, name: 'دورة الأمين', attributes: null, price: '1.00', currency: null, startsAt: null, endsAt: null },
                { collectionId: foreign.id, name: 'تسلل', attributes: null, price: null, currency: null, startsAt: null, endsAt: null },
            ],
            deletes: [],
        });
        expect(result).toBeNull();
        const prices = await rowsOf(pricesId);
        expect(prices.find(r => r.id === priceRow.id)?.price).toBe('35000.00');
    });
});

async function readKbVersion(pageId: string): Promise<number> {
    const [row] = await testDb
        .select({ v: schema.pages.kbActiveVersion })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .limit(1);
    return row?.v ?? 0;
}

/**
 * L2 row gating, end to end (review finding H3 — the gating path had no
 * service-level test, and finding H1 lived exactly here: the row filter matched
 * any attribute's VALUE without checking the attribute's LABEL).
 */
describe('fact collections — deterministic row gating', () => {
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'Distributor', knowledgeBase: 'وكيل حصري' });
        pageId = page.id;
        await factCollectionsService.createCollection(pageId, {
            label: 'الصيدليات التي تتوفر فيها منتجاتنا',
            keyAttr: 'المدينة',
            rows: OUTLETS,
        });
    });

    it('shows only the matched area, and reports that it gated', async () => {
        const ctx = await factCollectionsService.buildFactCollectionsContext(
            pageId, 'أنا ساكن في تلة الريح، وين نلقى منتجاتكم؟', '2026-07-28');
        expect(ctx.gated).toBe(true);
        expect(ctx.block).toContain('صيدلية الفيروز');
        expect(ctx.block).not.toContain('صيدلية النرجس المركزية');
        // The boundary survives: every covered value is still named.
        expect(ctx.block).toContain('حي الرمال');
    });

    it('withholds EVERY row when nothing matched, keeping the coverage line', async () => {
        const ctx = await factCollectionsService.buildFactCollectionsContext(
            pageId, 'سوق الثلاثاء فيه صيدليات تبيع منتجاتكم؟', '2026-07-28');
        expect(ctx.gated).toBe(true);
        for (const row of OUTLETS) expect(ctx.block).not.toContain(row.name);
        expect(ctx.block).toContain('عين الدالية');
        expect(ctx.block).toContain('غير مسجّل لدينا');
    });

    // H1: the value must be carried UNDER THE COLLECTION'S KEY. A row whose
    // unrelated attribute happens to hold a matched string must NOT surface — that
    // would attribute an outlet to an area it does not belong to, inside the module
    // whose entire purpose is attribution.
    it('does not surface a row whose NON-KEY attribute merely contains the matched value', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'D2', knowledgeBase: 'وكيل' });
        await factCollectionsService.createCollection(page.id, {
            label: 'الصيدليات',
            keyAttr: 'المدينة',
            rows: [
                { name: 'صيدلية الفيروز', attributes: [{ label: 'المدينة', value: 'تلة الريح' }] },
                // Lives in another city. Its NOTE holds the matched value EXACTLY —
                // that is what makes this test bite: the pre-fix filter did a set
                // lookup on any attribute's value, so an exact-but-wrong-label match
                // (not a substring) was the actual hole.
                { name: 'صيدلية بعيدة', attributes: [
                    { label: 'المدينة', value: 'صبراتة' },
                    { label: 'ملاحظة', value: 'تلة الريح' },
                ] },
            ],
        });
        const ctx = await factCollectionsService.buildFactCollectionsContext(
            page.id, 'أنا في تلة الريح', '2026-07-28');
        expect(ctx.block).toContain('صيدلية الفيروز');
        expect(ctx.block).not.toContain('صيدلية بعيدة');
    });

    it('does not gate when the collection has no key (nothing to match against)', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'D3', knowledgeBase: 'وكيل' });
        await factCollectionsService.createCollection(page.id, {
            label: 'خدماتنا',
            keyAttr: null,
            rows: [{ name: 'توصيل' }, { name: 'تركيب' }],
        });
        const ctx = await factCollectionsService.buildFactCollectionsContext(page.id, 'أي شيء', '2026-07-28');
        expect(ctx.gated).toBe(false);
        expect(ctx.block).toContain('توصيل');
        expect(ctx.block).toContain('تركيب');
    });

    it('does not gate when a row is missing the key — a partial index is not a boundary', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id, { name: 'D4', knowledgeBase: 'وكيل' });
        await factCollectionsService.createCollection(page.id, {
            label: 'الصيدليات',
            keyAttr: 'المدينة',
            rows: [
                { name: 'صيدلية الفيروز', attributes: [{ label: 'المدينة', value: 'تلة الريح' }] },
                { name: 'صيدلية بلا منطقة' },
            ],
        });
        const ctx = await factCollectionsService.buildFactCollectionsContext(
            page.id, 'أنا في تلة الريح', '2026-07-28');
        expect(ctx.gated).toBe(false);
        expect(ctx.block).toContain('صيدلية بلا منطقة');
    });

    // ── SUB-KEY narrowing (2026-08-06) ───────────────────────────────────────
    // Both of today's fixes were measured only by the probe battery and the eval,
    // which sample a RATE and cost money per run. These pin them for free, and the
    // second one is the more important of the two: a false denial loses a real
    // registration, and without a deterministic test, "simplifying" the predicate
    // back to per-collection leaves the whole unit suite green.
    describe('sub-key narrowing', () => {
        /** A cohort list keyed on «الدورة»: انكليزي has levels, ICDL has none at all.
         *  ICDL carries days AND a slot time, so a row can be asserted on its own
         *  detail rather than on its name — «دورة ICDL» alone cannot tell "row shown"
         *  from "row shown with its detail stripped". */
        const COHORTS = [
            { name: 'دورة اللغة الإنكليزية', attributes: [
                { label: 'الدورة', value: 'انكليزي' }, { label: 'المستوى', value: 'مبتدئ' },
                { label: 'الأيام', value: 'السبت والأربعاء' }] },
            { name: 'دورة اللغة الإنكليزية', attributes: [
                { label: 'الدورة', value: 'انكليزي' }, { label: 'المستوى', value: 'متوسط 2' },
                { label: 'الأيام', value: 'الأحد والثلاثاء' }] },
            { name: 'دورة ICDL', attributes: [
                { label: 'الدورة', value: 'ICDL' },
                { label: 'الأيام', value: 'الخميس فقط' }, { label: 'الساعة', value: '2-4' }] },
            { name: 'دورة ICDL', attributes: [
                { label: 'الدورة', value: 'ICDL' },
                { label: 'الأيام', value: 'الاثنين والأربعاء' }, { label: 'الساعة', value: '5-6' }] },
        ];
        /** The PRICE list — where «محادثة» is recorded, and it is recorded NOWHERE
         *  else. That asymmetry is the whole mechanism: the constraint exists because
         *  the merchant priced a level they have not scheduled, so "this level has no
         *  announced cohort" is derivable from their own data with no configuration.
         *  Mirrors the real page, where محادثة is priced at 75k and has no slot.
         *
         *  «متقدم» belongs to a DIFFERENT course (الحلاقة). On the real page the level
         *  vocabulary is shared across unrelated courses exactly like this — مبتدئ /
         *  متقدم / محترف price the barbering and accounting courses, and none of them
         *  is an English level. That is what the co-scoping tests below exercise. */
        const PRICES = [
            { name: 'اللغة الإنكليزية', attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000' },
            { name: 'اللغة الإنكليزية', attributes: [{ label: 'المستوى', value: 'متوسط 2' }], price: '50000' },
            { name: 'اللغة الإنكليزية', attributes: [{ label: 'المستوى', value: 'محادثة' }], price: '75000' },
            { name: 'دورة الحلاقة', attributes: [{ label: 'المستوى', value: 'متقدم' }], price: '50000' },
            { name: 'دورة ICDL', attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '40000' },
        ];
        let cohortPage: string;

        beforeEach(async () => {
            const user = await createTestUser();
            const page = await createTestPage(user.id, { name: 'Institute', knowledgeBase: 'معهد تدريب' });
            cohortPage = page.id;
            await factCollectionsService.createCollection(cohortPage, {
                label: 'أسعار الدورات', keyAttr: null, rows: PRICES,
            });
            await factCollectionsService.createCollection(cohortPage, {
                label: 'مواعيد الدورات المعلنة', keyAttr: 'الدورة', rows: COHORTS,
            });
        });

        // The prod defect (الدمشقي 2026-08-05): the key gate admits «انكليزي», the
        // coverage line asserts انكليزي is covered, and the model relabels a sibling
        // level's row. «محادثة» is a level that no row carries.
        it('withholds every sibling row when the named level has none, keeping the boundary', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورة المحادثة انكليزي؟', '2026-07-28');
            expect(ctx.gated).toBe(true);
            // Nothing borrowable is in front of the model…
            expect(ctx.block).not.toContain('السبت والأربعاء');
            expect(ctx.block).not.toContain('الأحد والثلاثاء');
            // …and the list's boundary still renders.
            expect(ctx.block).toContain('انكليزي');
            expect(ctx.block).toContain('غير مسجّل لدينا');
        });

        // THE FALSE-DENIAL REGRESSION PIN. ICDL carries no «المستوى» at all, so a
        // per-COLLECTION test ("does this list use that label?" — true, because the
        // English rows do) filtered every ICDL row out and denied a real cohort:
        // measured 0/6 vs 8/8 on probe C7. A row the constraint cannot judge is kept.
        //
        // The constraint here is genuinely IN SCOPE for ICDL — «مبتدئ» is a priced
        // ICDL level — so co-scoping cannot mask a regression in the per-row rule.
        // Asserted on the rows' own detail, not on «دورة ICDL», which the row NAME
        // would satisfy even if every attribute were stripped.
        it('keeps rows that do not carry the constrained label at all', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورة ICDL؟ أنا مبتدئ تماماً', '2026-07-28');
            expect(ctx.block).toContain('الخميس فقط');
            expect(ctx.block).toContain('الاثنين والأربعاء');
        });

        // ── CO-SCOPING (2026-08-06, external review) ─────────────────────────
        // The constraint vocabulary was page-global, so ANY list's values applied to
        // EVERY list. «متقدم» is a level of the barbering price list and of nothing
        // English — measured on the shipped الدمشقي fixture, this took all nine live
        // انكليزي cohorts to zero and told the customer there were no announced
        // dates. Strictly worse than the borrowing being fixed: a false denial loses
        // the registration outright.
        it('does not let another course\'s level withhold this course\'s cohorts', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورات الانكليزي؟ أنا متقدم بالانكليزي', '2026-07-28');
            // «متقدم» was stored on a barbering row, which the «انكليزي» key match
            // does not reach ⇒ no constraint ⇒ both live cohorts stay answerable.
            expect(ctx.block).toContain('السبت والأربعاء');
            expect(ctx.block).toContain('الأحد والثلاثاء');
        });

        // The same guard, from the other direction: co-scoping must not become a
        // blanket "ignore other collections", or S9 stops working. «محادثة» lives
        // ONLY in the price list and must keep constraining the schedules list —
        // that cross-collection asymmetry is the whole mechanism.
        it('still applies a level from another collection when the key match reaches it', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورة المحادثة انكليزي؟', '2026-07-28');
            expect(ctx.block).not.toContain('السبت والأربعاء');
            expect(ctx.block).not.toContain('الأحد والثلاثاء');
        });

        // A letter-free stored value («الساعة» = «2-4») found inside a digit run.
        // The matcher reads the conversation's earlier USER turns, so a phone number
        // typed once withheld every differently-timed cohort for the rest of the
        // thread. The constraint IS in scope for ICDL here — only the token boundary
        // in valueOccursIn prevents the denial.
        it('does not let a phone number match a slot time', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورة ICDL؟ رقمي 0932-4567', '2026-07-28');
            expect(ctx.block).toContain('الخميس فقط');
            expect(ctx.block).toContain('الاثنين والأربعاء');
        });

        it('still narrows on a slot time the customer actually asked about', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'عندكم دورة ICDL الساعة 2-4؟', '2026-07-28');
            expect(ctx.block).toContain('الخميس فقط');
            expect(ctx.block).not.toContain('الاثنين والأربعاء');
        });

        it('narrows to the named level when rows DO carry it', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'أنا مبتدئ بالانكليزي، ايمتا تبدأ الدورات؟', '2026-07-28');
            expect(ctx.block).toContain('السبت والأربعاء');       // the مبتدئ row
            expect(ctx.block).not.toContain('الأحد والثلاثاء');   // the متوسط 2 row
        });

        // THE LIMIT OF THE MECHANISM, pinned so it is not mistaken for coverage it
        // does not have: a value the merchant recorded NOWHERE produces no constraint,
        // so the sibling rows are still shown and only the coverage statement guards
        // the answer. Found by this very test failing before the price list was added.
        // The practical consequence: promoting a level into ANY list (even just a
        // price) is what buys it deterministic protection.
        it('cannot constrain a value the merchant never recorded anywhere', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'ايمتا تبدأ دورة الترجمة الفورية انكليزي؟', '2026-07-28');
            // «الترجمة الفورية» is in no list ⇒ no constraint ⇒ siblings stay visible.
            expect(ctx.block).toContain('السبت والأربعاء');
        });

        it('is inert when the message names only the key', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                cohortPage, 'شو مواعيد دورات انكليزي؟', '2026-07-28');
            expect(ctx.block).toContain('السبت والأربعاء');
            expect(ctx.block).toContain('الأحد والثلاثاء');
        });

        // The measured 28%→0% place mechanism must be untouched: outlet rows carry
        // nothing but the key, so there is no second axis to constrain. A level word
        // in the message may not empty a pharmacy directory.
        it('leaves a key-only list untouched even when the message names another list\'s value', async () => {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                pageId, 'أنا مبتدئ وساكن في تلة الريح، وين نلقى منتجاتكم؟', '2026-07-28');
            expect(ctx.block).toContain('صيدلية الفيروز');
        });
    });

    it('does not gate with no message text (cache-warm / block-only callers)', async () => {
        const ctx = await factCollectionsService.buildFactCollectionsContext(pageId, undefined, '2026-07-28');
        expect(ctx.gated).toBe(false);
        for (const row of OUTLETS) expect(ctx.block).toContain(row.name);
    });

    it('honours FACT_LIST_MODE=list as the rollback lever', async () => {
        const prev = process.env.FACT_LIST_MODE;
        process.env.FACT_LIST_MODE = 'list';
        try {
            const ctx = await factCollectionsService.buildFactCollectionsContext(
                pageId, 'سوق الثلاثاء فيه صيدليات؟', '2026-07-28');
            expect(ctx.gated).toBe(false);
            for (const row of OUTLETS) expect(ctx.block).toContain(row.name);
        } finally {
            if (prev === undefined) delete process.env.FACT_LIST_MODE; else process.env.FACT_LIST_MODE = prev;
        }
    });
});

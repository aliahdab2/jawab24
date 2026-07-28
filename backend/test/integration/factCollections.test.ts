import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
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

import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { catalogService, CatalogLimitError, CatalogStoreConflictError } from '../../src/services/catalog';
import { MAX_CATALOG_ITEMS_PER_PAGE } from '@jawab24/shared';

async function makePage() {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    const page = await createTestPage(user.id, { workspaceId: workspace.id });
    return { user, workspace, page };
}

async function kbActiveVersionOf(pageId: string): Promise<number> {
    const [row] = await testDb
        .select({ v: schema.pages.kbActiveVersion })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId));
    return row.v ?? 0;
}

describe('catalogService — integration', () => {
    it('creates, lists, updates and deletes items', async () => {
        const { user, workspace, page } = await makePage();

        const created = await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'دبل صدمات NJT', price: 3500, currency: 'EGP', description: 'يناسب الصيني والهندي',
        });
        expect(created).not.toBeNull();
        expect(created!.pageUserId).toBe(user.id); // feeds the activation event without a second query
        expect(created!.item.type).toBe('product');
        expect(created!.item.price).toBe('3500.00');
        expect(created!.item.isAvailable).toBe(true);
        expect(created!.item.sortOrder).toBe(0);

        const second = await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'دورة صيانة', type: 'course', price: 1200, currency: 'EGP',
        });
        expect(second!.item.sortOrder).toBe(1); // appended after the first

        const items = await catalogService.listCatalogItems(workspace.id, page.id);
        expect(items).toHaveLength(2);
        expect(items![0].name).toBe('دبل صدمات NJT');

        const updated = await catalogService.updateCatalogItem(workspace.id, page.id, created!.item.id, {
            isAvailable: false, price: null,
        });
        expect(updated!.isAvailable).toBe(false);
        expect(updated!.price).toBeNull(); // "price on request"
        expect(updated!.name).toBe('دبل صدمات NJT'); // untouched fields survive

        const deleted = await catalogService.deleteCatalogItem(workspace.id, page.id, created!.item.id);
        expect(deleted).toBe(true);
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toHaveLength(1);
    });

    it('bumps kbActiveVersion on every write (reply-cache invalidation)', async () => {
        const { workspace, page } = await makePage();
        const v0 = await kbActiveVersionOf(page.id);

        const created = await catalogService.createCatalogItem(workspace.id, page.id, { name: 'منتج' });
        const v1 = await kbActiveVersionOf(page.id);
        expect(v1).toBe(v0 + 1);

        await catalogService.updateCatalogItem(workspace.id, page.id, created!.item.id, { name: 'منتج معدل' });
        const v2 = await kbActiveVersionOf(page.id);
        expect(v2).toBe(v1 + 1);

        await catalogService.deleteCatalogItem(workspace.id, page.id, created!.item.id);
        const v3 = await kbActiveVersionOf(page.id);
        expect(v3).toBe(v2 + 1);
    });

    it('returns null/false for a page in another workspace (no existence leak)', async () => {
        const { page } = await makePage();
        const intruder = await createTestUser();
        const otherWorkspace = await createTestWorkspace(intruder.id);

        expect(await catalogService.listCatalogItems(otherWorkspace.id, page.id)).toBeNull();
        expect(await catalogService.createCatalogItem(otherWorkspace.id, page.id, { name: 'x' })).toBeNull();
        expect(await catalogService.updateCatalogItem(otherWorkspace.id, page.id, crypto.randomUUID(), { name: 'x' })).toBeNull();
        expect(await catalogService.deleteCatalogItem(otherWorkspace.id, page.id, crypto.randomUUID())).toBe(false);
    });

    it('returns null when updating an item that belongs to a different page', async () => {
        const { workspace, page } = await makePage();
        const other = await createTestPage((await createTestUser()).id, { workspaceId: workspace.id });
        const foreign = await catalogService.createCatalogItem(workspace.id, other.id, { name: 'أجنبي' });

        // Right workspace, wrong page for this item id → not found
        expect(await catalogService.updateCatalogItem(workspace.id, page.id, foreign!.item.id, { name: 'x' })).toBeNull();
        expect(await catalogService.deleteCatalogItem(workspace.id, page.id, foreign!.item.id)).toBe(false);
    });

    it('rejects writes on a store-linked page (manual items would orphan its RAG chunks)', async () => {
        const { user, workspace, page } = await makePage();

        // Link the page to a store (dummy encrypted-token fields satisfy NOT NULLs)
        const [store] = await testDb.insert(schema.ecommerceStores).values({
            userId: user.id,
            workspaceId: workspace.id,
            platform: 'salla',
            storeDomain: `store-${Date.now()}.test`,
            accessToken: 'enc-token',
            accessTokenIv: 'iv',
        }).returning({ id: schema.ecommerceStores.id });
        await testDb.update(schema.pages)
            .set({ ecommerceStoreId: store.id })
            .where(eq(schema.pages.id, page.id));

        const vBefore = await kbActiveVersionOf(page.id);
        await expect(
            catalogService.createCatalogItem(workspace.id, page.id, { name: 'ممنوع' }),
        ).rejects.toThrow(CatalogStoreConflictError);
        await expect(
            catalogService.updateCatalogItem(workspace.id, page.id, crypto.randomUUID(), { name: 'x' }),
        ).rejects.toThrow(CatalogStoreConflictError);
        await expect(
            catalogService.deleteCatalogItem(workspace.id, page.id, crypto.randomUUID()),
        ).rejects.toThrow(CatalogStoreConflictError);

        // The guard must fire BEFORE any version bump — a bump would orphan the
        // store page's RAG chunks (exact kb_version filter in pgvector-store).
        expect(await kbActiveVersionOf(page.id)).toBe(vBefore);

        // Reads stay allowed (harmless; lets the merchant see leftover items).
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toEqual([]);
    });

    it(`enforces the ${MAX_CATALOG_ITEMS_PER_PAGE}-item cap at create time`, async () => {
        const { workspace, page } = await makePage();

        // Bulk-seed to the cap directly (the service path would be 300 inserts + 300 cache bumps)
        await testDb.insert(schema.catalogItems).values(
            Array.from({ length: MAX_CATALOG_ITEMS_PER_PAGE }, (_, i) => ({
                pageId: page.id, name: `item-${i}`, sortOrder: i,
            })),
        );

        await expect(
            catalogService.createCatalogItem(workspace.id, page.id, { name: 'واحد زيادة' }),
        ).rejects.toThrow(CatalogLimitError);
    });

    it('batch-creates in one transaction: appended sortOrder, ONE cache bump', async () => {
        const { user, workspace, page } = await makePage();
        // Pre-existing manual item so the batch has an order to continue from.
        await catalogService.createCatalogItem(workspace.id, page.id, { name: 'قائم مسبقًا' });
        const vBefore = await kbActiveVersionOf(page.id);

        const created = await catalogService.createCatalogItemsBatch(workspace.id, page.id, [
            { name: 'دورة ICDL', type: 'course', price: 3500, currency: 'ل.س' },
            { name: 'دورة فوتوشوب', type: 'course', price: 5000, currency: 'ل.س' },
            { name: 'استشارة', type: 'service' },
        ]);

        expect(created).not.toBeNull();
        expect(created!.pageUserId).toBe(user.id);
        expect(created!.items.map(i => i.sortOrder)).toEqual([1, 2, 3]); // continues after the existing 0
        expect(created!.items[0].price).toBe('3500.00');
        expect(created!.items[2].price).toBeNull(); // price on request

        // Exactly ONE bump for the whole batch — not one per row.
        expect(await kbActiveVersionOf(page.id)).toBe(vBefore + 1);
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toHaveLength(4);
    });

    it('batch is all-or-nothing at the cap: a breaching batch inserts ZERO rows', async () => {
        const { workspace, page } = await makePage();
        await testDb.insert(schema.catalogItems).values(
            Array.from({ length: MAX_CATALOG_ITEMS_PER_PAGE - 1 }, (_, i) => ({
                pageId: page.id, name: `item-${i}`, sortOrder: i,
            })),
        );
        const vBefore = await kbActiveVersionOf(page.id);

        // 299 existing + 2 → over the cap → rollback, nothing lands.
        await expect(
            catalogService.createCatalogItemsBatch(workspace.id, page.id, [{ name: 'أ' }, { name: 'ب' }]),
        ).rejects.toThrow(CatalogLimitError);
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toHaveLength(MAX_CATALOG_ITEMS_PER_PAGE - 1);
        expect(await kbActiveVersionOf(page.id)).toBe(vBefore); // failed batch must not bump caches

        // 299 + 1 fits exactly.
        const fits = await catalogService.createCatalogItemsBatch(workspace.id, page.id, [{ name: 'الأخير' }]);
        expect(fits!.items).toHaveLength(1);
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toHaveLength(MAX_CATALOG_ITEMS_PER_PAGE);
    });

    it('batch mirrors the single-write guards: null for foreign workspace, throws on store pages', async () => {
        const { user, workspace, page } = await makePage();
        const otherWorkspace = await createTestWorkspace((await createTestUser()).id);
        expect(await catalogService.createCatalogItemsBatch(otherWorkspace.id, page.id, [{ name: 'x' }])).toBeNull();
        expect(await catalogService.getCatalogCapacity(otherWorkspace.id, page.id)).toBeNull();

        const [store] = await testDb.insert(schema.ecommerceStores).values({
            userId: user.id, workspaceId: workspace.id, platform: 'salla',
            storeDomain: `store-${Date.now()}.test`, accessToken: 'enc-token', accessTokenIv: 'iv',
        }).returning({ id: schema.ecommerceStores.id });
        await testDb.update(schema.pages).set({ ecommerceStoreId: store.id }).where(eq(schema.pages.id, page.id));

        await expect(
            catalogService.createCatalogItemsBatch(workspace.id, page.id, [{ name: 'ممنوع' }]),
        ).rejects.toThrow(CatalogStoreConflictError);
        await expect(
            catalogService.getCatalogCapacity(workspace.id, page.id),
        ).rejects.toThrow(CatalogStoreConflictError);
    });

    it('reports remaining capacity for the extract pre-check', async () => {
        const { user, workspace, page } = await makePage();
        expect(await catalogService.getCatalogCapacity(workspace.id, page.id))
            .toEqual({ remaining: MAX_CATALOG_ITEMS_PER_PAGE, pageUserId: user.id });

        await catalogService.createCatalogItemsBatch(workspace.id, page.id, [{ name: 'أ' }, { name: 'ب' }]);
        expect((await catalogService.getCatalogCapacity(workspace.id, page.id))!.remaining)
            .toBe(MAX_CATALOG_ITEMS_PER_PAGE - 2);
    });

    it('builds the prompt block from stored rows and returns undefined when empty', async () => {
        const { workspace, page } = await makePage();
        expect(await catalogService.buildCatalogPromptBlock(page.id)).toBeUndefined();

        await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'كاوتش ميشلان', price: 220, currency: 'EGP',
        });
        const block = await catalogService.buildCatalogPromptBlock(page.id);
        expect(block).toContain('- كاوتش ميشلان — 220 EGP — in stock');
    });

    it('round-trips dates (as strings) and attributes (jsonb) through create and update', async () => {
        const { workspace, page } = await makePage();

        const created = await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'دورة ميكانيك متقدمة', type: 'course', price: 1800, currency: 'ريال',
            startsAt: '2026-08-10', endsAt: '2026-09-20',
            attributes: [{ label: 'المدة', value: '٦ أسابيع' }, { label: 'المستوى', value: 'متقدم' }],
        });
        expect(created!.item.startsAt).toBe('2026-08-10'); // drizzle date() → string, no tz drift
        expect(created!.item.endsAt).toBe('2026-09-20');
        expect(created!.item.attributes).toEqual([
            { label: 'المدة', value: '٦ أسابيع' }, { label: 'المستوى', value: 'متقدم' },
        ]);

        const updated = await catalogService.updateCatalogItem(workspace.id, page.id, created!.item.id, {
            endsAt: null, attributes: [{ label: 'المدة', value: '٨ أسابيع' }],
        });
        expect(updated!.endsAt).toBeNull();
        expect(updated!.startsAt).toBe('2026-08-10'); // untouched field survives
        expect(updated!.attributes).toEqual([{ label: 'المدة', value: '٨ أسابيع' }]);
    });

    it('excludes expired items from the prompt block but keeps them listed for the merchant', async () => {
        const { workspace, page } = await makePage();
        const past = new Date(); past.setDate(past.getDate() - 10);
        const future = new Date(); future.setDate(future.getDate() + 10);
        const iso = (d: Date) => d.toLocaleDateString('en-CA');

        await catalogService.createCatalogItemsBatch(workspace.id, page.id, [
            { name: 'عرض منتهٍ', price: 199, endsAt: iso(past) },
            { name: 'عرض ساري', price: 299, endsAt: iso(future) },
            { name: 'بلا تاريخ', price: 99 },
        ]);

        const block = await catalogService.buildCatalogPromptBlock(page.id);
        expect(block).not.toContain('عرض منتهٍ'); // the AI can never offer it
        expect(block).toContain('عرض ساري');
        expect(block).toContain(`ends ${iso(future)}`);
        expect(block).toContain('بلا تاريخ');

        // Merchant list still shows all three (badge tells them why).
        const items = await catalogService.listCatalogItems(workspace.id, page.id);
        expect(items).toHaveLength(3);
    });
});

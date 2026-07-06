import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { catalogService, CatalogLimitError } from '../../src/services/catalog';
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
        const { workspace, page } = await makePage();

        const created = await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'دبل صدمات NJT', price: 3500, currency: 'EGP', description: 'يناسب الصيني والهندي',
        });
        expect(created).not.toBeNull();
        expect(created!.type).toBe('product');
        expect(created!.price).toBe('3500.00');
        expect(created!.isAvailable).toBe(true);
        expect(created!.sortOrder).toBe(0);

        const second = await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'دورة صيانة', type: 'course', price: 1200, currency: 'EGP',
        });
        expect(second!.sortOrder).toBe(1); // appended after the first

        const items = await catalogService.listCatalogItems(workspace.id, page.id);
        expect(items).toHaveLength(2);
        expect(items![0].name).toBe('دبل صدمات NJT');

        const updated = await catalogService.updateCatalogItem(workspace.id, page.id, created!.id, {
            isAvailable: false, price: null,
        });
        expect(updated!.isAvailable).toBe(false);
        expect(updated!.price).toBeNull(); // "price on request"
        expect(updated!.name).toBe('دبل صدمات NJT'); // untouched fields survive

        const deleted = await catalogService.deleteCatalogItem(workspace.id, page.id, created!.id);
        expect(deleted).toBe(true);
        expect(await catalogService.listCatalogItems(workspace.id, page.id)).toHaveLength(1);
    });

    it('bumps kbActiveVersion on every write (reply-cache invalidation)', async () => {
        const { workspace, page } = await makePage();
        const v0 = await kbActiveVersionOf(page.id);

        const item = await catalogService.createCatalogItem(workspace.id, page.id, { name: 'منتج' });
        const v1 = await kbActiveVersionOf(page.id);
        expect(v1).toBe(v0 + 1);

        await catalogService.updateCatalogItem(workspace.id, page.id, item!.id, { name: 'منتج معدل' });
        const v2 = await kbActiveVersionOf(page.id);
        expect(v2).toBe(v1 + 1);

        await catalogService.deleteCatalogItem(workspace.id, page.id, item!.id);
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
        expect(await catalogService.updateCatalogItem(workspace.id, page.id, foreign!.id, { name: 'x' })).toBeNull();
        expect(await catalogService.deleteCatalogItem(workspace.id, page.id, foreign!.id)).toBe(false);
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

    it('builds the prompt block from stored rows and returns undefined when empty', async () => {
        const { workspace, page } = await makePage();
        expect(await catalogService.buildCatalogPromptBlock(page.id)).toBeUndefined();

        await catalogService.createCatalogItem(workspace.id, page.id, {
            name: 'كاوتش ميشلان', price: 220, currency: 'EGP',
        });
        const block = await catalogService.buildCatalogPromptBlock(page.id);
        expect(block).toContain('- كاوتش ميشلان — 220 EGP — in stock');
    });
});

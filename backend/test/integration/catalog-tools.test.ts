import { describe, it, expect, beforeEach } from 'vitest';
import { testDb, createTestUser, createTestPage } from './setup';
import { catalogItems } from '../../src/db/schema';
import { executeCatalogToolCall, pageHasCatalogItems } from '../../src/services/catalogTools';

/**
 * Stage 2.3a integration tests — pure handler layer. No ai-worker or LLM
 * involvement yet; these verify that the executor:
 *  - validates inputs
 *  - scopes every read to the supplied pageId
 *  - filters out archived items
 *  - filters out items past endsAt for list_active_entities
 *  - returns the normalized {success, data}/{success, error} envelope
 *  - computes status (active / expiring_soon / expired / archived) correctly
 */
describe('catalogTools — Stage 2.3a executor', () => {
    let pageId: string;
    let otherPageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id);
        pageId = page.id;
        const other = await createTestPage(user.id, { facebookPageId: `other-${Date.now()}` });
        otherPageId = other.id;
    });

    describe('search_entities', () => {
        beforeEach(async () => {
            await testDb.insert(catalogItems).values([
                { pageId, type: 'course', name: 'IELTS Preparation', description: 'Intensive English exam prep', priceMinor: 250000, currency: 'SAR' },
                { pageId, type: 'course', name: 'TOEFL Course', description: 'Test of English as a Foreign Language', priceMinor: 200000, currency: 'SAR' },
                { pageId, type: 'service', name: 'Private tutoring', description: 'One-on-one English lessons', priceMinor: 50000, currency: 'SAR' },
                { pageId, type: 'product', name: 'Archived course', archivedAt: new Date() },
                { pageId: otherPageId, type: 'course', name: 'IELTS at other page' },
            ]);
        });

        it('matches by name (case-insensitive)', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'ielts' },
            });
            expect(res.success).toBe(true);
            const names = (res.data!.results as { name: string }[]).map(r => r.name);
            expect(names).toEqual(['IELTS Preparation']);
        });

        it('matches by description', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'foreign language' },
            });
            expect((res.data!.results as { name: string }[]).map(r => r.name)).toEqual(['TOEFL Course']);
        });

        it('filters by type', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'english', type: 'service' },
            });
            expect((res.data!.results as { name: string }[]).map(r => r.name)).toEqual(['Private tutoring']);
        });

        it('filters by price range (minor units)', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'course', price_max_minor: 220000 },
            });
            expect((res.data!.results as { name: string }[]).map(r => r.name)).toEqual(['TOEFL Course']);
        });

        it('excludes archived items', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'archived' },
            });
            expect((res.data!.results as unknown[])).toHaveLength(0);
        });

        it('does not leak items from another page', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: { query: 'IELTS' },
            });
            const names = (res.data!.results as { name: string }[]).map(r => r.name);
            expect(names).not.toContain('IELTS at other page');
        });

        it('returns error when query is missing', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'search_entities',
                arguments: {},
            });
            expect(res).toEqual({ tool_name: 'search_entities', success: false, error: 'query_required' });
        });
    });

    describe('get_entity_details', () => {
        it('returns full record including metadata for matching id', async () => {
            const [row] = await testDb.insert(catalogItems).values({
                pageId, type: 'course', name: 'X',
                metadata: { level: 'advanced', maxStudents: 20 },
            }).returning();

            const res = await executeCatalogToolCall(pageId, {
                name: 'get_entity_details',
                arguments: { id: row.id },
            });
            expect(res.success).toBe(true);
            const entity = res.data!.entity as { id: string; metadata: Record<string, unknown> };
            expect(entity.id).toBe(row.id);
            expect(entity.metadata).toEqual({ level: 'advanced', maxStudents: 20 });
        });

        it('returns entity_not_found for foreign-page item id', async () => {
            const [row] = await testDb.insert(catalogItems)
                .values({ pageId: otherPageId, type: 'service', name: 'Foreign' })
                .returning();
            const res = await executeCatalogToolCall(pageId, {
                name: 'get_entity_details',
                arguments: { id: row.id },
            });
            expect(res).toEqual({ tool_name: 'get_entity_details', success: false, error: 'entity_not_found' });
        });

        it('returns id_required when arg is missing', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'get_entity_details',
                arguments: {},
            });
            expect(res.error).toBe('id_required');
        });
    });

    describe('list_active_entities', () => {
        beforeEach(async () => {
            const now = new Date();
            const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);  // 3 days → expiring_soon
            const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days → active
            await testDb.insert(catalogItems).values([
                { pageId, type: 'course', name: 'Active future', endsAt: future },
                { pageId, type: 'course', name: 'Expiring soon', endsAt: soon },
                { pageId, type: 'course', name: 'Expired course', endsAt: past },
                { pageId, type: 'service', name: 'Evergreen service' },
                { pageId, type: 'course', name: 'Archived future', endsAt: future, archivedAt: now },
            ]);
        });

        it('returns active + expiring_soon + evergreen; excludes expired and archived', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'list_active_entities',
                arguments: {},
            });
            expect(res.success).toBe(true);
            const results = res.data!.results as { name: string; status: string }[];
            const names = results.map(r => r.name).sort();
            expect(names).toEqual(['Active future', 'Evergreen service', 'Expiring soon']);
        });

        it('computes status correctly', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'list_active_entities',
                arguments: {},
            });
            const results = res.data!.results as { name: string; status: string }[];
            const byName = Object.fromEntries(results.map(r => [r.name, r.status]));
            expect(byName['Active future']).toBe('active');
            expect(byName['Expiring soon']).toBe('expiring_soon');
            expect(byName['Evergreen service']).toBe('active');
        });

        it('filters by type', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'list_active_entities',
                arguments: { type: 'service' },
            });
            const names = (res.data!.results as { name: string }[]).map(r => r.name);
            expect(names).toEqual(['Evergreen service']);
        });

        it('honors limit (clamped to HARD_MAX_LIMIT=25)', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'list_active_entities',
                arguments: { limit: 2 },
            });
            expect((res.data!.results as unknown[]).length).toBeLessThanOrEqual(2);
        });
    });

    describe('dispatcher', () => {
        it('rejects unknown tool names with unknown_tool', async () => {
            const res = await executeCatalogToolCall(pageId, {
                name: 'rm_rf_everything' as never,
                arguments: {},
            });
            expect(res).toEqual({ tool_name: 'rm_rf_everything', success: false, error: 'unknown_tool' });
        });
    });

    describe('pageHasCatalogItems', () => {
        it('returns false for a page with no items', async () => {
            expect(await pageHasCatalogItems(pageId)).toBe(false);
        });

        it('returns true for a page with at least one non-archived item', async () => {
            await testDb.insert(catalogItems).values({ pageId, type: 'service', name: 'X' });
            expect(await pageHasCatalogItems(pageId)).toBe(true);
        });

        it('returns false when only archived items exist (no signal to surface tools)', async () => {
            await testDb.insert(catalogItems).values({ pageId, type: 'service', name: 'X', archivedAt: new Date() });
            expect(await pageHasCatalogItems(pageId)).toBe(false);
        });
    });
});

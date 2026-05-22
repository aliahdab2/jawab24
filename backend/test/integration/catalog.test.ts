import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage } from './setup';
import { catalogItems } from '../../src/db/schema';

/**
 * Stage 2.1 integration tests — data-layer only. No backend API or AI tools
 * yet; these verify the schema, indexes, and the freshness/active filter
 * that list_active_entities() (Stage 2.3) will rely on.
 */
describe('catalog_items — Stage 2.1 schema integration', () => {
    let userId: string;
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const page = await createTestPage(userId, { kbActiveVersion: 1 });
        pageId = page.id;
    });

    describe('CRUD basics', () => {
        it('persists all documented columns on insert', async () => {
            const now = new Date();
            const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
            const [row] = await testDb
                .insert(catalogItems)
                .values({
                    pageId,
                    type: 'course',
                    name: 'IELTS Preparation',
                    description: 'Intensive 12-week IELTS prep course',
                    priceMinor: 250000, // 2500.00 SAR
                    currency: 'SAR',
                    startsAt: now,
                    endsAt: future,
                    enrollmentClosesAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
                    metadata: { level: 'advanced', maxStudents: 20 },
                })
                .returning();

            expect(row.id).toBeDefined();
            expect(row.pageId).toBe(pageId);
            expect(row.type).toBe('course');
            expect(row.name).toBe('IELTS Preparation');
            expect(row.priceMinor).toBe(250000);
            expect(row.currency).toBe('SAR');
            expect(row.metadata).toEqual({ level: 'advanced', maxStudents: 20 });
            expect(row.sourceTier).toBe(2); // default
            expect(row.archivedAt).toBeNull();
        });

        it('defaults source_tier to 2 (manually entered structured catalog)', async () => {
            const [row] = await testDb
                .insert(catalogItems)
                .values({ pageId, type: 'service', name: 'Haircut' })
                .returning();
            expect(row.sourceTier).toBe(2);
        });

        it('allows null price for "contact us" items', async () => {
            const [row] = await testDb
                .insert(catalogItems)
                .values({ pageId, type: 'service', name: 'Custom consulting' })
                .returning();
            expect(row.priceMinor).toBeNull();
            expect(row.currency).toBeNull();
        });

        it('cascade-deletes catalog_items when parent page is deleted', async () => {
            await testDb
                .insert(catalogItems)
                .values({ pageId, type: 'course', name: 'Course to be orphaned' });

            await testDb.execute(sql`DELETE FROM pages WHERE id = ${pageId}`);

            const remaining = await testDb
                .select()
                .from(catalogItems)
                .where(eq(catalogItems.pageId, pageId));
            expect(remaining).toHaveLength(0);
        });
    });

    describe('active-items filter (basis for list_active_entities)', () => {
        beforeEach(async () => {
            const now = new Date();
            const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
            const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7d

            await testDb.insert(catalogItems).values([
                { pageId, type: 'course', name: 'Active future course', endsAt: future },
                { pageId, type: 'course', name: 'Expired course', endsAt: past },
                { pageId, type: 'service', name: 'Evergreen service' /* no endsAt */ },
                { pageId, type: 'course', name: 'Archived item', endsAt: future, archivedAt: now },
            ]);
        });

        it('returns active (future endsAt) + evergreen (null endsAt), excludes expired and archived', async () => {
            const active = await testDb
                .select()
                .from(catalogItems)
                .where(
                    and(
                        eq(catalogItems.pageId, pageId),
                        isNull(catalogItems.archivedAt),
                        or(isNull(catalogItems.endsAt), gt(catalogItems.endsAt, sql`NOW()`)),
                    ),
                );

            const names = active.map(r => r.name).sort();
            expect(names).toEqual(['Active future course', 'Evergreen service']);
        });

        it('expired items remain queryable for admin reference (not deleted)', async () => {
            const allForPage = await testDb
                .select()
                .from(catalogItems)
                .where(eq(catalogItems.pageId, pageId));
            expect(allForPage).toHaveLength(4);
        });
    });

    describe('type-driven filtering (basis for search_entities type param)', () => {
        it('filters by type per page', async () => {
            await testDb.insert(catalogItems).values([
                { pageId, type: 'course', name: 'C1' },
                { pageId, type: 'course', name: 'C2' },
                { pageId, type: 'service', name: 'S1' },
                { pageId, type: 'product', name: 'P1' },
            ]);

            const courses = await testDb
                .select()
                .from(catalogItems)
                .where(and(eq(catalogItems.pageId, pageId), eq(catalogItems.type, 'course')));

            expect(courses).toHaveLength(2);
            expect(courses.map(r => r.name).sort()).toEqual(['C1', 'C2']);
        });
    });
});

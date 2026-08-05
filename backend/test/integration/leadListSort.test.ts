/**
 * Integration test: the ORDER the leads list returns rows in (real Postgres).
 *
 * Why this needs a real DB: the thing under test is an ORDER BY clause feeding
 * OFFSET pagination. A mocked `db` hands back whatever array the test wrote and
 * proves nothing about the SQL, and the pagination bug this guards (ties in
 * `created_at` reordering between the page-1 and page-2 queries) only exists
 * inside Postgres' sort.
 *
 * Origin (2026-08-05): the list was hardcoded to `created_at DESC`, which
 * structurally buries a neglected lead — every new capture pushes an untouched
 * one further down. A production audit found 14 of 17 pages with leads had never
 * worked a single one, the oldest untouched lead being 97 days old. Merchants can
 * now flip the queue to oldest-first; the tiebreaker was added in the same change
 * because extending offset pagination without a deterministic second sort key
 * lets a lead appear twice, or never, in the scrolled list.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    createTestUser,
    createTestWorkspace,
    createTestPage,
    testDb,
} from './setup';
import * as schema from '../../src/db/schema';
import { leadExtractorService } from '../../src/services/leadExtractor';

const at = (iso: string) => new Date(iso);

let pageId: string;

/** Insert a lead with an explicit created_at so ordering is deterministic. */
async function seedLead(name: string, createdAt: Date, overrides: Partial<typeof schema.leads.$inferInsert> = {}) {
    const [lead] = await testDb
        .insert(schema.leads)
        .values({
            pageId,
            senderId: `sender-${name}`,
            senderName: name,
            phone: `+96395100${name.length}${Math.floor(Math.random() * 1000)}`,
            createdAt,
            updatedAt: createdAt,
            ...overrides,
        })
        .returning();
    return lead;
}

const names = (rows: { senderName: string | null }[]) => rows.map((r) => r.senderName);

beforeEach(async () => {
    const user = await createTestUser();
    await createTestWorkspace(user.id);
    const page = await createTestPage(user.id);
    pageId = page.id;
});

describe('getLeadsByPage — sort order', () => {
    beforeEach(async () => {
        await seedLead('oldest', at('2026-05-01T10:00:00Z'));
        await seedLead('middle', at('2026-06-01T10:00:00Z'));
        await seedLead('newest', at('2026-07-01T10:00:00Z'));
    });

    it('defaults to newest-first when no sort is passed (unchanged behaviour)', async () => {
        const { data } = await leadExtractorService.getLeadsByPage(pageId, {});
        expect(names(data)).toEqual(['newest', 'middle', 'oldest']);
    });

    it("returns newest-first for sort: 'newest'", async () => {
        const { data } = await leadExtractorService.getLeadsByPage(pageId, { sort: 'newest' });
        expect(names(data)).toEqual(['newest', 'middle', 'oldest']);
    });

    it("returns oldest-first for sort: 'oldest' — the triage view", async () => {
        const { data } = await leadExtractorService.getLeadsByPage(pageId, { sort: 'oldest' });
        expect(names(data)).toEqual(['oldest', 'middle', 'newest']);
    });

    it('reports the same total regardless of order', async () => {
        const newest = await leadExtractorService.getLeadsByPage(pageId, { sort: 'newest' });
        const oldest = await leadExtractorService.getLeadsByPage(pageId, { sort: 'oldest' });
        expect(newest.total).toBe(3);
        expect(oldest.total).toBe(newest.total);
    });

    it('applies the status filter within the chosen order', async () => {
        await seedLead('worked', at('2026-05-15T10:00:00Z'), { status: 'contacted' });
        const { data } = await leadExtractorService.getLeadsByPage(pageId, { sort: 'oldest', status: 'new' });
        expect(names(data)).toEqual(['oldest', 'middle', 'newest']);
    });
});

describe('getLeadsByPage — pagination stability with tied created_at', () => {
    // A burst of comments on one post captures several leads in the same instant.
    // Equal sort keys leave the row order up to the executor, so without a
    // tiebreaker a paginated walk can repeat or skip rows.
    const TIE = at('2026-06-15T12:00:00Z');

    beforeEach(async () => {
        for (let i = 0; i < 10; i++) {
            await seedLead(`tied-${String(i).padStart(2, '0')}`, TIE);
        }
    });

    it.each(['newest', 'oldest'] as const)('walks every tied lead exactly once (%s)', async (sort) => {
        const collected: (string | null)[] = [];
        for (let offset = 0; offset < 10; offset += 3) {
            const { data } = await leadExtractorService.getLeadsByPage(pageId, { sort, limit: 3, offset });
            collected.push(...names(data));
        }

        expect(collected).toHaveLength(10);
        expect(new Set(collected).size).toBe(10);
    });

    it('is repeatable — the same page returns the same rows across calls', async () => {
        const first = await leadExtractorService.getLeadsByPage(pageId, { sort: 'oldest', limit: 4, offset: 4 });
        const second = await leadExtractorService.getLeadsByPage(pageId, { sort: 'oldest', limit: 4, offset: 4 });
        expect(names(first.data)).toEqual(names(second.data));
    });
});

/**
 * Integration test: the workspace-wide waiting-leads summary (real Postgres).
 *
 * Two things a mocked `db` cannot check:
 *   1. `oldestAt` really is MIN(created_at) over the workspace's waiting leads —
 *      the dashboard row shows it as the queue's urgency, and showing the newest
 *      arrival instead reads "5 minutes ago" over a ten-day backlog.
 *   2. It comes back as a real `Date`. Aggregates like `min()` bypass drizzle's
 *      timestamp parser and hand back a string, which has already caused a
 *      TEXT-not-Date bug in this repo (the 0.45 upgrade). If that regressed the
 *      value would serialize wrong and the row would render nothing.
 *
 * Also pins the scoping the badge depends on: `new` only, this workspace only.
 */
import { describe, it, expect } from 'vitest';

import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { leadExtractorService } from '../../src/services/leadExtractor';

let seq = 0;
async function insertLead(
    pageId: string,
    overrides: Partial<typeof schema.leads.$inferInsert> = {},
) {
    seq += 1;
    const [lead] = await testDb.insert(schema.leads).values({
        pageId,
        senderId: `sender-${seq}-${Math.random().toString(36).slice(2, 8)}`,
        senderName: `Customer ${seq}`,
        phone: `+96355511${String(seq).padStart(4, '0')}`,
        status: 'new',
        ...overrides,
    }).returning();
    return lead;
}

async function seedWorkspace() {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    const page = await createTestPage(user.id, { workspaceId: workspace.id });
    return { user, workspace, page };
}

describe('getNewLeadsSummaryForWorkspace (real Postgres)', () => {
    it('returns MIN(created_at) as oldestAt and the newest lead as latest*', async () => {
        const { workspace, page } = await seedWorkspace();
        const oldest = new Date('2026-07-25T09:21:00.000Z');
        const middle = new Date('2026-07-30T13:22:00.000Z');
        const newest = new Date('2026-08-04T14:50:00.000Z');

        await insertLead(page.id, { createdAt: middle, senderName: 'Middle' });
        await insertLead(page.id, { createdAt: oldest, senderName: 'Oldest' });
        await insertLead(page.id, { createdAt: newest, senderName: 'Newest' });

        const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

        expect(summary.count).toBe(3);
        // A real Date, not the string an aggregate hands back unparsed.
        expect(summary.oldestAt).toBeInstanceOf(Date);
        expect(summary.oldestAt?.toISOString()).toBe(oldest.toISOString());
        expect(summary.latestAt?.toISOString()).toBe(newest.toISOString());
        expect(summary.latestName).toBe('Newest');
    });

    it('ignores leads the merchant already worked', async () => {
        const { workspace, page } = await seedWorkspace();
        const stillWaiting = new Date('2026-08-01T10:00:00.000Z');

        // Older, but contacted — must not become `oldestAt`.
        await insertLead(page.id, { createdAt: new Date('2026-07-01T10:00:00.000Z'), status: 'contacted' });
        await insertLead(page.id, { createdAt: new Date('2026-07-02T10:00:00.000Z'), status: 'converted' });
        await insertLead(page.id, { createdAt: stillWaiting, status: 'new' });

        const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

        expect(summary.count).toBe(1);
        expect(summary.oldestAt?.toISOString()).toBe(stillWaiting.toISOString());
    });

    it('never counts another workspace\'s leads', async () => {
        const mine = await seedWorkspace();
        const theirs = await seedWorkspace();
        await insertLead(mine.page.id, { senderName: 'Mine' });
        await insertLead(theirs.page.id, { senderName: 'Theirs' });
        await insertLead(theirs.page.id, { senderName: 'Theirs 2' });

        const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(mine.workspace.id);

        expect(summary.count).toBe(1);
        expect(summary.latestName).toBe('Mine');
    });

    it('returns an empty summary — not a crash — when nothing is waiting', async () => {
        const { workspace } = await seedWorkspace();

        const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

        expect(summary).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null });
    });
});

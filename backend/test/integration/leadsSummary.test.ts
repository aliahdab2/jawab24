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

        expect(summary).toEqual({ count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] });
    });

    /**
     * The nav badge counts the whole workspace; the leads list shows ONE page.
     * `byPage` is what stops the badge's deep link from opening a page that
     * holds none of the leads it counted — an empty list under a badge of 9.
     */
    describe('byPage', () => {
        it('splits the queue per page, longest-waiting page first', async () => {
            const user = await createTestUser();
            const workspace = await createTestWorkspace(user.id);
            const busy = await createTestPage(user.id, { workspaceId: workspace.id });
            const patient = await createTestPage(user.id, { workspaceId: workspace.id });

            // `busy` has more leads, `patient` has the one that has waited longest.
            await insertLead(busy.id, { createdAt: new Date('2026-08-10T09:00:00.000Z') });
            await insertLead(busy.id, { createdAt: new Date('2026-08-11T09:00:00.000Z') });
            await insertLead(busy.id, { createdAt: new Date('2026-08-12T09:00:00.000Z') });
            await insertLead(patient.id, { createdAt: new Date('2026-08-02T09:00:00.000Z') });

            const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

            // Urgency decides the order, not volume — the same stance the
            // attention row takes by showing oldestAt rather than latestAt.
            expect(summary.byPage.map((p) => p.pageId)).toEqual([patient.id, busy.id]);
            expect(summary.byPage.map((p) => p.count)).toEqual([1, 3]);
            expect(summary.byPage[0].oldestAt).toBeInstanceOf(Date);
            expect(summary.byPage[0].oldestAt?.toISOString()).toBe('2026-08-02T09:00:00.000Z');
        });

        it('agrees with the totals it is derived from', async () => {
            const user = await createTestUser();
            const workspace = await createTestWorkspace(user.id);
            const first = await createTestPage(user.id, { workspaceId: workspace.id });
            const second = await createTestPage(user.id, { workspaceId: workspace.id });
            await insertLead(first.id, { createdAt: new Date('2026-08-06T09:00:00.000Z') });
            await insertLead(second.id, { createdAt: new Date('2026-08-03T09:00:00.000Z') });
            await insertLead(second.id, { createdAt: new Date('2026-08-07T09:00:00.000Z') });

            const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

            // A badge whose number cannot be found in the breakdown is exactly
            // the mismatch this endpoint exists to close.
            expect(summary.count).toBe(3);
            expect(summary.byPage.reduce((sum, p) => sum + p.count, 0)).toBe(summary.count);
            expect(summary.oldestAt?.toISOString()).toBe(summary.byPage[0].oldestAt?.toISOString());
        });

        it('omits pages with nothing waiting, and other workspaces entirely', async () => {
            const user = await createTestUser();
            const workspace = await createTestWorkspace(user.id);
            const waiting = await createTestPage(user.id, { workspaceId: workspace.id });
            const worked = await createTestPage(user.id, { workspaceId: workspace.id });
            const theirs = await seedWorkspace();

            await insertLead(waiting.id);
            await insertLead(worked.id, { status: 'contacted' });
            await insertLead(theirs.page.id);

            const summary = await leadExtractorService.getNewLeadsSummaryForWorkspace(workspace.id);

            // A page listed with 0 would put an empty landing page back on the
            // table; a foreign page would leak another workspace's queue.
            expect(summary.byPage.map((p) => p.pageId)).toEqual([waiting.id]);
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import { posts } from '../../src/db/schema';
import { postsService, SCHEDULED_MARKER_GRACE_MS } from '../../src/services/posts';
import { PostNotOwnedError } from '../../src/services/postErrors';
import { facebookService } from '../../src/services/facebook';
import { notificationService } from '../../src/services/notifications';

/**
 * Real-Postgres coverage for the scheduled-post arming marker and the cross-tenant
 * post-lookup guard.
 *
 * These two behaviours cannot be proven by the unit tests: one depends on Postgres
 * actually raising SQLSTATE 23505 on the `posts.facebook_post_id` unique index (the unit
 * test asserts against an error object the test itself constructed), and the other on the
 * `scheduled_publish_time < cutoff` predicate really selecting the rows we think it does.
 * Both are on the per-comment reply path or the publish webhook, so "the mock agreed with
 * me" is not good enough.
 */

/** A `posts` row, read back straight from the database. */
async function readPost(id: string) {
    const [row] = await testDb.select().from(posts).where(eq(posts.id, id));
    return row;
}

async function insertPost(values: Partial<typeof posts.$inferInsert> & { facebookPostId: string }) {
    const [row] = await testDb.insert(posts).values({
        autoReplyEnabled: true,
        ...values,
    } as typeof posts.$inferInsert).returning();
    return row;
}

describe('posts — scheduled arming marker (real Postgres)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // No Graph in an integration run: every schedule read is stubbed per test.
        vi.spyOn(facebookService, 'getPostSchedule').mockResolvedValue(null);
        vi.spyOn(facebookService, 'getPostContent').mockResolvedValue(null);
        vi.spyOn(notificationService, 'sendTemplateNotificationToWorkspace').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('findOrCreateFromWebhook — the unique index is real', () => {
        it('adopts a row whose page_id is NULL instead of throwing on the comment path', async () => {
            // The Critical case. posts.page_id is nullable, so a legacy/manual row can
            // belong to nobody. Rejecting it would make this function throw for every
            // comment on that post, forever — and the comment is dropped before it is
            // ever stored. The 23505 here is raised by Postgres, not by a mock.
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const orphan = await insertPost({ facebookPostId: 'fb_orphan_1', pageId: null, message: 'legacy row' });

            const result = await postsService.findOrCreateFromWebhook(page.id, 'fb_orphan_1');

            expect(result.id).toBe(orphan.id);
            expect(result.pageId).toBe(page.id);
            // Adopted in place — no duplicate row was created for the same post id.
            const all = await testDb.select().from(posts).where(eq(posts.facebookPostId, 'fb_orphan_1'));
            expect(all).toHaveLength(1);
            // And nothing is left unowned.
            const unowned = await testDb.select().from(posts).where(isNull(posts.pageId));
            expect(unowned).toHaveLength(0);
        });

        it('throws PostNotOwnedError for a row owned by ANOTHER page, and leaves it untouched', async () => {
            const ownerUser = await createTestUser();
            const ownerWs = await createTestWorkspace(ownerUser.id);
            const ownerPage = await createTestPage(ownerUser.id, { workspaceId: ownerWs.id });
            const theirs = await insertPost({ facebookPostId: 'fb_theirs_1', pageId: ownerPage.id, triggerReply: 'their secret reply' });

            const attackerUser = await createTestUser();
            const attackerWs = await createTestWorkspace(attackerUser.id);
            const attackerPage = await createTestPage(attackerUser.id, { workspaceId: attackerWs.id });

            await expect(postsService.findOrCreateFromWebhook(attackerPage.id, 'fb_theirs_1'))
                .rejects.toBeInstanceOf(PostNotOwnedError);

            // The victim's row still belongs to the victim — no page_id was rewritten.
            const after = await readPost(theirs.id);
            expect(after.pageId).toBe(ownerPage.id);
            expect(after.triggerReply).toBe('their secret reply');
        });

        it('returns the caller\'s own row when it already exists (no 23505 path at all)', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const mine = await insertPost({ facebookPostId: 'fb_mine_1', pageId: page.id, message: 'mine' });

            const result = await postsService.findOrCreateFromWebhook(page.id, 'fb_mine_1');

            expect(result.id).toBe(mine.id);
        });
    });

    describe('onPostPublished — the grace-window predicate is real', () => {
        /** Marker `offsetMs` behind now: negative = still in the future. */
        function markerAt(offsetMs: number) {
            return new Date(Date.now() - offsetMs);
        }

        it('clears the marker for the post that just went live', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const armed = await insertPost({
                facebookPostId: 'fb_sched_1',
                pageId: page.id,
                triggerReply: 'شكراً',
                scheduledPublishTime: markerAt(60_000),
            });

            const result = await postsService.onPostPublished(page.id, 'fb_sched_1', { accessToken: 'tok', workspaceId: ws.id });

            expect(result.cleared).toBe(true);
            expect(await readPost(armed.id)).toMatchObject({ scheduledPublishTime: null });
            expect(result.orphanedPostIds).toEqual([]);
        });

        it('leaves another page\'s armed marker alone (the clear is page-scoped)', async () => {
            const a = await createTestUser();
            const wsA = await createTestWorkspace(a.id);
            const pageA = await createTestPage(a.id, { workspaceId: wsA.id });
            const b = await createTestUser();
            const wsB = await createTestWorkspace(b.id);
            const pageB = await createTestPage(b.id, { workspaceId: wsB.id });

            const marker = markerAt(SCHEDULED_MARKER_GRACE_MS + 600_000);
            const theirs = await insertPost({
                facebookPostId: 'fb_other_page', pageId: pageB.id, triggerReply: 'r', scheduledPublishTime: marker,
            });

            const result = await postsService.onPostPublished(pageA.id, 'fb_a_published', { accessToken: 'tok', workspaceId: wsA.id });

            // Not cleared, not healed, not reported — it is not this page's business.
            expect(result).toMatchObject({ cleared: false, orphanedPostIds: [], healedPostIds: [] });
            expect((await readPost(theirs.id)).scheduledPublishTime).not.toBeNull();
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
        });

        it('does NOT consider a marker still inside the grace window', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            await insertPost({
                facebookPostId: 'fb_recent',
                pageId: page.id,
                triggerReply: 'r',
                // Half a grace window past its time: the normal publish→webhook race.
                scheduledPublishTime: markerAt(SCHEDULED_MARKER_GRACE_MS / 2),
            });

            const result = await postsService.onPostPublished(page.id, 'fb_something_else', { accessToken: 'tok', workspaceId: ws.id });

            expect(result.orphanedPostIds).toEqual([]);
            expect(result.healedPostIds).toEqual([]);
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
        });

        it('heals an overdue marker when Graph says the post is already published', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const stranded = await insertPost({
                facebookPostId: 'fb_stranded',
                pageId: page.id,
                triggerReply: 'r',
                scheduledPublishTime: markerAt(SCHEDULED_MARKER_GRACE_MS + 3_600_000),
            });
            vi.spyOn(facebookService, 'getPostSchedule').mockResolvedValue({ isPublished: true, scheduledPublishTime: null });

            const result = await postsService.onPostPublished(page.id, 'fb_fresh', { accessToken: 'tok', workspaceId: ws.id });

            expect(result.healedPostIds).toEqual(['fb_stranded']);
            expect(result.orphanedPostIds).toEqual([]);
            // Actually written back — otherwise the next publish re-alarms forever.
            expect((await readPost(stranded.id)).scheduledPublishTime).toBeNull();
            expect(notificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
        });

        it('reports drift and notifies the merchant when Graph says it is STILL pending', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const orphaned = await insertPost({
                facebookPostId: 'fb_drifted',
                pageId: page.id,
                triggerReply: 'r',
                scheduledPublishTime: markerAt(SCHEDULED_MARKER_GRACE_MS + 3_600_000),
            });
            vi.spyOn(facebookService, 'getPostSchedule').mockResolvedValue({
                isPublished: false, scheduledPublishTime: '2026-08-01T09:00:00.000Z',
            });

            const result = await postsService.onPostPublished(page.id, 'fb_fresh', {
                accessToken: 'tok', workspaceId: ws.id, pageName: 'Test Page',
            });

            expect(result.orphanedPostIds).toEqual(['fb_drifted']);
            // The marker STAYS — it is the record of an unresolved problem.
            expect((await readPost(orphaned.id)).scheduledPublishTime).not.toBeNull();
            expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
                ws.id, 'post_reply_orphaned', { pageName: 'Test Page' },
                expect.objectContaining({ orphanedPostIds: ['fb_drifted'] }),
            );
        });

        it('ignores an overdue marker on a post with NO trigger configured', async () => {
            // Arming opens the modal (which sets the marker) before the reply is saved. An
            // abandoned setup is not an orphaned trigger and must not alarm.
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            await insertPost({
                facebookPostId: 'fb_abandoned',
                pageId: page.id,
                triggerReply: null,
                scheduledPublishTime: markerAt(SCHEDULED_MARKER_GRACE_MS + 3_600_000),
            });

            const result = await postsService.onPostPublished(page.id, 'fb_fresh', { accessToken: 'tok', workspaceId: ws.id });

            expect(result.orphanedPostIds).toEqual([]);
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
        });
    });

    describe('ensureContent — marker round-trips through the column', () => {
        it('writes the Graph-reported schedule and reads it back as the same instant', async () => {
            // Guards the timestamp round-trip itself: `scheduled_publish_time` is a
            // `timestamp` (no zone), so a write/read mismatch would silently shift the
            // merchant-visible publish time.
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const iso = '2026-08-20T09:00:00.000Z';
            vi.spyOn(facebookService, 'getPostSchedule').mockResolvedValue({ isPublished: false, scheduledPublishTime: iso });

            const content = await postsService.ensureContent(
                { id: page.id, facebookPageId: page.facebookPageId, instagramAccountId: null, accessToken: 'tok' },
                'facebook',
                'fb_new_sched',
            );

            expect(content.scheduledPublishTime).toBe(iso);
            const [row] = await testDb.select().from(posts)
                .where(and(eq(posts.pageId, page.id), eq(posts.facebookPostId, 'fb_new_sched')));
            expect(row.scheduledPublishTime?.toISOString()).toBe(iso);
        });

        it('keeps a stored marker when Graph cannot answer', async () => {
            const user = await createTestUser();
            const ws = await createTestWorkspace(user.id);
            const page = await createTestPage(user.id, { workspaceId: ws.id });
            const stored = new Date('2026-08-20T09:00:00.000Z');
            await insertPost({ facebookPostId: 'fb_unknown', pageId: page.id, scheduledPublishTime: stored });
            vi.spyOn(facebookService, 'getPostSchedule').mockResolvedValue(null);

            const content = await postsService.ensureContent(
                { id: page.id, facebookPageId: page.facebookPageId, instagramAccountId: null, accessToken: 'tok' },
                'facebook',
                'fb_unknown',
            );

            expect(content.scheduledPublishTime).toBe(stored.toISOString());
        });
    });
});

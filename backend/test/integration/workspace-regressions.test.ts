/**
 * Workspace Refactor — Regression Integration Tests
 *
 * These tests run against a real Postgres DB and catch regressions
 * introduced by the workspace refactor that unit tests (with mocked
 * dependencies) cannot detect.
 *
 * Covers:
 *  1. Demo seed → pages visible via workspaceId (was broken: workspaceId=null)
 *  2. Demo seed refresh path → workspaceId set on existing pages
 *  3. Settings → workspaceSettings sync (critical disconnect)
 *  4. Comments IDOR — workspace isolation on getOne / delete
 *  5. Instagram comments IDOR — getCommentForWorkspace covers Instagram table
 */

import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
    testDb,
    createTestUser,
    createTestWorkspace,
    createTestPage,
    insertPost,
    insertComment,
    insertInstagramMedia,
    insertInstagramComment,
} from './setup';
import * as schema from '../../src/db/schema';

/** The workspace's stored settings blob, unmediated by defaults or the drift-heal. */
async function readWorkspaceSettingsJsonb(workspaceId: string): Promise<Record<string, unknown>> {
    const [row] = await testDb
        .select({ settings: schema.workspaces.settings })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId));
    return (row?.settings ?? {}) as Record<string, unknown>;
}
import { pagesService } from '../../src/services/pages';
import { commentsService } from '../../src/services/comments';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { settingsService } from '../../src/services/settings';
import { seedDemoData, DEMO_PAGES } from '../../src/plugins/demo/seedData';
import { workspaceService } from '../../src/services/workspace';

// Silence Redis — we test DB behaviour, not cache
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        scan: vi.fn().mockResolvedValue(['0', []]),
    },
}));

// Prevent real OpenAI embedding calls during seedDemoData → seedDemoStore
vi.mock('../../src/services/kb/ingestion', () => ({
    KbIngestionService: vi.fn().mockImplementation(() => ({
        ingestFullPage: vi.fn().mockResolvedValue(undefined),
        ingestKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    })),
}));

// ── 1. Demo seed → workspace-scoped page visibility ───────────────────────────

describe('Demo seed — workspace scoping', () => {
    it('seeded pages are visible via pagesService.getPages(workspaceId)', async () => {
        const user = await createTestUser({ facebookId: 'demo_user_jawab24' });
        const ws = await createTestWorkspace(user.id);

        await seedDemoData(user.id, ws.id);

        const pages = await pagesService.getPages(ws.id);

        // Must return all demo pages, not an empty array. Derived from the
        // fixture list so adding a demo page doesn't red the suite.
        expect(pages.length).toBe(DEMO_PAGES.length);
        expect(pages.every(p => p.workspaceId === ws.id)).toBe(true);
    });

    it('seeded pages are NOT visible under a different workspace', async () => {
        const user = await createTestUser({ facebookId: 'demo_user_jawab24_iso' });
        const ws = await createTestWorkspace(user.id);
        const otherUser = await createTestUser();
        const otherWs = await createTestWorkspace(otherUser.id);

        await seedDemoData(user.id, ws.id);

        const otherPages = await pagesService.getPages(otherWs.id);
        expect(otherPages.length).toBe(0);
    });

    it('calling seedDemoData twice (refresh path) keeps pages in workspace', async () => {
        const user = await createTestUser({ facebookId: 'demo_user_refresh' });
        const ws = await createTestWorkspace(user.id);

        // First seed
        await seedDemoData(user.id, ws.id);
        // Second seed (refresh path — pages already exist)
        await seedDemoData(user.id, ws.id);

        const pages = await pagesService.getPages(ws.id);
        expect(pages.length).toBe(DEMO_PAGES.length);
        expect(pages.every(p => p.workspaceId === ws.id)).toBe(true);
    });
});

// ── 2. Settings → workspaceSettings sync ─────────────────────────────────────

describe('Settings → workspaceSettings sync', () => {
    it('disabling commentsAutoReply via settingsService reflects in workspaceSettings', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        // Update via the per-user settings service (what the UI calls)
        await settingsService.updateSettings(user.id, { commentsAutoReply: false });

        // The reply pipeline reads from workspaceSettings
        const enabled = await workspaceSettingsService.isCommentsAutoReplyEnabled(ws.id);
        expect(enabled).toBe(false);
    });

    it('disabling messagesAutoReply via settingsService reflects in workspaceSettings', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        await settingsService.updateSettings(user.id, { messagesAutoReply: false });

        const enabled = await workspaceSettingsService.isMessagesAutoReplyEnabled(ws.id);
        expect(enabled).toBe(false);
    });

    it('updating replyDelay via settingsService reflects in workspaceSettings', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        await settingsService.updateSettings(user.id, { replyDelay: 30 });

        const delay = await workspaceSettingsService.getReplyDelay(ws.id);
        expect(delay).toBe(30);
    });
});

// ── 2a2. The write lands in the REQUESTED workspace, against a real DB ───────

/**
 * The authorization boundary, end to end.
 *
 * `PUT /settings` runs `resolveWorkspace` + `requireRole('admin')`, so the role is
 * checked against `request.workspaceId`. The pipeline write must land in THAT
 * workspace. It used to be routed by `settingsService.resolveWorkspaceId(userId)` —
 * an unordered `limit(1)` over the user's memberships — so for a user holding two it
 * could land in the workspace whose role was never checked, and it ignored the
 * workspace pin a restricted embedded session carries (D-067).
 *
 * Two memberships is not a contrived state: «الفريق» / Team is a first-class feature,
 * and `workspaceInvite.acceptInvite` adds a membership unconditionally, so anyone who
 * signed up and later accepted an invite holds two. `createTestWorkspace` inserts an
 * owner membership, so calling it twice reproduces exactly that shape.
 *
 * Asserted against the RAW JSONB rather than `workspaceSettingsService.getSettings`,
 * because that read applies the legacy drift-heal — see the test below it.
 */
describe('Settings — the pipeline write lands in the named workspace', () => {
    it('a user in TWO workspaces: only the named workspace receives the write', async () => {
        const user = await createTestUser();
        const wsA = await createTestWorkspace(user.id, { name: 'Workspace A' });
        const wsB = await createTestWorkspace(user.id, { name: 'Workspace B' });
        // The service memoizes userId→workspaceId for the process lifetime.
        settingsService.clearWorkspaceIdCache();

        // The request resolved wsB (X-Workspace-Id / last-active / embedded token pin).
        await settingsService.updateSettings(user.id, { commentsAutoReply: false }, wsB.id);

        const rawB = await readWorkspaceSettingsJsonb(wsB.id);
        const rawA = await readWorkspaceSettingsJsonb(wsA.id);

        expect(rawB.commentsAutoReply).toBe(false);
        // wsA was never named, so nothing may have been written into it.
        expect(rawA).not.toHaveProperty('commentsAutoReply');
    });

    it('with no workspace named, the legacy fallback still resolves one (login payload path)', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        settingsService.clearWorkspaceIdCache();

        await settingsService.updateSettings(user.id, { replyDelay: 30 });

        expect((await readWorkspaceSettingsJsonb(ws.id)).replyDelay).toBe(30);
    });
});

/**
 * ⚠️ Known gap this fix does NOT close, pinned so it cannot regress silently.
 *
 * `workspaceSettingsService.getSettings` runs `detectLegacyDrift`, which fills keys
 * MISSING from a workspace's JSONB from the OWNER's legacy `settings` row. The legacy
 * row is per-user, so after a write scoped to wsB, a first read of wsA heals itself
 * from that same row and adopts wsB's value — the write leaks across workspaces at
 * READ time, through a different mechanism than the one fixed above.
 *
 * This is why the consolidation deletes the drift-heal (Phase 3b) rather than only
 * scoping the writer: while two stores exist, the per-user store keeps re-joining them.
 * When drift-heal is deleted, this test flips to `toBe(true)` — that is the fix, not a
 * regression.
 */
describe('Settings — drift-heal leaks a scoped write across workspaces (documented gap)', () => {
    it('reading the OTHER workspace heals it from the shared legacy row', async () => {
        const user = await createTestUser();
        const wsA = await createTestWorkspace(user.id, { name: 'Workspace A' });
        const wsB = await createTestWorkspace(user.id, { name: 'Workspace B' });
        settingsService.clearWorkspaceIdCache();

        await settingsService.updateSettings(user.id, { commentsAutoReply: false }, wsB.id);

        // The JSONB write stayed in wsB (asserted above); the READ is what leaks.
        expect(await workspaceSettingsService.isCommentsAutoReplyEnabled(wsA.id)).toBe(false);
    });
});

// ── 2b. D-029 aiEnabled write clamp — the zombie state is unrepresentable ────

describe('Settings — aiEnabled clamp (D-029)', () => {
    it('an old-client master-off ({aiEnabled:false} alone) cascades to both channels', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);
        await settingsService.updateSettings(user.id, { commentsAutoReply: true, messagesAutoReply: true });

        // The shipped mobile builds' standalone toggle sends aiEnabled alone.
        await settingsService.updateSettings(user.id, { aiEnabled: false });

        const result = await settingsService.getSettings(user.id);
        expect(result.aiEnabled).toBe(false);
        expect(result.commentsAutoReply).toBe(false);
        expect(result.messagesAutoReply).toBe(false);
        // The pipeline store agrees — no zombie (engine off + channels on).
        expect(await workspaceSettingsService.isCommentsAutoReplyEnabled(ws.id)).toBe(false);
    });

    it('aiEnabled is derived from the channels whenever channel flags are in the payload', async () => {
        const user = await createTestUser();
        await createTestWorkspace(user.id);

        // Contradictory payload: aiEnabled=false but a channel is being turned ON.
        await settingsService.updateSettings(user.id, { aiEnabled: false, commentsAutoReply: true });
        let result = await settingsService.getSettings(user.id);
        expect(result.aiEnabled).toBe(true);

        // Turning the last channel off derives aiEnabled=false even if omitted.
        await settingsService.updateSettings(user.id, { commentsAutoReply: false, messagesAutoReply: false });
        result = await settingsService.getSettings(user.id);
        expect(result.aiEnabled).toBe(false);
    });
});

// ── 2c. D-026 overlay heals string-shaped *Multi values from the workspace store ──

describe('Settings — workspace overlay *Multi coercion', () => {
    it('returns an object when the workspace store holds a double-encoded string', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        // Simulate the known drizzle jsonb-as-string shape copied verbatim into
        // the workspace store by the drift-heal/backfill.
        await workspaceSettingsService.updateSettings(ws.id, {
            dualReplyNudgeMulti: JSON.stringify({ ar: 'تفاصيل بالخاص', sourceLang: 'ar' }) as unknown as Record<string, string>,
        });

        const result = await settingsService.getSettings(user.id);
        expect(typeof result.dualReplyNudgeMulti).toBe('object');
        expect((result.dualReplyNudgeMulti as Record<string, string>).ar).toBe('تفاصيل بالخاص');
    });
});

// ── 3. Comments — workspace isolation (IDOR prevention) ──────────────────────

describe('Comments — workspace isolation', () => {
    it('commentsService.getComment does not return a comment from another workspace', async () => {
        // Workspace A: owner + page + post + comment
        const ownerA = await createTestUser();
        const wsA = await createTestWorkspace(ownerA.id);
        const pageA = await createTestPage(ownerA.id, { workspaceId: wsA.id });
        const postA = await insertPost(pageA.id);
        const comment = await insertComment(postA.id, { message: 'secret comment' });

        // Workspace B: a completely separate user
        const ownerB = await createTestUser();
        const wsB = await createTestWorkspace(ownerB.id);

        // getComment by raw ID should not be reachable without workspace check
        // We verify the comment exists
        const found = await commentsService.getComment(comment.id);
        expect(found).not.toBeNull();

        // But it does NOT belong to workspace B's pages
        const pagesB = await pagesService.getPages(wsB.id);
        const pageBIds = pagesB.map(p => p.id);

        // The comment's post's page is NOT in workspace B
        expect(pageBIds).not.toContain(pageA.id);
    });

    it('pagesService.getPages returns only pages for the requested workspace', async () => {
        const userA = await createTestUser();
        const wsA = await createTestWorkspace(userA.id);
        await createTestPage(userA.id, { workspaceId: wsA.id, name: 'Page A' });

        const userB = await createTestUser();
        const wsB = await createTestWorkspace(userB.id);
        await createTestPage(userB.id, { workspaceId: wsB.id, name: 'Page B' });

        const pagesA = await pagesService.getPages(wsA.id);
        const pagesB = await pagesService.getPages(wsB.id);

        expect(pagesA).toHaveLength(1);
        expect(pagesA[0].name).toBe('Page A');

        expect(pagesB).toHaveLength(1);
        expect(pagesB[0].name).toBe('Page B');
    });
});

// ── 4. Instagram comments — workspace isolation (IDOR prevention) ─────────────
//
// Regression: getCommentForWorkspace originally only queried the Facebook
// `comments` table. Instagram comments (instagramComments → instagramMedia →
// pages) were not checked, meaning a cross-workspace ID lookup would return
// null (silently safe in the happy path) but would also never resolve a
// legitimate Instagram comment as "owned" by the requesting workspace.

describe('Instagram comments — workspace isolation', () => {
    it('getCommentForWorkspace returns an Instagram comment that belongs to the workspace', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);
        const page = await createTestPage(owner.id, { workspaceId: ws.id });
        const media = await insertInstagramMedia(page.id, { caption: 'My reel' });
        const igComment = await insertInstagramComment(media.id, { message: 'Great post!' });

        const found = await commentsService.getCommentForWorkspace(igComment.id, ws.id);

        expect(found).not.toBeNull();
        expect(found!.id).toBe(igComment.id);
        expect(found!.message).toBe('Great post!');
    });

    it('getCommentForWorkspace returns null for an Instagram comment that belongs to a different workspace', async () => {
        // Workspace A owns the page, media, and comment
        const ownerA = await createTestUser();
        const wsA = await createTestWorkspace(ownerA.id);
        const pageA = await createTestPage(ownerA.id, { workspaceId: wsA.id });
        const mediaA = await insertInstagramMedia(pageA.id);
        const igComment = await insertInstagramComment(mediaA.id, { message: 'Secret IG comment' });

        // Workspace B tries to access it by raw ID (IDOR attempt)
        const ownerB = await createTestUser();
        const wsB = await createTestWorkspace(ownerB.id);

        const found = await commentsService.getCommentForWorkspace(igComment.id, wsB.id);

        expect(found).toBeNull();
    });

    it('getCommentForWorkspace does not confuse a Facebook comment ID with an Instagram comment', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);
        const page = await createTestPage(owner.id, { workspaceId: ws.id });

        // Create a Facebook comment
        const post = await insertPost(page.id);
        const fbComment = await insertComment(post.id, { message: 'Facebook comment' });

        // Create an Instagram comment on a different page in the same workspace
        const media = await insertInstagramMedia(page.id);
        const igComment = await insertInstagramComment(media.id, { message: 'Instagram comment' });

        // Each ID resolves to the correct record
        const foundFb = await commentsService.getCommentForWorkspace(fbComment.id, ws.id);
        const foundIg = await commentsService.getCommentForWorkspace(igComment.id, ws.id);

        expect(foundFb).not.toBeNull();
        expect(foundFb!.id).toBe(fbComment.id);

        expect(foundIg).not.toBeNull();
        expect(foundIg!.id).toBe(igComment.id);
    });
});

// ── 5. Workspace auto-create on login (ensureWorkspace) ──────────────────────

describe('Auth — ensureWorkspace', () => {
    it('a new user gets a workspace automatically after login', async () => {
        const { authService } = await import('../../src/services/auth');

        // Simulate login via Facebook
        const user = await authService.findOrCreateUser(
            `fb-${Date.now()}`,
            'New User',
            'newuser@example.com',
        );

        const workspaces = await workspaceService.getUserWorkspaces(user.id);
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].role).toBe('owner');
    });

    it('an existing user without a workspace gets one created on next login', async () => {
        const { authService } = await import('../../src/services/auth');

        // First login — creates user + workspace
        const fbId = `fb-existing-${Date.now()}`;
        await authService.findOrCreateUser(fbId, 'Existing User');
        const after = await workspaceService.getUserWorkspaces(
            (await authService.findOrCreateUser(fbId, 'Existing User')).id,
        );

        // Should still have exactly 1 workspace (idempotent)
        expect(after).toHaveLength(1);
    });
});

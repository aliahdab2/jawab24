import { describe, it, expect } from 'vitest';
import { eq, getTableColumns } from 'drizzle-orm';
import { testDb, createTestUser, createTestPage, createTestWorkspace, insertPost, insertComment, insertInstagramMedia, insertInstagramComment } from './setup';
import * as schema from '../../src/db/schema';
import { pagesService } from '../../src/services/pages';

describe('pagesService.getPages — integration', () => {
    it('returns pages with zeroed stats when no comments exist', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await createTestPage(user.id, { name: 'My Page', workspaceId: workspace.id });

        const pages = await pagesService.getPages(workspace.id);

        expect(pages).toHaveLength(1);
        expect(pages[0].name).toBe('My Page');
        expect(pages[0].commentsCount).toBe(0);
        expect(pages[0].repliesCount).toBe(0);
        expect(pages[0].replyRate).toBe(0);
        expect(pages[0].lastActivity).toBeNull();
    });

    it('returns correct stats with FB comments', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        // Seed: post → 3 comments (2 replied)
        const post = await insertPost(page.id, { facebookPostId: `post-${Date.now()}`, message: 'Test post' });

        const now = new Date();
        await insertComment(post.id, { facebookCommentId: `c1-${Date.now()}`, message: 'Hello', replied: true, repliedAt: now, replyMethod: 'ai' });
        await insertComment(post.id, { facebookCommentId: `c2-${Date.now()}`, message: 'Hi', replied: true, repliedAt: new Date(now.getTime() - 60000), replyMethod: 'ai' });
        await insertComment(post.id, { facebookCommentId: `c3-${Date.now()}`, message: 'Hey', replied: false });

        const pages = await pagesService.getPages(workspace.id);

        expect(pages[0].commentsCount).toBe(3);
        expect(pages[0].repliesCount).toBe(2);
        expect(pages[0].replyRate).toBe(67); // Math.round(2/3*100)
        expect(pages[0].lastActivity).toBeTypeOf('number');
        expect(pages[0].lastActivity).toBeGreaterThan(0);
    });

    it('returns correct stats with IG comments', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        // Seed: instagramMedia → 2 IG comments (1 replied)
        const media = await insertInstagramMedia(page.id, { instagramMediaId: `ig-media-${Date.now()}`, mediaType: 'IMAGE' });

        await insertInstagramComment(media.id, { instagramCommentId: `ic1-${Date.now()}`, message: 'Nice', replied: true, repliedAt: new Date(), replyMethod: 'ai' });
        await insertInstagramComment(media.id, { instagramCommentId: `ic2-${Date.now()}`, message: 'Cool', replied: false });

        const pages = await pagesService.getPages(workspace.id);

        expect(pages[0].commentsCount).toBe(2);
        expect(pages[0].repliesCount).toBe(1);
        expect(pages[0].replyRate).toBe(50);
    });

    it('combines FB + IG stats for the same page', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        // FB: 1 comment (replied)
        const post = await insertPost(page.id, { facebookPostId: `post-${Date.now()}`, message: 'FB post' });
        await insertComment(post.id, { facebookCommentId: `c-${Date.now()}`, message: 'FB comment', replied: true, repliedAt: new Date(), replyMethod: 'ai' });

        // IG: 1 comment (not replied)
        const media = await insertInstagramMedia(page.id, { instagramMediaId: `ig-${Date.now()}`, mediaType: 'REELS' });
        await insertInstagramComment(media.id, { instagramCommentId: `ic-${Date.now()}`, message: 'IG comment', replied: false });

        const pages = await pagesService.getPages(workspace.id);

        expect(pages[0].commentsCount).toBe(2); // 1 FB + 1 IG
        expect(pages[0].repliesCount).toBe(1);   // 1 FB
        expect(pages[0].replyRate).toBe(50);
    });

    it('returns every schema column plus computed stats', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await createTestPage(user.id, { name: 'Full Page', workspaceId: workspace.id });

        const pages = await pagesService.getPages(workspace.id);
        const page = pages[0];
        const returnedKeys = Object.keys(page);

        // Dynamically get ALL column names from the schema — if a column is
        // added to the schema, this test will fail if getPages() drops it.
        const schemaColumns = Object.keys(getTableColumns(schema.pages));
        for (const col of schemaColumns) {
            expect(returnedKeys, `missing schema column: ${col}`).toContain(col);
        }

        // Computed stats must also be present
        for (const stat of ['commentsCount', 'repliesCount', 'replyRate', 'lastActivity']) {
            expect(returnedKeys, `missing computed stat: ${stat}`).toContain(stat);
        }
    });

    it('still returns archived pages (the Facebook sync depends on seeing them)', async () => {
        // Archived rows are hidden by the pages CONTROLLER, never by this service:
        // syncFromFacebook builds its existing-page map and revoke list from here,
        // so filtering at this level would re-insert duplicates and mis-revoke.
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await createTestPage(user.id, {
            name: 'Hidden Page',
            workspaceId: workspace.id,
            accessToken: '',
            autoReplyEnabled: false,
            archivedAt: new Date(),
        });

        const pages = await pagesService.getPages(workspace.id);

        expect(pages).toHaveLength(1);
        expect(pages[0].name).toBe('Hidden Page');
        expect(pages[0].archivedAt).toBeInstanceOf(Date);
    });

    it('archivePage hides a disconnected page and refuses a connected one', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const disconnected = await createTestPage(user.id, {
            name: 'Dead Page', workspaceId: workspace.id, accessToken: '', autoReplyEnabled: false,
        });
        const connected = await createTestPage(user.id, {
            name: 'Live Page', workspaceId: workspace.id, accessToken: 'live-token',
        });

        const archived = await pagesService.archivePage(workspace.id, disconnected.id);
        expect(archived.status).toBe('archived');

        const refused = await pagesService.archivePage(workspace.id, connected.id);
        expect(refused.status).toBe('not_disconnected');

        const pages = await pagesService.getPages(workspace.id);
        const stored = pages.find(p => p.id === disconnected.id);
        expect(stored?.archivedAt).toBeInstanceOf(Date);
        expect(pages.find(p => p.id === connected.id)?.archivedAt).toBeNull();
    });

    it('returns empty array for workspace with no pages', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const pages = await pagesService.getPages(workspace.id);
        expect(pages).toEqual([]);
    });
});

describe('pagesService.disconnectWhatsApp — integration', () => {
    // whatsapp_coexistence means "this number is ALSO live on the merchant's
    // phone", and it is what makes a later connect skip Cloud-API registration.
    // Left set on a card whose number is gone, it is a claim about a number that
    // is no longer there — the same reason this function already clears
    // whatsapp_disconnect_reason rather than leaving support a false trail.
    it('clears the coexistence flag along with the number', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            whatsappPhoneNumberId: `pn-${Date.now()}`,
            whatsappAccessToken: 'wa-token',
            whatsappCoexistence: true,
            whatsappAutoReplyEnabled: true,
        });

        const updated = await pagesService.disconnectWhatsApp(workspace.id, page.id);

        expect(updated?.whatsappCoexistence).toBeNull();
        expect(updated?.whatsappAccessToken).toBeNull();
        expect(updated?.whatsappPhoneNumberId).toBeNull();
    });
});

describe('pagesService channel auto-reply toggles — integration', () => {
    // These pin the ACTUAL column each toggle writes, read back from the DB.
    // Every other test of the toggles mocks pagesService at the module boundary,
    // so a cross-wired column inside setChannelAutoReply (the computed-key
    // .set() the two public methods share) would keep the whole suite green.
    // Each test asserts the sibling column is untouched — that IS the cross-wire
    // detector, not decoration.
    async function readAutoReplyColumns(pageId: string) {
        const [row] = await testDb
            .select({
                instagram: schema.pages.instagramAutoReplyEnabled,
                whatsapp: schema.pages.whatsappAutoReplyEnabled,
            })
            .from(schema.pages)
            .where(eq(schema.pages.id, pageId));
        return row;
    }

    it('toggleInstagramAutoReply flips only the Instagram column', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            instagramAutoReplyEnabled: false,
            whatsappAutoReplyEnabled: false,
        });

        const updated = await pagesService.toggleInstagramAutoReply(workspace.id, page.id, true);
        expect(updated.instagramAutoReplyEnabled).toBe(true);

        const row = await readAutoReplyColumns(page.id);
        expect(row.instagram).toBe(true);
        expect(row.whatsapp).toBe(false);
    });

    it('toggleWhatsAppAutoReply flips only the WhatsApp column', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            instagramAutoReplyEnabled: false,
            whatsappAutoReplyEnabled: false,
        });

        const updated = await pagesService.toggleWhatsAppAutoReply(workspace.id, page.id, true);
        expect(updated.whatsappAutoReplyEnabled).toBe(true);

        const row = await readAutoReplyColumns(page.id);
        expect(row.whatsapp).toBe(true);
        expect(row.instagram).toBe(false);
    });

    it('does not write a page outside the given workspace', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const otherWorkspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            instagramAutoReplyEnabled: false,
        });

        const updated = await pagesService.toggleInstagramAutoReply(otherWorkspace.id, page.id, true);
        expect(updated).toBeUndefined();

        const row = await readAutoReplyColumns(page.id);
        expect(row.instagram).toBe(false);
    });
});

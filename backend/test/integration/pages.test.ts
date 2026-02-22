import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { createTestUser, createTestPage, createTestWorkspace, testDb } from './setup';
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
        const [post] = await testDb.insert(schema.posts).values({
            pageId: page.id,
            facebookPostId: `post-${Date.now()}`,
            message: 'Test post',
        }).returning();

        const now = new Date();
        await testDb.insert(schema.comments).values([
            { postId: post.id, facebookCommentId: `c1-${Date.now()}`, message: 'Hello', replied: true, repliedAt: now },
            { postId: post.id, facebookCommentId: `c2-${Date.now()}`, message: 'Hi', replied: true, repliedAt: new Date(now.getTime() - 60000) },
            { postId: post.id, facebookCommentId: `c3-${Date.now()}`, message: 'Hey', replied: false },
        ]);

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
        const [media] = await testDb.insert(schema.instagramMedia).values({
            pageId: page.id,
            instagramMediaId: `ig-media-${Date.now()}`,
            mediaType: 'IMAGE',
        }).returning();

        await testDb.insert(schema.instagramComments).values([
            { mediaId: media.id, instagramCommentId: `ic1-${Date.now()}`, message: 'Nice', replied: true, repliedAt: new Date() },
            { mediaId: media.id, instagramCommentId: `ic2-${Date.now()}`, message: 'Cool', replied: false },
        ]);

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
        const [post] = await testDb.insert(schema.posts).values({
            pageId: page.id, facebookPostId: `post-${Date.now()}`, message: 'FB post',
        }).returning();
        await testDb.insert(schema.comments).values({
            postId: post.id, facebookCommentId: `c-${Date.now()}`, message: 'FB comment', replied: true, repliedAt: new Date(),
        });

        // IG: 1 comment (not replied)
        const [media] = await testDb.insert(schema.instagramMedia).values({
            pageId: page.id, instagramMediaId: `ig-${Date.now()}`, mediaType: 'REELS',
        }).returning();
        await testDb.insert(schema.instagramComments).values({
            mediaId: media.id, instagramCommentId: `ic-${Date.now()}`, message: 'IG comment', replied: false,
        });

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

    it('returns empty array for workspace with no pages', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const pages = await pagesService.getPages(workspace.id);
        expect(pages).toEqual([]);
    });
});

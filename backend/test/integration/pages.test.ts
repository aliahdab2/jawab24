import { describe, it, expect } from 'vitest';
import { createTestUser, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { pagesService } from '../../src/services/pages';

describe('pagesService.getPages — integration', () => {
    it('returns pages with zeroed stats when no comments exist', async () => {
        const user = await createTestUser();
        await createTestPage(user.id, { name: 'My Page' });

        const pages = await pagesService.getPages(user.id);

        expect(pages).toHaveLength(1);
        expect(pages[0].name).toBe('My Page');
        expect(pages[0].commentsCount).toBe(0);
        expect(pages[0].repliesCount).toBe(0);
        expect(pages[0].replyRate).toBe(0);
        expect(pages[0].lastActivity).toBeNull();
    });

    it('returns correct stats with FB comments', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id);

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

        const pages = await pagesService.getPages(user.id);

        expect(pages[0].commentsCount).toBe(3);
        expect(pages[0].repliesCount).toBe(2);
        expect(pages[0].replyRate).toBe(67); // Math.round(2/3*100)
        expect(pages[0].lastActivity).toBeTypeOf('number');
        expect(pages[0].lastActivity).toBeGreaterThan(0);
    });

    it('returns correct stats with IG comments', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id);

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

        const pages = await pagesService.getPages(user.id);

        expect(pages[0].commentsCount).toBe(2);
        expect(pages[0].repliesCount).toBe(1);
        expect(pages[0].replyRate).toBe(50);
    });

    it('combines FB + IG stats for the same page', async () => {
        const user = await createTestUser();
        const page = await createTestPage(user.id);

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

        const pages = await pagesService.getPages(user.id);

        expect(pages[0].commentsCount).toBe(2); // 1 FB + 1 IG
        expect(pages[0].repliesCount).toBe(1);   // 1 FB
        expect(pages[0].replyRate).toBe(50);
    });

    it('returns all page columns (no missing fields)', async () => {
        const user = await createTestUser();
        await createTestPage(user.id, {
            name: 'Full Page',
            instagramAccountId: 'ig-123',
            instagramUsername: 'testuser',
            knowledgeBase: 'Some KB',
        });

        const pages = await pagesService.getPages(user.id);
        const page = pages[0];

        // Core columns that must always be present
        expect(page).toHaveProperty('id');
        expect(page).toHaveProperty('userId');
        expect(page).toHaveProperty('facebookPageId');
        expect(page).toHaveProperty('name', 'Full Page');
        expect(page).toHaveProperty('accessToken');
        expect(page).toHaveProperty('autoReplyEnabled');
        expect(page).toHaveProperty('instagramAccountId', 'ig-123');
        expect(page).toHaveProperty('instagramUsername', 'testuser');
        expect(page).toHaveProperty('instagramAutoReplyEnabled');
        expect(page).toHaveProperty('knowledgeBase', 'Some KB');
        expect(page).toHaveProperty('kbActiveVersion');
        expect(page).toHaveProperty('createdAt');
        expect(page).toHaveProperty('updatedAt');
        // Columns that caused the previous 500 when missing
        expect(page).toHaveProperty('shopifyStoreId');
        expect(page).toHaveProperty('suggestedKnowledgeBase');
        expect(page).toHaveProperty('kbVersion');
        expect(page).toHaveProperty('kbUpdatedAt');
        expect(page).toHaveProperty('businessProfile');
        expect(page).toHaveProperty('businessProfileUpdatedAt');
        // Computed stats
        expect(page).toHaveProperty('commentsCount');
        expect(page).toHaveProperty('repliesCount');
        expect(page).toHaveProperty('replyRate');
        expect(page).toHaveProperty('lastActivity');
    });

    it('returns empty array for user with no pages', async () => {
        const user = await createTestUser();
        const pages = await pagesService.getPages(user.id);
        expect(pages).toEqual([]);
    });
});

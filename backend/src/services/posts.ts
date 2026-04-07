import { db } from '../db';
import { posts, pages, instagramMedia } from '../db/schema';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { CreatePostDTO, UpdatePostDTO, Logger, noopLogger } from '../types';
import { facebookService } from './facebook';

export class PostsService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Create a new post
     */
    async createPost(data: CreatePostDTO) {
        const [newPost] = await db
            .insert(posts)
            .values({
                pageId: data.pageId,
                facebookPostId: data.facebookPostId,
                message: data.message,
                autoReplyEnabled: data.autoReplyEnabled ?? true,
                createdTime: data.createdTime,
            })
            .returning();
        
        return newPost;
    }

    /**
     * Get all posts for a page
     */
    async getPostsByPage(pageId: string) {
        return db
            .select()
            .from(posts)
            .where(eq(posts.pageId, pageId))
            .orderBy(desc(posts.createdAt))
            .limit(200);
    }

    /**
     * Get all posts for a user (across all their pages)
     */
    async getPostsByWorkspace(workspaceId: string) {
        return db
            .select({
                id: posts.id,
                pageId: posts.pageId,
                facebookPostId: posts.facebookPostId,
                message: posts.message,
                autoReplyEnabled: posts.autoReplyEnabled,
                triggerKeyword: posts.triggerKeyword,
                triggerReply: posts.triggerReply,
                createdTime: posts.createdTime,
                createdAt: posts.createdAt,
                updatedAt: posts.updatedAt,
                pageName: pages.name,
            })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(eq(pages.workspaceId, workspaceId))
            .orderBy(desc(posts.createdAt))
            .limit(200);
    }

    /**
     * Get a single post by ID.
     * When workspaceId is provided, only returns the post if it belongs to that workspace.
     */
    async getPost(postId: string, workspaceId?: string) {
        if (workspaceId) {
            const result = await db
                .select({ post: posts })
                .from(posts)
                .innerJoin(pages, eq(posts.pageId, pages.id))
                .where(and(eq(posts.id, postId), eq(pages.workspaceId, workspaceId)));
            return result[0]?.post || null;
        }

        const result = await db.select().from(posts).where(eq(posts.id, postId));
        return result[0] || null;
    }

    /**
     * Get post by Facebook Post ID
     */
    async getPostByFacebookId(facebookPostId: string) {
        const result = await db
            .select()
            .from(posts)
            .where(eq(posts.facebookPostId, facebookPostId));
        
        return result[0] || null;
    }

    /**
     * Update a post — internal use only (webhook processing, no auth check).
     * API callers must use updatePostByWorkspace.
     */
    async updatePost(postId: string, data: UpdatePostDTO) {
        const [updatedPost] = await db
            .update(posts)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(posts.id, postId))
            .returning();
        return updatedPost;
    }

    /**
     * Update a post (workspace-scoped). Single query — ownership verified via subquery.
     */
    async updatePostByWorkspace(postId: string, data: UpdatePostDTO, workspaceId: string) {
        const workspacePageIds = db.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId));
        const [updatedPost] = await db
            .update(posts)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(posts.id, postId), inArray(posts.pageId, workspacePageIds)))
            .returning();
        return updatedPost || null;
    }

    /**
     * Delete a post (workspace-scoped). Single query — ownership verified via subquery.
     */
    async deletePost(postId: string, workspaceId: string) {
        const workspacePageIds = db.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId));
        const [deleted] = await db
            .delete(posts)
            .where(and(eq(posts.id, postId), inArray(posts.pageId, workspacePageIds)))
            .returning({ id: posts.id });
        return !!deleted;
    }

    /**
     * Toggle auto-reply for a post (workspace-scoped). Single query.
     */
    async toggleAutoReply(postId: string, enabled: boolean, workspaceId: string) {
        const workspacePageIds = db.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId));
        const [updatedPost] = await db
            .update(posts)
            .set({ autoReplyEnabled: enabled, updatedAt: new Date() })
            .where(and(eq(posts.id, postId), inArray(posts.pageId, workspacePageIds)))
            .returning();
        return updatedPost || null;
    }

    /**
     * Update trigger keyword + reply for a post or Instagram media (workspace-scoped).
     * source determines which table to target. Single query per table.
     * Returns false if the record is not found or not owned by this workspace.
     */
    async updateTrigger(
        contentId: string,
        source: 'facebook' | 'instagram',
        triggerKeyword: string | null,
        triggerReply: string | null,
        workspaceId: string,
    ): Promise<boolean> {
        const workspacePageIds = db.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId));

        if (source === 'instagram') {
            const [updated] = await db
                .update(instagramMedia)
                .set({ triggerKeyword, triggerReply, updatedAt: new Date() })
                .where(and(eq(instagramMedia.id, contentId), inArray(instagramMedia.pageId, workspacePageIds)))
                .returning({ id: instagramMedia.id });
            return !!updated;
        }

        const [updated] = await db
            .update(posts)
            .set({ triggerKeyword, triggerReply, updatedAt: new Date() })
            .where(and(eq(posts.id, contentId), inArray(posts.pageId, workspacePageIds)))
            .returning({ id: posts.id });
        return !!updated;
    }

    /**
     * Find or create post from Facebook webhook
     * Automatically fetches post content from Facebook if not provided
     */
    async findOrCreateFromWebhook(pageId: string, facebookPostId: string, message?: string, pageAccessToken?: string) {
        const existing = await this.getPostByFacebookId(facebookPostId);
        
        if (existing) {
            // If we have the post but no message, try to fetch it
            if (!existing.message && pageAccessToken) {
                const postContent = await facebookService.getPostContent(facebookPostId, pageAccessToken);
                if (postContent) {
                    this.logger.info('[Posts] Updating post with fetched content', { facebookPostId });
                    return this.updatePost(existing.id, { message: postContent });
                }
            }
            return existing;
        }

        // Try to fetch post content from Facebook if not provided
        let postMessage = message;
        if (!postMessage && pageAccessToken) {
            this.logger.debug('[Posts] Fetching content for new post', { facebookPostId });
            postMessage = await facebookService.getPostContent(facebookPostId, pageAccessToken) || undefined;
        }

        return this.createPost({
            pageId,
            facebookPostId,
            message: postMessage,
        });
    }
}

export const postsService = new PostsService();


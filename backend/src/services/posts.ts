import { db } from '../db';
import { posts, pages, instagramMedia } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
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
     * Update a post (workspace-scoped). Verifies ownership before updating.
     */
    async updatePostByWorkspace(postId: string, data: UpdatePostDTO, workspaceId: string) {
        const owned = await db
            .select({ id: posts.id })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(posts.id, postId), eq(pages.workspaceId, workspaceId)));
        if (!owned[0]) return null;

        const [updatedPost] = await db
            .update(posts)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(posts.id, postId))
            .returning();
        return updatedPost || null;
    }

    /**
     * Delete a post (workspace-scoped). Verifies ownership before deleting.
     */
    async deletePost(postId: string, workspaceId: string) {
        const owned = await db
            .select({ id: posts.id })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(posts.id, postId), eq(pages.workspaceId, workspaceId)));
        if (!owned[0]) return false;

        await db.delete(posts).where(eq(posts.id, postId));
        return true;
    }

    /**
     * Toggle auto-reply for a post (workspace-scoped). Verifies ownership before updating.
     */
    async toggleAutoReply(postId: string, enabled: boolean, workspaceId: string) {
        const owned = await db
            .select({ id: posts.id })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(eq(posts.id, postId), eq(pages.workspaceId, workspaceId)));
        if (!owned[0]) return null;

        const [updatedPost] = await db
            .update(posts)
            .set({ autoReplyEnabled: enabled, updatedAt: new Date() })
            .where(eq(posts.id, postId))
            .returning();
        return updatedPost || null;
    }

    /**
     * Update trigger keyword + reply for a post or Instagram media (workspace-scoped).
     * source determines which table to target. Verifies ownership before updating.
     * Returns false if the record is not found or not owned by this workspace.
     */
    async updateTrigger(
        contentId: string,
        source: 'facebook' | 'instagram',
        triggerKeyword: string | null,
        triggerReply: string | null,
        workspaceId: string,
        triggerType: 'keyword' | 'all' = 'keyword',
    ): Promise<boolean> {
        if (source === 'instagram') {
            const owned = await db
                .select({ id: instagramMedia.id })
                .from(instagramMedia)
                .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
                .where(and(eq(instagramMedia.id, contentId), eq(pages.workspaceId, workspaceId)));
            if (!owned[0]) return false;

            await db
                .update(instagramMedia)
                .set({ triggerKeyword, triggerReply, triggerType, updatedAt: new Date() })
                .where(eq(instagramMedia.id, contentId));
        } else {
            const owned = await db
                .select({ id: posts.id })
                .from(posts)
                .innerJoin(pages, eq(posts.pageId, pages.id))
                .where(and(eq(posts.id, contentId), eq(pages.workspaceId, workspaceId)));
            if (!owned[0]) return false;

            await db
                .update(posts)
                .set({ triggerKeyword, triggerReply, triggerType, updatedAt: new Date() })
                .where(eq(posts.id, contentId));
        }

        return true;
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


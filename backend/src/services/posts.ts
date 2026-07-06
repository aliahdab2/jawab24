import { db } from '../db';
import { posts, pages, instagramMedia } from '../db/schema';
import { eq, desc, and, inArray, isNotNull } from 'drizzle-orm';
import { CreatePostDTO, UpdatePostDTO, Logger, noopLogger } from '../types';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import type { PublishedPost } from '@jawab24/shared';

/** Default number of published posts shown per picker page (owner: "last 5, not more").
 *  "Load more" fetches the next page via the platform Graph cursor. */
export const PICKER_PAGE_SIZE = 5;

type PickerPage = {
    id: string;
    facebookPageId: string | null;
    instagramAccountId?: string | null;
    accessToken: string;
};

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

    /**
     * Find-or-create the internal instagram_media row for a media id. Single source of
     * truth shared by the comment pipeline (`InstagramCommentAdapter.findOrCreateContent`)
     * and the Post Reply picker's ensure endpoint — do NOT inline this insert elsewhere.
     */
    async findOrCreateInstagramMedia(pageId: string, instagramMediaId: string) {
        const existing = await db
            .select()
            .from(instagramMedia)
            .where(eq(instagramMedia.instagramMediaId, instagramMediaId));
        if (existing[0]) return existing[0];

        const [created] = await db
            .insert(instagramMedia)
            .values({ pageId, instagramMediaId, autoReplyEnabled: true })
            .returning();
        return created;
    }

    /**
     * Ensure an internal content row exists for a published post the merchant picked,
     * so the standard `PATCH /posts/:id/trigger` can configure it. Idempotent
     * (find-or-create) and reuses the same primitives the comment webhook path uses,
     * so a post armed BEFORE its first comment converges with the row a later comment
     * would have created. Returns the internal id + current trigger fields.
     */
    async ensureContent(
        page: PickerPage,
        source: 'facebook' | 'instagram',
        platformPostId: string,
    ): Promise<{ id: string; triggerKeyword: string | null; triggerReply: string | null; triggerType: 'keyword' | 'all' }> {
        if (source === 'facebook') {
            const post = await this.findOrCreateFromWebhook(page.id, platformPostId, undefined, page.accessToken);
            return {
                id: post.id,
                triggerKeyword: post.triggerKeyword ?? null,
                triggerReply: post.triggerReply ?? null,
                triggerType: post.triggerType === 'all' ? 'all' : 'keyword',
            };
        }
        const media = await this.findOrCreateInstagramMedia(page.id, platformPostId);
        return {
            id: media.id,
            triggerKeyword: media.triggerKeyword ?? null,
            triggerReply: media.triggerReply ?? null,
            triggerType: media.triggerType === 'all' ? 'all' : 'keyword',
        };
    }

    /** Map platform post ids → their stored trigger type, but ONLY for rows that
     *  actually carry a Post Reply (`trigger_reply` set). Absent id = no trigger. */
    private async facebookTriggerMap(facebookPostIds: string[]): Promise<Map<string, 'keyword' | 'all'>> {
        const map = new Map<string, 'keyword' | 'all'>();
        if (facebookPostIds.length === 0) return map;
        const rows = await db
            .select({ fbId: posts.facebookPostId, triggerType: posts.triggerType })
            .from(posts)
            .where(and(inArray(posts.facebookPostId, facebookPostIds), isNotNull(posts.triggerReply)));
        for (const r of rows) if (r.fbId) map.set(r.fbId, r.triggerType === 'all' ? 'all' : 'keyword');
        return map;
    }

    private async instagramTriggerMap(mediaIds: string[]): Promise<Map<string, 'keyword' | 'all'>> {
        const map = new Map<string, 'keyword' | 'all'>();
        if (mediaIds.length === 0) return map;
        const rows = await db
            .select({ mid: instagramMedia.instagramMediaId, triggerType: instagramMedia.triggerType })
            .from(instagramMedia)
            .where(and(inArray(instagramMedia.instagramMediaId, mediaIds), isNotNull(instagramMedia.triggerReply)));
        for (const r of rows) if (r.mid) map.set(r.mid, r.triggerType === 'all' ? 'all' : 'keyword');
        return map;
    }

    /**
     * List a page's recent published posts for the Post Reply picker, merged with their
     * stored trigger state. Per-platform (FB or IG) so pagination uses one Graph cursor;
     * the caller picks the source (a page connected to both shows a source toggle).
     * Graph errors degrade to an empty page (getPagePosts/getMedia handle FB; IG throws,
     * so the caller wraps). Newest first, `limit` items (default 5) + a `nextCursor`.
     */
    async listPublishedPosts(
        page: PickerPage,
        opts: { source: 'facebook' | 'instagram'; limit?: number; after?: string },
    ): Promise<{ posts: PublishedPost[]; nextCursor: string | null }> {
        const limit = opts.limit ?? PICKER_PAGE_SIZE;

        if (opts.source === 'facebook') {
            if (!page.facebookPageId) return { posts: [], nextCursor: null };
            const { posts: raw, nextCursor } = await facebookService.getPagePosts(
                page.facebookPageId, page.accessToken, { limit, after: opts.after },
            );
            const triggers = await this.facebookTriggerMap(raw.map(p => p.id));
            return {
                posts: raw.map(p => ({
                    platformPostId: p.id,
                    source: 'facebook' as const,
                    message: p.message,
                    imageUrl: p.imageUrl,
                    createdTime: p.createdTime,
                    commentsCount: p.commentsCount,
                    hasTrigger: triggers.has(p.id),
                    triggerType: triggers.get(p.id) ?? null,
                })),
                nextCursor,
            };
        }

        if (!page.instagramAccountId) return { posts: [], nextCursor: null };
        const { media, nextCursor } = await instagramService.getMedia(
            page.instagramAccountId, page.accessToken, { limit, after: opts.after },
        );
        const triggers = await this.instagramTriggerMap(media.map(m => m.id));
        return {
            posts: media.map(m => ({
                platformPostId: m.id,
                source: 'instagram' as const,
                message: m.caption ?? null,
                // thumbnail_url is the poster for VIDEO/REELS (media_url is the video file);
                // for IMAGE/CAROUSEL thumbnail is absent so media_url is the image.
                imageUrl: m.thumbnail_url || m.media_url || null,
                createdTime: m.timestamp ?? null,
                commentsCount: m.comments_count ?? null,
                hasTrigger: triggers.has(m.id),
                triggerType: triggers.get(m.id) ?? null,
            })),
            nextCursor,
        };
    }
}

export const postsService = new PostsService();


import { randomUUID } from 'crypto';
import { db } from '../db';
import { posts, pages, instagramMedia } from '../db/schema';
import { eq, desc, and, inArray, isNotNull, sql } from 'drizzle-orm';
import { CreatePostDTO, UpdatePostDTO, Logger, noopLogger } from '../types';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import { imageStorage } from './imageStorage';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { type PublishedPost } from '@jawab24/shared';

/** How the caller wants the Post Reply image handled on this save. */
export type TriggerImageInput =
    | { action: 'keep' }                                    // default — leave the image column as-is
    | { action: 'remove' }                                  // delete the object + null the columns
    | { action: 'set'; buffer: Buffer; mimeType: string };  // upload + replace

export type UpdateTriggerResult =
    | { ok: true }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'quota_exceeded' };

/** All updateTrigger inputs, keyed by name — the parameter list outgrew positional args. */
export interface UpdateTriggerOptions {
    contentId: string;
    source: 'facebook' | 'instagram';
    workspaceId: string;
    triggerKeyword: string | null;
    triggerReply: string | null;
    triggerType?: 'keyword' | 'all';
    /** Image intent — defaults to keep (leave columns untouched). */
    image?: TriggerImageInput;
    /** undefined = leave the column untouched (keep); a boolean = explicit set.
     *  Facebook-only column, so it's ignored on the instagram branch. */
    likeComment?: boolean;
    /** Veto keywords: undefined = keep; null = clear; string = set. Both platforms. */
    triggerExcludeKeyword?: string | null;
}

/** File extension for a validated image MIME (allowlist mirrors the validator). */
function extForMime(mime: string): string {
    switch (mime) {
        case 'image/jpeg': return 'jpg';
        case 'image/png': return 'png';
        case 'image/webp': return 'webp';
        default: return 'img';
    }
}

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
    async updateTrigger(opts: UpdateTriggerOptions): Promise<UpdateTriggerResult> {
        const {
            contentId,
            source,
            triggerKeyword,
            triggerReply,
            workspaceId,
            triggerType = 'keyword',
            image = { action: 'keep' } as TriggerImageInput,
            likeComment,
            triggerExcludeKeyword,
        } = opts;
        const table = source === 'instagram' ? instagramMedia : posts;

        // Ownership + current image, in one query. The current key/bytes drive the
        // safe-order delete (delete AFTER the row is committed) and the quota delta.
        const [owned] = await db
            .select({
                id: table.id,
                imageKey: table.triggerImageKey,
                imageBytes: table.triggerImageBytes,
            })
            .from(table)
            .innerJoin(pages, eq(table.pageId, pages.id))
            .where(and(eq(table.id, contentId), eq(pages.workspaceId, workspaceId)));
        if (!owned) return { ok: false, reason: 'not_found' };

        // Clearing the rule (no reply) always drops any attached image too — a cleared
        // trigger owns no image. Otherwise honor the caller's explicit intent.
        const clearing = !triggerReply;
        const effectiveAction = clearing ? 'remove' : image.action;

        // Reply length (flat 1000 cap) is validated at the controller before this point —
        // an attached image is sent as its own message, so it never shortens the text budget.

        // Columns to write for the image. `undefined` here means "leave as-is" (keep).
        let imageColumns: { triggerImageUrl: string | null; triggerImageKey: string | null; triggerImageBytes: number | null } | undefined;
        let keyToDeleteAfterCommit: string | null = null;

        if (effectiveAction === 'set' && image.action === 'set') {
            // Quota: total workspace image bytes, minus what THIS row already holds
            // (a replace nets the delta), plus the incoming bytes.
            const newBytes = image.buffer.length;
            const workspaceBytes = await this.workspaceImageBytes(workspaceId);
            const projected = workspaceBytes - (owned.imageBytes ?? 0) + newBytes;
            if (projected > config.objectStorage.quotaBytes) {
                return { ok: false, reason: 'quota_exceeded' };
            }
            // Upload the NEW object FIRST, so a failed upload aborts the save with the
            // old image still intact (never a missing live image). Capture the failure
            // with context — otherwise an S3/R2 outage is an opaque 500.
            const key = `trigger-images/${workspaceId}/${randomUUID()}.${extForMime(image.mimeType)}`;
            let stored;
            try {
                stored = await imageStorage.put(key, image.buffer, image.mimeType);
            } catch (err) {
                captureError(err, 'Post Reply image upload failed', {
                    fingerprint: ['image-storage-put-failed'],
                    tags: { component: 'imageStorage', source },
                    extra: { workspaceId, contentId, bytes: newBytes },
                });
                throw err;
            }
            imageColumns = { triggerImageUrl: stored.url, triggerImageKey: stored.key, triggerImageBytes: newBytes };
            // Old object (if any, and different) is swept only AFTER the DB commit.
            if (owned.imageKey && owned.imageKey !== stored.key) keyToDeleteAfterCommit = owned.imageKey;
        } else if (effectiveAction === 'remove') {
            imageColumns = { triggerImageUrl: null, triggerImageKey: null, triggerImageBytes: null };
            if (owned.imageKey) keyToDeleteAfterCommit = owned.imageKey;
        }
        // effectiveAction === 'keep' → imageColumns stays undefined → columns untouched.

        const triggerColumns = {
            triggerKeyword,
            triggerReply,
            triggerType,
            // Veto keywords exist on both tables. Only write on explicit intent —
            // absent (undefined) leaves the column untouched (keep semantics).
            ...(triggerExcludeKeyword !== undefined ? { triggerExcludeKeyword } : {}),
            ...(imageColumns ?? {}),
            updatedAt: new Date(),
        };
        if (source === 'facebook') {
            // likeComment lives only on posts (the Instagram API can't like comments),
            // so the facebook branch writes it and the instagram branch has no column.
            // Only write when the caller expressed intent — absent leaves it untouched.
            await db
                .update(posts)
                .set({ ...triggerColumns, ...(likeComment !== undefined ? { likeComment } : {}) })
                .where(eq(posts.id, contentId));
        } else {
            await db
                .update(instagramMedia)
                .set(triggerColumns)
                .where(eq(instagramMedia.id, contentId));
        }

        // Safe-order delete: the new state is committed; only now drop the superseded
        // object. Best-effort — a failed delete leaves a harmless orphan, never a
        // missing live image (imageStorage.remove logs and swallows).
        if (keyToDeleteAfterCommit) {
            await imageStorage.remove(keyToDeleteAfterCommit);
        }

        return { ok: true };
    }

    /** Sum of trigger-image bytes across a workspace's FB posts + IG media (quota basis). */
    private async workspaceImageBytes(workspaceId: string): Promise<number> {
        const [p] = await db
            .select({ total: sql<string>`coalesce(sum(${posts.triggerImageBytes}), 0)` })
            .from(posts)
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(eq(pages.workspaceId, workspaceId));
        const [m] = await db
            .select({ total: sql<string>`coalesce(sum(${instagramMedia.triggerImageBytes}), 0)` })
            .from(instagramMedia)
            .innerJoin(pages, eq(instagramMedia.pageId, pages.id))
            .where(eq(pages.workspaceId, workspaceId));
        return Number(p?.total ?? 0) + Number(m?.total ?? 0);
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
    ): Promise<{ id: string; triggerKeyword: string | null; triggerReply: string | null; triggerType: 'keyword' | 'all'; triggerExcludeKeyword: string | null; triggerImageUrl: string | null; likeComment: boolean }> {
        if (source === 'facebook') {
            const post = await this.findOrCreateFromWebhook(page.id, platformPostId, undefined, page.accessToken);
            return {
                id: post.id,
                triggerKeyword: post.triggerKeyword ?? null,
                triggerReply: post.triggerReply ?? null,
                triggerType: post.triggerType === 'all' ? 'all' : 'keyword',
                triggerExcludeKeyword: post.triggerExcludeKeyword ?? null,
                triggerImageUrl: post.triggerImageUrl ?? null,
                likeComment: post.likeComment ?? false,
            };
        }
        const media = await this.findOrCreateInstagramMedia(page.id, platformPostId);
        return {
            id: media.id,
            triggerKeyword: media.triggerKeyword ?? null,
            triggerReply: media.triggerReply ?? null,
            triggerType: media.triggerType === 'all' ? 'all' : 'keyword',
            triggerExcludeKeyword: media.triggerExcludeKeyword ?? null,
            triggerImageUrl: media.triggerImageUrl ?? null,
            likeComment: false,
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


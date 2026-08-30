import { randomUUID } from 'crypto';
import { db } from '../db';
import { posts, pages, instagramMedia, contentCtaClassifications } from '../db/schema';
import { eq, desc, and, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { CreatePostDTO, UpdatePostDTO, Logger, noopLogger } from '../types';
import { facebookService } from './facebook';
import { instagramService } from './instagram';
import { resolveInstagramCredential, pageLinkedInstagramCredential } from './instagramCredential';
import { notificationService } from './notifications';
import { imageStorage } from './imageStorage';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { isUniqueViolation } from '../utils/dbErrors';
import { PostNotOwnedError } from './postErrors';
import { handlePageTokenFailure, withPageTokenRetry } from './pageTokenRecovery';
import { POST_REPLY_BUTTON_TEXT_MAX, type PublishedPost } from '@jawab24/shared';

/** How the caller wants the Post Reply image handled on this save. */
export type TriggerImageInput =
    | { action: 'keep' }                                    // default — leave the image column as-is
    | { action: 'remove' }                                  // delete the object + null the columns
    | { action: 'set'; buffer: Buffer; mimeType: string };  // upload + replace

export type UpdateTriggerResult =
    | { ok: true }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'quota_exceeded' }
    | { ok: false; reason: 'button_text_too_long' };

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
    /** Mention the commenter in the public comment. Same keep/set semantics and the same
     *  Facebook-only scoping as likeComment. */
    tagCommenter?: boolean;
    /** Veto keywords: undefined = keep; null = clear; string = set. Both platforms. */
    triggerExcludeKeyword?: string | null;
    /** CTA button label + URL (Facebook-only). undefined = keep; null = clear. Set together
     *  (the controller enforces both-or-neither); ignored on the instagram branch. */
    triggerButtonLabel?: string | null;
    triggerButtonUrl?: string | null;
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

/** How long after its scheduled time an arming marker may legitimately survive before the
 *  publish tripwire treats it as an id change. Covers the normal gap between Facebook
 *  publishing the post and the feed webhook reaching us (plus retries), so a slow webhook
 *  never masquerades as a drifted post id. */
export const SCHEDULED_MARKER_GRACE_MS = 30 * 60 * 1000;

/** Most Graph re-checks we will run in one publish webhook before alarming. Bounds the
 *  work a page with many stranded markers can cost per published post; anything past it
 *  is reported unverified rather than silently dropped. */
export const SCHEDULED_MARKER_RECHECK_MAX = 5;

/** Re-exported so `postsService` consumers keep a single import site; the class itself
 *  lives in its own module so the comment pipeline can catch it without importing this
 *  service (and everything it pulls in). */
export { PostNotOwnedError } from './postErrors';

/** The cutoff a scheduled-post arming marker must predate to be treated as overdue.
 *  Pure + exported so the grace window is testable without a database — the SQL bound
 *  and the in-memory re-check below both derive from this one function. */
export function staleMarkerCutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - SCHEDULED_MARKER_GRACE_MS);
}

type PickerPage = {
    id: string;
    facebookPageId: string | null;
    instagramAccountId?: string | null;
    accessToken: string;
    /** Required, not optional: `resolveInstagramCredential` discriminates on it, and
     *  an object literal that silently omitted it routed every Instagram-direct
     *  picker read to graph.facebook.com with the '' token (PR #772 review H2). */
    instagramAccessToken: string | null;
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
     * Trigger state for every post in a workspace — the ⚡ badge on the comments
     * screen and nothing else.
     *
     * ⚠️ TRIGGER FIELDS ONLY, deliberately. This used to `select` the full post
     * `message` (plus pageName/createdTime/autoReplyEnabled) for all 200 rows,
     * which measured up to **445 kB of post text per page load** on real
     * workspaces — against 0–2.7 kB of `triggerReply` actually read. The whole
     * dashboard API burst is 39 kB for comparison, so this single endpoint could
     * outweigh it tenfold on a slow connection.
     *
     * Its ONLY consumer is `frontend/src/pages/comments.tsx`, which reduces the
     * response to `{ id → { keyword, reply } }` on arrival and reads nothing
     * else. If a caller ever needs the post body, give it a separate endpoint
     * rather than widening this one back out — the body is what made it heavy.
     */
    async getPostsByWorkspace(workspaceId: string) {
        return db
            .select({
                id: posts.id,
                pageId: posts.pageId,
                triggerKeyword: posts.triggerKeyword,
                triggerReply: posts.triggerReply,
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
     * Get post by Facebook Post ID, scoped to a page (internal UUID).
     *
     * `pageId` is REQUIRED: `posts.facebook_post_id` is globally unique, so an unscoped
     * lookup on a caller-influenced path (the ensure endpoint) returns another
     * workspace's row. The one place that legitimately needs to see across pages is the
     * NULL-page adoption probe in `findOrCreateFromWebhook`, which uses the explicitly
     * named private helper below rather than making this parameter optional again.
     */
    async getPostByFacebookId(facebookPostId: string, pageId: string) {
        const result = await db
            .select()
            .from(posts)
            .where(and(eq(posts.facebookPostId, facebookPostId), eq(posts.pageId, pageId)));

        return result[0] || null;
    }

    /** Unscoped lookup on the globally-unique post id. Private and single-purpose: the
     *  ONLY caller is the unique-violation branch of `findOrCreateFromWebhook`, which has
     *  to know whether the conflicting row is unowned (adopt) or another page's (reject).
     *  Never return this row to a caller without checking `pageId` first. */
    private async findAnyPostByFacebookId(facebookPostId: string) {
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
        // The D-111 verdict row has no FK to posts (it is shared with instagram_media),
        // so it is removed here rather than by cascade; page deletion cascades via page_id.
        await db.delete(contentCtaClassifications).where(eq(contentCtaClassifications.contentId, postId));
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
            tagCommenter,
            triggerExcludeKeyword,
            triggerButtonLabel,
            triggerButtonUrl,
        } = opts;
        const table = source === 'instagram' ? instagramMedia : posts;

        // Ownership + current image, in one query. The current key/bytes drive the
        // safe-order delete (delete AFTER the row is committed) and the quota delta.
        const [owned] = await db
            .select({
                id: table.id,
                imageKey: table.triggerImageKey,
                imageBytes: table.triggerImageBytes,
                // Facebook-only column; the instagram_media select coalesces it to null below.
                buttonLabel: source === 'facebook' ? posts.triggerButtonLabel : sql<string | null>`NULL`,
            })
            .from(table)
            .innerJoin(pages, eq(table.pageId, pages.id))
            .where(and(eq(table.id, contentId), eq(pages.workspaceId, workspaceId)));
        if (!owned) return { ok: false, reason: 'not_found' };

        // Clearing the rule (no reply) always drops any attached image too — a cleared
        // trigger owns no image. Otherwise honor the caller's explicit intent.
        const clearing = !triggerReply;
        const effectiveAction = clearing ? 'remove' : image.action;

        // Button-template text cap: a CTA delivered WITHOUT an image rides a button template,
        // whose text is capped at 640 (tighter than the 1000 editor cap). Resolve the FINAL
        // image + button state (stored + this request's intent) — only here is it fully known.
        if (!clearing && triggerReply && source === 'facebook') {
            const finalHasImage =
                effectiveAction === 'set' ? true
                : effectiveAction === 'remove' ? false
                : !!owned.imageKey; // keep → stored image decides
            const finalHasButton =
                triggerButtonLabel !== undefined ? !!triggerButtonLabel   // set/clear this request
                : !!owned.buttonLabel;                                    // keep → stored button decides
            if (finalHasButton && !finalHasImage && triggerReply.length > POST_REPLY_BUTTON_TEXT_MAX) {
                return { ok: false, reason: 'button_text_too_long' };
            }
        }

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
            // likeComment, tagCommenter + the CTA button live only on posts (Facebook-only),
            // so the facebook branch writes them and the instagram branch has no column. Only
            // write when the caller expressed intent — absent leaves it untouched.
            await db
                .update(posts)
                .set({
                    ...triggerColumns,
                    ...(likeComment !== undefined ? { likeComment } : {}),
                    ...(tagCommenter !== undefined ? { tagCommenter } : {}),
                    ...(triggerButtonLabel !== undefined ? { triggerButtonLabel } : {}),
                    ...(triggerButtonUrl !== undefined ? { triggerButtonUrl } : {}),
                })
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
        const existing = await this.getPostByFacebookId(facebookPostId, pageId);

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

        try {
            return await this.createPost({
                pageId,
                facebookPostId,
                message: postMessage,
            });
        } catch (err) {
            // NOT a bare `err.code` read: drizzle wraps driver errors, so the SQLSTATE is
            // on `.cause` and the obvious check never matches (see utils/dbErrors).
            if (!isUniqueViolation(err)) throw err;

            // 23505 after a page-scoped miss has three possible causes, and only the last
            // is a foreign post. Getting this wrong is expensive: this function is on the
            // per-comment path (FacebookCommentAdapter.findOrCreateContent), so a throw
            // here loses the comment entirely.

            // 1. We lost a race with a concurrent insert for the SAME page.
            const winner = await this.getPostByFacebookId(facebookPostId, pageId);
            if (winner) return winner;

            // 2. The row exists but is owned by NOBODY (`page_id IS NULL`). `posts.page_id`
            //    is nullable and `CreatePostDTO.pageId` has only ever been required by
            //    convention, so such rows can exist from legacy/manual writes. They belong
            //    to no workspace, and refusing them would strand every future comment on
            //    that post — adopt onto this page instead. Guarded on `IS NULL` so a
            //    concurrent adopter can't be overwritten.
            const conflicting = await this.findAnyPostByFacebookId(facebookPostId);
            if (conflicting && conflicting.pageId === null) {
                const [adopted] = await db.update(posts)
                    .set({ pageId, updatedAt: new Date() })
                    .where(and(eq(posts.id, conflicting.id), isNull(posts.pageId)))
                    .returning();
                if (adopted) {
                    this.logger.info('[Posts] Adopted an unowned post row onto its page', {
                        pageId, facebookPostId,
                    });
                    return adopted;
                }
                // Someone adopted it between our read and write — re-read under our scope.
                const reread = await this.getPostByFacebookId(facebookPostId, pageId);
                if (reread) return reread;
            }

            // 3. Owned by a different page — a cross-tenant probe on the ensure endpoint.
            captureError(err, 'Post ensure hit a foreign post id', {
                level: 'warning',
                fingerprint: ['post-ensure-foreign-post'],
                tags: { pageId },
                extra: { pageId, facebookPostId, conflictingPageId: conflicting?.pageId ?? null },
            });
            throw new PostNotOwnedError(facebookPostId);
        }
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
    ): Promise<{ id: string; triggerKeyword: string | null; triggerReply: string | null; triggerType: 'keyword' | 'all'; triggerExcludeKeyword: string | null; triggerImageUrl: string | null; likeComment: boolean; tagCommenter: boolean; triggerButtonLabel: string | null; triggerButtonUrl: string | null; scheduledPublishTime: string | null }> {
        if (source === 'facebook') {
            // Two independent Graph reads (post content inside find-or-create, publish
            // state here) — issue them together rather than stacking two round-trips on
            // the merchant's modal open.
            const [post, state] = await Promise.all([
                this.findOrCreateFromWebhook(page.id, platformPostId, undefined, page.accessToken),
                page.accessToken
                    ? facebookService.getPostSchedule(platformPostId, page.accessToken)
                    : Promise.resolve(null),
            ]);
            const scheduledPublishTime = await this.syncScheduleMarker(post, state);
            if (scheduledPublishTime) {
                // The only in-production signal that anyone uses scheduled arming. The
                // platform behaviour this feature rests on is unverified, so "has this
                // ever fired?" must be answerable from logs.
                this.logger.info('[Posts] Post Reply armed on a still-scheduled post', {
                    pageId: page.id,
                    facebookPostId: platformPostId,
                    scheduledPublishTime: scheduledPublishTime.toISOString(),
                });
            }
            return {
                id: post.id,
                triggerKeyword: post.triggerKeyword ?? null,
                triggerReply: post.triggerReply ?? null,
                triggerType: post.triggerType === 'all' ? 'all' : 'keyword',
                triggerExcludeKeyword: post.triggerExcludeKeyword ?? null,
                triggerImageUrl: post.triggerImageUrl ?? null,
                likeComment: post.likeComment ?? false,
                tagCommenter: post.tagCommenter ?? false,
                triggerButtonLabel: post.triggerButtonLabel ?? null,
                triggerButtonUrl: post.triggerButtonUrl ?? null,
                scheduledPublishTime: scheduledPublishTime?.toISOString() ?? null,
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
            // IG mentions use `@username`, a different mechanism — no column, always false.
            tagCommenter: false,
            // IG has no button columns (button-template support unverified on IG).
            triggerButtonLabel: null,
            triggerButtonUrl: null,
            // The Instagram Graph API exposes no scheduled-media edge, so IG media is
            // always already published by the time the picker can show it.
            scheduledPublishTime: null,
        };
    }

    /**
     * Reconcile `posts.scheduled_publish_time` with what Graph said about the post, and
     * return the reconciled value. Called on the picker's arm path only — the merchant
     * chose the post, so one extra Graph read is cheap; the per-comment webhook path must
     * NOT pay for it (see findOrCreateFromWebhook, which stays a pure find-or-create).
     *
     * The schedule is read from Graph, never from the request body: the client tells us
     * WHICH post was tapped, and the platform tells us whether that post is still pending.
     * Graph declining to answer (`null`) means unknown — we keep whatever is stored rather
     * than guessing "published", because a wrong clear would disarm the tripwire.
     */
    private async syncScheduleMarker(
        post: { id: string; facebookPostId: string; scheduledPublishTime: Date | null },
        state: { isPublished: boolean; scheduledPublishTime: string | null } | null,
    ): Promise<Date | null> {
        if (!state) return post.scheduledPublishTime;

        const desired = state.isPublished || !state.scheduledPublishTime
            ? null
            : new Date(state.scheduledPublishTime);

        if ((desired?.getTime() ?? null) === (post.scheduledPublishTime?.getTime() ?? null)) {
            return post.scheduledPublishTime;
        }

        await db.update(posts)
            .set({ scheduledPublishTime: desired, updatedAt: new Date() })
            .where(eq(posts.id, post.id));
        return desired;
    }

    /**
     * A post went live on the page (feed webhook, item=post verb=add). Clears the arming
     * marker for that post id, and reconciles any OTHER post on the same page whose marker
     * is already overdue — the tripwire for "a scheduled post published under a DIFFERENT
     * id", which silently orphans the Post Reply the merchant configured.
     *
     * An overdue marker alone is NOT proof of drift: the far more likely cause is a publish
     * webhook we never received (page temporarily disconnected, Meta giving up on retries),
     * and treating that as drift makes the alarm fire on every subsequent publish, forever,
     * with no way to clear it from the product side. So each overdue marker is re-checked
     * against Graph first — published means "we missed the webhook", so clear it and stay
     * quiet; unknown means we cannot tell, so stay quiet too. Only a post Graph still
     * reports as pending past its own time is reported as orphaned.
     *
     * Detection, not prevention: Facebook owns the post id, so we cannot make the id
     * stable. What we CAN do is refuse to let the failure be silent — an orphaned trigger
     * looks exactly like a working one in the UI — and tell the MERCHANT, not just Sentry,
     * because they are the only one who can re-arm the post.
     */
    async onPostPublished(
        pageId: string,
        facebookPostId: string,
        opts?: { accessToken?: string | null; workspaceId?: string | null; pageName?: string | null },
    ): Promise<{ cleared: boolean; orphanedPostIds: string[]; healedPostIds: string[]; uncheckedPostIds: string[] }> {
        const [cleared] = await db.update(posts)
            .set({ scheduledPublishTime: null, updatedAt: new Date() })
            .where(and(
                eq(posts.pageId, pageId),
                eq(posts.facebookPostId, facebookPostId),
                isNotNull(posts.scheduledPublishTime),
            ))
            .returning({ id: posts.id });

        // Grace window: a marker whose time only just passed is the normal race between
        // "Facebook started publishing" and "our webhook landed", not an id change. The
        // SQL bound keeps the scan small; the same cutoff is re-applied in memory so the
        // grace logic is exercised by unit tests instead of living only in the database.
        const cutoff = staleMarkerCutoff();
        const rows = await db.select({
            id: posts.id,
            fbId: posts.facebookPostId,
            scheduledPublishTime: posts.scheduledPublishTime,
        })
            .from(posts)
            .where(and(
                eq(posts.pageId, pageId),
                isNotNull(posts.triggerReply),
                isNotNull(posts.scheduledPublishTime),
                lt(posts.scheduledPublishTime, cutoff),
            ));

        const candidates = rows.filter(r =>
            r.fbId !== facebookPostId
            && !!r.scheduledPublishTime
            && r.scheduledPublishTime < cutoff,
        );

        const orphanedPostIds: string[] = [];
        const healedPostIds: string[] = [];
        // Bounded: never let one page's stranded markers turn a publish webhook into an
        // unbounded fan-out of Graph reads. Anything past the cap is reported unchecked
        // rather than quietly assumed fine.
        const accessToken = opts?.accessToken;
        const checkable = accessToken ? candidates.slice(0, SCHEDULED_MARKER_RECHECK_MAX) : [];
        const uncheckedPostIds = candidates.slice(checkable.length).map(c => c.fbId);

        const states = accessToken
            ? await Promise.all(checkable.map(c => facebookService.getPostSchedule(c.fbId, accessToken)))
            : [];
        for (let i = 0; i < checkable.length; i++) {
            const state = states[i];
            // Unknown (token blip, post deleted): we cannot prove drift, so we do not claim it.
            if (!state) continue;
            if (state.isPublished) {
                // It DID publish under its own id — our clear-webhook never arrived.
                await db.update(posts)
                    .set({ scheduledPublishTime: null, updatedAt: new Date() })
                    .where(eq(posts.id, checkable[i].id));
                healedPostIds.push(checkable[i].fbId);
                continue;
            }
            orphanedPostIds.push(checkable[i].fbId);
        }

        if (healedPostIds.length > 0) {
            this.logger.info('[Posts] Healed scheduled markers whose publish webhook was missed', {
                pageId, healedPostIds,
            });
        }
        if (uncheckedPostIds.length > 0) {
            this.logger.warn('[Posts] Overdue scheduled markers left unchecked (cap reached or no token)', {
                pageId, uncheckedCount: uncheckedPostIds.length, cap: SCHEDULED_MARKER_RECHECK_MAX,
            });
        }

        if (orphanedPostIds.length > 0) {
            captureError(
                new Error('Armed scheduled post never published under its own id'),
                'Post Reply armed on a scheduled post may be orphaned',
                {
                    level: 'warning',
                    // Per page: one global fingerprint collapses every merchant into a
                    // single Sentry issue, so muting one merchant's drift hides them all.
                    fingerprint: ['post-reply-scheduled-id-drift', pageId],
                    tags: { pageId },
                    extra: { pageId, publishedPostId: facebookPostId, orphanedPostIds },
                },
            );
            // Sentry reaches US; the merchant is the only one who can fix it by re-arming.
            if (opts?.workspaceId) {
                await notificationService.sendTemplateNotificationToWorkspace(
                    opts.workspaceId,
                    'post_reply_orphaned',
                    { pageName: opts.pageName || '' },
                    { pageId, orphanedPostIds },
                ).catch(err => captureError(err, 'Failed to notify merchant of orphaned Post Reply', {
                    level: 'warning',
                    extra: { pageId, orphanedPostIds },
                }));
            }
        }

        return { cleared: !!cleared, orphanedPostIds, healedPostIds, uncheckedPostIds };
    }

    /** Map platform post ids → their stored trigger type, but ONLY for rows that
     *  actually carry a Post Reply (`trigger_reply` set). Absent id = no trigger.
     *  Scoped to the page: the ids come from the page's own Graph listing today, but an
     *  unscoped read on the globally-unique column is the same shape as the cross-tenant
     *  leak the ensure path just closed — don't leave the second copy of it lying around. */
    private async facebookTriggerMap(pageId: string, facebookPostIds: string[]): Promise<Map<string, 'keyword' | 'all'>> {
        const map = new Map<string, 'keyword' | 'all'>();
        if (facebookPostIds.length === 0) return map;
        const rows = await db
            .select({ fbId: posts.facebookPostId, triggerType: posts.triggerType })
            .from(posts)
            .where(and(
                eq(posts.pageId, pageId),
                inArray(posts.facebookPostId, facebookPostIds),
                isNotNull(posts.triggerReply),
            ));
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
     * so the caller wraps) but set `partial` so the picker can say the list is incomplete
     * instead of letting a token problem read as "you have no posts". Newest first,
     * `limit` items (default 5) + a `nextCursor`.
     *
     * `includeScheduled` opts into the page's still-pending posts. It is an opt-in, not a
     * default, because a shipped mobile build that predates the field renders a scheduled
     * post as a published one with no date — see PublishedPost in @jawab24/shared.
     */
    async listPublishedPosts(
        page: PickerPage,
        opts: { source: 'facebook' | 'instagram'; limit?: number; after?: string; includeScheduled?: boolean },
    ): Promise<{ posts: PublishedPost[]; nextCursor: string | null; partial: boolean }> {
        const limit = opts.limit ?? PICKER_PAGE_SIZE;

        if (opts.source === 'facebook') {
            if (!page.facebookPageId) return { posts: [], nextCursor: null, partial: false };
            // Scheduled posts only belong on the FIRST page: they are a small, bounded set
            // that lives at the top of the list, and mixing a second Graph edge into
            // "load more" would need a second cursor to page independently. Fetched in
            // parallel with the published page — two independent Graph reads.
            const wantScheduled = !!opts.includeScheduled && !opts.after;
            const facebookPageId = page.facebookPageId;
            const readSlice = (accessToken: string) => Promise.all([
                facebookService.getPagePosts(facebookPageId, accessToken, { limit, after: opts.after }),
                wantScheduled
                    ? facebookService.getScheduledPosts(facebookPageId, accessToken)
                    : Promise.resolve({ posts: [], failed: false, truncated: false, error: undefined }),
            ]);

            let [published, scheduled] = await readSlice(page.accessToken);

            // Both reads fail SOFT, so a dead page credential arrives here as an
            // empty list rather than an exception — which is exactly how it reached
            // a merchant as "لا توجد منشورات حديثة" while the real answer was "your
            // Facebook connection ended" (2026-08-14). Recover the token in-request
            // and read once more; `handlePageTokenFailure` alerts the merchant when
            // it cannot, and returns null for every non-token error.
            //
            // ONLY the published edge is a credential verdict. `/scheduled_posts`
            // needs manage-level permission the published edge does not, so it can
            // fail 200|10 while the same token is serving replies fine — and if the
            // owner's USER token is also long dead, recovery would then clear a
            // WORKING page token over a permission gap on an optional edge. A
            // scheduled-only failure keeps its pre-existing answer: `partial: true`.
            const readError = published.error;
            if (readError) {
                const freshToken = await handlePageTokenFailure(page.id, readError);
                if (freshToken) {
                    [published, scheduled] = await readSlice(freshToken);
                }
            }
            // At the publish boundary Graph can briefly return the same post on BOTH edges.
            // The published copy is the truthful one (it's live), so drop the scheduled
            // twin — otherwise the picker renders one post twice under one React key.
            const publishedIds = new Set(published.posts.map(p => p.id));
            const pending = scheduled.posts.filter(p => !publishedIds.has(p.id));

            const triggers = await this.facebookTriggerMap(
                page.id,
                [...pending.map(p => p.id), ...published.posts.map(p => p.id)],
            );
            return {
                posts: [
                    // Soonest-first: the next post to go live is the one the merchant is
                    // most likely arming. Graph's own order on this edge is unspecified.
                    // A pending post Graph gave no time for sorts LAST (it can't be the
                    // "soonest") and still renders as scheduled — the edge it came from
                    // is what makes it pending, not the presence of a timestamp.
                    ...[...pending]
                        .sort((a, b) => (a.scheduledPublishTime ?? '￿').localeCompare(b.scheduledPublishTime ?? '￿'))
                        .map(p => ({
                            platformPostId: p.id,
                            source: 'facebook' as const,
                            message: p.message,
                            imageUrl: p.imageUrl,
                            // A scheduled post is not published, so it has no publish date
                            // and can carry no comments — null, never a fabricated 0/now.
                            createdTime: null,
                            commentsCount: null,
                            hasTrigger: triggers.has(p.id),
                            triggerType: triggers.get(p.id) ?? null,
                            scheduledPublishTime: p.scheduledPublishTime,
                            isScheduled: true,
                        })),
                    ...published.posts.map(p => ({
                        platformPostId: p.id,
                        source: 'facebook' as const,
                        message: p.message,
                        imageUrl: p.imageUrl,
                        createdTime: p.createdTime,
                        commentsCount: p.commentsCount,
                        hasTrigger: triggers.has(p.id),
                        triggerType: triggers.get(p.id) ?? null,
                        scheduledPublishTime: null,
                        isScheduled: false,
                    })),
                ],
                nextCursor: published.nextCursor,
                partial: published.failed || scheduled.failed || scheduled.truncated,
            };
        }

        if (!page.instagramAccountId) return { posts: [], nextCursor: null, partial: false };
        const instagramAccountId = page.instagramAccountId;
        // Page-linked Instagram rides the SAME page token as Facebook (IG is columns
        // on the page row, not a separate credential), so one revoked session kills
        // both. Unlike the Facebook reads above this one THROWS — the controller turns
        // it into a 500 and the app shows «حدث خطأ ما» — so it gets the wrapper rather
        // than the fail-soft treatment: re-mint once, retry once, otherwise rethrow
        // untouched.
        //
        // An Instagram Login page has no Facebook Page to re-mint from, so the wrapper
        // there would spend a Redis cooldown claim and a DB read on a recovery that
        // always returns null. It runs the call directly on its own credential; the
        // 60-day token is kept alive by `instagramLoginService.runRefreshSweep`.
        const cred = resolveInstagramCredential(page);
        const { media, nextCursor } = cred.direct
            ? await instagramService.getMedia(instagramAccountId, cred, { limit, after: opts.after })
            : await withPageTokenRetry(page, accessToken =>
                instagramService.getMedia(
                    instagramAccountId,
                    pageLinkedInstagramCredential(accessToken),
                    { limit, after: opts.after },
                ),
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
                // No scheduled-media edge on the Instagram Graph API, so IG media is always
                // already published. Explicit rather than absent, so the field means the
                // same thing on both sources.
                scheduledPublishTime: null,
                isScheduled: false,
            })),
            nextCursor,
            partial: false,
        };
    }
}

export const postsService = new PostsService();


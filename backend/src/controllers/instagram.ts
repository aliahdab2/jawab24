import { FastifyReply, FastifyRequest } from 'fastify';
import type { ResolvedWorkspaceRequest } from '../middleware/workspace';
import { pagesService } from '../services/pages';
import { instagramService } from '../services/instagram';
import { resolveInstagramCredential } from '../services/instagramCredential';
import { subscriptionsService } from '../services/subscriptions';
import { channelTrialService } from '../services/channelTrial';
import { recordAutoreplyEnabledIfEffective } from '../services/activation';
import { businessInfoGate } from '../services/businessReadiness';
import { pageGateError } from '../utils/pageGateResponse';
import { db } from '../db';
import { instagramMedia, instagramComments } from '../db/schema';
import { eq, desc, inArray, sql } from 'drizzle-orm';
import type { InstagramComment } from '../types';

export class InstagramController {
    /**
     * Get Instagram media for a page
     * GET /instagram/:pageId/media
     */
    async getMedia(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { pageId } = request.params;

        try {
            // Get page and verify workspace ownership
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            if (!page.instagramAccountId) {
                return reply.status(400).send({
                    error: 'No Instagram account linked to this page',
                    hint: 'Please link an Instagram Business Account to your Facebook Page first'
                });
            }

            // Get media from database
            const media = await db
                .select()
                .from(instagramMedia)
                .where(eq(instagramMedia.pageId, pageId))
                .orderBy(desc(instagramMedia.createdTime))
                .limit(100);

            return reply.send(media);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch Instagram media' });
        }
    }

    /**
     * Get comments for Instagram media
     * GET /instagram/media/:mediaId/comments
     */
    async getComments(
        request: FastifyRequest<{ Params: { mediaId: string } }>,
        reply: FastifyReply
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { mediaId } = request.params;

        try {
            // Get media and verify ownership through page
            const mediaItem = await db
                .select()
                .from(instagramMedia)
                .where(eq(instagramMedia.id, mediaId));

            if (!mediaItem[0]) {
                return reply.status(404).send({ error: 'Media not found' });
            }

            // Verify page ownership
            const pageId = mediaItem[0].pageId;
            if (!pageId) {
                return reply.status(404).send({ error: 'Media has no associated page' });
            }
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Access denied' });
            }

            // Get comments from database
            const comments = await db
                .select()
                .from(instagramComments)
                .where(eq(instagramComments.mediaId, mediaId))
                .orderBy(desc(instagramComments.createdTime))
                .limit(200);

            return reply.send(comments);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch Instagram comments' });
        }
    }

    /**
     * Reply to an Instagram comment
     * POST /instagram/comments/:commentId/reply
     */
    async replyToComment(
        request: FastifyRequest<{
            Params: { commentId: string };
            Body: { message: string }
        }>,
        reply: FastifyReply
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { commentId } = request.params;
        const { message } = request.body;

        if (!message) {
            return reply.status(400).send({ error: 'Message is required' });
        }

        try {
            // Get comment from database
            const comment = await db
                .select()
                .from(instagramComments)
                .where(eq(instagramComments.id, commentId));

            if (!comment[0]) {
                return reply.status(404).send({ error: 'Comment not found' });
            }

            // Get media to get page access
            const commentMediaId = comment[0].mediaId;
            if (!commentMediaId) {
                return reply.status(404).send({ error: 'Comment has no associated media' });
            }
            const media = await db
                .select()
                .from(instagramMedia)
                .where(eq(instagramMedia.id, commentMediaId));

            if (!media[0]) {
                return reply.status(404).send({ error: 'Media not found' });
            }

            // Verify page ownership and get access token
            const mediaPageId = media[0].pageId;
            if (!mediaPageId) {
                return reply.status(404).send({ error: 'Media has no associated page' });
            }
            const page = await pagesService.getPage(req.workspaceId, mediaPageId);
            if (!page) {
                return reply.status(403).send({ error: 'Access denied' });
            }

            // Post reply to Instagram
            const replyId = await instagramService.replyToComment(
                comment[0].instagramCommentId,
                message,
                resolveInstagramCredential(page)
            );

            // Update comment in database
            await db
                .update(instagramComments)
                .set({
                    replied: true,
                    replyText: message,
                    replyMethod: 'manual',
                    repliedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(instagramComments.id, commentId));

            return reply.send({
                success: true,
                replyId,
                message: 'Reply posted successfully'
            });
        } catch (error) {
            request.log.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return reply.status(500).send({
                error: 'Failed to post reply',
                details: errorMessage
            });
        }
    }

    /**
     * Toggle Instagram auto-reply for a page
     * PATCH /pages/:id/instagram-auto-reply
     */
    async toggleAutoReply(
        request: FastifyRequest<{
            Params: { id: string };
            Body: { enabled: boolean }
        }>,
        reply: FastifyReply
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.user || !req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { workspaceId, workspaceOwnerId } = req;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                // Hoisted out of the trial block below: the readiness gate needs it
                // too, and fetching the page twice in one request would be the
                // cheaper-looking mistake.
                const existingPage = await pagesService.getPage(workspaceId, id);

                // Same readiness bar as the Facebook and WhatsApp toggles — never
                // put a bot in front of customers with nothing to answer from.
                // Checked before the billing gates because it is the one blocker the
                // merchant can clear for free.
                const infoGate = await businessInfoGate(existingPage);
                if (infoGate) return reply.status(infoGate.status).send(infoGate.body);

                const limitCheck = await subscriptionsService.canEnablePage(workspaceOwnerId, workspaceId, id);
                if (!limitCheck.allowed) {
                    const { status, body } = pageGateError(limitCheck);
                    return reply.status(status).send(body);
                }

                // Anti free-trial-abuse: a channel gets one free trial across the
                // platform. If this channel already used it under another account
                // and this account isn't paying, keep auto-reply off until they
                // subscribe (paying unlocks it instantly).
                if (existingPage) {
                    const trialCheck = await channelTrialService.evaluate(
                        workspaceOwnerId,
                        channelTrialService.channelsForPage(existingPage),
                    );
                    if (trialCheck.blocked) {
                        return reply.status(402).send({
                            error: 'This account has already used its free trial. Subscribe to enable auto-reply.',
                            code: 'TRIAL_ALREADY_USED',
                        });
                    }
                }
            }

            const page = await pagesService.toggleInstagramAutoReply(workspaceId, id, enabled);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }
            // Claim the channels for the billing account (first writer wins).
            if (enabled) {
                await channelTrialService.record(
                    channelTrialService.channelsForPage(page),
                    workspaceOwnerId,
                    workspaceId,
                );
                // Activation funnel (D-026): same emit as the FB page toggle — the
                // gate counts instagramAutoReplyEnabled, so an IG-channel enable can
                // be the step that makes the pipeline effective.
                if (page.userId) {
                    void recordAutoreplyEnabledIfEffective(page.userId, workspaceId, { pageId: page.id, source: 'page_toggle' });
                }
            }
            return reply.send(page);
        } catch (error) {
            request.log.error(error);
            return reply.status(500).send({ error: 'Failed to toggle Instagram auto-reply' });
        }
    }

    /**
     * Sync Instagram media and comments from API
     * POST /instagram/:pageId/sync
     */
    async syncMedia(
        request: FastifyRequest<{ Params: { pageId: string } }>,
        reply: FastifyReply
    ) {
        const req = request as ResolvedWorkspaceRequest;
        if (!req.workspaceId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { pageId } = request.params;

        try {
            // Get page and verify workspace ownership
            const page = await pagesService.getPage(req.workspaceId, pageId);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
            }

            if (!page.instagramAccountId) {
                return reply.status(400).send({
                    error: 'No Instagram account linked to this page',
                    hint: 'Please link an Instagram Business Account to your Facebook Page first'
                });
            }

            request.log.info(`[Instagram] Starting sync for page ${pageId}`);

            // Fetch media from Instagram API
            const { media: igMedia } = await instagramService.getMedia(
                page.instagramAccountId,
                resolveInstagramCredential(page)
            );

            let syncedMedia = 0;
            let syncedComments = 0;

            // Phase 1: Bulk upsert all media in a single round trip.
            // Pre-fetch existing IDs only to count new-vs-updated correctly;
            // the actual write is one batched INSERT … ON CONFLICT DO UPDATE.
            const mediaPkByPlatformId = new Map<string, string>();
            if (igMedia.length > 0) {
                const igMediaIds = igMedia.map(m => m.id);
                const existingMediaRows = await db
                    .select({ instagramMediaId: instagramMedia.instagramMediaId })
                    .from(instagramMedia)
                    .where(inArray(instagramMedia.instagramMediaId, igMediaIds));
                const existingMediaIds = new Set(existingMediaRows.map(r => r.instagramMediaId));
                syncedMedia = igMediaIds.filter(id => !existingMediaIds.has(id)).length;

                const upserted = await db
                    .insert(instagramMedia)
                    .values(igMedia.map(item => ({
                        pageId,
                        instagramMediaId: item.id,
                        mediaType: item.media_type,
                        caption: item.caption,
                        permalink: item.permalink,
                        thumbnailUrl: item.thumbnail_url,
                        createdTime: item.timestamp ? new Date(item.timestamp) : null,
                    })))
                    .onConflictDoUpdate({
                        target: instagramMedia.instagramMediaId,
                        set: {
                            caption: sql`EXCLUDED.caption`,
                            permalink: sql`EXCLUDED.permalink`,
                            thumbnailUrl: sql`EXCLUDED.thumbnail_url`,
                            updatedAt: new Date(),
                        },
                    })
                    .returning({
                        id: instagramMedia.id,
                        instagramMediaId: instagramMedia.instagramMediaId,
                    });

                for (const r of upserted) {
                    mediaPkByPlatformId.set(r.instagramMediaId, r.id);
                }
            }

            // Phase 2: Fetch comments per media (per-media IG Graph call is
            // unavoidable). Collect first, then batch the DB writes.
            // Track per-media fetch failures so partial outages (rate limit,
            // permission revoked on a subset of media) surface to the merchant
            // instead of being reported as success: true with undercount.
            const collectedComments: Array<{ mediaPk: string; comment: InstagramComment }> = [];
            let commentFetchFailures = 0;
            for (const item of igMedia) {
                const mediaPk = mediaPkByPlatformId.get(item.id);
                if (!mediaPk) continue;
                try {
                    const igComments = await instagramService.getComments(
                        item.id,
                        resolveInstagramCredential(page)
                    );
                    for (const comment of igComments) {
                        collectedComments.push({ mediaPk, comment });
                    }
                } catch (commentsError) {
                    commentFetchFailures++;
                    request.log.warn(`Failed to fetch comments for media ${item.id}: ${commentsError}`);
                }
            }

            // Phase 3: Bulk upsert all comments in two round trips total
            // (one SELECT for the new-vs-existing split, one INSERT for new rows).
            if (collectedComments.length > 0) {
                const commentIds = collectedComments.map(c => c.comment.id);
                const existingCommentRows = await db
                    .select({ instagramCommentId: instagramComments.instagramCommentId })
                    .from(instagramComments)
                    .where(inArray(instagramComments.instagramCommentId, commentIds));
                const existingCommentSet = new Set(existingCommentRows.map(r => r.instagramCommentId));

                const newComments = collectedComments.filter(
                    ({ comment }) => !existingCommentSet.has(comment.id)
                );

                if (newComments.length > 0) {
                    // Race-safe: a concurrent webhook may have inserted the same
                    // instagram_comment_id between our SELECT and INSERT.
                    // .returning() counts only rows actually inserted (ON CONFLICT
                    // DO NOTHING skips conflicting rows), so the reported count
                    // stays accurate when we lose the race.
                    const inserted = await db
                        .insert(instagramComments)
                        .values(newComments.map(({ mediaPk, comment }) => ({
                            mediaId: mediaPk,
                            workspaceId: req.workspaceId,
                            instagramCommentId: comment.id,
                            message: comment.text,
                            fromId: comment.from?.id,
                            fromUsername: comment.from?.username,
                            createdTime: comment.timestamp ? new Date(comment.timestamp) : null,
                        })))
                        .onConflictDoNothing({ target: instagramComments.instagramCommentId })
                        .returning({ id: instagramComments.id });
                    syncedComments = inserted.length;
                }
            }

            const partial = commentFetchFailures > 0;
            if (partial) {
                request.log.warn(`[Instagram] Sync completed with ${commentFetchFailures} per-media comment-fetch failures — comment count is undercounted`);
            }
            request.log.info(`[Instagram] Sync complete: ${syncedMedia} new media, ${syncedComments} new comments${partial ? ` (${commentFetchFailures} media skipped)` : ''}`);

            return reply.send({
                // success=false on partial fetch failures so the merchant's
                // dashboard surfaces the issue instead of reporting a clean run
                // when comments were silently dropped (rate limit, partial token
                // revoke, etc.).
                success: !partial,
                synced: {
                    media: syncedMedia,
                    comments: syncedComments,
                },
                ...(partial ? { warnings: { commentFetchFailures } } : {}),
            });
        } catch (error) {
            request.log.error(error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return reply.status(500).send({
                error: 'Failed to sync Instagram data',
                details: errorMessage
            });
        }
    }
}

export const instagramController = new InstagramController();

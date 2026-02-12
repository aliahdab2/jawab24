import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedRequest } from '../middleware/auth';
import { pagesService } from '../services/pages';
import { instagramService } from '../services/instagram';
import { subscriptionsService } from '../services/subscriptions';
import { db } from '../db';
import { instagramMedia, instagramComments } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export class InstagramController {
    /**
     * Get Instagram media for a page
     * GET /instagram/:pageId/media
     */
    async getMedia(
        request: FastifyRequest<{ Params: { pageId: string } }>, 
        reply: FastifyReply
    ) {
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { pageId } = request.params;

        try {
            // Get page and verify ownership
            const page = await pagesService.getPage(userId, pageId);
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
                .orderBy(desc(instagramMedia.createdTime));

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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
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
            const page = await pagesService.getPage(userId, pageId);
            if (!page) {
                return reply.status(403).send({ error: 'Access denied' });
            }

            // Get comments from database
            const comments = await db
                .select()
                .from(instagramComments)
                .where(eq(instagramComments.mediaId, mediaId))
                .orderBy(desc(instagramComments.createdTime));

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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
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
            const page = await pagesService.getPage(userId, mediaPageId);
            if (!page) {
                return reply.status(403).send({ error: 'Access denied' });
            }

            // Post reply to Instagram
            const replyId = await instagramService.replyToComment(
                comment[0].instagramCommentId,
                message,
                page.accessToken
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { id } = request.params;
        const { enabled } = request.body;

        try {
            // Only check limit when ENABLING (disabling is always allowed)
            if (enabled) {
                const limitCheck = await subscriptionsService.canEnablePage(userId, id);
                if (!limitCheck.allowed) {
                    return reply.status(403).send({
                        error: limitCheck.reason || 'Page limit reached',
                        code: 'PAGE_LIMIT_REACHED',
                        limit: limitCheck.limit,
                        used: limitCheck.used,
                    });
                }
            }

            const page = await pagesService.toggleInstagramAutoReply(userId, id, enabled);
            if (!page) {
                return reply.status(404).send({ error: 'Page not found' });
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
        const user = (request as AuthenticatedRequest).user;
        if (!user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { userId } = user;
        const { pageId } = request.params;

        try {
            // Get page and verify ownership
            const page = await pagesService.getPage(userId, pageId);
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
            const igMedia = await instagramService.getMedia(
                page.instagramAccountId,
                page.accessToken
            );

            let syncedMedia = 0;
            let syncedComments = 0;

            for (const item of igMedia) {
                // Upsert media
                const existing = await db
                    .select()
                    .from(instagramMedia)
                    .where(eq(instagramMedia.instagramMediaId, item.id));

                let mediaId: string;

                if (existing[0]) {
                    // Update existing media
                    await db
                        .update(instagramMedia)
                        .set({
                            caption: item.caption,
                            permalink: item.permalink,
                            thumbnailUrl: item.thumbnail_url,
                            updatedAt: new Date(),
                        })
                        .where(eq(instagramMedia.id, existing[0].id));
                    mediaId = existing[0].id;
                } else {
                    // Insert new media
                    const [inserted] = await db
                        .insert(instagramMedia)
                        .values({
                            pageId,
                            instagramMediaId: item.id,
                            mediaType: item.media_type,
                            caption: item.caption,
                            permalink: item.permalink,
                            thumbnailUrl: item.thumbnail_url,
                            createdTime: item.timestamp ? new Date(item.timestamp) : null,
                        })
                        .returning();
                    mediaId = inserted.id;
                    syncedMedia++;
                }

                // Fetch and sync comments for this media
                try {
                    const igComments = await instagramService.getComments(
                        item.id,
                        page.accessToken
                    );

                    for (const comment of igComments) {
                        const existingComment = await db
                            .select()
                            .from(instagramComments)
                            .where(eq(instagramComments.instagramCommentId, comment.id));

                        if (!existingComment[0]) {
                            await db
                                .insert(instagramComments)
                                .values({
                                    mediaId,
                                    instagramCommentId: comment.id,
                                    message: comment.text,
                                    fromId: comment.from?.id,
                                    fromUsername: comment.from?.username,
                                    createdTime: comment.timestamp ? new Date(comment.timestamp) : null,
                                });
                            syncedComments++;
                        }
                    }
                } catch (commentsError) {
                    request.log.warn(`Failed to fetch comments for media ${item.id}: ${commentsError}`);
                }
            }

            request.log.info(`[Instagram] Sync complete: ${syncedMedia} new media, ${syncedComments} new comments`);

            return reply.send({
                success: true,
                synced: {
                    media: syncedMedia,
                    comments: syncedComments,
                },
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


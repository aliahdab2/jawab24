import { pagesService } from './pages';
import { settingsService } from './settings';
import { instagramService } from './instagram';
import { messagesService } from './messages';
import { replyGenerator } from './reply/generator';
import { rateLimiter } from './protection/rate-limiter';
import { notificationService } from './notifications';
import { messageProcessor } from './reply/messageProcessor';
import { instagramMessageAdapter } from './reply/adapters';
import { detectLanguageCode } from '../utils/language';
import { db } from '../db';
import { instagramMedia, instagramComments } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Logger, noopLogger, InstagramReplyResult, InstagramMessageResult } from '../types';

export class InstagramReplyService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
        replyGenerator.setLogger(logger);
        rateLimiter.setLogger(logger);
        messageProcessor.setLogger(logger);
    }

    /**
     * Process an incoming Instagram comment and generate a reply
     */
    async processComment(
        instagramAccountId: string,
        mediaId: string,
        instagramCommentId: string,
        commentMessage: string,
        fromId?: string,
        fromUsername?: string
    ): Promise<InstagramReplyResult> {
        try {
            // 1. Get page by Instagram Account ID
            const page = await pagesService.getPageByInstagramId(instagramAccountId);
            if (!page) {
                return { success: false, commentId: instagramCommentId, error: 'Page not found' };
            }

            if (!page.instagramAutoReplyEnabled) {
                return { success: false, commentId: instagramCommentId, error: 'Instagram auto-reply disabled for this page' };
            }

            // Ensure page has an associated user
            if (!page.userId) {
                return { success: false, commentId: instagramCommentId, error: 'Page has no associated user' };
            }
            const pageUserId = page.userId;

            // 2. Check user settings for comments auto-reply
            const isCommentsEnabled = await settingsService.isCommentsAutoReplyEnabled(pageUserId);
            if (!isCommentsEnabled) {
                // Store the comment but don't reply
                await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);
                return { success: false, commentId: instagramCommentId, error: 'Comments auto-reply disabled' };
            }

            // 3. Find or create the media record
            const media = await this.findOrCreateMedia(page.id, mediaId);
            if (!media.autoReplyEnabled) {
                await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);
                return { success: false, commentId: instagramCommentId, error: 'Auto-reply disabled for this media' };
            }

            // 4. Check if comment already exists
            const existingComment = await db
                .select()
                .from(instagramComments)
                .where(eq(instagramComments.instagramCommentId, instagramCommentId));

            if (existingComment[0]?.replied) {
                return { success: false, commentId: instagramCommentId, error: 'Comment already replied' };
            }

            // 4.5 Handoff pause
            if (fromId) {
                const isPaused = await messagesService.isPaused(page.id, fromId);
                if (isPaused) {
                    this.logger.info('[Instagram] Comment skipped — handoff active', { fromId });
                    await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);
                    return { success: false, commentId: instagramCommentId, error: 'Handoff active' };
                }
            }

            // 4.6 Rate limiting
            if (fromId) {
                const rateCheck = await rateLimiter.check(page.id, fromId, 'comment');
                if (!rateCheck.allowed) {
                    this.logger.info('[Instagram] Comment rate limited', { fromId });
                    await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);
                    return { success: false, commentId: instagramCommentId, error: 'Rate limited' };
                }
            }

            // 5. Store the comment
            const comment = await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);

            // 6. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(pageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 7. Generate reply via unified generator (template matching + AI + subscription limits)
            const userSettings = await settingsService.getSettings(pageUserId);
            const genResult = await replyGenerator.generateForComment(
                {
                    userId: pageUserId,
                    text: commentMessage,
                    pageName: page.name || undefined,
                    knowledgeBase: page.knowledgeBase || undefined,
                    postMessage: media.caption || undefined,
                    pageId: page.id,
                },
                userSettings.aiEnabled ?? false
            );
            let replyText = genResult.replyText;
            const replyMethod = genResult.replyMethod;
            const needsAttention = genResult.needsAttention ?? false;
            const flagReason = genResult.flagReason;
            const aiIntent = genResult.aiIntent;

            // 8. Fallback if no reply
            if (!replyText) {
                replyText = 'Thank you for your comment! 🙏';
            }

            // 9. Post reply to Instagram
            try {
                await instagramService.replyToComment(
                    instagramCommentId,
                    replyText,
                    page.accessToken
                );
            } catch (error) {
                this.logger.error('[Instagram] Failed to post reply', { error: String(error) });
                return {
                    success: false,
                    commentId: comment.id,
                    error: 'Failed to post reply to Instagram'
                };
            }

            // 10. Mark comment as replied
            const detectedLanguage = detectLanguageCode(commentMessage);
            await db
                .update(instagramComments)
                .set({
                    replied: true,
                    replyText,
                    replyMethod,
                    needsAttention,
                    flagReason: flagReason ?? null,
                    aiIntent: aiIntent ?? null,
                    detectedLanguage,
                    repliedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(instagramComments.id, comment.id));

            // 11. Notify if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId, 'flagged_reply',
                    { senderName: fromUsername || 'Unknown', reason: flagReason || 'AI flagged' },
                    { type: 'instagram_comment', deepLink: '/dashboard?filter=flagged' }
                ).catch(err => this.logger.error('Notification failed', { err }));
            }

            return {
                success: true,
                commentId: comment.id,
                replyText,
                replyMethod,
            };

        } catch (error) {
            this.logger.error('[Instagram] Error processing comment', { 
                instagramCommentId,
                error: error instanceof Error ? error.message : String(error) 
            });
            return {
                success: false,
                commentId: instagramCommentId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Process an incoming Instagram DM.
     * Delegates to the shared platform-agnostic pipeline via the Instagram adapter.
     */
    async processMessage(
        instagramAccountId: string,
        senderId: string,
        messageText: string,
        messageId: string,
    ): Promise<InstagramMessageResult> {
        return messageProcessor.processMessage(
            instagramMessageAdapter, instagramAccountId, senderId, messageText, messageId,
        );
    }

    // ================== Helper Methods ==================

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async findOrCreateMedia(pageId: string, instagramMediaId: string) {
        const existing = await db
            .select()
            .from(instagramMedia)
            .where(eq(instagramMedia.instagramMediaId, instagramMediaId));

        if (existing[0]) {
            return existing[0];
        }

        const [created] = await db
            .insert(instagramMedia)
            .values({
                pageId,
                instagramMediaId,
                autoReplyEnabled: true,
            })
            .returning();

        return created;
    }

    private async storeComment(
        pageId: string,
        mediaId: string,
        instagramCommentId: string,
        message: string,
        fromId?: string,
        fromUsername?: string
    ) {
        // First ensure media exists
        const media = await this.findOrCreateMedia(pageId, mediaId);

        // Check if comment exists
        const existing = await db
            .select()
            .from(instagramComments)
            .where(eq(instagramComments.instagramCommentId, instagramCommentId));

        if (existing[0]) {
            return existing[0];
        }

        const [created] = await db
            .insert(instagramComments)
            .values({
                mediaId: media.id,
                instagramCommentId,
                message,
                fromId,
                fromUsername,
                createdTime: new Date(),
            })
            .returning();

        return created;
    }

}

export const instagramReplyService = new InstagramReplyService();


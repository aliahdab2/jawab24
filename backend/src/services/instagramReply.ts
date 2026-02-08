import { pagesService } from './pages';
import { settingsService } from './settings';
import { instagramService } from './instagram';
import { messagesService } from './messages';
import { replyGenerator } from './reply/generator';
import { rateLimiter } from './protection/rate-limiter';
import { notificationService } from './notifications';
import { detectLanguageCode } from '../utils/language';
import { db } from '../db';
import { instagramMedia, instagramComments, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Logger, noopLogger, InstagramReplyResult, InstagramMessageResult } from '../types';

export class InstagramReplyService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
        replyGenerator.setLogger(logger);
        rateLimiter.setLogger(logger);
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

            // 4.5 Handoff pause: skip auto-reply if conversation is paused
            if (fromId) {
                const paused = await messagesService.isPaused(page.id, fromId);
                if (paused) {
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
     * Process an incoming Instagram DM
     */
    async processMessage(
        instagramAccountId: string,
        senderId: string,
        messageText: string,
        messageId: string
    ): Promise<InstagramMessageResult> {
        try {
            // 1. Get page by Instagram Account ID
            const page = await pagesService.getPageByInstagramId(instagramAccountId);
            if (!page) {
                return { success: false, messageId, error: 'Page not found' };
            }

            if (!page.instagramAutoReplyEnabled) {
                return { success: false, messageId, error: 'Instagram auto-reply disabled for this page' };
            }

            // Ensure page has an associated user
            if (!page.userId) {
                return { success: false, messageId, error: 'Page has no associated user' };
            }
            const msgPageUserId = page.userId;

            // 2. Check user settings for messages auto-reply
            const isMessagesEnabled = await settingsService.isMessagesAutoReplyEnabled(msgPageUserId);

            // 3. Store the incoming message
            const storedMessage = await this.storeMessage(
                page.id,
                messageId,
                senderId,
                messageText
            );

            if (!isMessagesEnabled) {
                // Send away message if configured
                const awayMessage = await settingsService.getAwayMessage(msgPageUserId);
                if (awayMessage) {
                    try {
                        await instagramService.sendDirectMessage(
                            instagramAccountId,
                            senderId,
                            awayMessage,
                            page.accessToken
                        );
                    } catch {
                        this.logger.debug('[Instagram] Failed to send away message - may not be able to message this user');
                    }
                }
                return { success: false, messageId, error: 'Messages auto-reply disabled' };
            }

            // 4. Skip if already replied
            if (storedMessage.replied) {
                return { success: false, messageId, error: 'Message already replied' };
            }

            // 4.5 Handoff pause: skip auto-reply if conversation is paused
            const paused = await messagesService.isPaused(page.id, senderId);
            if (paused) {
                this.logger.info('[Instagram] Skipping DM — handoff active', { senderId });
                return { success: false, messageId, error: 'Handoff active' };
            }

            // 4.6 Rate limiting
            const rateCheck = await rateLimiter.check(page.id, senderId, 'message');
            if (!rateCheck.allowed) {
                this.logger.info('[Instagram] Message rate limited', { senderId });
                return { success: false, messageId, error: 'Rate limited' };
            }

            // 4.7 Debounce — skip if a newer unreplied message exists
            const facebookMessageId = `ig_${messageId}`;
            const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, facebookMessageId);
            if (hasNewer) {
                this.logger.info('[Instagram] Skipping — newer message pending', { messageId });
                return { success: false, messageId, error: 'Skipped: newer message pending' };
            }

            // 5. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(msgPageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 6. Generate reply via unified generator (template matching + AI + subscription limits)
            const userSettings = await settingsService.getSettings(msgPageUserId);
            const genResult = await replyGenerator.generateForMessage(
                {
                    userId: msgPageUserId,
                    text: messageText,
                    pageName: page.name || undefined,
                    knowledgeBase: page.knowledgeBase || undefined,
                    pageId: page.id,
                    senderId,
                },
                userSettings.aiEnabled ?? false
            );
            const replyText = genResult.replyText;
            const replyMethod = genResult.replyMethod;
            const needsAttention = genResult.needsAttention ?? false;
            const flagReason = genResult.flagReason;
            const aiIntent = genResult.aiIntent;

            // 7. If still no reply, skip
            if (!replyText) {
                return { success: false, messageId, error: 'No reply generated' };
            }

            // 8. Send reply to Instagram
            try {
                await instagramService.sendDirectMessage(
                    instagramAccountId,
                    senderId,
                    replyText,
                    page.accessToken
                );
            } catch (error) {
                this.logger.error('[Instagram] Failed to send DM reply', { error: String(error) });
                return {
                    success: false,
                    messageId,
                    error: 'Failed to send reply - user may need to message first'
                };
            }

            // 9. Mark message as replied
            await db
                .update(messages)
                .set({
                    replied: true,
                    replyText,
                    replyMethod,
                    needsAttention,
                    flagReason: flagReason ?? null,
                    aiIntent: aiIntent ?? null,
                    repliedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(messages.id, storedMessage.id));

            // 10. Store outgoing message for conversation history
            await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod);

            // 11. Notify if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId, 'flagged_reply',
                    { senderName: senderId, reason: flagReason || 'AI flagged' },
                    { type: 'instagram_message', deepLink: '/dashboard?filter=flagged' }
                ).catch(err => this.logger.error('Notification failed', { err }));
            }

            return {
                success: true,
                messageId,
                replyText,
                replyMethod,
            };

        } catch (error) {
            this.logger.error('[Instagram] Error processing message', { 
                messageId,
                error: error instanceof Error ? error.message : String(error) 
            });
            return {
                success: false,
                messageId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
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

    private async storeMessage(
        pageId: string,
        instagramMessageId: string,
        senderId: string,
        message: string
    ) {
        // Check if message exists
        const existing = await db
            .select()
            .from(messages)
            .where(eq(messages.instagramMessageId, instagramMessageId));

        if (existing[0]) {
            return existing[0];
        }

        // Generate a unique Facebook message ID placeholder for Instagram messages
        const facebookMessageId = `ig_${instagramMessageId}`;

        const [created] = await db
            .insert(messages)
            .values({
                pageId,
                facebookMessageId,
                instagramMessageId,
                platform: 'instagram',
                senderId,
                message,
                direction: 'incoming',
                createdTime: new Date(),
            })
            .returning();

        return created;
    }
}

export const instagramReplyService = new InstagramReplyService();


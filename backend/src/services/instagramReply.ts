import { pagesService } from './pages';
import { aiService } from './ai';
import { settingsService } from './settings';
import { instagramService } from './instagram';
import { messagesService } from './messages';
import { db } from '../db';
import { instagramMedia, instagramComments, messages } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Logger, noopLogger, InstagramReplyResult, InstagramMessageResult } from '../types';

export class InstagramReplyService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
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

            // 4.5 Manual handoff pause
            if (fromId) {
                const isPaused = await messagesService.isManuallyPaused(page.id, fromId);
                if (isPaused) {
                    this.logger.info('[Instagram] Comment skipped — manual handoff active', { fromId });
                    await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);
                    return { success: false, commentId: instagramCommentId, error: 'Manual handoff active' };
                }
            }

            // 5. Store the comment
            const comment = await this.storeComment(page.id, mediaId, instagramCommentId, commentMessage, fromId, fromUsername);

            // 6. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(pageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 7. Generate AI reply
            const userSettings = await settingsService.getSettings(pageUserId);
            let replyText: string | null = null;
            let replyMethod: 'ai' | 'template' = 'ai';

            let needsAttention = false;
            let flagReason: string | undefined;
            let aiIntent: string | undefined;

            if (userSettings.aiEnabled) {
                const aiResponse = await aiService.generateReply({
                    comment: commentMessage,
                    context: {
                        pageId: page.id,
                        pageName: page.name || undefined,
                        postMessage: media.caption || undefined,
                        knowledgeBase: page.knowledgeBase || undefined,
                    }
                });
                replyText = aiResponse.reply;

                // Determine flagging from AI metadata
                const flags = aiResponse.flags || [];
                needsAttention = flags.length > 0 ||
                    aiResponse.confidence === 'low' ||
                    aiResponse.intent === 'COMPLAINT' ||
                    aiResponse.intent === 'OFFENSIVE';
                flagReason = flags.join(',') ||
                    (aiResponse.intent === 'COMPLAINT' ? 'complaint' : null) ||
                    (aiResponse.intent === 'OFFENSIVE' ? 'offensive' : null) ||
                    undefined;
                aiIntent = aiResponse.intent;
            }

            // 8. Fallback if no AI reply
            if (!replyText) {
                replyText = 'Thank you for your comment! 🙏';
                replyMethod = 'template';
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
            await db
                .update(instagramComments)
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
                .where(eq(instagramComments.id, comment.id));

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

            // 4.5 Manual handoff pause
            const isPaused = await messagesService.isManuallyPaused(page.id, senderId);
            if (isPaused) {
                this.logger.info('[Instagram] Skipping DM — manual handoff active', { senderId });
                return { success: false, messageId, error: 'Manual handoff active' };
            }

            // 5. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(msgPageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 6. Generate AI reply
            const userSettings = await settingsService.getSettings(msgPageUserId);
            let replyText: string | null = null;
            const replyMethod: 'ai' | 'template' = 'ai';

            let needsAttention = false;
            let flagReason: string | undefined;
            let aiIntent: string | undefined;

            if (userSettings.aiEnabled) {
                // Get conversation history for context
                const conversationHistory = await this.getInstagramConversationHistory(
                    page.id,
                    senderId,
                    10
                );

                const aiResponse = await aiService.generateReply({
                    comment: messageText,
                    context: {
                        pageId: page.id,
                        pageName: page.name || undefined,
                        knowledgeBase: page.knowledgeBase || undefined,
                        conversationHistory,
                    }
                });
                replyText = aiResponse.reply;

                // Determine flagging from AI metadata
                const flags = aiResponse.flags || [];
                needsAttention = flags.length > 0 ||
                    aiResponse.confidence === 'low' ||
                    aiResponse.intent === 'COMPLAINT' ||
                    aiResponse.intent === 'OFFENSIVE';
                flagReason = flags.join(',') ||
                    (aiResponse.intent === 'COMPLAINT' ? 'complaint' : null) ||
                    (aiResponse.intent === 'OFFENSIVE' ? 'offensive' : null) ||
                    undefined;
                aiIntent = aiResponse.intent;
            }

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

    private async getInstagramConversationHistory(
        pageId: string,
        senderId: string,
        limit: number
    ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
        const recentMessages = await db
            .select()
            .from(messages)
            .where(
                and(
                    eq(messages.pageId, pageId),
                    eq(messages.senderId, senderId),
                    eq(messages.platform, 'instagram')
                )
            )
            .orderBy(desc(messages.createdTime))
            .limit(limit);

        // Reverse to get chronological order and format for AI
        return recentMessages.reverse().map(msg => ({
            role: msg.direction === 'incoming' ? 'user' as const : 'assistant' as const,
            content: msg.message,
        }));
    }
}

export const instagramReplyService = new InstagramReplyService();


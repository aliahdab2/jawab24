import { pagesService } from '../pages';
import { postsService } from '../posts';
import { commentsService } from '../comments';
import { facebookService } from '../facebook';
import { settingsService } from '../settings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator } from './generator';
import { replySender, ReplyMode } from './sender';
import { detectLanguageCode } from '../../utils/language';
import { Logger, noopLogger, ReplyResult, MessageResult } from '../../types';

/**
 * Reply Service
 * Main orchestration for processing incoming comments and messages
 * Delegates generation and sending to specialized modules
 */
export class ReplyService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
        // Propagate logger to sub-services
        rateLimiter.setLogger(logger);
        replyGenerator.setLogger(logger);
        replySender.setLogger(logger);
    }

    /**
     * Process an incoming private message
     */
    async processMessage(
        pageId: string,
        senderId: string,
        messageText: string,
        messageId: string
    ): Promise<MessageResult> {
        try {
            // 1. Validate page
            const page = await pagesService.getPageByFacebookId(pageId);
            if (!page) {
                return { success: false, messageId, error: 'Page not found' };
            }
            if (!page.autoReplyEnabled) {
                return { success: false, messageId, error: 'Auto-reply disabled for this page' };
            }
            if (!page.userId) {
                return { success: false, messageId, error: 'Page has no associated user' };
            }

            const userId = page.userId;

            // 2. Check user settings
            const isMessagesEnabled = await settingsService.isMessagesAutoReplyEnabled(userId);

            // 2.5 Fetch sender name from Facebook (best-effort, within 24h window)
            let senderName: string | undefined;
            try {
                const profile = await facebookService.getSenderProfile(senderId, page.accessToken);
                if (profile?.name) {
                    senderName = profile.name;
                }
            } catch {
                // Non-critical — continue without sender name
            }

            // 3. Store the incoming message (may already exist if stored at webhook time)
            const { message: storedMessage, isNew } = await messagesService.findOrCreateFromWebhook(
                page.id,
                messageId,
                senderId,
                messageText,
                senderName
            );

            // 3.5 Debounce: skip if a newer unreplied message exists from the same sender
            // (the newer message's job will handle the reply with full conversation context)
            const hasNewer = await messagesService.hasNewerUnrepliedMessage(page.id, senderId, messageId);
            if (hasNewer) {
                this.logger.info('[Reply] Skipping — newer message from same sender exists', { messageId, senderId });
                return { success: false, messageId, error: 'Skipped: newer message pending' };
            }

            // 3.6 Handoff pause: skip auto-reply if conversation is paused (explicit or manual)
            const isPaused = await messagesService.isPaused(page.id, senderId);
            if (isPaused) {
                this.logger.info('[Reply] Skipping — handoff active', { senderId, pageId });
                return { success: false, messageId, error: 'Handoff active' };
            }

            // 4. Rate limit check
            const rateCheck = await rateLimiter.check(pageId, senderId, 'message');
            if (!rateCheck.allowed) {
                this.logger.info('[Reply] Message rate limited', { senderId, count: rateCheck.count });
                return { success: false, messageId, error: 'Rate limited' };
            }

            // 5. Handle disabled auto-reply (send away message if configured)
            if (!isMessagesEnabled) {
                const awayMessage = await settingsService.getAwayMessage(userId);
                if (awayMessage && isNew) {
                    await facebookService.sendPrivateMessage(page.accessToken, senderId, awayMessage);
                    await messagesService.storeOutgoingMessage(page.id, senderId, awayMessage, 'template');
                }
                return { success: false, messageId, error: 'Messages auto-reply disabled' };
            }

            // 6. Skip if already replied
            if (!isNew && storedMessage.replied) {
                return { success: false, messageId, error: 'Message already replied' };
            }

            // 7. Apply reply delay
            const replyDelay = await settingsService.getReplyDelay(userId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 7.5 Consolidate all unreplied messages from this sender into one prompt
            // so the AI addresses everything the customer said, not just the last message
            const unrepliedMessages = await messagesService.getUnrepliedFromSender(page.id, senderId);
            const consolidatedText = unrepliedMessages.length > 1
                ? unrepliedMessages.map(m => m.message).join('\n')
                : messageText;

            // 8. Generate reply
            const userSettings = await settingsService.getSettings(userId);
            const { replyText, replyMethod, needsAttention, flagReason, aiIntent } = await replyGenerator.generateForMessage(
                {
                    userId,
                    text: consolidatedText,
                    pageName: page.name || undefined,
                    knowledgeBase: page.knowledgeBase || undefined,
                    pageId: page.id,
                    senderId,
                },
                userSettings.aiEnabled ?? false
            );

            if (!replyText) {
                return { success: false, messageId, error: 'No reply generated' };
            }

            // 9. Send reply
            await facebookService.sendPrivateMessage(page.accessToken, senderId, replyText);

            // 10. Update database
            await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod, needsAttention, flagReason, aiIntent);
            await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod);

            // 10.5 Mark older debounced messages as replied (they were addressed in the consolidated reply)
            if (unrepliedMessages.length > 1) {
                const marked = await messagesService.markOlderMessagesAsReplied(
                    page.id, senderId, storedMessage.id, replyText, replyMethod
                );
                if (marked > 0) {
                    this.logger.info('[Reply] Marked older debounced messages as replied', { count: marked, senderId });
                }
            }

            // 11. Send notification if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId,
                    'flagged_reply',
                    { senderName: senderName || senderId, reason: flagReason || 'AI flagged this reply' },
                    { messageId: storedMessage.id, type: 'message', deepLink: '/messages?filter=flagged' }
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            return { success: true, messageId, replyText, replyMethod };

        } catch (error) {
            this.logger.error('Error processing message', {
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

    /**
     * Process an incoming comment
     */
    async processComment(
        pageId: string,
        postId: string,
        facebookCommentId: string,
        commentMessage: string,
        fromId?: string,
        fromName?: string
    ): Promise<ReplyResult> {
        try {
            // 1. Validate page
            const page = await pagesService.getPageByFacebookId(pageId);
            if (!page) {
                return { success: false, commentId: facebookCommentId, error: 'Page not found' };
            }
            if (!page.autoReplyEnabled) {
                return { success: false, commentId: facebookCommentId, error: 'Auto-reply disabled for this page' };
            }
            if (!page.userId) {
                return { success: false, commentId: facebookCommentId, error: 'Page has no associated user' };
            }

            const pageUserId = page.userId;

            // 2. Check user settings
            const isCommentsEnabled = await settingsService.isCommentsAutoReplyEnabled(pageUserId);

            // 3. Find or create the post
            const post = await postsService.findOrCreateFromWebhook(page.id, postId, undefined);
            if (!post.autoReplyEnabled) {
                return { success: false, commentId: facebookCommentId, error: 'Auto-reply disabled for this post' };
            }

            // 4. Store the comment
            const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
                post.id,
                facebookCommentId,
                commentMessage,
                fromId,
                fromName
            );

            // 5. Rate limit check
            if (fromId) {
                const rateCheck = await rateLimiter.check(pageId, fromId, 'comment');
                if (!rateCheck.allowed) {
                    this.logger.info('[Reply] Comment rate limited', { fromId, count: rateCheck.count });
                    return { success: false, commentId: comment.id, error: 'Rate limited' };
                }
            }

            // 5.5 Handoff pause: skip auto-reply if conversation is paused (explicit or manual)
            if (fromId) {
                const isCommentPaused = await messagesService.isPaused(page.id, fromId);
                if (isCommentPaused) {
                    this.logger.info('[Reply] Comment skipped — handoff active', { fromId, pageId });
                    return { success: false, commentId: comment.id, error: 'Handoff active' };
                }
            }

            // 6. Skip if auto-reply disabled or already replied
            if (!isCommentsEnabled) {
                return { success: false, commentId: comment.id, error: 'Comments auto-reply disabled' };
            }
            if (!isNew && comment.replied) {
                return { success: false, commentId: comment.id, error: 'Comment already replied' };
            }

            // 7. Apply reply delay
            const replyDelay = await settingsService.getReplyDelay(pageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 8. Generate reply
            const userSettings = await settingsService.getSettings(pageUserId);
            const { replyText, replyMethod, templateId, needsAttention, flagReason, aiIntent } = await replyGenerator.generateForComment(
                {
                    userId: pageUserId,
                    text: commentMessage,
                    pageName: page.name || undefined,
                    knowledgeBase: page.knowledgeBase || undefined,
                    postId,
                    postMessage: post.message || undefined,
                    pageId: page.id,
                    accessToken: page.accessToken,
                },
                userSettings.aiEnabled ?? false
            );

            if (!replyText) {
                // Notify user about pending comment that couldn't be auto-replied
                if (page.userId) {
                    notificationService.sendTemplateNotification(
                        page.userId,
                        'new_comment',
                        { senderName: fromName || 'Unknown' },
                        { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' }
                    ).catch(err => this.logger.error('New comment notification failed', { err }));
                }
                return { success: false, commentId: comment.id, error: 'No reply generated' };
            }

            // 9. Send reply based on mode
            const replyMode = (userSettings.commentReplyMode || 'public') as ReplyMode;
            // Check if this is a demo page (skip Facebook API calls)
            const isDemo = page.facebookPageId.startsWith('demo_');
            const sendResult = await replySender.sendCommentReply({
                facebookCommentId,
                replyText,
                commentMessage,
                accessToken: page.accessToken,
                fromId,
                replyMode,
                dualReplyConfig: userSettings.dualReplyConfig as Record<string, string> | undefined,
                isDemo,
            });

            if (!sendResult.success) {
                return { success: false, commentId: comment.id, error: sendResult.error };
            }

            // 10. Mark as replied
            const detectedLanguage = detectLanguageCode(commentMessage);
            await commentsService.markAsReplied(
                comment.id,
                replyText,
                replyMethod,
                templateId,
                detectedLanguage === 'unknown' ? 'en' : detectedLanguage,
                needsAttention,
                flagReason,
                aiIntent
            );

            // 11. Send notification if flagged
            if (needsAttention && page.userId) {
                notificationService.sendTemplateNotification(
                    page.userId,
                    'flagged_reply',
                    { senderName: fromName || 'Unknown', reason: flagReason || 'AI flagged this reply' },
                    { commentId: comment.id, type: 'comment', deepLink: '/comments?filter=flagged' }
                ).catch(err => this.logger.error('Flagged notification failed', { err }));
            }

            return { success: true, commentId: comment.id, replyText, replyMethod };

        } catch (error) {
            this.logger.error('Error processing comment', {
                facebookCommentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                success: false,
                commentId: facebookCommentId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Post a reply to a Facebook comment (legacy - use replySender instead)
     */
    async postReplyToFacebook(
        commentId: string,
        message: string,
        accessToken: string
    ): Promise<boolean> {
        return replySender.postPublicReply(commentId, message, accessToken);
    }

    /**
     * Process pending comments (batch processing)
     */
    async processPendingComments(userId: string, limit: number = 10): Promise<ReplyResult[]> {
        const unrepliedComments = await commentsService.getUnrepliedComments(userId, limit);
        const results: ReplyResult[] = [];

        for (const comment of unrepliedComments) {
            results.push({
                success: false,
                commentId: comment.id,
                error: 'Batch processing not fully implemented',
            });
        }

        return results;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const replyService = new ReplyService();

// Re-export sub-modules for direct access if needed
export { replyGenerator } from './generator';
export { replySender } from './sender';

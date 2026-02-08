import { pagesService } from '../pages';
import { postsService } from '../posts';
import { commentsService } from '../comments';
import { settingsService } from '../settings';
import { messagesService } from '../messages';
import { rateLimiter } from '../protection';
import { notificationService } from '../notifications';
import { replyGenerator } from './generator';
import { replySender, ReplyMode } from './sender';
import { messageProcessor } from './messageProcessor';
import { facebookMessageAdapter } from './adapters';
import { detectLanguageCode } from '../../utils/language';
import { Logger, noopLogger, ReplyResult } from '../../types';
import type { MessageResult } from '../../interfaces';

/**
 * Reply Service
 * Main orchestration for processing incoming comments and messages.
 * DM processing is delegated to the shared messageProcessor via the Facebook adapter.
 */
export class ReplyService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
        rateLimiter.setLogger(logger);
        replyGenerator.setLogger(logger);
        replySender.setLogger(logger);
        messageProcessor.setLogger(logger);
    }

    /**
     * Process an incoming private message.
     * Delegates to the shared platform-agnostic pipeline via the Facebook adapter.
     */
    async processMessage(
        pageId: string,
        senderId: string,
        messageText: string,
        messageId: string,
    ): Promise<MessageResult> {
        return messageProcessor.processMessage(
            facebookMessageAdapter, pageId, senderId, messageText, messageId,
        );
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

// Re-export sub-modules
export { replyGenerator } from './generator';
export { replySender } from './sender';
export { messageProcessor } from './messageProcessor';
export { facebookMessageAdapter, instagramMessageAdapter } from './adapters';

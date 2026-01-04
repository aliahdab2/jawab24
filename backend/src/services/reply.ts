import axios from 'axios';
import { pagesService } from './pages';
import { postsService } from './posts';
import { commentsService } from './comments';
import { rulesService } from './rules';
import { templatesService } from './templates';
import { aiService } from './ai';
import { facebookService } from './facebook';
import { settingsService } from './settings';
import { messagesService } from './messages';
import { subscriptionsService } from './subscriptions';
import { detectLanguageCode } from '../utils/language';
import { Logger, noopLogger, ReplyResult, MessageResult } from '../types';

const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

export class ReplyService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
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
            // 1. Get page to check if auto-reply is enabled
            const page = await pagesService.getPageByFacebookId(pageId);
            if (!page) {
                return { success: false, messageId, error: 'Page not found' };
            }

            if (!page.autoReplyEnabled) {
                return { success: false, messageId, error: 'Auto-reply disabled for this page' };
            }

            // Ensure page has an associated user
            if (!page.userId) {
                return { success: false, messageId, error: 'Page has no associated user' };
            }
            const userId = page.userId;

            // 2. Check user settings for messages auto-reply
            const isMessagesEnabled = await settingsService.isMessagesAutoReplyEnabled(userId);

            // Store the incoming message regardless of auto-reply status
            const { message: storedMessage, isNew } = await messagesService.findOrCreateFromWebhook(
                page.id,
                messageId,
                senderId,
                messageText
            );

            if (!isMessagesEnabled) {
                // Send away message if configured
                const awayMessage = await settingsService.getAwayMessage(userId);
                if (awayMessage && isNew) {
                    await facebookService.sendPrivateMessage(
                        page.accessToken,
                        senderId,
                        awayMessage
                    );
                    await messagesService.storeOutgoingMessage(page.id, senderId, awayMessage, 'template');
                }
                return { success: false, messageId, error: 'Messages auto-reply disabled' };
            }

            // Skip if already replied
            if (!isNew && storedMessage.replied) {
                return { success: false, messageId, error: 'Message already replied' };
            }

            // 3. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(userId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 4. Try to find a matching rule
            const matchingRule = await rulesService.findMatchingRule(userId, messageText);

            let replyText: string | null = null;
            let replyMethod: 'template' | 'ai' = 'ai';

            // 5. If rule found with template, use template
            if (matchingRule && matchingRule.templateId) {
                const template = await templatesService.getTemplate(userId, matchingRule.templateId);

                if (template && template.translations) {
                    const translations = template.translations as Record<string, string>;
                    // Simple language fallback for now
                    replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                    replyMethod = 'template';
                }
            }

            // 6. If no template reply, use AI with conversation context
            const userSettings = await settingsService.getSettings(userId);
            if (!replyText && userSettings.aiEnabled) {
                // Check AI usage limits before generating reply
                const limitCheck = await subscriptionsService.canUseAiReplies(userId);
                if (!limitCheck.allowed) {
                    this.logger.info('[Reply] AI limit reached for user', { reason: limitCheck.reason });
                    // Fall back to a generic message when limit is reached
                    replyText = 'Thank you for your message! We will get back to you soon.';
                    replyMethod = 'template';
                } else {
                    // Get conversation history for context
                    const conversationHistory = await messagesService.getConversationHistory(
                        page.id,
                        senderId,
                        10 // Last 10 messages
                    );

                    const aiResponse = await aiService.generateReply({
                        comment: messageText,
                        context: {
                            pageName: page.name || undefined,
                            knowledgeBase: page.knowledgeBase || undefined,
                            conversationHistory,
                        }
                    });
                    replyText = aiResponse.reply;
                    replyMethod = 'ai';

                    // Track AI usage
                    await subscriptionsService.incrementAiReplies(userId);
                }
            }

            // 7. If still no reply, ignore (don't spam empty messages)
            if (!replyText) {
                return { success: false, messageId, error: 'No reply generated' };
            }

            // 8. Send private message reply
            await facebookService.sendPrivateMessage(
                page.accessToken,
                senderId,
                replyText
            );

            // 9. Mark message as replied and store outgoing message
            await messagesService.markAsReplied(storedMessage.id, replyText, replyMethod);
            await messagesService.storeOutgoingMessage(page.id, senderId, replyText, replyMethod);

            return {
                success: true,
                messageId,
                replyText,
                replyMethod,
            };

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
     * Helper to add delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process an incoming comment and generate a reply
     * This is the main orchestration function
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
            // 1. Get page to check if auto-reply is enabled
            const page = await pagesService.getPageByFacebookId(pageId);
            if (!page) {
                return { success: false, commentId: facebookCommentId, error: 'Page not found' };
            }

            if (!page.autoReplyEnabled) {
                return { success: false, commentId: facebookCommentId, error: 'Auto-reply disabled for this page' };
            }

            // Ensure page has an associated user
            if (!page.userId) {
                return { success: false, commentId: facebookCommentId, error: 'Page has no associated user' };
            }
            const pageUserId = page.userId;

            // 2. Check user settings for comments auto-reply
            const isCommentsEnabled = await settingsService.isCommentsAutoReplyEnabled(pageUserId);

            // 3. Find or create the post (WITHOUT fetching content yet - we'll do it lazily)
            let post = await postsService.findOrCreateFromWebhook(page.id, postId, undefined);

            if (!post.autoReplyEnabled) {
                return { success: false, commentId: facebookCommentId, error: 'Auto-reply disabled for this post' };
            }

            // 4. Find or create the comment (store it regardless of auto-reply status)
            const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
                post.id,
                facebookCommentId,
                commentMessage,
                fromId,
                fromName
            );

            // If comments auto-reply is disabled, just store the comment
            if (!isCommentsEnabled) {
                return { success: false, commentId: comment.id, error: 'Comments auto-reply disabled' };
            }

            // If comment already exists and was replied to, skip
            if (!isNew && comment.replied) {
                return { success: false, commentId: comment.id, error: 'Comment already replied' };
            }

            // 5. Get reply delay
            const replyDelay = await settingsService.getReplyDelay(pageUserId);
            if (replyDelay > 0) {
                await this.delay(replyDelay * 1000);
            }

            // 6. Try to find a matching rule FIRST (no need for post content)
            const matchingRule = await rulesService.findMatchingRule(pageUserId, commentMessage);

            let replyText: string | null = null;
            let replyMethod: 'template' | 'ai' = 'ai';
            let templateId: string | undefined;

            // 7. If rule found with template, use template (NO API CALL NEEDED!)
            if (matchingRule && matchingRule.templateId) {
                const template = await templatesService.getTemplate(pageUserId, matchingRule.templateId);

                if (template && template.translations) {
                    // Try to get translation based on detected language or default to English
                    const translations = template.translations as Record<string, string>;
                    replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                    replyMethod = 'template';
                    templateId = template.id;
                    this.logger.debug('[Reply] Using template - no API call for post content needed', { templateName: template.name });
                }
            }

            // 8. If no template reply, use AI with knowledge base (check user settings)
            const userSettings = await settingsService.getSettings(pageUserId);
            if (!replyText && userSettings.aiEnabled) {
                // Check AI usage limits before generating reply
                const limitCheck = await subscriptionsService.canUseAiReplies(pageUserId);
                if (!limitCheck.allowed) {
                    this.logger.info('[Reply] AI limit reached for user', { reason: limitCheck.reason });
                    // Fall back to a generic message when limit is reached
                    replyText = 'Thank you for your comment!';
                    replyMethod = 'template';
                } else {
                    // NOW we need post content - fetch it lazily
                    if (!post.message) {
                        this.logger.debug('[Reply] AI enabled, fetching post content for context');
                        post = await postsService.findOrCreateFromWebhook(page.id, postId, undefined, page.accessToken);
                    }

                    const aiResponse = await aiService.generateReply({
                        comment: commentMessage,
                        context: {
                            pageName: page.name || undefined,
                            postMessage: post.message || undefined,
                            knowledgeBase: page.knowledgeBase || undefined,
                        }
                    });
                    replyText = aiResponse.reply;
                    replyMethod = 'ai';

                    // Track AI usage
                    await subscriptionsService.incrementAiReplies(pageUserId);
                }
            }

            // 9. If still no reply (AI disabled and no template), use fallback
            if (!replyText) {
                replyText = 'Thank you for your comment!';
                replyMethod = 'template';
                this.logger.debug('[Reply] Using fallback reply - no API call for post content needed');
            }

            // 10. Send reply based on user preference (public or private)
            let success = false;
            let errorMsg = '';

            // Get reply mode from settings (default to public if not set)
            const replyMode = userSettings.commentReplyMode || 'public';

            if (replyMode === 'private') {
                // Private message mode
                if (!fromId) {
                    return {
                        success: false,
                        commentId: comment.id,
                        error: 'Cannot send private message: commenter ID not available'
                    };
                }

                try {
                    await facebookService.sendPrivateMessage(
                        page.accessToken,
                        fromId,
                        replyText
                    );
                    success = true;
                    this.logger.debug('[Reply] Sent private message to commenter', { fromId });
                } catch (error) {
                    this.logger.error('Failed to send private message to commenter', {
                        fromId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    errorMsg = 'Failed to send private message to commenter';
                }
            } else {
                // Public reply (default)
                success = await this.postReplyToFacebook(
                    facebookCommentId,
                    replyText,
                    page.accessToken
                );

                if (!success) {
                    errorMsg = 'Failed to post public reply to Facebook';
                }
            }

            if (!success) {
                return {
                    success: false,
                    commentId: comment.id,
                    error: errorMsg
                };
            }

            // 11. Mark comment as replied in our database
            const detectedLanguage = detectLanguageCode(commentMessage);
            await commentsService.markAsReplied(
                comment.id,
                replyText,
                replyMethod,
                templateId,
                detectedLanguage === 'unknown' ? 'en' : detectedLanguage
            );

            return {
                success: true,
                commentId: comment.id,
                replyText,
                replyMethod,
            };

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
     * Post a reply to a Facebook comment
     */
    async postReplyToFacebook(
        commentId: string,
        message: string,
        accessToken: string
    ): Promise<boolean> {
        try {
            await axios.post(
                `${FACEBOOK_GRAPH_API}/${commentId}/comments`,
                {
                    message,
                },
                {
                    params: {
                        access_token: accessToken,
                    },
                }
            );
            return true;
        } catch (error) {
            this.logger.error('Failed to post reply to Facebook', {
                commentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Process a batch of comments (for testing or manual triggering)
     */
    async processPendingComments(userId: string, limit: number = 10): Promise<ReplyResult[]> {
        const unrepliedComments = await commentsService.getUnrepliedComments(userId, limit);
        const results: ReplyResult[] = [];

        for (const comment of unrepliedComments) {
            // We need to get the full comment with post and page info
            // For now, we'll skip batch processing as it needs more context
            results.push({
                success: false,
                commentId: comment.id,
                error: 'Batch processing not fully implemented',
            });
        }

        return results;
    }
}

export const replyService = new ReplyService();



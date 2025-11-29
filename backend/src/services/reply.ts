import axios from 'axios';
import { pagesService } from './pages';
import { postsService } from './posts';
import { commentsService } from './comments';
import { rulesService } from './rules';
import { templatesService } from './templates';
import { aiService } from './ai';
import { facebookService } from './facebook';
import { config } from '../config';

const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

export interface ReplyResult {
    success: boolean;
    commentId: string;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    error?: string;
}

export interface MessageResult {
    success: boolean;
    messageId: string; // Facebook Message ID (mid)
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    error?: string;
}

export class ReplyService {
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

            // 2. Try to find a matching rule
            const matchingRule = await rulesService.findMatchingRule(page.userId!, messageText);

            let replyText: string | null = null;
            let replyMethod: 'template' | 'ai' = 'ai';

            // 3. If rule found with template, use template
            if (matchingRule && matchingRule.templateId) {
                const template = await templatesService.getTemplate(page.userId!, matchingRule.templateId);
                
                if (template && template.translations) {
                    const translations = template.translations as Record<string, string>;
                    // Simple language fallback for now
                    replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                    replyMethod = 'template';
                }
            }

            // 4. If no template reply, use AI
            if (!replyText && config.ai.enabled) {
                const aiResponse = await aiService.generateReply({
                    comment: messageText, // Using comment parameter for message text
                    context: {
                        pageName: page.name || undefined,
                        postMessage: "Private Message Conversation", // Context for AI
                    }
                });
                replyText = aiResponse.reply;
                replyMethod = 'ai';
            }

            // 5. If still no reply, ignore (don't spam empty messages)
            if (!replyText) {
                return { success: false, messageId, error: 'No reply generated' };
            }

            // 6. Send private message reply
            await facebookService.sendPrivateMessage(
                page.accessToken,
                senderId,
                replyText
            );

            return {
                success: true,
                messageId,
                replyText,
                replyMethod,
            };

        } catch (error) {
            console.error('Error processing message:', error);
            return {
                success: false,
                messageId,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
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

            // 2. Find or create the post
            const post = await postsService.findOrCreateFromWebhook(page.id, postId, undefined);
            
            if (!post.autoReplyEnabled) {
                return { success: false, commentId: facebookCommentId, error: 'Auto-reply disabled for this post' };
            }

            // 3. Find or create the comment
            const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
                post.id,
                facebookCommentId,
                commentMessage,
                fromId,
                fromName
            );

            // If comment already exists and was replied to, skip
            if (!isNew && comment.replied) {
                return { success: false, commentId: comment.id, error: 'Comment already replied' };
            }

            // 4. Try to find a matching rule
            const matchingRule = await rulesService.findMatchingRule(page.userId!, commentMessage);

            let replyText: string | null = null;
            let replyMethod: 'template' | 'ai' = 'ai';
            let templateId: string | undefined;

            // 5. If rule found with template, use template
            if (matchingRule && matchingRule.templateId) {
                const template = await templatesService.getTemplate(page.userId!, matchingRule.templateId);
                
                if (template && template.translations) {
                    // Try to get translation based on detected language or default to English
                    const translations = template.translations as Record<string, string>;
                    replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                    replyMethod = 'template';
                    templateId = template.id;
                }
            }

            // 6. If no template reply, use AI
            if (!replyText && config.ai.enabled) {
                const aiResponse = await aiService.generateReply({
                    comment: commentMessage,
                    context: {
                        pageName: page.name || undefined,
                        postMessage: post.message || undefined,
                    }
                });
                replyText = aiResponse.reply;
                replyMethod = 'ai';
            }

            // 7. If still no reply (AI disabled and no template), use fallback
            if (!replyText) {
                replyText = 'Thank you for your comment!';
                replyMethod = 'template';
            }

            // 8. Post reply to Facebook
            const facebookSuccess = await this.postReplyToFacebook(
                facebookCommentId,
                replyText,
                page.accessToken
            );

            if (!facebookSuccess) {
                return { 
                    success: false, 
                    commentId: comment.id, 
                    error: 'Failed to post reply to Facebook' 
                };
            }

            // 9. Mark comment as replied in our database
            await commentsService.markAsReplied(
                comment.id,
                replyText,
                replyMethod,
                templateId,
                'en' // TODO: detect language
            );

            return {
                success: true,
                commentId: comment.id,
                replyText,
                replyMethod,
            };

        } catch (error) {
            console.error('Error processing comment:', error);
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
            console.error('Failed to post reply to Facebook:', error);
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


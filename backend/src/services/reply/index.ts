import { commentsService } from '../comments';
import { rateLimiter } from '../protection';
import { replyGenerator } from './generator';
import { replySender } from './sender';
import { messageProcessor } from './messageProcessor';
import { commentProcessor } from './commentProcessor';
import { facebookMessageAdapter, facebookCommentAdapter } from './adapters';
import { Logger, CommentResult } from '../../types';
import type { MessageResult } from '../../interfaces';

/**
 * Reply Service
 * Main orchestration for processing incoming comments and messages.
 * DM processing is delegated to the shared messageProcessor via the Facebook adapter.
 * Comment processing is delegated to the shared commentProcessor via the Facebook comment adapter.
 */
export class ReplyService {
    setLogger(logger: Logger): void {
        rateLimiter.setLogger(logger);
        replyGenerator.setLogger(logger);
        replySender.setLogger(logger);
        messageProcessor.setLogger(logger);
        commentProcessor.setLogger(logger);
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
        sharedPostUrl?: string,
        sharedPostId?: string,
    ): Promise<MessageResult> {
        return messageProcessor.processMessage(
            facebookMessageAdapter, pageId, senderId, messageText, messageId, sharedPostUrl, sharedPostId,
        );
    }

    /**
     * Process an incoming comment.
     * Delegates to the shared platform-agnostic pipeline via the Facebook comment adapter.
     */
    async processComment(
        pageId: string,
        postId: string,
        facebookCommentId: string,
        commentMessage: string,
        fromId?: string,
        fromName?: string,
        parentId?: string
    ): Promise<CommentResult> {
        return commentProcessor.processComment(
            facebookCommentAdapter, pageId, postId, facebookCommentId,
            commentMessage, fromId, fromName, parentId,
        );
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
    async processPendingComments(userId: string, limit: number = 10): Promise<CommentResult[]> {
        const unrepliedComments = await commentsService.getUnrepliedComments(userId, limit);
        const results: CommentResult[] = [];

        for (const comment of unrepliedComments) {
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

// Re-export sub-modules
export { replyGenerator } from './generator';
export { replySender } from './sender';
export { messageProcessor } from './messageProcessor';
export { commentProcessor } from './commentProcessor';
export { facebookMessageAdapter, instagramMessageAdapter } from './adapters';
export { facebookCommentAdapter, instagramCommentAdapter } from './adapters';

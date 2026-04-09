import { replyGenerator } from './reply/generator';
import { rateLimiter } from './protection/rate-limiter';
import { messageProcessor } from './reply/messageProcessor';
import { commentProcessor } from './reply/commentProcessor';
import { instagramMessageAdapter, instagramCommentAdapter } from './reply/adapters';
import { Logger, CommentResult } from '../types';
import type { MessageResult } from '../interfaces';

export class InstagramReplyService {
    setLogger(logger: Logger): void {
        replyGenerator.setLogger(logger);
        rateLimiter.setLogger(logger);
        messageProcessor.setLogger(logger);
        commentProcessor.setLogger(logger);
    }

    /**
     * Process an incoming Instagram comment and generate a reply.
     * Delegates to the shared platform-agnostic pipeline via the Instagram comment adapter.
     */
    async processComment(
        instagramAccountId: string,
        mediaId: string,
        instagramCommentId: string,
        commentMessage: string,
        fromId?: string,
        fromUsername?: string
    ): Promise<CommentResult> {
        return commentProcessor.processComment(
            instagramCommentAdapter, instagramAccountId, mediaId, instagramCommentId,
            commentMessage, fromId, fromUsername,
        );
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
        sharedPostUrl?: string,
        sharedPostId?: string,
    ): Promise<MessageResult> {
        return messageProcessor.processMessage(
            instagramMessageAdapter, instagramAccountId, senderId, messageText, messageId, sharedPostUrl, sharedPostId,
        );
    }
}

export const instagramReplyService = new InstagramReplyService();

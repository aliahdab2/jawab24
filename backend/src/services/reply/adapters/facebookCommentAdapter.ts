import { pagesService } from '../../pages';
import { postsService } from '../../posts';
import { commentsService } from '../../comments';
import { replySender, ReplyMode } from '../sender';
import type {
    CommentPlatformAdapter,
    PlatformPage,
    StoredComment,
    ContentEntity,
    CommentReplyContext,
    SendCommentResult,
} from '../../../interfaces';

/**
 * Facebook Comment Platform Adapter
 *
 * Implements platform-specific behavior for Facebook comment processing.
 */
export class FacebookCommentAdapter implements CommentPlatformAdapter {
    readonly platform = 'facebook' as const;

    async getPage(facebookPageId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByFacebookId(facebookPageId);
        if (!page) return null;
        return {
            id: page.id,
            userId: page.userId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: page.knowledgeBase,
            autoReplyEnabled: page.autoReplyEnabled ?? true,
        };
    }

    async findOrCreateContent(pageId: string, postId: string): Promise<ContentEntity> {
        const post = await postsService.findOrCreateFromWebhook(pageId, postId, undefined);
        return {
            id: post.id,
            autoReplyEnabled: post.autoReplyEnabled ?? true,
            message: post.message,
        };
    }

    async storeComment(
        postId: string,
        facebookCommentId: string,
        message: string,
        fromId?: string,
        fromName?: string,
    ): Promise<{ comment: StoredComment; isNew: boolean }> {
        const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
            postId, facebookCommentId, message, fromId, fromName,
        );
        return {
            comment: { id: comment.id, replied: comment.replied ?? false },
            isNew,
        };
    }

    async sendReply(opts: {
        platformCommentId: string;
        platformPageId: string;
        replyText: string;
        commentMessage: string;
        accessToken: string;
        fromId?: string;
        userSettings: Record<string, unknown>;
    }): Promise<SendCommentResult> {
        const replyMode = (opts.userSettings.commentReplyMode || 'public') as ReplyMode;
        const isDemo = opts.platformPageId.startsWith('demo_');

        return replySender.sendCommentReply({
            facebookCommentId: opts.platformCommentId,
            replyText: opts.replyText,
            commentMessage: opts.commentMessage,
            accessToken: opts.accessToken,
            fromId: opts.fromId,
            replyMode,
            dualReplyConfig: opts.userSettings.dualReplyConfig as Record<string, string> | undefined,
            isDemo,
        });
    }

    async markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        detectedLanguage: string,
        templateId?: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
    ): Promise<void> {
        await commentsService.markAsReplied(
            commentId, replyText, replyMethod, templateId,
            detectedLanguage, needsAttention, flagReason, aiIntent,
        );
    }

    buildGeneratorContext(
        page: PlatformPage,
        contentEntity: ContentEntity,
        contentId: string,
    ): CommentReplyContext {
        return {
            userId: page.userId!,
            text: '',  // filled by processor with commentMessage
            pageName: page.name || undefined,
            knowledgeBase: page.knowledgeBase || undefined,
            postId: contentId,
            postMessage: contentEntity.message || undefined,
            pageId: page.id,
            accessToken: page.accessToken,
        };
    }

    getFallbackReply(): string | null {
        return null;
    }
}

export const facebookCommentAdapter = new FacebookCommentAdapter();

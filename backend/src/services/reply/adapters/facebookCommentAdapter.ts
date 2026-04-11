import { pagesService } from '../../pages';
import { postsService } from '../../posts';
import { commentsService } from '../../comments';
import { facebookService } from '../../facebook';
import { replySender, ReplyMode } from '../sender';
import { pickNudgeVariation } from '../nudge';
import { detectLanguageCode } from '../../../utils/language';
import { mapToPlatformPage } from './shared';
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
        return mapToPlatformPage(page, { autoReplyEnabled: page.autoReplyEnabled ?? true });
    }

    async findOrCreateContent(pageId: string, postId: string, accessToken?: string): Promise<ContentEntity> {
        const post = await postsService.findOrCreateFromWebhook(pageId, postId, undefined, accessToken);
        return {
            id: post.id,
            autoReplyEnabled: post.autoReplyEnabled ?? true,
            message: post.message,
            triggerKeyword: post.triggerKeyword ?? null,
            triggerReply: post.triggerReply ?? null,
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
            comment: { id: comment.id, replied: comment.replied ?? false, needsAttention: comment.needsAttention ?? false },
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
        postMessage?: string;
    }): Promise<SendCommentResult> {
        const replyMode = (opts.userSettings.commentReplyMode || 'public') as ReplyMode;
        const isDemo = opts.platformPageId.startsWith('demo_');

        // Pick a random nudge variation for this comment's language,
        // falling back to post language for punctuation-only comments (e.g. ".", "..")
        const commentLang = detectLanguageCode(opts.commentMessage);
        const effectiveLang = commentLang !== 'unknown' ? commentLang
            : (opts.postMessage ? detectLanguageCode(opts.postMessage) : 'unknown');
        const variationsMulti = opts.userSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined;
        const dualReplyNudge = pickNudgeVariation(variationsMulti, effectiveLang);

        return replySender.sendCommentReply({
            facebookCommentId: opts.platformCommentId,
            replyText: opts.replyText,
            commentMessage: opts.commentMessage,
            accessToken: opts.accessToken,
            fromId: opts.fromId,
            replyMode,
            dualReplyNudge,
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
        aiOriginalReply?: string,
    ): Promise<void> {
        await commentsService.markAsReplied(
            commentId, replyText, replyMethod, templateId,
            detectedLanguage, needsAttention, flagReason, aiIntent,
            aiOriginalReply,
        );
    }

    async flagComment(commentId: string, flagReason?: string, aiIntent?: string): Promise<void> {
        await commentsService.updateComment(commentId, {
            needsAttention: true,
            flagReason: flagReason ?? null,
            aiIntent: aiIntent ?? null,
        });
    }

    buildGeneratorContext(
        page: PlatformPage,
        contentEntity: ContentEntity,
        contentId: string,
    ): CommentReplyContext {
        return {
            workspaceId: page.workspaceId ?? '',
            userId: page.userId ?? '',
            text: '',  // filled by processor with commentMessage
            pageName: page.name || undefined,
            knowledgeBase: page.knowledgeBase || undefined,
            kbActiveVersion: page.kbActiveVersion,
            postId: contentId,
            postMessage: contentEntity.message || undefined,
            pageId: page.id,
            accessToken: page.accessToken,
        };
    }

    getFallbackReply(): string | null {
        return null;
    }

    async fetchCommenterName(platformCommentId: string, accessToken: string): Promise<string | undefined> {
        try {
            const details = await facebookService.getCommentDetails(platformCommentId, accessToken);
            return details?.from?.name;
        } catch {
            return undefined;
        }
    }
}

export const facebookCommentAdapter = new FacebookCommentAdapter();

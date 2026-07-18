import { pagesService } from '../../pages';
import { postsService } from '../../posts';
import { commentsService } from '../../comments';
import { facebookService } from '../../facebook';
import { replySender, ReplyMode } from '../sender';
import { pickNudgeVariation } from '../nudge';
import { detectCommentLanguage } from '../../../utils/language';
import { stripCommentNoise } from '../../../utils/commentText';
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
        return mapToPlatformPage(page, {
            autoReplyEnabled: page.autoReplyEnabled ?? true,
            autoReplyDisabledReason: page.autoReplyDisabledReason ?? null,
        });
    }

    async findOrCreateContent(pageId: string, postId: string, accessToken?: string): Promise<ContentEntity> {
        const post = await postsService.findOrCreateFromWebhook(pageId, postId, undefined, accessToken);
        return {
            id: post.id,
            autoReplyEnabled: post.autoReplyEnabled ?? true,
            message: post.message,
            triggerKeyword: post.triggerKeyword ?? null,
            triggerReply: post.triggerReply ?? null,
            triggerType: post.triggerType ?? 'keyword',
            triggerImageUrl: post.triggerImageUrl ?? null,
        };
    }

    async storeComment(
        postId: string,
        workspaceId: string,
        facebookCommentId: string,
        message: string,
        fromId?: string,
        fromName?: string,
        messageTags?: import('../../../utils/commentText').FacebookMessageTag[],
    ): Promise<{ comment: StoredComment; isNew: boolean }> {
        const { comment, isNew } = await commentsService.findOrCreateFromWebhook(
            postId, workspaceId, facebookCommentId, message, fromId, fromName, messageTags,
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
        replyImageUrl?: string | null;
    }): Promise<SendCommentResult> {
        const replyMode = (opts.userSettings.commentReplyMode || 'public') as ReplyMode;
        const isDemo = opts.platformPageId.startsWith('demo_');

        // Pick a nudge variation in the comment's language. Strip @mentions/URLs first —
        // their Latin characters (e.g. "@[id:Hanaa Kanaan]") otherwise pollute detection
        // on Arabic pages. Stripped text falls back to post language when script-less.
        const effectiveLang = detectCommentLanguage(stripCommentNoise(opts.commentMessage), opts.postMessage);
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
            // Image rides ONLY the DM channel — the sender applies it in the private/dual
            // branch and never on a public comment.
            replyImageUrl: opts.replyImageUrl,
        });
    }

    async markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        detectedLanguage: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
    ): Promise<void> {
        await commentsService.markAsReplied(
            commentId, replyText, replyMethod,
            detectedLanguage, needsAttention, flagReason, aiIntent,
            aiOriginalReply, flagMeta,
        );
    }

    async flagComment(
        commentId: string,
        flagReason?: string,
        aiIntent?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
        autoResolve?: boolean,
    ): Promise<void> {
        await commentsService.updateComment(commentId, {
            needsAttention: !autoResolve,
            resolved: autoResolve ? true : undefined,
            flagReason: flagReason ?? null,
            flagMeta: flagMeta ?? null,
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

    async fetchCommentWithTags(platformCommentId: string, accessToken: string) {
        return facebookService.getCommentWithTags(platformCommentId, accessToken);
    }
}

export const facebookCommentAdapter = new FacebookCommentAdapter();

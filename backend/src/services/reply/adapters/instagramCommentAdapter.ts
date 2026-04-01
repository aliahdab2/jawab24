import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { pickNudgeVariation } from '../nudge';
import { detectLanguageCode } from '../../../utils/language';
import { db } from '../../../db';
import { instagramMedia, instagramComments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import type { ReplyMode } from '../sender';
import type {
    CommentPlatformAdapter,
    PlatformPage,
    StoredComment,
    ContentEntity,
    CommentReplyContext,
    SendCommentResult,
} from '../../../interfaces';

/**
 * Instagram Comment Platform Adapter
 *
 * Implements platform-specific behavior for Instagram comment processing.
 */
export class InstagramCommentAdapter implements CommentPlatformAdapter {
    readonly platform = 'instagram' as const;

    async getPage(instagramAccountId: string): Promise<PlatformPage | null> {
        const page = await pagesService.getPageByInstagramId(instagramAccountId);
        if (!page) return null;
        return {
            id: page.id,
            userId: page.userId,
            workspaceId: page.workspaceId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: page.knowledgeBase,
            kbActiveVersion: page.kbActiveVersion ?? null,
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
            ecommerceStoreId: page.ecommerceStoreId,
            businessProfile: page.businessProfile as Record<string, unknown> | null,
        };
    }

    async findOrCreateContent(pageId: string, instagramMediaId: string): Promise<ContentEntity> {
        const existing = await db
            .select()
            .from(instagramMedia)
            .where(eq(instagramMedia.instagramMediaId, instagramMediaId));

        if (existing[0]) {
            return {
                id: existing[0].id,
                autoReplyEnabled: existing[0].autoReplyEnabled ?? true,
                message: existing[0].caption,
            };
        }

        const [created] = await db
            .insert(instagramMedia)
            .values({
                pageId,
                instagramMediaId,
                autoReplyEnabled: true,
            })
            .returning();

        return {
            id: created.id,
            autoReplyEnabled: true,
            message: created.caption,
        };
    }

    async storeComment(
        mediaId: string,
        instagramCommentId: string,
        message: string,
        fromId?: string,
        fromUsername?: string,
    ): Promise<{ comment: StoredComment; isNew: boolean }> {
        const existing = await db
            .select()
            .from(instagramComments)
            .where(eq(instagramComments.instagramCommentId, instagramCommentId));

        if (existing[0]) {
            return {
                comment: { id: existing[0].id, replied: existing[0].replied ?? false, needsAttention: existing[0].needsAttention ?? false },
                isNew: false,
            };
        }

        const [created] = await db
            .insert(instagramComments)
            .values({
                mediaId,
                instagramCommentId,
                message,
                fromId,
                fromUsername,
                createdTime: new Date(),
            })
            .returning();

        return {
            comment: { id: created.id, replied: false },
            isNew: true,
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
        const commentLang = detectLanguageCode(opts.commentMessage);
        const variationsMulti = opts.userSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined;
        const dualReplyNudge = pickNudgeVariation(variationsMulti, commentLang);

        let success = false;
        let errorMsg = '';

        // Private or Dual: send DM first
        if (replyMode === 'private' || replyMode === 'dual') {
            if (!opts.fromId) {
                return { success: false, error: 'Cannot send DM: commenter ID not available' };
            }
            try {
                await instagramService.sendDirectMessage(
                    opts.platformPageId, opts.fromId, opts.replyText, opts.accessToken,
                );
                success = true;
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                if (replyMode === 'private') {
                    return { success: false, error: `Failed to send Instagram DM: ${detail}` };
                }
                errorMsg = 'DM failed';
            }
        }

        // Public or Dual: post public comment reply
        if (replyMode === 'public' || (replyMode === 'dual' && !errorMsg)) {
            const publicText = replyMode === 'dual'
                ? (dualReplyNudge || 'أرسلنا لك التفاصيل برسالة خاصة 📩').slice(0, 80)
                : opts.replyText;
            try {
                await instagramService.replyToComment(
                    opts.platformCommentId, publicText, opts.accessToken,
                );
                success = true;
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                if (replyMode === 'public') {
                    errorMsg = `Failed to post reply to Instagram: ${detail}`;
                }
            }
        }

        return { success, error: errorMsg || undefined };
    }

    async markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        detectedLanguage: string,
        _templateId?: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ): Promise<void> {
        await db
            .update(instagramComments)
            .set({
                replied: true,
                replyText,
                replyMethod,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
                aiOriginalReply: aiOriginalReply ?? null,
                detectedLanguage,
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(instagramComments.id, commentId));
    }

    async flagComment(commentId: string, flagReason?: string, aiIntent?: string): Promise<void> {
        await db
            .update(instagramComments)
            .set({
                needsAttention: true,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
                updatedAt: new Date(),
            })
            .where(eq(instagramComments.id, commentId));
    }

    // Instagram doesn't expose a postId or require accessToken for reply generation
    // (unlike Facebook which fetches post content via API). Only media caption is used.
    buildGeneratorContext(
        page: PlatformPage,
        contentEntity: ContentEntity,
        _contentId: string,
    ): CommentReplyContext {
        return {
            workspaceId: page.workspaceId!,
            userId: page.userId!,
            text: '',  // filled by processor with commentMessage
            pageName: page.name || undefined,
            knowledgeBase: page.knowledgeBase || undefined,
            kbActiveVersion: page.kbActiveVersion,
            postMessage: contentEntity.message || undefined,
            pageId: page.id,
        };
    }

    getFallbackReply(): string | null {
        return 'Thank you for your comment! \u{1F64F}';
    }
}

export const instagramCommentAdapter = new InstagramCommentAdapter();

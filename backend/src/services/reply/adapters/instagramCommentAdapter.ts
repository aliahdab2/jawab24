import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { pickNudgeVariation } from '../nudge';
import { detectLanguageCode } from '../../../utils/language';
import { t } from '../../../utils/i18n';
import { db } from '../../../db';
import { instagramMedia, instagramComments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { mapToPlatformPage } from './shared';
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
        return mapToPlatformPage(page, {
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
        });
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
                triggerKeyword: existing[0].triggerKeyword ?? null,
                triggerReply: existing[0].triggerReply ?? null,
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
            triggerKeyword: null,
            triggerReply: null,
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

        const lang = message ? detectLanguageCode(message) : 'unknown';
        const [created] = await db
            .insert(instagramComments)
            .values({
                mediaId,
                instagramCommentId,
                message,
                fromId,
                fromUsername,
                createdTime: new Date(),
                detectedLanguage: lang !== 'unknown' ? lang : null,
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
        postMessage?: string;
    }): Promise<SendCommentResult> {
        const replyMode = (opts.userSettings.commentReplyMode || 'public') as ReplyMode;
        const commentLang = detectLanguageCode(opts.commentMessage);
        const effectiveLang = commentLang !== 'unknown' ? commentLang
            : (opts.postMessage ? detectLanguageCode(opts.postMessage) : 'unknown');
        const variationsMulti = opts.userSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined;
        const dualReplyNudge = pickNudgeVariation(variationsMulti, effectiveLang);

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

        // Public mode: post full reply
        // Dual mode: post nudge if DM succeeded, or full reply if DM failed
        if (replyMode === 'public' || replyMode === 'dual') {
            let publicText = opts.replyText;
            if (replyMode === 'dual' && !errorMsg) {
                // Nudge already truncated by pickNudgeVariation
                publicText = dualReplyNudge || t('dualNudgeDefault', commentLang);
            }
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

    getFallbackReply(lang = 'en'): string | null {
        return t('instagramFallback', lang);
    }
}

export const instagramCommentAdapter = new InstagramCommentAdapter();

import { pagesService } from '../../pages';
import { instagramService } from '../../instagram';
import { pickNudgeVariation } from '../nudge';
import { detectLanguageCode, detectCommentLanguage } from '../../../utils/language';
import { stripCommentNoise } from '../../../utils/commentText';
import { classifyDmError, type DmFailure } from '../../../utils/fbGraphErrors';
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
        workspaceId: string,
        instagramCommentId: string,
        message: string,
        fromId?: string,
        fromUsername?: string,
        _messageTags?: import('../../../utils/commentText').FacebookMessageTag[],
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
                workspaceId,
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
        // Strip @mentions/URLs before language detection — their Latin characters
        // otherwise force an English nudge on Arabic pages.
        const effectiveLang = detectCommentLanguage(stripCommentNoise(opts.commentMessage), opts.postMessage);
        const variationsMulti = opts.userSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined;
        const dualReplyNudge = pickNudgeVariation(variationsMulti, effectiveLang);

        let dmFailure: DmFailure | undefined;

        // DM send (private + dual modes)
        if (replyMode === 'private' || replyMode === 'dual') {
            if (!opts.fromId) {
                // Not a DM-send failure (we never called IG API) — pre-flight validation error.
                return { success: false, error: 'Cannot send DM: commenter ID not available' };
            }
            try {
                await instagramService.sendDirectMessage(
                    opts.platformPageId, opts.fromId, opts.replyText, opts.accessToken,
                );
            } catch (error) {
                dmFailure = classifyDmError(error, 'instagram');
                if (dmFailure.bucket === 'customer_refused' || dmFailure.bucket === 'window_expired') {
                    // Expected outcomes — warn, not error
                    // (logger not wired into this adapter today; rely on sender-style logging in step 10)
                }
                // Transient errors propagate up so BullMQ retries the job.
                if (dmFailure.bucket === 'transient') {
                    throw error;
                }
            }
        }

        // Public mode: post the full reply as a comment
        if (replyMode === 'public') {
            try {
                await instagramService.replyToComment(opts.platformCommentId, opts.replyText, opts.accessToken);
                return { success: true };
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                return { success: false, error: `Failed to post reply to Instagram: ${detail}` };
            }
        }

        // Private mode: on DM failure, DO NOT fall back to public (privacy-first).
        if (replyMode === 'private') {
            if (!dmFailure) return { success: true };
            return { success: false, dmFailure, suppressedPublic: true, error: `DM failed: ${dmFailure.bucket}` };
        }

        // Dual mode
        if (!dmFailure) {
            // DM succeeded → post nudge publicly
            const nudgeText = dualReplyNudge || t('dualNudgeDefault', effectiveLang as 'ar' | 'en');
            try {
                await instagramService.replyToComment(opts.platformCommentId, nudgeText, opts.accessToken);
            } catch {
                // nudge failure is logged at higher levels; DM already succeeded
            }
            return { success: true };
        }

        // DM failed in dual mode — nudge only for window_expired, nothing otherwise.
        if (dmFailure.bucket === 'window_expired' && dualReplyNudge) {
            try {
                await instagramService.replyToComment(opts.platformCommentId, dualReplyNudge, opts.accessToken);
            } catch {
                // nudge post failure is non-fatal here
            }
            return { success: false, dmFailure, error: `DM failed: ${dmFailure.bucket}` };
        }
        return { success: false, dmFailure, suppressedPublic: true, error: `DM failed: ${dmFailure.bucket}` };
    }

    async markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        detectedLanguage: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
    ): Promise<void> {
        await db
            .update(instagramComments)
            .set({
                replied: true,
                replyText,
                replyMethod,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                flagMeta: flagMeta ?? null,
                aiIntent: aiIntent ?? null,
                aiOriginalReply: aiOriginalReply ?? null,
                detectedLanguage,
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(instagramComments.id, commentId));
    }

    async flagComment(
        commentId: string,
        flagReason?: string,
        aiIntent?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
    ): Promise<void> {
        await db
            .update(instagramComments)
            .set({
                needsAttention: true,
                flagReason: flagReason ?? null,
                flagMeta: flagMeta ?? null,
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

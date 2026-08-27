import { pagesService } from '../../pages';
import { renderReplyForChannel } from '@jawab24/shared';
import { postsService } from '../../posts';
import { instagramService } from '../../instagram';
import { pickNudgeVariation } from '../nudge';
import { detectLanguageCode, detectCommentLanguage } from '../../../utils/language';
import { stripCommentNoise } from '../../../utils/commentText';
import { classifyDmError, type DmFailure } from '../../../utils/fbGraphErrors';
import { deliverReplyImageBestEffort } from '../postReplyImage';
import { t } from '../../../utils/i18n';
import { db } from '../../../db';
import { instagramComments } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { mapToPlatformPage } from './shared';
import {
    resolveInstagramCredential,
    pageLinkedInstagramCredential,
    instagramMessagesEndpoint,
    type InstagramCredential,
} from '../../instagramCredential';
import type { CommentDeliveryMode } from '../sender';
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
        const credential = resolveInstagramCredential(page);
        // See instagramAdapter.getPage — `accessToken` carries the credential this
        // platform actually sends with, WhatsApp-adapter style.
        return mapToPlatformPage({ ...page, accessToken: credential.accessToken }, {
            autoReplyEnabled: page.instagramAutoReplyEnabled ?? true,
            platformAccountId: page.instagramAccountId ?? undefined,
            instagramCredential: credential,
        });
    }

    async findOrCreateContent(pageId: string, instagramMediaId: string): Promise<ContentEntity> {
        // Shared with the Post Reply picker's ensure endpoint — the find-or-create lives
        // in postsService so both paths converge on the same row (see postsService).
        const media = await postsService.findOrCreateInstagramMedia(pageId, instagramMediaId);
        return {
            id: media.id,
            autoReplyEnabled: media.autoReplyEnabled ?? true,
            message: media.caption,
            triggerKeyword: media.triggerKeyword ?? null,
            triggerReply: media.triggerReply ?? null,
            triggerType: media.triggerType ?? 'keyword',
            triggerExcludeKeyword: media.triggerExcludeKeyword ?? null,
            triggerImageUrl: media.triggerImageUrl ?? null,
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

    renderReply(text: string): string {
        return renderReplyForChannel(text, 'plain');
    }

    async sendReply(opts: {
        platformCommentId: string;
        platformPageId: string;
        replyText: string;
        commentMessage: string;
        accessToken: string;
        instagramCredential?: InstagramCredential;
        fromId?: string;
        userSettings: Record<string, unknown>;
        postMessage?: string;
        replyImageUrl?: string | null;
    }): Promise<SendCommentResult> {
        // HOST from the resolved credential, TOKEN from `opts`: the page-token
        // retry wrapper hands this method a freshly re-minted Facebook token when
        // the stored one died, and the send must adopt it — the credential
        // snapshot predates the re-mint. On an Instagram Login page no re-mint
        // happens (there is no Facebook Page to mint from), so the two agree.
        const base = opts.instagramCredential ?? pageLinkedInstagramCredential(opts.accessToken);
        const cred: InstagramCredential = { ...base, accessToken: opts.accessToken };
        const replyMode = (opts.userSettings.commentReplyMode || 'public') as CommentDeliveryMode;
        // Strip @mentions/URLs before language detection — their Latin characters
        // otherwise force an English nudge on Arabic pages.
        const effectiveLang = detectCommentLanguage(stripCommentNoise(opts.commentMessage), opts.postMessage);
        const variationsMulti = opts.userSettings.dualReplyNudgeVariations as Record<string, string[]> | undefined;
        const dualReplyNudge = pickNudgeVariation(variationsMulti, effectiveLang);

        let dmFailure: DmFailure | undefined;
        let imageDelivered = false;

        // DM send (private + dual modes). Image (Post Reply only) rides ONLY here.
        if (replyMode === 'private' || replyMode === 'dual') {
            if (!opts.fromId) {
                // Not a DM-send failure (we never called IG API) — pre-flight validation error.
                return { success: false, error: 'Cannot send DM: commenter ID not available' };
            }
            try {
                // Text first — the reliable, primary delivery (sent to the commenter's PSID).
                await instagramService.sendDirectMessage(
                    opts.platformPageId, opts.fromId, opts.replyText, cred,
                );
                // An attached image (Post Reply only) follows as its OWN native-image message —
                // full, uncropped, tap-to-open. Best-effort (the text already delivered); see
                // deliverReplyImageBestEffort for why it never throws.
                if (opts.replyImageUrl) {
                    imageDelivered = await deliverReplyImageBestEffort(cred.accessToken, opts.fromId, opts.replyImageUrl, {
                        platform: 'instagram',
                        component: 'instagramCommentAdapter',
                        extra: { platformCommentId: opts.platformCommentId, replyMode },
                        endpoint: instagramMessagesEndpoint(cred, opts.platformPageId),
                    });
                }
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
                await instagramService.replyToComment(opts.platformCommentId, opts.replyText, cred);
                return { success: true };
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                // `publicFailure`, mirroring the Facebook sender. Instagram rides the
                // SAME page token (it is columns on the page row, not a separate
                // credential), so one revoked session kills both — but this branch used
                // to return a bare string, so page-token recovery had nothing to
                // classify and never fired on Instagram's DEFAULT comment mode.
                //
                // NOT `dmFailure`: no DM was attempted, and that field drives the inbox
                // label and the auto-pause bucket. See sender.ts → SendReplyResult.
                return {
                    success: false,
                    publicFailure: classifyDmError(error, 'instagram'),
                    error: `Failed to post reply to Instagram: ${detail}`,
                };
            }
        }

        // Private mode: on DM failure, DO NOT fall back to public (privacy-first).
        if (replyMode === 'private') {
            if (!dmFailure) return { success: true, imageDelivered };
            return { success: false, dmFailure, suppressedPublic: true, error: `DM failed: ${dmFailure.bucket}` };
        }

        // Dual mode
        if (!dmFailure) {
            // DM succeeded → post nudge publicly
            const nudgeText = dualReplyNudge || t('dualNudgeDefault', effectiveLang as 'ar' | 'en');
            try {
                await instagramService.replyToComment(opts.platformCommentId, nudgeText, cred);
            } catch {
                // nudge failure is logged at higher levels; DM already succeeded
            }
            return { success: true, imageDelivered };
        }

        // DM failed in dual mode — nudge only for window_expired, nothing otherwise.
        if (dmFailure.bucket === 'window_expired' && dualReplyNudge) {
            try {
                await instagramService.replyToComment(opts.platformCommentId, dualReplyNudge, cred);
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
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
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
        autoResolve?: boolean,
    ): Promise<void> {
        await db
            .update(instagramComments)
            .set({
                needsAttention: !autoResolve,
                ...(autoResolve ? { resolved: true } : {}),
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
            kbIndexedVersion: page.kbIndexedVersion,
            postMessage: contentEntity.message || undefined,
            pageId: page.id,
        };
    }

    getFallbackReply(): string | null {
        // No adapter-level fallback. When generator returns no reply (offensive,
        // spam, low confidence, AI unavailable), commentProcessor's no-reply
        // branch flags the comment needs_attention and notifies the merchant —
        // matches the Facebook adapter's behavior and avoids sending a useless
        // "شكراً لتعليقك! 🙏" mid-conversation.
        return null;
    }
}

export const instagramCommentAdapter = new InstagramCommentAdapter();

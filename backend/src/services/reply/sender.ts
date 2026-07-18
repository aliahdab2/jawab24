import { facebookService } from '../facebook';
import { fbAxios } from '../../lib/fbAxios';
import { Logger, noopLogger } from '../../types';
import { config } from '../../config';
import { t } from '../../utils/i18n';
import { classifyDmError, type DmFailure } from '../../utils/fbGraphErrors';
import { deliverReplyImageBestEffort } from './postReplyImage';

const FACEBOOK_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

export type ReplyMode = 'public' | 'private' | 'dual';

export interface SendCommentReplyOptions {
    facebookCommentId: string;
    replyText: string;
    commentMessage: string;
    accessToken: string;
    fromId?: string;
    replyMode: ReplyMode;
    dualReplyNudge?: string;
    /** If true, skip Facebook API calls (for demo mode) */
    isDemo?: boolean;
    /** Post Reply image URL — sent as a card on the DM channel only (private/dual).
     *  On non-transient card failure we fall back to a plain-text DM. */
    replyImageUrl?: string | null;
}

export interface SendReplyResult {
    success: boolean;
    error?: string;
    /** PSID of the DM recipient, present when a private message was successfully sent */
    dmRecipientId?: string;
    /**
     * Structured info about a DM failure — set by the catch branch in dual/private modes.
     * Consumed by commentProcessor to decide page-level integration alerts (never per-comment flags).
     * See docs/comment-and-message-handling.md → "DM-failure-aware fallback".
     */
    dmFailure?: DmFailure;
    /**
     * True when the public-comment fallback was intentionally suppressed because the
     * failure bucket forbids leaking DM content publicly (e.g. customer_refused, our_fault).
     * Callers use this to avoid logging "public post failed" when we never attempted one.
     */
    suppressedPublic?: boolean;
    /**
     * True when a Post Reply image was actually delivered (its own native-image message
     * sent successfully after the text). Drives the delivery-accurate "image attached"
     * badge. Undefined/false = no image, or the image send failed (text still delivered).
     */
    imageDelivered?: boolean;
}

/**
 * Reply Sender Service
 * Handles the logic of sending replies to Facebook (public comments, private messages)
 */
export class ReplySender {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Send a reply to a comment based on the reply mode:
     * - public: Reply as a public comment.
     * - private: Send as a DM. On DM failure: no public fallback — privacy first.
     *            The full reply was generated for DM ("channel=dm") and may contain
     *            prices/specs/customer-specific info that shouldn't leak publicly.
     * - dual: Send DM + short public nudge. On DM failure, still only the nudge is
     *         posted for `window_expired`; all other failure buckets post NOTHING.
     *
     * DM-failure behavior is classified into 5 buckets via classifyDmError().
     * See docs/comment-and-message-handling.md → "DM-failure-aware fallback".
     * `transient` errors are rethrown so BullMQ retries the whole job (replyQueue.ts).
     */
    async sendCommentReply(options: SendCommentReplyOptions): Promise<SendReplyResult> {
        const {
            facebookCommentId,
            replyText,
            accessToken,
            replyMode,
            dualReplyNudge,
            isDemo = false,
            replyImageUrl,
        } = options;

        if (isDemo) {
            this.logger.info('[Sender] Demo mode - skipping Facebook API', { facebookCommentId });
            return { success: true };
        }

        let dmRecipientId: string | undefined;
        let dmFailure: DmFailure | undefined;
        let imageDelivered = false;

        // DM send (private + dual modes). An image (Post Reply only) rides ONLY here —
        // never on the public branch below.
        if (replyMode === 'private' || replyMode === 'dual') {
            try {
                // The reply TEXT is the one-shot private reply (recipient.comment_id) — always
                // sent first, and it returns the PSID. It is the reliable, primary delivery.
                const dm = await facebookService.sendPrivateReplyToComment(accessToken, facebookCommentId, replyText);
                dmRecipientId = dm.recipientId;
                this.logger.info('[Sender] Private reply sent', { facebookCommentId, replyMode, recipientId: dmRecipientId, hasImage: !!replyImageUrl });

                // An attached image (Post Reply only) follows as its OWN native-image message
                // to the returned PSID — full, uncropped, tap-to-open. Best-effort (the text
                // already delivered); see deliverReplyImageBestEffort for why it never throws.
                if (replyImageUrl) {
                    imageDelivered = await deliverReplyImageBestEffort(accessToken, dmRecipientId, replyImageUrl, {
                        platform: 'facebook',
                        component: 'sender',
                        extra: { facebookCommentId, replyMode },
                    });
                }
            } catch (error) {
                dmFailure = classifyDmError(error, 'facebook');
                this.logFailure(facebookCommentId, replyMode, dmFailure);

                // Transient failures propagate up so BullMQ retries the whole comment job.
                // No public post either way — we never leak DM content on retry-worthy errors.
                if (dmFailure.bucket === 'transient') {
                    throw error;
                }
            }
        }

        // Public send (public mode, or dual-mode nudge when DM succeeded/window_expired)
        if (replyMode === 'public') {
            const ok = await this.postPublicReply(facebookCommentId, replyText, accessToken);
            return ok
                ? { success: true }
                : { success: false, error: 'Failed to post public reply to Facebook' };
        }

        if (replyMode === 'private') {
            if (!dmFailure) {
                return { success: true, dmRecipientId, imageDelivered };
            }
            // DM failed in private mode → DO NOT fall back to public.
            // The reply was generated for DM; posting it publicly would leak content.
            return { success: false, dmFailure, suppressedPublic: true, error: `DM failed: ${dmFailure.bucket}` };
        }

        // Dual mode
        if (!dmFailure) {
            // DM succeeded → post the nudge publicly
            const publicText = dualReplyNudge || t('dualNudgeDefault', 'ar');
            const ok = await this.postPublicReply(facebookCommentId, publicText, accessToken);
            if (!ok) this.logger.warn('[Sender] Dual mode: nudge post failed', { facebookCommentId });
            return { success: true, dmRecipientId, imageDelivered };
        }

        // DM failed in dual mode — only window_expired gets a short nudge.
        // All other buckets (customer_refused / our_fault / unknown): post nothing.
        if (dmFailure.bucket === 'window_expired' && dualReplyNudge) {
            const ok = await this.postPublicReply(facebookCommentId, dualReplyNudge, accessToken);
            if (!ok) this.logger.warn('[Sender] Dual mode: window_expired nudge post failed', { facebookCommentId });
            return { success: false, dmFailure, error: `DM failed: ${dmFailure.bucket}` };
        }
        return { success: false, dmFailure, suppressedPublic: true, error: `DM failed: ${dmFailure.bucket}` };
    }

    private logFailure(facebookCommentId: string, replyMode: ReplyMode, failure: DmFailure): void {
        const ctx = {
            facebookCommentId,
            replyMode,
            bucket: failure.bucket,
            code: failure.code,
            subcode: failure.subcode,
            fbMessage: failure.fbMessage,
        };
        // customer_refused / window_expired are expected outcomes — warn, not error.
        if (failure.bucket === 'customer_refused' || failure.bucket === 'window_expired') {
            this.logger.warn('[Sender] DM not delivered (expected)', ctx);
        } else {
            this.logger.error('[Sender] DM send failed', ctx);
        }
    }

    /**
     * Post a reply to a Facebook comment
     */
    async postPublicReply(
        commentId: string,
        message: string,
        accessToken: string
    ): Promise<boolean> {
        try {
            await fbAxios.post(
                `${FACEBOOK_GRAPH_API}/${commentId}/comments`,
                { message },
                { params: { access_token: accessToken } }
            );
            return true;
        } catch (error) {
            this.logger.error('Failed to post reply to Facebook', {
                commentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
}

export const replySender = new ReplySender();

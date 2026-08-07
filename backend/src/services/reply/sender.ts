import { facebookService } from '../facebook';
import { fbAxios } from '../../lib/fbAxios';
import { Logger, noopLogger } from '../../types';
import { config } from '../../config';
import { t } from '../../utils/i18n';
import { classifyDmError, type DmFailure } from '../../utils/fbGraphErrors';
import { captureError } from '../../utils/sentryHelpers';
import { buildFacebookMentionToken, prefixMention } from '../../utils/commentMention';
import { commentMentionGuard } from './commentMentionGuard';
import type { CtaButton } from '../metaMessaging';

const FACEBOOK_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

export type ReplyMode = 'public' | 'private' | 'dual';

export interface SendCommentReplyOptions {
    facebookCommentId: string;
    replyText: string;
    commentMessage: string;
    accessToken: string;
    /** Commenter's PSID (the comment's `from.id`). Also the mention target when `tagCommenter`
     *  is on — Meta accepts exactly this id in `@[…]` for someone who commented on the post. */
    fromId?: string;
    /** Facebook page id — keys the per-page "this page rejects mentions" memo. */
    platformPageId?: string;
    /** Post Reply option: mention the commenter in the PUBLIC comment. Never affects the DM
     *  (the customer is already the recipient there). Requires `fromId` + `platformPageId`. */
    tagCommenter?: boolean;
    replyMode: ReplyMode;
    dualReplyNudge?: string;
    /** If true, skip Facebook API calls (for demo mode) */
    isDemo?: boolean;
    /** Post Reply image URL — delivered on the DM channel only (private/dual) as an inline
     *  image card (image is always shown). On non-transient failure we fall back to a plain-text DM. */
    replyImageUrl?: string | null;
    /** Localized «Read more» postback button for a long caption: when set and the caption
     *  exceeds the card limit, the card shows a teaser + this button; the tap delivers the full
     *  text in-chat (the image stays in the card). Null/absent → short caption shown in full, no button. */
    readMore?: { label: string; payload: string } | null;
    /** Stable link the card's tap-through opens — resolves the Post Reply's CURRENT image at tap
     *  time so an already-sent card never 404s after the merchant replaces or clears it.
     *  Absent → the card falls back to the raw image URL (see metaMessaging.imageCardMessage). */
    imageViewUrl?: string;
    /** Post Reply CTA link button (DM channel only, Facebook only): label + URL. When set, the
     *  reply rides a button template (no image) or the image card (with image). Absent → no button. */
    cta?: CtaButton;
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
     * True when a Post Reply image was actually delivered (the single private-reply message
     * — image card or text+button — sent successfully). Drives the delivery-accurate "image
     * attached" badge. Undefined/false = no image, or the image send failed and we fell back
     * to a plain-text reply.
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
        // The guard is only ever reached through this class, so it inherits our logger —
        // otherwise its "page rejects mentions" warnings would go to the noop logger and
        // the one failure mode it exists to surface would be invisible in production.
        commentMentionGuard.setLogger(logger);
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
            readMore,
            imageViewUrl,
            cta,
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
                if (replyImageUrl) {
                    // Meta allows exactly ONE message on a cold comment→DM. The image ALWAYS rides
                    // an inline card (never hidden). A short caption shows in full; a long one shows
                    // a teaser + «Read more» postback, and the tap delivers the full text in-chat.
                    // An optional CTA link button rides the same card.
                    try {
                        const dm = await facebookService.sendPrivateReplyWithImage(accessToken, facebookCommentId, replyText, replyImageUrl, readMore ?? null, cta, imageViewUrl);
                        dmRecipientId = dm.recipientId;
                        imageDelivered = true;
                        this.logger.info('[Sender] Private reply with image sent', { facebookCommentId, replyMode, recipientId: dmRecipientId, format: dm.format });
                    } catch (imgError) {
                        // Transient → let the outer handler retry the whole job.
                        if (classifyDmError(imgError, 'facebook').bucket === 'transient') throw imgError;
                        // Non-transient (e.g. Meta rejected the template) → fall back to a plain-text
                        // private reply so the customer still gets the reply; the image is dropped
                        // this time (honest: imageDelivered stays false, so no "image" badge). The
                        // CTA still rides the fallback (button template) so the link isn't lost.
                        captureError(imgError, 'Post Reply image reply failed; sent text only', {
                            fingerprint: ['post-reply-image-reply-failed'],
                            level: 'warning',
                            tags: { platform: 'facebook', component: 'sender' },
                            extra: { facebookCommentId, replyMode },
                        });
                        const dm = await facebookService.sendPrivateReplyToComment(accessToken, facebookCommentId, replyText, cta);
                        dmRecipientId = dm.recipientId;
                    }
                } else {
                    // Plain-text (or button-template, with a CTA) one-shot private reply
                    // (recipient.comment_id) — returns the PSID.
                    const dm = await facebookService.sendPrivateReplyToComment(accessToken, facebookCommentId, replyText, cta);
                    dmRecipientId = dm.recipientId;
                    this.logger.info('[Sender] Private reply sent', { facebookCommentId, replyMode, recipientId: dmRecipientId, hasCta: !!cta });
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
            const ok = await this.postPublicReplyMaybeTagged(options, replyText);
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
            const ok = await this.postPublicReplyMaybeTagged(options, publicText);
            if (!ok) this.logger.warn('[Sender] Dual mode: nudge post failed', { facebookCommentId });
            return { success: true, dmRecipientId, imageDelivered };
        }

        // DM failed in dual mode — only window_expired gets a short nudge.
        // All other buckets (customer_refused / our_fault / unknown): post nothing.
        if (dmFailure.bucket === 'window_expired' && dualReplyNudge) {
            const ok = await this.postPublicReplyMaybeTagged(options, dualReplyNudge);
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
     * Post a reply to a Facebook comment. Returns the created comment's id, or null when the
     * post failed — callers that only care about success can treat it as a boolean, while the
     * mention path needs the id to read the result back.
     */
    async postPublicReply(
        commentId: string,
        message: string,
        accessToken: string
    ): Promise<string | null> {
        try {
            const res = await fbAxios.post<{ id?: string }>(
                `${FACEBOOK_GRAPH_API}/${commentId}/comments`,
                { message },
                { params: { access_token: accessToken } }
            );
            // Graph returns the new comment id; fall back to a sentinel so a successful post
            // with an unexpected body still reads as success (it just can't be verified).
            return res.data?.id ?? '';
        } catch (error) {
            this.logger.error('Failed to post reply to Facebook', {
                commentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Post the public comment, mentioning the commenter when the merchant armed that option.
     *
     * The mention is prefixed AFTER the caller's own truncation (the nudge is capped at
     * NUDGE_MAX_LENGTH) so the token can never be sliced into a literal `@[1784`. When Meta
     * declines to render it — the page's «Others Tagging this Page» setting is off, which no
     * API exposes — the guard rewrites this comment to the untagged text and stops tagging on
     * this page. See commentMentionGuard.ts for why that is the only available strategy.
     */
    private async postPublicReplyMaybeTagged(
        options: SendCommentReplyOptions,
        message: string,
    ): Promise<boolean> {
        const { facebookCommentId, accessToken, fromId, platformPageId, tagCommenter } = options;

        const token = tagCommenter && platformPageId ? buildFacebookMentionToken(fromId) : null;
        const mayTag = token ? await commentMentionGuard.shouldTag(platformPageId as string) : false;
        if (!token || !mayTag) {
            return (await this.postPublicReply(facebookCommentId, message, accessToken)) !== null;
        }

        const postedId = await this.postPublicReply(facebookCommentId, prefixMention(token, message), accessToken);
        if (postedId === null) return false;
        // Empty id = posted but unverifiable (no id in the response); nothing to read back.
        if (postedId) {
            await commentMentionGuard.verifyAndRepair({
                postedCommentId: postedId,
                pageId: platformPageId as string,
                psid: (fromId as string).trim(),
                plainText: message,
                accessToken,
            });
        }
        return true;
    }
}

export const replySender = new ReplySender();

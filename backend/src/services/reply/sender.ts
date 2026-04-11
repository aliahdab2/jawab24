import { facebookService } from '../facebook';
import { fbAxios } from '../../lib/fbAxios';
import { Logger, noopLogger } from '../../types';
import { config } from '../../config';
import { t } from '../../utils/i18n';

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
}

export interface SendReplyResult {
    success: boolean;
    error?: string;
    /** PSID of the DM recipient, present when a private message was successfully sent */
    dmRecipientId?: string;
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
     * Send a reply to a comment based on the reply mode
     * - public: Reply as a comment
     * - private: Send as a DM
     * - dual: Send DM + short public nudge
     */
    async sendCommentReply(options: SendCommentReplyOptions): Promise<SendReplyResult> {
        const {
            facebookCommentId,
            replyText,
            accessToken,
            replyMode,
            dualReplyNudge,
            isDemo = false
        } = options;

        // Demo mode: Skip Facebook API calls, simulate success
        if (isDemo) {
            this.logger.info('[Sender] Demo mode - skipping Facebook API', { facebookCommentId });
            return { success: true };
        }

        let success = false;
        let errorMsg = '';
        let dmRecipientId: string | undefined;

        // Private or Dual mode: Send DM via /me/messages with comment_id
        if (replyMode === 'private' || replyMode === 'dual') {
            try {
                const dm = await facebookService.sendPrivateReplyToComment(accessToken, facebookCommentId, replyText);
                success = true;
                dmRecipientId = dm.recipientId;
                this.logger.info('[Sender] Private reply sent', { facebookCommentId, replyMode, recipientId: dmRecipientId });
            } catch (error) {
                this.logger.error('[Sender] Failed to send private reply', {
                    facebookCommentId,
                    replyMode,
                    error: error instanceof Error ? error.message : String(error)
                });

                if (replyMode === 'private') {
                    // Private-only: fall back to public comment so user always gets a response
                    this.logger.warn('[Sender] Private mode failed — falling back to public comment', { facebookCommentId });
                    const pubSuccess = await this.postPublicReply(facebookCommentId, replyText, accessToken);
                    return pubSuccess
                        ? { success: true }
                        : { success: false, error: 'Failed to send private and public reply' };
                }
                // Dual mode: DM failed — still post nudge, not the full reply.
                // The user chose dual mode specifically to avoid full replies in public.
                errorMsg = 'Private message failed';
            }
        }

        // Public mode: post full reply as comment
        // Dual mode: always post nudge (respects user's setting regardless of DM outcome)
        if (replyMode === 'public' || replyMode === 'dual') {
            let publicText = replyText;

            if (replyMode === 'dual') {
                publicText = dualReplyNudge || t('dualNudgeDefault', 'ar');
            }

            const pubSuccess = await this.postPublicReply(
                facebookCommentId,
                publicText,
                accessToken
            );

            if (pubSuccess) {
                success = true;
            } else {
                if (replyMode === 'public') {
                    errorMsg = 'Failed to post public reply to Facebook';
                }
                if (replyMode === 'dual') {
                    this.logger.warn('Dual mode: Public reply failed', { commentId: facebookCommentId });
                }
            }
        }

        return { success, dmRecipientId, error: errorMsg || undefined };
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

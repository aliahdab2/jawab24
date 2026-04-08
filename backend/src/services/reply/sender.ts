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

        // Private or Dual mode: Send DM via /{comment-id}/private_replies
        // This works for any commenter without prior Messenger interaction.
        if (replyMode === 'private' || replyMode === 'dual') {
            try {
                await facebookService.sendPrivateReplyToComment(accessToken, facebookCommentId, replyText);
                success = true;
                this.logger.debug('[Sender] Sent private reply', { facebookCommentId });
            } catch (error) {
                this.logger.error('Failed to send private reply', {
                    facebookCommentId,
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
                // Dual mode: DM failed, continue to public reply with full text (not just nudge)
                errorMsg = 'Private message failed';
            }
        }

        // Public mode: post public comment
        // Dual mode: post nudge if DM succeeded, or full reply if DM failed
        if (replyMode === 'public' || replyMode === 'dual') {
            let publicText = replyText;

            // For dual mode with successful DM, use the pre-picked nudge (already truncated by pickNudgeVariation)
            if (replyMode === 'dual' && !errorMsg) {
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

        return { success, error: errorMsg || undefined };
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

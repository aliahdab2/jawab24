import axios from 'axios';
import { facebookService } from '../facebook';
import { detectLanguageCode } from '../../utils/language';
import { Logger, noopLogger } from '../../types';
import { config } from '../../config';

const FACEBOOK_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

export type ReplyMode = 'public' | 'private' | 'dual';

export interface DualReplyConfig {
    [lang: string]: string;
}

export interface SendCommentReplyOptions {
    facebookCommentId: string;
    replyText: string;
    commentMessage: string;
    accessToken: string;
    fromId?: string;
    replyMode: ReplyMode;
    dualReplyConfig?: DualReplyConfig;
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
            commentMessage,
            accessToken, 
            fromId, 
            replyMode, 
            dualReplyConfig,
            isDemo = false
        } = options;

        // Demo mode: Skip Facebook API calls, simulate success
        if (isDemo) {
            this.logger.info('[Sender] Demo mode - skipping Facebook API', { facebookCommentId });
            return { success: true };
        }

        let success = false;
        let errorMsg = '';

        // Private or Dual mode: Send DM first
        if (replyMode === 'private' || replyMode === 'dual') {
            if (!fromId) {
                return {
                    success: false,
                    error: 'Cannot send private message: commenter ID not available'
                };
            }

            try {
                await facebookService.sendPrivateMessage(accessToken, fromId, replyText);
                
                if (replyMode === 'private') {
                    success = true;
                }
                this.logger.debug('[Sender] Sent private message', { fromId });
            } catch (error) {
                this.logger.error('Failed to send private message', {
                    fromId,
                    error: error instanceof Error ? error.message : String(error)
                });

                if (replyMode === 'private') {
                    return {
                        success: false,
                        error: 'Failed to send private message to commenter'
                    };
                }
                // For dual mode, we continue to try public
                errorMsg = 'Private message failed';
            }
        }

        // Public or Dual mode: Post public comment
        if (replyMode === 'public' || (replyMode === 'dual' && !errorMsg)) {
            let publicText = replyText;

            // For dual mode, use a short "nudge" instead of the full reply
            if (replyMode === 'dual') {
                publicText = this.getDualModeNudge(commentMessage, dualReplyConfig);
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
     * Get the public "nudge" text for dual mode
     * This is a short message that points to the private message
     */
    private getDualModeNudge(commentMessage: string, config?: DualReplyConfig): string {
        const detectedLang = detectLanguageCode(commentMessage);
        const lang = detectedLang === 'unknown' ? 'en' : detectedLang;

        const nudge = config?.[lang] ||
            config?.['en'] ||
            (lang === 'ar' ? 'تم إرسال التفاصيل برسالة خاصة 📩' : 'Details sent in a private message 📩');

        // Enforce max length (80 chars) for public comments
        return nudge.slice(0, 80);
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
            await axios.post(
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

    /**
     * Send a private message reply
     */
    async sendPrivateMessage(
        accessToken: string,
        recipientId: string,
        message: string
    ): Promise<boolean> {
        try {
            await facebookService.sendPrivateMessage(accessToken, recipientId, message);
            return true;
        } catch (error) {
            this.logger.error('Failed to send private message', {
                recipientId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
}

export const replySender = new ReplySender();

import axios from 'axios';
import {
    Logger,
    noopLogger,
    InstagramAccount,
    InstagramMedia,
    InstagramComment,
    InstagramMediaResponse,
    InstagramCommentsResponse
} from '../types';

import { GRAPH_API_BASE, fbAxios } from '../lib/fbAxios';
import { DmSendError } from '../utils/fbGraphErrors';
import { buildMessagePayload, type SendMessageOptions } from './metaMessaging';

const INSTAGRAM_GRAPH_API = GRAPH_API_BASE;

export class InstagramService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Get Instagram Business Account linked to a Facebook Page
     * Requires: instagram_business_basic permission
     */
    async getLinkedInstagramAccount(pageId: string, pageAccessToken: string): Promise<InstagramAccount | null> {
        try {
            this.logger.debug('[Instagram] Fetching linked Instagram account', { pageId });
            
            const response = await fbAxios.get(`${INSTAGRAM_GRAPH_API}/${pageId}`, {
                params: {
                    fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}',
                    access_token: pageAccessToken,
                },
            });

            const igAccount = response.data.instagram_business_account;
            
            if (igAccount) {
                this.logger.info('[Instagram] Found linked account', { username: igAccount.username });
                return igAccount;
            }
            
            this.logger.debug('[Instagram] No Instagram Business Account linked to this page');
            return null;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error', { error: error.response?.data?.error?.message || error.message });
                // Don't throw - just return null if Instagram isn't connected
                if (error.response?.data?.error?.code === 190) {
                    throw new Error('Access token expired');
                }
                return null;
            }
            throw error;
        }
    }

    /**
     * Get Instagram media (posts, reels) for an account
     * Requires: instagram_business_basic permission
     */
    async getMedia(
        instagramAccountId: string,
        pageAccessToken: string,
        opts: { limit?: number; after?: string } = {},
    ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }> {
        try {
            this.logger.debug('[Instagram] Fetching media', { instagramAccountId });

            const response = await fbAxios.get<InstagramMediaResponse>(
                `${INSTAGRAM_GRAPH_API}/${instagramAccountId}/media`,
                {
                    params: {
                        fields: 'id,media_type,caption,permalink,media_url,thumbnail_url,timestamp,comments_count',
                        limit: opts.limit ?? 25,
                        ...(opts.after ? { after: opts.after } : {}),
                        access_token: pageAccessToken,
                    },
                }
            );

            const media = response.data.data || [];
            this.logger.info('[Instagram] Found media items', { count: media.length });
            return { media, nextCursor: response.data.paging?.cursors?.after || null };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error fetching media', { error: error.response?.data?.error?.message || error.message });
                // `DmSendError.fromAxios`, not `new Error(...)`: same contract and
                // reasoning as `replyToComment` below — a plain Error destroys the
                // Graph code/subcode, which made `withPageTokenRetry` around this
                // read (posts.ts) permanently inert: `classifyTokenFailure` saw an
                // unclassifiable error and never re-minted. Message text preserved
                // by `fromAxios`, so `.message` consumers are unaffected.
                throw DmSendError.fromAxios(error, 'Instagram API error');
            }
            throw error;
        }
    }

    /**
     * Get comments on an Instagram media object
     * Requires: instagram_business_basic permission
     */
    async getComments(mediaId: string, pageAccessToken: string): Promise<InstagramComment[]> {
        try {
            this.logger.debug('[Instagram] Fetching comments', { mediaId });
            
            const response = await fbAxios.get<InstagramCommentsResponse>(
                `${INSTAGRAM_GRAPH_API}/${mediaId}/comments`,
                {
                    params: {
                        fields: 'id,text,timestamp,from{id,username},replies{id,text,timestamp,from{id,username}}',
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Found comments', { count: response.data.data?.length || 0 });
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error fetching comments', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get Instagram media content (caption) by media ID.
     * Returns the caption text or null if unavailable.
     */
    async getPostContent(mediaId: string, pageAccessToken: string): Promise<string | null> {
        try {
            this.logger.debug('[Instagram] Fetching media content', { mediaId });
            const response = await fbAxios.get(`${INSTAGRAM_GRAPH_API}/${mediaId}`, {
                params: {
                    fields: 'caption',
                    access_token: pageAccessToken,
                },
            });

            const caption = response.data.caption || null;
            this.logger.debug('[Instagram] Media content fetched', {
                mediaId,
                hasContent: !!caption,
                contentPreview: caption ? caption.substring(0, 50) : null,
            });
            return caption;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] Error fetching media content', {
                    mediaId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            // Don't throw — return null if we can't fetch the media
            return null;
        }
    }

    /**
     * Reply to an Instagram comment
     * Requires: instagram_business_manage_comments permission
     */
    async replyToComment(commentId: string, message: string, pageAccessToken: string): Promise<string> {
        try {
            this.logger.debug('[Instagram] Replying to comment', { commentId });
            
            const response = await fbAxios.post(
                `${INSTAGRAM_GRAPH_API}/${commentId}/replies`,
                {
                    message,
                },
                {
                    params: {
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Reply posted successfully', { replyId: response.data.id });
            return response.data.id;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error posting reply', { error: error.response?.data?.error?.message || error.message });
                // `DmSendError.fromAxios`, not `new Error(...)`: flattening to a plain
                // Error destroys the Graph code/subcode, and every consumer that has to
                // tell a DEAD CREDENTIAL from a blip reads exactly those two fields.
                // While this threw a bare Error, `classifyDmError` could only answer
                // `unknown`, so page-token recovery never fired on Instagram's default
                // comment path — the same defect the Facebook side carried until
                // sender.ts started classifying. Same message text as before
                // (`Instagram API error: <graph message>`), so callers reading
                // `.message` are unaffected. Precedent: sendDirectMessage below.
                throw DmSendError.fromAxios(error, 'Instagram API error');
            }
            throw error;
        }
    }

    /**
     * Hide a comment on Instagram
     * Requires: instagram_business_manage_comments permission
     */
    async hideComment(commentId: string, pageAccessToken: string): Promise<void> {
        try {
            this.logger.debug('[Instagram] Hiding comment', { commentId });
            
            await fbAxios.post(
                `${INSTAGRAM_GRAPH_API}/${commentId}`,
                {
                    hide: true,
                },
                {
                    params: {
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Comment hidden successfully');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error hiding comment', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Delete a comment on Instagram (only for comments on own media)
     * Requires: instagram_business_manage_comments permission
     */
    async deleteComment(commentId: string, pageAccessToken: string): Promise<void> {
        try {
            this.logger.debug('[Instagram] Deleting comment', { commentId });
            
            await fbAxios.delete(
                `${INSTAGRAM_GRAPH_API}/${commentId}`,
                {
                    params: {
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Comment deleted successfully');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error deleting comment', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Send a sender_action to Instagram DM. Cosmetic — never blocks the reply.
     * Failures surface as warn so we can spot regressions like dropped
     * permissions or Graph API shape changes.
     */
    private async sendSenderAction(
        instagramAccountId: string,
        recipientId: string,
        pageAccessToken: string,
        action: 'typing_on' | 'typing_off',
    ): Promise<void> {
        try {
            await fbAxios.post(
                `${INSTAGRAM_GRAPH_API}/me/messages`,
                {
                    recipient: { id: recipientId },
                    sender_action: action,
                },
                { params: { access_token: pageAccessToken } },
            );
        } catch (error) {
            const igError = (error as { response?: { data?: unknown; status?: number } })?.response;
            this.logger.warn(`[Instagram] ${action} failed (non-fatal)`, {
                instagramAccountId,
                recipientId,
                status: igError?.status,
                data: igError?.data,
            });
        }
    }

    async sendTypingIndicator(
        instagramAccountId: string,
        recipientId: string,
        pageAccessToken: string,
    ): Promise<void> {
        return this.sendSenderAction(instagramAccountId, recipientId, pageAccessToken, 'typing_on');
    }

    /**
     * Clear the "typing..." indicator. Used on abort paths where typing_on was
     * fired but no reply will follow — Instagram's auto-clear is also ~20s.
     */
    async sendTypingOff(
        instagramAccountId: string,
        recipientId: string,
        pageAccessToken: string,
    ): Promise<void> {
        return this.sendSenderAction(instagramAccountId, recipientId, pageAccessToken, 'typing_off');
    }

    async sendDirectMessage(
        instagramAccountId: string,
        recipientId: string,
        message: string,
        pageAccessToken: string,
        opts?: SendMessageOptions,
    ): Promise<string> {
        try {
            this.logger.debug('[Instagram] Sending DM', { instagramAccountId, recipientId });

            const response = await fbAxios.post(
                `${INSTAGRAM_GRAPH_API}/me/messages`,
                buildMessagePayload(recipientId, { text: message }, opts),
                { params: { access_token: pageAccessToken } },
            );

            this.logger.info('[Instagram] DM sent successfully', { messageId: response.data.message_id });
            return response.data.message_id;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const dmError = DmSendError.fromAxios(error, 'Instagram API error');
                this.logger.error('[Instagram] API Error sending DM', { error: dmError.message });
                throw dmError;
            }
            throw error;
        }
    }

    /**
     * Get Instagram conversations (DMs)
     * Requires: instagram_business_manage_messages permission
     */
    async getConversations(instagramAccountId: string, pageAccessToken: string): Promise<unknown[]> {
        try {
            this.logger.debug('[Instagram] Fetching conversations', { instagramAccountId });
            
            const response = await fbAxios.get(
                `${INSTAGRAM_GRAPH_API}/${instagramAccountId}/conversations`,
                {
                    params: {
                        platform: 'instagram',
                        fields: 'participants,messages{id,message,from,to,created_time}',
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Found conversations', { count: response.data.data?.length || 0 });
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error fetching conversations', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }
}

export const instagramService = new InstagramService();


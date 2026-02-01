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

import { config } from '../config';

const INSTAGRAM_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

export class InstagramService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Get Instagram Business Account linked to a Facebook Page
     * Requires: instagram_basic permission
     */
    async getLinkedInstagramAccount(pageId: string, pageAccessToken: string): Promise<InstagramAccount | null> {
        try {
            this.logger.debug('[Instagram] Fetching linked Instagram account', { pageId });
            
            const response = await axios.get(`${INSTAGRAM_GRAPH_API}/${pageId}`, {
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
     * Requires: instagram_basic permission
     */
    async getMedia(instagramAccountId: string, pageAccessToken: string, limit: number = 25): Promise<InstagramMedia[]> {
        try {
            this.logger.debug('[Instagram] Fetching media', { instagramAccountId });
            
            const response = await axios.get<InstagramMediaResponse>(
                `${INSTAGRAM_GRAPH_API}/${instagramAccountId}/media`,
                {
                    params: {
                        fields: 'id,media_type,caption,permalink,thumbnail_url,timestamp,comments_count',
                        limit,
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] Found media items', { count: response.data.data?.length || 0 });
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error fetching media', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get comments on an Instagram media object
     * Requires: instagram_basic permission
     */
    async getComments(mediaId: string, pageAccessToken: string): Promise<InstagramComment[]> {
        try {
            this.logger.debug('[Instagram] Fetching comments', { mediaId });
            
            const response = await axios.get<InstagramCommentsResponse>(
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
     * Reply to an Instagram comment
     * Requires: instagram_manage_comments permission
     */
    async replyToComment(commentId: string, message: string, pageAccessToken: string): Promise<string> {
        try {
            this.logger.debug('[Instagram] Replying to comment', { commentId });
            
            const response = await axios.post(
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
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Hide a comment on Instagram
     * Requires: instagram_manage_comments permission
     */
    async hideComment(commentId: string, pageAccessToken: string): Promise<void> {
        try {
            this.logger.debug('[Instagram] Hiding comment', { commentId });
            
            await axios.post(
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
     * Requires: instagram_manage_comments permission
     */
    async deleteComment(commentId: string, pageAccessToken: string): Promise<void> {
        try {
            this.logger.debug('[Instagram] Deleting comment', { commentId });
            
            await axios.delete(
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
     * Send a direct message reply to a user (requires instagram_manage_messages)
     * Note: Can only message users who have messaged the account first
     */
    async sendDirectMessage(
        instagramAccountId: string, 
        recipientId: string, 
        message: string, 
        pageAccessToken: string
    ): Promise<string> {
        try {
            this.logger.debug('[Instagram] Sending DM', { instagramAccountId, recipientId });
            
            const response = await axios.post(
                `${INSTAGRAM_GRAPH_API}/${instagramAccountId}/messages`,
                {
                    recipient: { id: recipientId },
                    message: { text: message },
                },
                {
                    params: {
                        access_token: pageAccessToken,
                    },
                }
            );

            this.logger.info('[Instagram] DM sent successfully', { messageId: response.data.message_id });
            return response.data.message_id;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Instagram] API Error sending DM', { error: error.response?.data?.error?.message || error.message });
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get Instagram conversations (DMs)
     * Requires: instagram_manage_messages permission
     */
    async getConversations(instagramAccountId: string, pageAccessToken: string): Promise<unknown[]> {
        try {
            this.logger.debug('[Instagram] Fetching conversations', { instagramAccountId });
            
            const response = await axios.get(
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


import axios from 'axios';

const INSTAGRAM_GRAPH_API = 'https://graph.facebook.com/v18.0';

// Instagram API Types
export interface InstagramAccount {
    id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
}

export interface InstagramMedia {
    id: string;
    media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
    caption?: string;
    permalink?: string;
    thumbnail_url?: string;
    timestamp?: string;
    comments_count?: number;
}

export interface InstagramComment {
    id: string;
    text: string;
    timestamp: string;
    from?: {
        id: string;
        username: string;
    };
    replies?: {
        data: InstagramComment[];
    };
}

export interface InstagramMediaResponse {
    data: InstagramMedia[];
    paging?: {
        cursors: {
            before: string;
            after: string;
        };
        next?: string;
    };
}

export interface InstagramCommentsResponse {
    data: InstagramComment[];
    paging?: {
        cursors: {
            before: string;
            after: string;
        };
        next?: string;
    };
}

export class InstagramService {
    /**
     * Get Instagram Business Account linked to a Facebook Page
     * Requires: instagram_basic permission
     */
    async getLinkedInstagramAccount(pageId: string, pageAccessToken: string): Promise<InstagramAccount | null> {
        try {
            console.log(`[Instagram] Fetching linked Instagram account for page ${pageId}`);
            
            const response = await axios.get(`${INSTAGRAM_GRAPH_API}/${pageId}`, {
                params: {
                    fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}',
                    access_token: pageAccessToken,
                },
            });

            const igAccount = response.data.instagram_business_account;
            
            if (igAccount) {
                console.log(`[Instagram] Found linked account: @${igAccount.username}`);
                return igAccount;
            }
            
            console.log('[Instagram] No Instagram Business Account linked to this page');
            return null;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error:', error.response?.data);
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
            console.log(`[Instagram] Fetching media for account ${instagramAccountId}`);
            
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

            console.log(`[Instagram] Found ${response.data.data?.length || 0} media items`);
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error fetching media:', error.response?.data);
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
            console.log(`[Instagram] Fetching comments for media ${mediaId}`);
            
            const response = await axios.get<InstagramCommentsResponse>(
                `${INSTAGRAM_GRAPH_API}/${mediaId}/comments`,
                {
                    params: {
                        fields: 'id,text,timestamp,from{id,username},replies{id,text,timestamp,from{id,username}}',
                        access_token: pageAccessToken,
                    },
                }
            );

            console.log(`[Instagram] Found ${response.data.data?.length || 0} comments`);
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error fetching comments:', error.response?.data);
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
            console.log(`[Instagram] Replying to comment ${commentId}`);
            
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

            console.log(`[Instagram] Reply posted successfully, ID: ${response.data.id}`);
            return response.data.id;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error posting reply:', error.response?.data);
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
            console.log(`[Instagram] Hiding comment ${commentId}`);
            
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

            console.log('[Instagram] Comment hidden successfully');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error hiding comment:', error.response?.data);
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
            console.log(`[Instagram] Deleting comment ${commentId}`);
            
            await axios.delete(
                `${INSTAGRAM_GRAPH_API}/${commentId}`,
                {
                    params: {
                        access_token: pageAccessToken,
                    },
                }
            );

            console.log('[Instagram] Comment deleted successfully');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error deleting comment:', error.response?.data);
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
            console.log(`[Instagram] Sending DM from ${instagramAccountId} to ${recipientId}`);
            
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

            console.log(`[Instagram] DM sent successfully, ID: ${response.data.message_id}`);
            return response.data.message_id;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error sending DM:', error.response?.data);
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
            console.log(`[Instagram] Fetching conversations for account ${instagramAccountId}`);
            
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

            console.log(`[Instagram] Found ${response.data.data?.length || 0} conversations`);
            return response.data.data || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Instagram] API Error fetching conversations:', error.response?.data);
                throw new Error(`Instagram API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }
}

export const instagramService = new InstagramService();


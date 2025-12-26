import axios from 'axios';
import { config } from '../config';
import type { FacebookTokenResponse, FacebookUserProfile, FacebookPagesResponse } from '../types';

const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

export class FacebookService {
    /**
     * Exchange OAuth code for access token
     */
    async getAccessToken(code: string): Promise<string> {
        try {
            const response = await axios.get<FacebookTokenResponse>(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                params: {
                    client_id: config.facebook.appId,
                    client_secret: config.facebook.appSecret,
                    redirect_uri: config.facebook.redirectUri,
                    code,
                },
            });

            return response.data.access_token;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get user profile from Facebook
     */
    async getUserProfile(accessToken: string): Promise<FacebookUserProfile> {
        try {
            const response = await axios.get<FacebookUserProfile>(`${FACEBOOK_GRAPH_API}/me`, {
                params: {
                    fields: 'id,name,email',
                    access_token: accessToken,
                },
            });

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get user's Facebook pages with access tokens
     */
    async getUserPages(accessToken: string): Promise<FacebookPagesResponse> {
        try {
            console.log('[Facebook] Fetching user pages...');
            const response = await axios.get<FacebookPagesResponse>(`${FACEBOOK_GRAPH_API}/me/accounts`, {
                params: {
                    access_token: accessToken,
                    fields: 'id,name,access_token,category,tasks',
                },
            });

            console.log(`[Facebook] Found ${response.data.data?.length || 0} pages`);
            if (response.data.data?.length) {
                console.log('[Facebook] Pages:', response.data.data.map(p => p.name).join(', '));
            }

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Facebook] API Error:', error.response?.data);
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Exchange short-lived token for long-lived token (60 days)
     */
    async getLongLivedToken(shortLivedToken: string): Promise<string> {
        try {
            const response = await axios.get<FacebookTokenResponse>(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: config.facebook.appId,
                    client_secret: config.facebook.appSecret,
                    fb_exchange_token: shortLivedToken,
                },
            });

            return response.data.access_token;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }
    /**
     * Send a private message to a user
     */
    async sendPrivateMessage(pageAccessToken: string, recipientId: string, text: string): Promise<void> {
        try {
            await axios.post(`${FACEBOOK_GRAPH_API}/me/messages`, {
                recipient: { id: recipientId },
                message: { text },
            }, {
                params: {
                    access_token: pageAccessToken,
                },
            });
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get post content from Facebook
     * Fetches the message/text content of a post
     */
    async getPostContent(postId: string, pageAccessToken: string): Promise<string | null> {
        try {
            console.log(`[Facebook] Fetching post content for ${postId}`);
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/${postId}`, {
                params: {
                    fields: 'message,story,created_time',
                    access_token: pageAccessToken,
                },
            });

            const message = response.data.message || response.data.story || null;
            console.log(`[Facebook] Post content: ${message ? message.substring(0, 100) + '...' : '(no content)'}`);
            return message;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Facebook] Error fetching post:', error.response?.data);
                // Don't throw - just return null if we can't fetch the post
                return null;
            }
            return null;
        }
    }

    /**
     * Get comment details from Facebook
     */
    async getCommentDetails(commentId: string, pageAccessToken: string): Promise<{
        message: string;
        from?: { id: string; name: string };
    } | null> {
        try {
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/${commentId}`, {
                params: {
                    fields: 'message,from',
                    access_token: pageAccessToken,
                },
            });

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('[Facebook] Error fetching comment:', error.response?.data);
                return null;
            }
            return null;
        }
    }
}

export const facebookService = new FacebookService();

import axios from 'axios';
import { config } from '../config';
import type { FacebookTokenResponse, FacebookUserProfile, FacebookPagesResponse, Logger } from '../types';
import { noopLogger } from '../types';

const FACEBOOK_GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

export class FacebookService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Exchange OAuth code for access token
     */
    async getAccessToken(code: string, redirectUri?: string): Promise<string> {
        try {
            const response = await axios.get<FacebookTokenResponse>(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                params: {
                    client_id: config.facebook.appId,
                    client_secret: config.facebook.appSecret,
                    redirect_uri: redirectUri || config.facebook.redirectUri,
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
     * Verify access token validity and metadata
     */
    async verifyAccessToken(accessToken: string): Promise<{ isValid: boolean; userId: string; expiresAt: number; scopes: string[] }> {
        try {
            const appAccessToken = `${config.facebook.appId}|${config.facebook.appSecret}`;
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/debug_token`, {
                params: {
                    input_token: accessToken,
                    access_token: appAccessToken,
                },
            });

            const data = response.data.data;

            if (!data.is_valid) {
                 throw new Error('Invalid access token');
            }

            // Security check: Ensure token was issued to OUR app
            if (data.app_id !== config.facebook.appId) {
                throw new Error('Token issued to a different app');
            }

            return {
                isValid: data.is_valid,
                userId: data.user_id,
                expiresAt: data.expires_at,
                scopes: data.scopes,
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Facebook Token Verification failed: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }
    async getUserProfile(accessToken: string): Promise<FacebookUserProfile> {
        try {
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/me`, {
                params: {
                    fields: 'id,name,email,picture.type(large)',
                    access_token: accessToken,
                },
            });

            // Extract picture URL from nested structure
            const data = response.data;
            const pictureUrl = data.picture?.data?.url;

            return {
                id: data.id,
                name: data.name,
                email: data.email,
                picture: pictureUrl,
            };
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
            this.logger.debug('[Facebook] Fetching user pages');
            const response = await axios.get<FacebookPagesResponse>(`${FACEBOOK_GRAPH_API}/me/accounts`, {
                params: {
                    access_token: accessToken,
                    fields: 'id,name,access_token,category,tasks,about,phone,single_line_address,hours,website',
                },
            });

            const pageCount = response.data.data?.length || 0;
            this.logger.info('[Facebook] Found pages', { count: pageCount });
            if (response.data.data?.length) {
                this.logger.debug('[Facebook] Page names', { pages: response.data.data.map(p => p.name) });
            }

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] API Error fetching pages', {
                    error: error.response?.data?.error?.message || error.message
                });
                throw new Error(`Facebook API error: ${error.response?.data?.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Exchange short-lived token for long-lived token (60 days)
     */
    async getLongLivedToken(shortLivedToken: string): Promise<{ token: string; expiresAt: Date }> {
        try {
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: config.facebook.appId,
                    client_secret: config.facebook.appSecret,
                    fb_exchange_token: shortLivedToken,
                },
            });

            const data = response.data;
            const expiresIn = data.expires_in ? data.expires_in * 1000 : 60 * 24 * 60 * 60 * 1000; // Default 60 days if missing

            return {
                token: data.access_token,
                expiresAt: new Date(Date.now() + expiresIn)
            };
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
            this.logger.debug('[Facebook] Fetching post content', { postId });
            const response = await axios.get(`${FACEBOOK_GRAPH_API}/${postId}`, {
                params: {
                    fields: 'message,story,created_time',
                    access_token: pageAccessToken,
                },
            });

            const message = response.data.message || response.data.story || null;
            this.logger.debug('[Facebook] Post content fetched', {
                postId,
                hasContent: !!message,
                contentPreview: message ? message.substring(0, 50) : null
            });
            return message;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Error fetching post', {
                    postId,
                    error: error.response?.data?.error?.message || error.message
                });
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
                this.logger.error('[Facebook] Error fetching comment', {
                    commentId,
                    error: error.response?.data?.error?.message || error.message
                });
                return null;
            }
            return null;
        }
    }
    /**
     * Subscribe a page to receive webhook events (feed + messages)
     * Must be called after connecting a page so Facebook sends events to our webhook
     */
    async subscribePageToWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
        try {
            this.logger.info('[Facebook] Subscribing page to webhooks', { pageId });
            await axios.post(`${FACEBOOK_GRAPH_API}/${pageId}/subscribed_apps`, null, {
                params: {
                    subscribed_fields: 'feed,messages',
                    access_token: pageAccessToken,
                },
            });
            this.logger.info('[Facebook] Page subscribed to webhooks', { pageId });
            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Failed to subscribe page to webhooks', {
                    pageId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return false;
        }
    }

    /**
     * Unsubscribe a page from webhook events
     */
    async unsubscribePageFromWebhooks(pageId: string, pageAccessToken: string): Promise<boolean> {
        try {
            this.logger.info('[Facebook] Unsubscribing page from webhooks', { pageId });
            await axios.delete(`${FACEBOOK_GRAPH_API}/${pageId}/subscribed_apps`, {
                params: {
                    access_token: pageAccessToken,
                },
            });
            this.logger.info('[Facebook] Page unsubscribed from webhooks', { pageId });
            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.logger.error('[Facebook] Failed to unsubscribe page from webhooks', {
                    pageId,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
            return false;
        }
    }
}

export const facebookService = new FacebookService();

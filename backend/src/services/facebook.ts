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
            const response = await axios.get<FacebookPagesResponse>(`${FACEBOOK_GRAPH_API}/me/accounts`, {
                params: {
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
}

export const facebookService = new FacebookService();

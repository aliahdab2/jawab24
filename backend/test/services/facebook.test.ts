import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fbAxios } from '../../src/lib/fbAxios';
import { FacebookService } from '../../src/services/facebook';

// Mock axios, fbAxios, and tracing
vi.mock('axios');
vi.mock('../../src/lib/fbAxios', () => ({
    fbAxios: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
    GRAPH_API_BASE: 'https://graph.facebook.com/v18.0',
}));
vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: (_service: string, _method: string, fn: () => unknown) => fn(),
}));

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            appId: 'test_app_id',
            appSecret: 'test_app_secret',
            redirectUri: 'http://localhost:3000/auth/callback',
            graphApiVersion: 'v18.0',
            webhookVerifyToken: 'test_verify_token',
        },
    },
}));

describe('Facebook Service', () => {
    let service: FacebookService;

    beforeEach(() => {
        service = new FacebookService();
        vi.clearAllMocks();
    });

    describe('getAccessToken', () => {
        it('should exchange code for access token', async () => {
            const mockResponse = {
                data: {
                    access_token: 'test_access_token',
                    token_type: 'bearer',
                    expires_in: 3600,
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const token = await service.getAccessToken('auth_code_123');

            expect(token).toBe('test_access_token');
            expect(fbAxios.get).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/oauth/access_token',
                expect.objectContaining({
                    params: expect.objectContaining({
                        client_id: 'test_app_id',
                        client_secret: 'test_app_secret',
                        redirect_uri: 'http://localhost:3000/auth/callback',
                        code: 'auth_code_123',
                    }),
                })
            );
        });

        it('should throw error on API failure', async () => {
            const mockError = {
                isAxiosError: true,
                response: {
                    data: {
                        error: {
                            message: 'Invalid code',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getAccessToken('invalid_code')).rejects.toThrow('Facebook API error');
        });
    });

    describe('getUserProfile', () => {
        it('should get user profile with picture from Facebook', async () => {
            const mockResponse = {
                data: {
                    id: '123456789',
                    name: 'John Doe',
                    email: 'john@example.com',
                    picture: {
                        data: {
                            url: 'https://graph.facebook.com/123456789/picture?type=large',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const profile = await service.getUserProfile('access_token_123');

            expect(profile).toEqual({
                id: '123456789',
                name: 'John Doe',
                email: 'john@example.com',
                picture: 'https://graph.facebook.com/123456789/picture?type=large',
            });
            expect(fbAxios.get).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/me',
                expect.objectContaining({
                    params: expect.objectContaining({
                        fields: 'id,name,email,picture.type(large)',
                        access_token: 'access_token_123',
                    }),
                })
            );
        });

        it('should handle profile without email', async () => {
            const mockResponse = {
                data: {
                    id: '123456789',
                    name: 'John Doe',
                    picture: {
                        data: {
                            url: 'https://example.com/photo.jpg',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const profile = await service.getUserProfile('access_token_123');

            expect(profile.email).toBeUndefined();
            expect(profile.picture).toBe('https://example.com/photo.jpg');
        });

        it('should handle profile without picture', async () => {
            const mockResponse = {
                data: {
                    id: '123456789',
                    name: 'John Doe',
                    email: 'john@example.com',
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const profile = await service.getUserProfile('access_token_123');

            expect(profile.id).toBe('123456789');
            expect(profile.name).toBe('John Doe');
            expect(profile.picture).toBeUndefined();
        });

        it('should throw error on API failure', async () => {
            const mockError = {
                isAxiosError: true,
                response: {
                    data: {
                        error: {
                            message: 'Invalid token',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getUserProfile('invalid_token')).rejects.toThrow('Facebook API error');
        });
    });

    describe('getUserPages', () => {
        it('should get user pages from Facebook', async () => {
            const mockResponse = {
                data: {
                    data: [
                        {
                            id: 'page_1',
                            name: 'My Store',
                            access_token: 'page_token_1',
                            category: 'Shopping',
                        },
                        {
                            id: 'page_2',
                            name: 'My Blog',
                            access_token: 'page_token_2',
                            category: 'Blog',
                        },
                    ],
                    paging: {
                        cursors: {
                            before: 'cursor_before',
                            after: 'cursor_after',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(2);
            expect(pages.data[0].name).toBe('My Store');
            expect(pages.data[1].name).toBe('My Blog');
        });

        it('should handle truly empty pages (no /me/accounts and no granular_scopes)', async () => {
            // /me/accounts returns empty, /debug_token has no pages_* granular_scopes
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } }) // /me/accounts
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['public_profile'],
                            granular_scopes: [{ scope: 'public_profile' }],
                        },
                    },
                }); // /debug_token

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(0);
            expect(fbAxios.get).toHaveBeenCalledTimes(2);
        });

        it('should throw error on API failure (primary /me/accounts)', async () => {
            const mockError = {
                isAxiosError: true,
                response: {
                    data: {
                        error: {
                            message: 'Permission denied',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getUserPages('invalid_token')).rejects.toThrow('Facebook API error');
        });
    });

    describe('getUserPages — Business Portfolio fallback', () => {
        it('falls back to granular_scopes when /me/accounts is empty', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } }) // /me/accounts
                .mockResolvedValueOnce({
                    // /debug_token — same page ID across two pages_* scopes
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list', 'pages_messaging'],
                            granular_scopes: [
                                { scope: 'pages_show_list', target_ids: ['page_bm_1'] },
                                { scope: 'pages_messaging', target_ids: ['page_bm_1'] },
                                { scope: 'instagram_basic', target_ids: ['ig_1'] },
                            ],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    // GET /page_bm_1
                    data: {
                        id: 'page_bm_1',
                        name: 'BM Owned Page',
                        access_token: 'page_token_bm_1',
                        category: 'Business',
                    },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_bm_1');
            expect(pages.data[0].name).toBe('BM Owned Page');
            expect(pages.data[0].access_token).toBe('page_token_bm_1');
            // 1 (/me/accounts) + 1 (/debug_token) + 1 (/page_bm_1) = 3
            expect(fbAxios.get).toHaveBeenCalledTimes(3);
        });

        it('returns empty when granular_scopes has no pages_* target_ids', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['instagram_basic'],
                            granular_scopes: [
                                { scope: 'instagram_basic', target_ids: ['ig_1'] },
                                // No pages_* entry with target_ids
                            ],
                        },
                    },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(0);
            // 1 (/me/accounts) + 1 (/debug_token) — no page fetches
            expect(fbAxios.get).toHaveBeenCalledTimes(2);
        });

        it('handles partial page fetch failures gracefully', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } }) // /me/accounts
                .mockResolvedValueOnce({
                    // /debug_token with 2 page IDs
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list'],
                            granular_scopes: [
                                { scope: 'pages_show_list', target_ids: ['page_ok', 'page_fail'] },
                            ],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    // GET /page_ok — success
                    data: { id: 'page_ok', name: 'Good Page', access_token: 'tok_ok' },
                })
                .mockRejectedValueOnce(new Error('403 Forbidden')); // GET /page_fail — failure

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_ok');
            // No exception bubbled up
        });

        it('deduplicates target_ids appearing across multiple scopes', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_engagement'],
                            granular_scopes: [
                                // Same 2 page IDs repeated across 3 different scopes
                                { scope: 'pages_show_list', target_ids: ['page_a', 'page_b'] },
                                { scope: 'pages_messaging', target_ids: ['page_a', 'page_b'] },
                                { scope: 'pages_manage_engagement', target_ids: ['page_a', 'page_b'] },
                            ],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: { id: 'page_a', name: 'Page A', access_token: 'tok_a' },
                })
                .mockResolvedValueOnce({
                    data: { id: 'page_b', name: 'Page B', access_token: 'tok_b' },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(2);
            // 1 (/me/accounts) + 1 (/debug_token) + 2 page fetches (NOT 6)
            expect(fbAxios.get).toHaveBeenCalledTimes(4);
        });

        it('verifyAccessToken returns granularScopes alongside scopes', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({
                data: {
                    data: {
                        is_valid: true,
                        app_id: 'test_app_id',
                        user_id: 'user_1',
                        expires_at: 1234567890,
                        scopes: ['pages_show_list'],
                        granular_scopes: [
                            { scope: 'pages_show_list', target_ids: ['page_x'] },
                        ],
                    },
                },
            });

            const result = await service.verifyAccessToken('access_token_123');

            expect(result.isValid).toBe(true);
            expect(result.scopes).toEqual(['pages_show_list']);
            expect(result.granularScopes).toEqual([
                { scope: 'pages_show_list', target_ids: ['page_x'] },
            ]);
        });
    });

    describe('getSenderProfile', () => {
        const SENDER_ID = 'psid_123456';
        const PAGE_TOKEN = 'page-access-token';
        const PAGE_ID = 'page_999';

        it('returns name from User Profile API when available', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({ data: { name: 'Ali Ahdab', id: SENDER_ID } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN);

            expect(result).toEqual({ name: 'Ali Ahdab' });
            expect(fbAxios.get).toHaveBeenCalledWith(
                expect.stringContaining(SENDER_ID),
                expect.objectContaining({ params: expect.objectContaining({ fields: 'name' }) })
            );
        });

        it('returns null when User Profile API returns no name and no pageId provided', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({ data: { id: SENDER_ID } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN);

            expect(result).toBeNull();
        });

        it('falls back to Conversations API when User Profile API throws an error', async () => {
            const axiosError = Object.assign(new Error('Forbidden'), {
                isAxiosError: true,
                response: { data: { error: { message: 'Permission denied' } } },
            });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
            vi.mocked(fbAxios.get)
                .mockRejectedValueOnce(axiosError)
                // Conversations API fallback goes through fbAxios.get (with retry logic)
                .mockResolvedValueOnce({
                    data: {
                        data: [{
                            participants: {
                                data: [
                                    { id: PAGE_ID, name: 'My Page' },
                                    { id: SENDER_ID, name: 'Ali Ahdab' },
                                ],
                            },
                        }],
                    },
                });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toEqual({ name: 'Ali Ahdab' });
        });

        it('falls back to Conversations API when User Profile API returns no name', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
                // Conversations API fallback goes through fbAxios.get (with retry logic)
                .mockResolvedValueOnce({
                    data: {
                        data: [{
                            participants: {
                                data: [{ id: SENDER_ID, name: 'Ali via Conversations' }],
                            },
                        }],
                    },
                });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toEqual({ name: 'Ali via Conversations' });
        });

        it('returns null when both APIs fail', async () => {
            const axiosError = Object.assign(new Error('Forbidden'), { isAxiosError: true });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
            vi.mocked(fbAxios.get)
                .mockRejectedValueOnce(axiosError)
                // Conversations API fallback goes through fbAxios.get (with retry logic)
                .mockRejectedValueOnce(new Error('Network error'));

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toBeNull();
        });

        it('returns null when Conversations API returns no matching participant', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
                // Conversations API fallback goes through fbAxios.get (with retry logic)
                .mockResolvedValueOnce({
                    data: {
                        data: [{
                            participants: { data: [{ id: 'other-user', name: 'Someone Else' }] },
                        }],
                    },
                });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toBeNull();
        });

        it('returns null when Conversations API returns empty conversations list', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
                // Conversations API fallback goes through fbAxios.get (with retry logic)
                .mockResolvedValueOnce({ data: { data: [] } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toBeNull();
        });
    });

    describe('subscribePageToWebhooks', () => {
        it('should subscribe a page to feed + messages', async () => {
            vi.mocked(fbAxios.post).mockResolvedValue({ data: { success: true } });

            const result = await service.subscribePageToWebhooks('page_123', 'page_token_abc');

            expect(result).toBe(true);
            expect(fbAxios.post).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/page_123/subscribed_apps',
                null,
                {
                    params: {
                        subscribed_fields: 'feed,messages',
                        access_token: 'page_token_abc',
                    },
                }
            );
        });

        it('should return false on API failure', async () => {
            const axiosError = Object.assign(new Error('Forbidden'), {
                isAxiosError: true,
                response: { data: { error: { message: 'Permission denied' } } },
            });
            vi.mocked(fbAxios.post).mockRejectedValue(axiosError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            const result = await service.subscribePageToWebhooks('page_123', 'bad_token');

            expect(result).toBe(false);
        });

        it('should fall back to messages-only when pages_manage_metadata is missing', async () => {
            const metadataError = Object.assign(new Error('Missing permission'), {
                isAxiosError: true,
                response: { data: { error: { message: 'To subscribe to the feed field, one of these permissions is needed: pages_manage_metadata', code: 200 } } },
            });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
            vi.mocked(fbAxios.post)
                .mockRejectedValueOnce(metadataError)   // first call: feed+messages fails
                .mockResolvedValueOnce({ data: { success: true } }); // retry: messages-only succeeds

            const result = await service.subscribePageToWebhooks('page_123', 'page_token');

            expect(result).toBe(true);
            expect(fbAxios.post).toHaveBeenCalledTimes(2);
            expect(fbAxios.post).toHaveBeenNthCalledWith(1,
                'https://graph.facebook.com/v18.0/page_123/subscribed_apps',
                null,
                { params: { subscribed_fields: 'feed,messages', access_token: 'page_token' } },
            );
            expect(fbAxios.post).toHaveBeenNthCalledWith(2,
                'https://graph.facebook.com/v18.0/page_123/subscribed_apps',
                null,
                { params: { subscribed_fields: 'messages', access_token: 'page_token' } },
            );
        });

        it('should return false when messages-only fallback also fails', async () => {
            const metadataError = Object.assign(new Error('Missing permission'), {
                isAxiosError: true,
                response: { data: { error: { message: 'To subscribe to the feed field, one of these permissions is needed: pages_manage_metadata', code: 200 } } },
            });
            const messagingError = Object.assign(new Error('No messaging permission'), {
                isAxiosError: true,
                response: { data: { error: { message: 'pages_messaging permission required' } } },
            });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
            vi.mocked(fbAxios.post)
                .mockRejectedValueOnce(metadataError)
                .mockRejectedValueOnce(messagingError);

            const result = await service.subscribePageToWebhooks('page_123', 'bad_token');

            expect(result).toBe(false);
            expect(fbAxios.post).toHaveBeenCalledTimes(2);
        });
    });

    describe('getLongLivedToken', () => {
        it('should exchange short-lived token for long-lived token', async () => {
            const mockResponse = {
                data: {
                    access_token: 'long_lived_token',
                    token_type: 'bearer',
                    expires_in: 5184000, // 60 days
                },
            };

            vi.mocked(fbAxios.get).mockResolvedValue(mockResponse);

            const result = await service.getLongLivedToken('short_lived_token');

            expect(result.token).toBe('long_lived_token');
            expect(result.expiresAt).toBeInstanceOf(Date);
            expect(fbAxios.get).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/oauth/access_token',
                expect.objectContaining({
                    params: expect.objectContaining({
                        grant_type: 'fb_exchange_token',
                        client_id: 'test_app_id',
                        client_secret: 'test_app_secret',
                        fb_exchange_token: 'short_lived_token',
                    }),
                })
            );
        });

        it('should throw error on API failure', async () => {
            const mockError = {
                isAxiosError: true,
                response: {
                    data: {
                        error: {
                            message: 'Token exchange failed',
                        },
                    },
                },
            };

            vi.mocked(fbAxios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getLongLivedToken('invalid_token')).rejects.toThrow('Facebook API error');
        });
    });
});


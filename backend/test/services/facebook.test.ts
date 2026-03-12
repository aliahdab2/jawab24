import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { FacebookService } from '../../src/services/facebook';

// Mock axios
vi.mock('axios');

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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

            const token = await service.getAccessToken('auth_code_123');

            expect(token).toBe('test_access_token');
            expect(axios.get).toHaveBeenCalledWith(
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

            vi.mocked(axios.get).mockRejectedValue(mockError);
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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

            const profile = await service.getUserProfile('access_token_123');

            expect(profile).toEqual({
                id: '123456789',
                name: 'John Doe',
                email: 'john@example.com',
                picture: 'https://graph.facebook.com/123456789/picture?type=large',
            });
            expect(axios.get).toHaveBeenCalledWith(
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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

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

            vi.mocked(axios.get).mockRejectedValue(mockError);
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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(2);
            expect(pages.data[0].name).toBe('My Store');
            expect(pages.data[1].name).toBe('My Blog');
        });

        it('should handle empty pages list', async () => {
            const mockResponse = {
                data: {
                    data: [],
                },
            };

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(0);
        });

        it('should throw error on API failure', async () => {
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

            vi.mocked(axios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getUserPages('invalid_token')).rejects.toThrow('Facebook API error');
        });
    });

    describe('getSenderProfile', () => {
        const SENDER_ID = 'psid_123456';
        const PAGE_TOKEN = 'page-access-token';
        const PAGE_ID = 'page_999';

        it('returns name from User Profile API when available', async () => {
            vi.mocked(axios.get).mockResolvedValue({ data: { name: 'Ali Ahdab', id: SENDER_ID } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN);

            expect(result).toEqual({ name: 'Ali Ahdab' });
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining(SENDER_ID),
                expect.objectContaining({ params: expect.objectContaining({ fields: 'name' }) })
            );
        });

        it('returns null when User Profile API returns no name and no pageId provided', async () => {
            vi.mocked(axios.get).mockResolvedValue({ data: { id: SENDER_ID } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN);

            expect(result).toBeNull();
        });

        it('falls back to Conversations API when User Profile API throws an error', async () => {
            const axiosError = Object.assign(new Error('Forbidden'), {
                isAxiosError: true,
                response: { data: { error: { message: 'Permission denied' } } },
            });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
            vi.mocked(axios.get)
                .mockRejectedValueOnce(axiosError)
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
            vi.mocked(axios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
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
            vi.mocked(axios.get)
                .mockRejectedValueOnce(axiosError)
                .mockRejectedValueOnce(new Error('Network error'));

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toBeNull();
        });

        it('returns null when Conversations API returns no matching participant', async () => {
            vi.mocked(axios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
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
            vi.mocked(axios.get)
                .mockResolvedValueOnce({ data: { id: SENDER_ID } })
                .mockResolvedValueOnce({ data: { data: [] } });

            const result = await service.getSenderProfile(SENDER_ID, PAGE_TOKEN, PAGE_ID);

            expect(result).toBeNull();
        });
    });

    describe('subscribePageToWebhooks', () => {
        it('should subscribe a page to feed + messages', async () => {
            vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

            const result = await service.subscribePageToWebhooks('page_123', 'page_token_abc');

            expect(result).toBe(true);
            expect(axios.post).toHaveBeenCalledWith(
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
            vi.mocked(axios.post).mockRejectedValue(axiosError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            const result = await service.subscribePageToWebhooks('page_123', 'bad_token');

            expect(result).toBe(false);
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

            vi.mocked(axios.get).mockResolvedValue(mockResponse);

            const result = await service.getLongLivedToken('short_lived_token');

            expect(result.token).toBe('long_lived_token');
            expect(result.expiresAt).toBeInstanceOf(Date);
            expect(axios.get).toHaveBeenCalledWith(
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

            vi.mocked(axios.get).mockRejectedValue(mockError);
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getLongLivedToken('invalid_token')).rejects.toThrow('Facebook API error');
        });
    });
});


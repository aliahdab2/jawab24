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


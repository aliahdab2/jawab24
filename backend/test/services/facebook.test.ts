import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as Sentry from '@sentry/node';
import { fbAxios } from '../../src/lib/fbAxios';
import { FacebookService } from '../../src/services/facebook';

// Mock axios, fbAxios, Sentry, and tracing
vi.mock('axios');
vi.mock('../../src/lib/fbAxios', () => ({
    fbAxios: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
    GRAPH_API_BASE: 'https://graph.facebook.com/v18.0',
}));
vi.mock('@sentry/node', () => ({
    addBreadcrumb: vi.fn(),
    captureMessage: vi.fn(),
}));
vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: (_service: string, _method: string, fn: () => unknown) => fn(),
}));

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

// Stub the Redis client directly. Transitive imports (reply/adapters/shared →
// messages → conversationPause) pull in lib/redis, which would otherwise try
// to read config.redis and instantiate a real client. Mocking the module
// keeps this test isolated from the config shape.
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), setex: vi.fn(), set: vi.fn(), del: vi.fn() },
    redisScanDelete: vi.fn(),
    isRedisAuthFailed: () => false,
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

    describe('sendPrivateReplyWithImage (Post Reply image — one comment→DM message)', () => {
        beforeEach(() => {
            vi.mocked(fbAxios.post).mockResolvedValue({ data: { recipient_id: 'psid_1' } });
        });

        it('short caption → inline image CARD (full caption, no button), addressed to the comment', async () => {
            const res = await service.sendPrivateReplyWithImage('tok', 'cmt_1', 'كريم غو ريبير', 'https://cdn/x.jpg', { label: 'اقرأ المزيد', payload: 'pr_more:facebook:p1' });
            expect(res).toEqual({ recipientId: 'psid_1', format: 'card' });
            const body = vi.mocked(fbAxios.post).mock.calls[0][1] as {
                recipient: { comment_id: string };
                message: { attachment: { payload: { template_type: string; elements: { image_url: string; buttons?: unknown[] }[] } } };
            };
            expect(body.recipient).toEqual({ comment_id: 'cmt_1' });
            expect(body.message.attachment.payload.template_type).toBe('generic');
            expect(body.message.attachment.payload.elements[0].image_url).toBe('https://cdn/x.jpg');
            // Short caption fits → no «Read more» button.
            expect(body.message.attachment.payload.elements[0].buttons).toBeUndefined();
        });

        it('long caption → image CARD with a «Read more» POSTBACK button', async () => {
            const longText = 'ن'.repeat(120);
            const res = await service.sendPrivateReplyWithImage('tok', 'cmt_1', longText, 'https://cdn/x.jpg', { label: 'اقرأ المزيد', payload: 'pr_more:facebook:p1' });
            expect(res).toEqual({ recipientId: 'psid_1', format: 'card_readmore' });
            const body = vi.mocked(fbAxios.post).mock.calls[0][1] as {
                message: { attachment: { payload: { template_type: string; elements: { image_url: string; buttons: { type: string; payload: string }[] }[] } } };
            };
            expect(body.message.attachment.payload.template_type).toBe('generic');
            expect(body.message.attachment.payload.elements[0].image_url).toBe('https://cdn/x.jpg');
            expect(body.message.attachment.payload.elements[0].buttons[0]).toMatchObject({ type: 'postback', payload: 'pr_more:facebook:p1' });
        });

        it('long caption but no readMore payload → still a card (no button, no crash)', async () => {
            const res = await service.sendPrivateReplyWithImage('tok', 'cmt_1', 'ن'.repeat(120), 'https://cdn/x.jpg', null);
            expect(res.format).toBe('card');
        });

        it('with a CTA → the image card carries the web_url button', async () => {
            await service.sendPrivateReplyWithImage('tok', 'cmt_1', 'hi', 'https://cdn/x.jpg', null, { label: 'Shop', url: 'https://shop.example' });
            const body = vi.mocked(fbAxios.post).mock.calls[0][1] as {
                message: { attachment: { payload: { elements: { buttons: { type: string; url?: string }[] }[] } } };
            };
            expect(body.message.attachment.payload.elements[0].buttons).toEqual([{ type: 'web_url', title: 'Shop', url: 'https://shop.example' }]);
        });
    });

    describe('sendPrivateReplyToComment (Post Reply text / CTA — one comment→DM message)', () => {
        beforeEach(() => {
            vi.mocked(fbAxios.post).mockResolvedValue({ data: { recipient_id: 'psid_1' } });
        });

        it('no CTA → a plain text message addressed to the comment', async () => {
            const res = await service.sendPrivateReplyToComment('tok', 'cmt_1', 'Here you go');
            expect(res).toEqual({ recipientId: 'psid_1' });
            const body = vi.mocked(fbAxios.post).mock.calls[0][1] as { recipient: { comment_id: string }; message: { text?: string } };
            expect(body.recipient).toEqual({ comment_id: 'cmt_1' });
            expect(body.message.text).toBe('Here you go');
        });

        it('with a CTA → a button template (text + web_url button)', async () => {
            const res = await service.sendPrivateReplyToComment('tok', 'cmt_1', 'Check this', { label: 'Shop now', url: 'https://shop.example/x' });
            expect(res).toEqual({ recipientId: 'psid_1' });
            const body = vi.mocked(fbAxios.post).mock.calls[0][1] as {
                message: { attachment: { payload: { template_type: string; text: string; buttons: { type: string; title: string; url: string }[] } } };
            };
            expect(body.message.attachment.payload.template_type).toBe('button');
            expect(body.message.attachment.payload.text).toBe('Check this');
            expect(body.message.attachment.payload.buttons).toEqual([{ type: 'web_url', title: 'Shop now', url: 'https://shop.example/x' }]);
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

        // Regression guard for the InMedia case (2026-08-09): /me/accounts is NOT
        // authoritative — it can omit SOME granted pages (NPE/Business-Portfolio
        // pages) while listing others. The merchant granted two pages, granular_scopes
        // carried both ids, /me/accounts returned only one, and the old code's
        // "fallback only when /me/accounts is EMPTY" early-return made the second
        // page permanently invisible to every sync.
        it('unions granular_scopes pages that /me/accounts omitted (partial omission)', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({
                    // /me/accounts — lists only the classic page
                    data: { data: [{ id: 'page_world', name: 'Shahin World', access_token: 'tok_world' }] },
                })
                .mockResolvedValueOnce({
                    // /debug_token — the grant truth: BOTH pages
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list', 'pages_messaging'],
                            granular_scopes: [
                                { scope: 'pages_show_list', target_ids: ['page_world', 'page_resort'] },
                                { scope: 'pages_messaging', target_ids: ['page_world', 'page_resort'] },
                            ],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    // GET /page_resort — only the MISSING page is fetched individually
                    data: { id: 'page_resort', name: 'Shahin Resort', access_token: 'tok_resort' },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(2);
            expect(pages.data.map(p => p.id)).toEqual(['page_world', 'page_resort']);
            expect(pages.data[1].access_token).toBe('tok_resort');
            // 1 (/me/accounts) + 1 (/debug_token) + 1 (/page_resort) — the page
            // already present in /me/accounts must NOT be refetched
            expect(fbAxios.get).toHaveBeenCalledTimes(3);
        });

        it('returns the primary response untouched when granular_scopes adds nothing new', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({
                    data: { data: [{ id: 'page_world', name: 'Shahin World', access_token: 'tok_world' }] },
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list'],
                            granular_scopes: [{ scope: 'pages_show_list', target_ids: ['page_world'] }],
                        },
                    },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_world');
            // No per-page fetches beyond /me/accounts + /debug_token
            expect(fbAxios.get).toHaveBeenCalledTimes(2);
        });

        it('keeps the primary pages when fetching an omitted page fails', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({
                    data: { data: [{ id: 'page_world', name: 'Shahin World', access_token: 'tok_world' }] },
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list'],
                            granular_scopes: [{ scope: 'pages_show_list', target_ids: ['page_world', 'page_gone'] }],
                        },
                    },
                })
                .mockRejectedValueOnce(new Error('403 Forbidden')); // GET /page_gone

            const pages = await service.getUserPages('access_token_123');

            // The union degrades to the primary result — never worse than before
            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_world');
        });

        it('returns the primary result as-is when /debug_token itself fails', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({
                    data: { data: [{ id: 'page_world', name: 'Shahin World', access_token: 'tok_world' }] },
                })
                .mockRejectedValueOnce(new Error('debug_token unavailable'));

            const pages = await service.getUserPages('access_token_123');

            // Reconciliation is best-effort: a /debug_token hiccup must never turn a
            // successful /me/accounts sync into a failure (the revoke step would read
            // a thrown sync as "user revoked everything")
            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_world');
        });

        it('skips an omitted page whose individual fetch returns no access_token', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({
                    data: { data: [{ id: 'page_world', name: 'Shahin World', access_token: 'tok_world' }] },
                })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list'],
                            granular_scopes: [{ scope: 'pages_show_list', target_ids: ['page_world', 'page_naked'] }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    // GET /page_naked — page object WITHOUT access_token (user lacks
                    // pages_read_engagement on that page) — unusable, must be skipped
                    data: { id: 'page_naked', name: 'No Token Page' },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_world');
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

        it('propagates errors from /debug_token when it fails during fallback', async () => {
            // /me/accounts returns empty, then /debug_token rejects (e.g., token expired between calls)
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } })
                .mockRejectedValueOnce({
                    isAxiosError: true,
                    response: { data: { error: { message: 'Token expired' } } },
                });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getUserPages('access_token_123')).rejects.toThrow('Token Verification failed');
        });

        it('skips fallback pages missing access_token (e.g., pages_read_engagement gap)', async () => {
            vi.mocked(fbAxios.get)
                .mockResolvedValueOnce({ data: { data: [] } })
                .mockResolvedValueOnce({
                    data: {
                        data: {
                            is_valid: true,
                            app_id: 'test_app_id',
                            user_id: 'user_1',
                            expires_at: 9999999999,
                            scopes: ['pages_show_list'],
                            granular_scopes: [
                                { scope: 'pages_show_list', target_ids: ['page_with_token', 'page_without_token'] },
                            ],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    // page_with_token — has access_token
                    data: { id: 'page_with_token', name: 'Page A', access_token: 'tok_a' },
                })
                .mockResolvedValueOnce({
                    // page_without_token — no access_token returned by Graph API
                    data: { id: 'page_without_token', name: 'Page B' },
                });

            const pages = await service.getUserPages('access_token_123');

            expect(pages.data).toHaveLength(1);
            expect(pages.data[0].id).toBe('page_with_token');
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
                        subscribed_fields: 'feed,messages,messaging_postbacks',
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
                { params: { subscribed_fields: 'feed,messages,messaging_postbacks', access_token: 'page_token' } },
            );
            expect(fbAxios.post).toHaveBeenNthCalledWith(2,
                'https://graph.facebook.com/v18.0/page_123/subscribed_apps',
                null,
                { params: { subscribed_fields: 'messages,messaging_postbacks', access_token: 'page_token' } },
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

    describe('likeComment', () => {
        it('POSTs to the comment likes edge with the page token, via plain axios (not the retrying fbAxios)', async () => {
            vi.mocked(axios.post).mockResolvedValue({ data: { success: true } });

            await expect(service.likeComment('comment_123', 'page_token_abc')).resolves.toBe(true);

            expect(axios.post).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/comment_123/likes',
                null,
                { params: { access_token: 'page_token_abc' }, timeout: 15_000 },
            );
            // Cosmetic call — must NOT go through the retrying fbAxios client.
            expect(fbAxios.post).not.toHaveBeenCalled();
        });

        it('never throws and never logs the raw error (no page token leak) on failure', async () => {
            // A real AxiosError carries config.params.access_token — logging the raw
            // object would leak the page token. The method must log only status + data.
            const axiosError = Object.assign(new Error('Forbidden'), {
                isAxiosError: true,
                config: { params: { access_token: 'SECRET_PAGE_TOKEN' } },
                response: { status: 403, data: { error: { message: 'permission', code: 200 } } },
            });
            vi.mocked(axios.post).mockRejectedValue(axiosError);

            const warn = vi.fn();
            const svc = new FacebookService();
            svc.setLogger({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as never);

            // Must resolve (never throw) so the reply is unaffected — false = like_failed.
            await expect(svc.likeComment('comment_123', 'SECRET_PAGE_TOKEN')).resolves.toBe(false);

            expect(warn).toHaveBeenCalledTimes(1);
            const loggedPayload = JSON.stringify(warn.mock.calls[0]);
            expect(loggedPayload).not.toContain('SECRET_PAGE_TOKEN');
            expect(loggedPayload).toContain('403');
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

    // ⛔ Both post-list edges FAIL SOFT: the error is RETURNED, not thrown. A
    // returned object travels much further than a caught one — `controllers/posts.ts`
    // does `request.log.error(error)` — so what rides on it is a publishing
    // decision, not an implementation detail.
    describe('post-list reads — the returned error is safe to hold and log', () => {
        /** An AxiosError shaped like a real Graph rejection: the page token is in
         *  `config.params`, exactly where `AxiosError.toJSON` would serialise it. */
        function graphRejection(status: number, code: number, subcode?: number) {
            return {
                isAxiosError: true,
                message: `Request failed with status code ${status}`,
                config: {
                    url: 'https://graph.facebook.com/v18.0/page_123/posts',
                    params: { fields: 'id,message', access_token: 'EAAG-SUPER-SECRET-PAGE-TOKEN' },
                },
                response: {
                    status,
                    data: { error: { message: 'Error validating access token', code, error_subcode: subcode, type: 'OAuthException' } },
                },
                toJSON() { return { message: this.message, config: this.config }; },
            };
        }

        beforeEach(() => {
            vi.mocked(axios.isAxiosError).mockReturnValue(true);
        });

        it.each([
            ['getPagePosts', (s: FacebookService) => s.getPagePosts('page_123', 'EAAG-SUPER-SECRET-PAGE-TOKEN')],
            ['getScheduledPosts', (s: FacebookService) => s.getScheduledPosts('page_123', 'EAAG-SUPER-SECRET-PAGE-TOKEN')],
        ])('%s never returns the raw AxiosError — that would publish the page token', async (_name, read) => {
            vi.mocked(fbAxios.get).mockRejectedValue(graphRejection(400, 190, 460));

            const result = await read(service);

            expect(result.failed).toBe(true);
            // The property that matters, stated the way a leak actually happens:
            // something downstream serialises it.
            expect(JSON.stringify(result.error)).not.toContain('EAAG-SUPER-SECRET-PAGE-TOKEN');
            expect(JSON.stringify(result.error ?? {})).not.toContain('access_token');
            // …and there is no axios `config` hanging off it at all.
            expect((result.error as unknown as { config?: unknown })?.config).toBeUndefined();
        });

        it('still carries the code/subcode recovery classifies on', async () => {
            // The leak fix must not cost the diagnosis: pageTokenRecovery reads
            // exactly these fields to tell a dead credential from a Graph blip.
            vi.mocked(fbAxios.get).mockRejectedValue(graphRejection(400, 190, 460));

            const result = await service.getPagePosts('page_123', 'tok');

            expect(result.error).toMatchObject({ code: 190, subcode: 460, isTransport: false });
        });

        it('flags a 5xx as transport, so an outage is not read as a revoked token', async () => {
            vi.mocked(fbAxios.get).mockRejectedValue(graphRejection(500, 190, 460));

            const result = await service.getPagePosts('page_123', 'tok');

            expect(result.error?.isTransport).toBe(true);
        });

        it('reports the /posts edge to Sentry with groupable numeric tags', async () => {
            // The incident was diagnosed off `/posts`; instrumenting only
            // `scheduled_posts` would leave the failing edge as invisible as it
            // was on 2026-08-14. Tags, not free text: Sentry's server-side
            // scrubbing replaced `extra.error` with "[Filtered]" on
            // JAWAB24-BACKEND-1Z because the message contains "access token".
            vi.mocked(fbAxios.get).mockRejectedValue(graphRejection(400, 190, 460));

            await service.getPagePosts('page_123', 'tok');

            expect(Sentry.captureMessage).toHaveBeenCalledWith(
                'Failed to list page posts',
                expect.objectContaining({
                    fingerprint: ['fb-page-posts-read-failed', 'page_123'],
                    tags: { fb_code: '190', fb_subcode: '460' },
                }),
            );
        });
    });

    describe('getScheduledPosts', () => {
        it('reads the scheduled_posts edge and converts the UNIX publish time to ISO', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({
                data: {
                    data: [
                        // Graph types scheduled_publish_time as a float in SECONDS.
                        { id: 'fb_1', message: 'launch', full_picture: 'https://cdn/p.jpg', scheduled_publish_time: 1786000800 },
                        { id: 'fb_2', scheduled_publish_time: '1786004400' },
                    ],
                },
            });

            const result = await service.getScheduledPosts('page_123', 'page_token');

            expect(result.failed).toBe(false);
            expect(result.truncated).toBe(false);
            expect(result.posts).toEqual([
                { id: 'fb_1', message: 'launch', imageUrl: 'https://cdn/p.jpg', scheduledPublishTime: new Date(1786000800 * 1000).toISOString() },
                // A numeric string still converts; only non-finite values mean "no schedule".
                { id: 'fb_2', message: null, imageUrl: null, scheduledPublishTime: new Date(1786004400 * 1000).toISOString() },
            ]);
            expect(fbAxios.get).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/page_123/scheduled_posts',
                expect.objectContaining({
                    params: expect.objectContaining({ fields: 'id,message,full_picture,scheduled_publish_time', access_token: 'page_token' }),
                }),
            );
        });

        it('marks the read as failed rather than reporting "no scheduled posts"', async () => {
            // Conflating a Graph error with an empty edge is the mistake getPagePosts'
            // `failed` flag exists to prevent — a caller must be able to tell them apart.
            vi.mocked(fbAxios.get).mockRejectedValue({ isAxiosError: true, response: { data: { error: { message: 'nope' } } } });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            const result = await service.getScheduledPosts('page_123', 'page_token');

            expect(result).toMatchObject({ posts: [], failed: true, truncated: false });
            // The error rides along so a caller that owns the page row can tell a dead
            // CREDENTIAL from a Graph blip and start recovery. Discarding it is what
            // made the 2026-08-14 outage look like "this page has no posts".
            expect(result.error).toBeDefined();
            // …and it is REPORTED. The caller degrades to "no scheduled posts", so
            // without this the failure is invisible on both sides. Pinned here
            // because this edge's reporting moved into the shared
            // `reportGraphReadFailure` helper — a refactor that silently dropped it
            // would otherwise leave every test green.
            expect(Sentry.captureMessage).toHaveBeenCalledWith(
                'Failed to list scheduled posts',
                expect.objectContaining({ fingerprint: ['fb-scheduled-posts-read-failed', 'page_123'] }),
            );
        });

        it('reports truncated when the edge fills the limit, rather than capping silently', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({
                data: { data: [{ id: 'fb_1' }, { id: 'fb_2' }] },
            });

            const result = await service.getScheduledPosts('page_123', 'page_token', { limit: 2 });

            expect(result.truncated).toBe(true);
        });
    });

    describe('getPostSchedule', () => {
        it('reports a scheduled post as unpublished with its ISO publish time', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({
                data: { is_published: false, scheduled_publish_time: 1786000800 },
            });

            await expect(service.getPostSchedule('fb_1', 'page_token')).resolves.toEqual({
                isPublished: false,
                scheduledPublishTime: new Date(1786000800 * 1000).toISOString(),
            });
        });

        it('treats a missing is_published as published (Graph omits it for normal posts)', async () => {
            vi.mocked(fbAxios.get).mockResolvedValue({ data: {} });

            await expect(service.getPostSchedule('fb_1', 'page_token')).resolves.toEqual({
                isPublished: true,
                scheduledPublishTime: null,
            });
        });

        it('returns null when Graph cannot answer, so callers can treat it as unknown', async () => {
            vi.mocked(fbAxios.get).mockRejectedValue({ isAxiosError: true, response: { data: { error: { message: 'gone' } } } });
            vi.mocked(axios.isAxiosError).mockReturnValue(true);

            await expect(service.getPostSchedule('fb_1', 'page_token')).resolves.toBeNull();
        });

        it('encodes the post id so a caller-supplied value cannot steer the Graph path', async () => {
            // The id arrives from a request body (POST /posts/ensure). Raw interpolation
            // would let it address a different node/edge on the page's token.
            vi.mocked(fbAxios.get).mockResolvedValue({ data: {} });

            await service.getPostSchedule('me/accounts', 'page_token');

            expect(fbAxios.get).toHaveBeenCalledWith(
                'https://graph.facebook.com/v18.0/me%2Faccounts',
                expect.anything(),
            );
        });
    });
});


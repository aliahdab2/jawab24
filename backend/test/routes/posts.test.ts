import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import postsRoutes from '../../src/routes/posts';
import { postsService, PostNotOwnedError } from '../../src/services/posts';
import { pagesService } from '../../src/services/pages';

// Mock services
vi.mock('../../src/services/posts');
vi.mock('../../src/services/pages');
vi.mock('../../src/services/comments');
// Image attachments require object storage configured — force it ON so the controller's
// image-validation branches are exercised (isConfigured() reads real env otherwise).
vi.mock('../../src/services/imageStorage', () => ({
    imageStorage: { isConfigured: vi.fn(() => true), put: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'test_workspace_id';
        req.workspaceRole = 'owner';
    },
    requireRole: () => async () => {},
}));

describe('Posts Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(postsRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /posts', () => {
        it('should get all posts for user', async () => {
            const postsList = [{ id: 'post_1', message: 'Hello World' }];
            vi.mocked(postsService.getPostsByWorkspace).mockResolvedValue(postsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/posts'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(postsList);
            expect(postsService.getPostsByWorkspace).toHaveBeenCalledWith('test_workspace_id');
        });
    });

    describe('GET /posts/:id', () => {
        it('should get a single post', async () => {
            const post = { id: 'post_1', message: 'Hello World' };
            vi.mocked(postsService.getPost).mockResolvedValue(post as any);

            const response = await app.inject({
                method: 'GET',
                url: '/posts/post_1'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(post);
        });

        it('should return 404 if post not found', async () => {
            vi.mocked(postsService.getPost).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/posts/non_existent'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('GET /pages/:pageId/posts', () => {
        it('should get posts for a specific page', async () => {
            const page = { id: 'page_1', name: 'My Store' };
            const postsList = [{ id: 'post_1', message: 'Hello' }];
            
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            vi.mocked(postsService.getPostsByPage).mockResolvedValue(postsList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/page_1/posts'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(postsList);
        });

        it('should return 404 if page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/non_existent/posts'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /posts/:id', () => {
        it('should delete a post', async () => {
            vi.mocked(postsService.deletePost).mockResolvedValue(true as any);

            const response = await app.inject({
                method: 'DELETE',
                url: '/posts/post_1'
            });

            expect(response.statusCode).toBe(204);
            expect(postsService.deletePost).toHaveBeenCalledWith('post_1', 'test_workspace_id');
        });
    });

    describe('PATCH /posts/:id/auto-reply', () => {
        it('should toggle auto-reply', async () => {
            const updatedPost = { id: 'post_1', autoReplyEnabled: false };
            vi.mocked(postsService.toggleAutoReply).mockResolvedValue(updatedPost as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/auto-reply',
                payload: { enabled: false }
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.toggleAutoReply).toHaveBeenCalledWith('post_1', false, 'test_workspace_id');
        });
    });

    describe('PATCH /posts/:id/trigger', () => {
        it('should set trigger keyword and reply', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Here are the details!' },
            });

            expect(response.statusCode).toBe(200);
            // No likeComment in the body → undefined (keep — never clobber a field the client didn't send).
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerKeyword: '.', triggerReply: 'Here are the details!',
                workspaceId: 'test_workspace_id', triggerType: 'keyword', image: { action: 'keep' }, likeComment: undefined,
            }));
        });

        it('should clear trigger when both values are null', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'instagram', triggerKeyword: null, triggerReply: null },
            });

            expect(response.statusCode).toBe(200);
            // Clearing the rule also drops any attached image and resets the like option + veto keywords.
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'instagram', triggerKeyword: null, triggerReply: null,
                triggerType: 'keyword', image: { action: 'remove' }, likeComment: false, triggerExcludeKeyword: null,
            }));
        });

        it('should return 400 for invalid source', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'twitter', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(400);
        });

        it('passes an explicit likeComment through for a facebook post', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', likeComment: true },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerReply: 'Details', likeComment: true,
            }));
        });

        it('passes an explicit tagCommenter through for a facebook post', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', tagCommenter: true },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerReply: 'Details', tagCommenter: true,
            }));
        });

        // Instagram mentions need `@username`, a mechanism this column does not describe —
        // an IG client asking for it must not end up with a true flag on a post row.
        it('coerces tagCommenter to false for an instagram post', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'instagram', triggerKeyword: '.', triggerReply: 'Details', tagCommenter: true },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                source: 'instagram', tagCommenter: false,
            }));
        });

        it('leaves tagCommenter untouched (undefined) when the field is absent — no lost update for stale clients', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', likeComment: true },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                tagCommenter: undefined,
            }));
        });

        it('leaves likeComment untouched (undefined) when the field is absent — no lost update for stale clients', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerReply: 'Details', likeComment: undefined,
            }));
        });

        it('coerces an explicit likeComment to false for instagram (its API cannot like comments)', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'instagram', triggerKeyword: '.', triggerReply: 'Details', likeComment: true },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'instagram', triggerReply: 'Details', likeComment: false,
            }));
        });

        it('should return 400 when keyword is set but reply is null (partial trigger)', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: null },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 400 for an unknown triggerType instead of silently coercing to keyword mode', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerType: 'garbage' },
            });

            expect(response.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('should set an any-comment trigger (no keyword stored)', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: null, triggerReply: 'DM sent!', triggerType: 'all' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerKeyword: null, triggerReply: 'DM sent!', triggerType: 'all',
            }));
        });

        it('passes exclude keywords through (trimmed) for both platforms', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerExcludeKeyword: '  غالي, expensive  ' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', triggerExcludeKeyword: 'غالي, expensive',
            }));
        });

        it('clears exclude keywords when an empty string is sent', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerExcludeKeyword: '' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                triggerExcludeKeyword: null,
            }));
        });

        it('leaves exclude keywords untouched (undefined) when the field is absent', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                triggerExcludeKeyword: undefined,
            }));
        });

        it('rejects more than 10 exclude keywords with 400', async () => {
            const kw = Array.from({ length: 11 }, (_, i) => `x${i}`).join(',');
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerExcludeKeyword: kw },
            });

            expect(response.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('passes a CTA button through (trimmed) for a facebook post', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerButtonLabel: '  Shop now  ', triggerButtonUrl: '  https://shop.example/x  ' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                triggerButtonLabel: 'Shop now', triggerButtonUrl: 'https://shop.example/x',
            }));
        });

        it('rejects a half-configured CTA button with 400', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerButtonLabel: 'Shop' },
            });
            expect(response.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('rejects a non-http(s) CTA URL with 400', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details', triggerButtonLabel: 'Go', triggerButtonUrl: 'javascript:alert(1)' },
            });
            expect(response.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('coerces a CTA button to cleared for instagram (no button columns / unverified support)', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'instagram', triggerKeyword: '.', triggerReply: 'Details', triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example' },
            });

            expect(response.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                source: 'instagram', triggerButtonLabel: null, triggerButtonUrl: null,
            }));
        });

        it('maps the service button_text_too_long result to 400', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: false, reason: 'button_text_too_long' });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/post_1/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'x'.repeat(700), triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example' },
            });
            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.body).error).toBe('button_text_too_long');
        });

        it('should return 404 when post not found or not owned', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: false, reason: 'not_found' });

            const response = await app.inject({
                method: 'PATCH',
                url: '/posts/unknown/trigger',
                payload: { source: 'facebook', triggerKeyword: '.', triggerReply: 'Details' },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('PATCH /posts/:id/trigger — image validation', () => {
        // Minimal buffer with the PNG magic signature so bufferMatchesMime passes for image/png.
        const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        // Correct PNG magic bytes but undecodable content — enough for the checks that
        // reject BEFORE normalization (bad MIME, oversized), which never decode the file.
        const validPng = (padBytes = 64) => Buffer.concat([PNG_SIG, Buffer.alloc(padBytes)]).toString('base64');
        // A real 1x1 PNG. Anything that must get PAST validation needs this: the upload
        // path now re-encodes the image to strip EXIF, so it has to actually decode.
        const realPng = () =>
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const patch = (triggerImage: unknown) => app.inject({
            method: 'PATCH', url: '/posts/post_1/trigger',
            payload: { source: 'facebook', triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', triggerImage },
        });

        beforeEach(() => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: true });
        });

        it('rejects an unsupported MIME type with 400', async () => {
            const res = await patch({ base64: validPng(), mimeType: 'image/gif' });
            expect(res.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('rejects a missing/empty base64 with 400', async () => {
            expect((await patch({ mimeType: 'image/png' })).statusCode).toBe(400);
            expect((await patch({ base64: '', mimeType: 'image/png' })).statusCode).toBe(400);
        });

        it('rejects an oversize image with 413', async () => {
            const res = await patch({ base64: validPng(2 * 1024 * 1024 + 10), mimeType: 'image/png' });
            expect(res.statusCode).toBe(413);
        });

        it('rejects a magic-byte / declared-type mismatch with 400', async () => {
            const notAPng = Buffer.from('this is plain text, not a png').toString('base64');
            const res = await patch({ base64: notAPng, mimeType: 'image/png' });
            expect(res.statusCode).toBe(400);
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('accepts a valid image and forwards a set intent to the service', async () => {
            const res = await patch({ base64: realPng(), mimeType: 'image/png' });
            expect(res.statusCode).toBe(200);
            expect(postsService.updateTrigger).toHaveBeenCalledWith(expect.objectContaining({
                contentId: 'post_1', source: 'facebook', triggerKeyword: 'k', triggerReply: 'hi',
                image: expect.objectContaining({ action: 'set', mimeType: 'image/png' }),
            }));
        });

        it('normalizes before handing the image to the service (EXIF never reaches storage)', async () => {
            await patch({ base64: realPng(), mimeType: 'image/png' });
            const { image } = vi.mocked(postsService.updateTrigger).mock.calls[0][0] as {
                image: { action: string; buffer: Buffer };
            };
            // Re-encoded, so the buffer the service stores is not the bytes we uploaded.
            expect(image.buffer.equals(Buffer.from(realPng(), 'base64'))).toBe(false);
            // Still a PNG — the key's extension and stored mimeType must stay truthful.
            expect(image.buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
        });

        it('rejects an undecodable image with 400 instead of storing it unprocessed', async () => {
            const res = await patch({ base64: validPng(), mimeType: 'image/png' });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toBe('image_unreadable');
            expect(postsService.updateTrigger).not.toHaveBeenCalled();
        });

        it('maps quota_exceeded to 413', async () => {
            vi.mocked(postsService.updateTrigger).mockResolvedValue({ ok: false, reason: 'quota_exceeded' });
            const res = await patch({ base64: realPng(), mimeType: 'image/png' });
            expect(res.statusCode).toBe(413);
            expect(JSON.parse(res.body).error).toBe('image_quota_exceeded');
        });

    });

    describe('GET /pages/:pageId/published-posts', () => {
        it('lists posts via the service, defaulting source to facebook when the page has a FB id', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' } as any);
            vi.mocked(postsService.listPublishedPosts).mockResolvedValue({ posts: [], nextCursor: null } as any);

            const res = await app.inject({ method: 'GET', url: '/pages/p1/published-posts' });

            expect(res.statusCode).toBe(200);
            expect(postsService.listPublishedPosts).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'p1' }),
                expect.objectContaining({ source: 'facebook' }),
            );
        });

        it('returns 404 when the workspace does not own the page', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            const res = await app.inject({ method: 'GET', url: '/pages/p1/published-posts' });
            expect(res.statusCode).toBe(404);
        });

        it('returns an empty page (not an error) when the requested source is not connected', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' } as any);

            const res = await app.inject({ method: 'GET', url: '/pages/p1/published-posts?source=instagram' });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.payload)).toEqual({ posts: [], nextCursor: null, partial: false });
            expect(postsService.listPublishedPosts).not.toHaveBeenCalled();
        });

        it('reports the list as PARTIAL when the page has no usable token', async () => {
            // `partial: false` is an assertion that the merchant has no posts, and
            // it is the wrong one when the CREDENTIAL is what is missing.
            // `pageTokenRecovery.markPageNeedsReconnect` blanks `access_token` the
            // moment Facebook confirms it is revoked, so without this the first
            // failure moves the page from "read failed → partial: true" to a
            // confidently COMPLETE empty list — the 2026-08-14 screen («لا توجد
            // منشورات حديثة على هذه الصفحة») with its last remaining clue removed.
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: '' } as any);

            const res = await app.inject({ method: 'GET', url: '/pages/p1/published-posts' });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.payload)).toEqual({ posts: [], nextCursor: null, partial: true });
            // Still no Graph call — there is nothing to call with.
            expect(postsService.listPublishedPosts).not.toHaveBeenCalled();
        });

        it('keeps "source not connected" COMPLETE even when the token is also blank', async () => {
            // The counterweight: an unconnected source has no list to be missing
            // anything from, so it must not start claiming to be partial.
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: '' } as any);

            const res = await app.inject({ method: 'GET', url: '/pages/p1/published-posts?source=instagram' });

            expect(JSON.parse(res.payload)).toEqual({ posts: [], nextCursor: null, partial: false });
        });
    });

    describe('POST /posts/ensure', () => {
        it('find-or-creates the internal row and returns its trigger fields', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' } as any);
            vi.mocked(postsService.ensureContent).mockResolvedValue({ id: 'internal-1', triggerKeyword: null, triggerReply: null, triggerType: 'keyword' } as any);

            const res = await app.inject({
                method: 'POST',
                url: '/posts/ensure',
                payload: { pageId: 'p1', source: 'facebook', platformPostId: 'fb_123' },
            });

            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.payload)).toMatchObject({ id: 'internal-1' });
            expect(postsService.ensureContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'facebook', 'fb_123');
        });

        it('returns 400 for an invalid source', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/posts/ensure',
                payload: { pageId: 'p1', source: 'twitter', platformPostId: 'x' },
            });
            expect(res.statusCode).toBe(400);
            expect(postsService.ensureContent).not.toHaveBeenCalled();
        });

        it('returns 400 when platformPostId is missing', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/posts/ensure',
                payload: { pageId: 'p1', source: 'facebook' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 when the workspace does not own the page', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null as any);
            const res = await app.inject({
                method: 'POST',
                url: '/posts/ensure',
                payload: { pageId: 'p1', source: 'facebook', platformPostId: 'x' },
            });
            expect(res.statusCode).toBe(404);
        });

        it('returns 404 (not 500) when the post id belongs to another workspace', async () => {
            // Cross-tenant probe: same response as an unknown post — never confirm
            // that the id exists under someone else's workspace.
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'p1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' } as any);
            vi.mocked(postsService.ensureContent).mockRejectedValue(new PostNotOwnedError('fb_foreign'));

            const res = await app.inject({
                method: 'POST',
                url: '/posts/ensure',
                payload: { pageId: 'p1', source: 'facebook', platformPostId: 'fb_foreign' },
            });

            expect(res.statusCode).toBe(404);
            expect(JSON.parse(res.payload).error).toBe('Post not found');
        });
    });
});


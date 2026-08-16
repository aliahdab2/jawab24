import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import pagesRoutes from '../../src/routes/pages';
import { pagesService } from '../../src/services/pages';
import { recordActivationEvent } from '../../src/services/activation';

// Mock services
vi.mock('../../src/services/pages');
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canAddPage: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
        canEnablePage: vi.fn().mockResolvedValue({ allowed: true, limit: 10, used: 1, remaining: 9 }),
    }
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
// The controller re-imports the pure helpers alongside the emitters, so the
// mock must provide both: emitters as spies, helpers from the real shared pkg.
vi.mock('../../src/services/activation', async () => {
    const { isBusinessInfoProvided, KB_FILLED_MIN_CHARS } = await import('@jawab24/shared');
    return {
        recordActivationEvent: vi.fn(),
        recordAutoreplyEnabledIfEffective: vi.fn(),
        isBusinessInfoProvided,
        KB_FILLED_MIN_CHARS,
    };
});

describe('Pages Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(pagesRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('POST /pages', () => {
        it('should create a new page', { timeout: 10_000 }, async () => {
            const newPageData = {
                facebookPageId: 'fb_page_123',
                name: 'My Store',
                accessToken: 'access_token_123'
            };
            const createdPage = {
                ...newPageData,
                id: 'page_1',
                userId: 'test_user_id',
                autoReplyEnabled: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            vi.mocked(pagesService.createPage).mockResolvedValue(createdPage);

            const response = await app.inject({
                method: 'POST',
                url: '/pages',
                payload: newPageData
            });

            expect(response.statusCode).toBe(201);
            expect(pagesService.createPage).toHaveBeenCalledWith('test_workspace_id', 'test_user_id', newPageData);
        });
    });

    describe('GET /pages', () => {
        it('should get all pages for user with isConnected flag', async () => {
            const pagesList = [{ id: 'page_1', name: 'My Store', facebookPageId: 'fb_1', accessToken: 'tok' }];
            vi.mocked(pagesService.getPages).mockResolvedValue(pagesList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body[0]).toEqual(expect.objectContaining({ id: 'page_1', isConnected: true }));
            expect(body[0].accessToken).toBeUndefined();
            expect(pagesService.getPages).toHaveBeenCalledWith('test_workspace_id');
        });
    });

    describe('GET /pages/:id', () => {
        it('should get a single page with isConnected flag', async () => {
            const page = { id: 'page_1', name: 'My Store', facebookPageId: 'fb_1', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/page_1'
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toEqual(expect.objectContaining({ id: 'page_1', isConnected: true }));
            expect(body.accessToken).toBeUndefined();
        });

        it('should return 404 if page not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: '/pages/non_existent'
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('DELETE /pages/:id', () => {
        it('should delete a page', async () => {
            vi.mocked(pagesService.deletePage).mockResolvedValue(undefined);

            const response = await app.inject({
                method: 'DELETE',
                url: '/pages/page_1'
            });

            expect(response.statusCode).toBe(204);
            expect(pagesService.deletePage).toHaveBeenCalledWith('test_workspace_id', 'page_1');
        });
    });

    describe('POST /pages/:id/archive', () => {
        it('archives a disconnected page', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({
                status: 'archived',
                page: { id: 'page_1', facebookPageId: 'fb_1', accessToken: '', archivedAt: new Date() },
                already: false,
            } as any);

            const response = await app.inject({
                method: 'POST',
                url: '/pages/page_1/archive',
            });

            expect(response.statusCode).toBe(200);
            expect(pagesService.archivePage).toHaveBeenCalledWith('test_workspace_id', 'page_1');
        });

        it('refuses a connected page with PAGE_NOT_DISCONNECTED', async () => {
            vi.mocked(pagesService.archivePage).mockResolvedValue({ status: 'not_disconnected' } as any);

            const response = await app.inject({
                method: 'POST',
                url: '/pages/page_1/archive',
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().code).toBe('PAGE_NOT_DISCONNECTED');
        });
    });

    describe('PATCH /pages/:id/auto-reply', () => {
        it('should toggle auto-reply', async () => {
            const updatedPage = { id: 'page_1', autoReplyEnabled: false, facebookPageId: 'fb_1', accessToken: 'tok' };
            vi.mocked(pagesService.toggleAutoReply).mockResolvedValue(updatedPage as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/auto-reply',
                payload: { enabled: false }
            });

            expect(response.statusCode).toBe(200);
            expect(pagesService.toggleAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page_1', false);
        });
    });

    describe('PATCH /pages/:id/lead-config', () => {
        const PAGE = { id: 'page_1', name: 'Nourva', facebookPageId: 'fb_1', accessToken: 'tok' };

        it('saves a sanitized per-page override and returns the serialized page', async () => {
            vi.mocked(pagesService.updateLeadConfig).mockResolvedValue({
                ...PAGE,
                leadStages: { converted: [{ id: 's1', label: 'Shipped', color: 'cyan' }] },
                leadFields: [{ id: 'f1', label: 'Order #' }],
            } as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/lead-config',
                payload: {
                    leadStages: { converted: [{ id: 's1', label: 'Shipped', color: 'cyan' }] },
                    leadFields: [{ id: 'f1', label: 'Order #' }],
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.accessToken).toBeUndefined(); // serializePage strips it
            expect(body.isConnected).toBe(true);
            expect(pagesService.updateLeadConfig).toHaveBeenCalledWith(
                'test_workspace_id',
                'page_1',
                expect.objectContaining({
                    leadStages: { converted: [{ id: 's1', label: 'Shipped', color: 'cyan' }] },
                    leadFields: [{ id: 'f1', label: 'Order #' }],
                }),
            );
        });

        it('reverts a slice to the workspace default when null is sent', async () => {
            vi.mocked(pagesService.updateLeadConfig).mockResolvedValue(PAGE as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/lead-config',
                payload: { leadStages: null },
            });

            expect(response.statusCode).toBe(200);
            // Only the provided slice is written; null passes through as "revert".
            expect(pagesService.updateLeadConfig).toHaveBeenCalledWith(
                'test_workspace_id', 'page_1', { leadStages: null },
            );
        });

        it('does NOT clobber the untouched slice on a partial PATCH', async () => {
            vi.mocked(pagesService.updateLeadConfig).mockResolvedValue(PAGE as any);

            await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/lead-config',
                payload: { leadFields: [{ id: 'f1', label: 'Order #' }] },
            });

            const arg = vi.mocked(pagesService.updateLeadConfig).mock.calls[0][2];
            expect(arg).not.toHaveProperty('leadStages');
            expect(arg).toHaveProperty('leadFields');
        });

        it('rejects a malformed override with 400 and never calls the service', async () => {
            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/lead-config',
                payload: { leadStages: 'not-an-object' },
            });

            expect(response.statusCode).toBe(400);
            expect(pagesService.updateLeadConfig).not.toHaveBeenCalled();
        });

        it('returns 404 when the page is not in the workspace', async () => {
            vi.mocked(pagesService.updateLeadConfig).mockResolvedValue(null as any);

            const response = await app.inject({
                method: 'PATCH',
                url: '/pages/page_1/lead-config',
                payload: { leadFields: [] },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('POST /pages/sync — no_fb_pages demand signal', () => {
        // Exactly the shape syncFromFacebook returns when /me/accounts is empty.
        const EMPTY_SYNC = {
            syncedPages: [], skippedCount: 0, skippedPages: [], skipReason: undefined,
            pageLimit: null, takenCount: 0, trialBlockedCount: 0, trialBlockedPages: [],
            revokedCount: 0, alreadyMemberOf: [],
        };

        it('records no_fb_pages when Facebook returns no pages and none exist', async () => {
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue(EMPTY_SYNC as any);
            vi.mocked(pagesService.getPages).mockResolvedValue([]);

            const response = await app.inject({
                method: 'POST',
                url: '/pages/sync',
                payload: { accessToken: 'tok' },
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload).synced).toBe(0);
            expect(recordActivationEvent).toHaveBeenCalledWith('test_user_id', 'no_fb_pages');
        });

        it('does NOT record no_fb_pages when the workspace already has pages', async () => {
            vi.mocked(pagesService.syncFromFacebook).mockResolvedValue(EMPTY_SYNC as any);
            vi.mocked(pagesService.getPages).mockResolvedValue([
                { id: 'page_1', name: 'Existing', facebookPageId: 'fb_1' } as any,
            ]);

            const response = await app.inject({
                method: 'POST',
                url: '/pages/sync',
                payload: { accessToken: 'tok' },
            });

            expect(response.statusCode).toBe(200);
            expect(recordActivationEvent).not.toHaveBeenCalled();
        });
    });

    describe('POST /pages/instagram-direct-interest', () => {
        it('records the interest signal for the acting user and returns 204', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/pages/instagram-direct-interest',
            });

            expect(response.statusCode).toBe(204);
            expect(recordActivationEvent).toHaveBeenCalledWith('test_user_id', 'ig_direct_interest');
        });
    });
});


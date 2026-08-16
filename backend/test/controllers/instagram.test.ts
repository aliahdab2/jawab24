import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock dependencies before imports
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
        toggleInstagramAutoReply: vi.fn(),
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        getMedia: vi.fn(),
        getComments: vi.fn(),
        replyToComment: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canEnablePage: vi.fn().mockResolvedValue({ allowed: true, remaining: null }),
    },
}));

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    orderBy: vi.fn(() => Promise.resolve([])),
                })),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoUpdate: vi.fn(() => Promise.resolve()),
                returning: vi.fn(() => Promise.resolve([{ id: 'new-media-1' }])),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve()),
            })),
        })),
    },
}));

vi.mock('../../src/db/schema', () => ({
    instagramMedia: {},
    instagramComments: {},
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((a: any, b: any) => ({ field: a, value: b, op: 'eq' })),
    and: vi.fn((...args: any[]) => ({ op: 'and', args })),
    desc: vi.fn((field: any) => ({ field, dir: 'desc' })),
    inArray: vi.fn((field: any, values: any[]) => ({ field, values, op: 'inArray' })),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

// The readiness gate hits the DB (catalog probe) and the store service. This
// suite is about the toggle/sync behaviour, so default to "the page is grounded"
// and let the dedicated test below flip it.
vi.mock('../../src/services/businessReadiness', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/services/businessReadiness')>()),
    businessInfoGate: vi.fn().mockResolvedValue(null),
}));

// Import controller AFTER mocks
import { instagramController } from '../../src/controllers/instagram';
import { businessInfoGate } from '../../src/services/businessReadiness';

// What businessInfoGate returns for a page with nothing to answer from.
const BUSINESS_INFO_REFUSAL = {
    status: 409,
    body: { error: 'Add your Business Info', code: 'BUSINESS_INFO_REQUIRED' },
} as const;
import { pagesService } from '../../src/services/pages';
import { instagramService } from '../../src/services/instagram';
import { pageLinkedInstagramCredential } from '../../src/services/instagramCredential';
import { db } from '../../src/db';

describe('InstagramController', () => {
    let mockRequest: Partial<FastifyRequest>;
    let mockReply: Partial<FastifyReply>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Re-armed after clearAllMocks: a cleared mock resolves undefined, which
        // the readiness gate reads as "ungrounded" and would 409 every enable.
        vi.mocked(businessInfoGate).mockResolvedValue(null);
        mockReply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
            code: vi.fn().mockReturnThis(),
        };
        mockRequest = {
            user: { userId: 'user-123', facebookId: 'fb-123' },
            workspaceId: 'test_workspace_id',
            workspaceRole: 'owner',
            query: {},
            params: {},
            body: {},
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        };
    });

    // ─── getMedia ──────────────────────────────────────────

    describe('getMedia', () => {
        it('should return media on success', async () => {
            const page = { id: 'page-1', instagramAccountId: 'ig-123', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);

            const mediaItems = [{ id: 'media-1', caption: 'Post 1' }];
            const mockLimit = vi.fn().mockResolvedValue(mediaItems);
            const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
            const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            (mockRequest as any).params = { pageId: 'page-1' };

            await instagramController.getMedia(mockRequest as any, mockReply as any);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith(mediaItems);
        });

        it('should return 404 when page is not found', async () => {
            vi.mocked(pagesService.getPage).mockResolvedValue(null);
            (mockRequest as any).params = { pageId: 'bad-page' };

            await instagramController.getMedia(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should return 400 when no Instagram account is linked', async () => {
            const page = { id: 'page-1', instagramAccountId: null };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            (mockRequest as any).params = { pageId: 'page-1' };

            await instagramController.getMedia(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'No Instagram account linked to this page' }),
            );
        });

        it('should return 403 when user does not own the page (via getComments path)', async () => {
            // For getMedia, ownership is checked via pagesService.getPage which returns null.
            // The 403 path is in getComments, so we test it there.
            // For getMedia, null page returns 404.
            vi.mocked(pagesService.getPage).mockResolvedValue(null);
            (mockRequest as any).params = { pageId: 'other-page' };

            await instagramController.getMedia(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });
    });

    // ─── getComments ───────────────────────────────────────

    describe('getComments', () => {
        it('should return comments on success', async () => {
            const mediaRow = [{ id: 'media-1', pageId: 'page-1' }];
            const comments = [{ id: 'c1', message: 'Nice!' }];
            const page = { id: 'page-1', userId: 'user-123' };

            // First db.select() call: get media
            // Second db.select() call: get comments
            let selectCallCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                selectCallCount++;
                if (selectCallCount === 1) {
                    // media lookup
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue(mediaRow),
                        }),
                    } as any;
                }
                // comments lookup
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue(comments),
                            }),
                        }),
                    }),
                } as any;
            });

            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            (mockRequest as any).params = { mediaId: 'media-1' };

            await instagramController.getComments(mockRequest as any, mockReply as any);

            expect(pagesService.getPage).toHaveBeenCalledWith('test_workspace_id', 'page-1');
            expect(mockReply.send).toHaveBeenCalledWith(comments);
        });

        it('should return 404 when media is not found', async () => {
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any);
            (mockRequest as any).params = { mediaId: 'bad-media' };

            await instagramController.getComments(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Media not found' });
        });

        it('should return 403 when user does not own the page', async () => {
            const mediaRow = [{ id: 'media-1', pageId: 'page-1' }];
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mediaRow),
                }),
            } as any);
            vi.mocked(pagesService.getPage).mockResolvedValue(null);
            (mockRequest as any).params = { mediaId: 'media-1' };

            await instagramController.getComments(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(403);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Access denied' });
        });
    });

    // ─── replyToComment ────────────────────────────────────

    describe('replyToComment', () => {
        it('should reply successfully and update DB', async () => {
            const commentRow = [{ id: 'c-1', mediaId: 'media-1', instagramCommentId: 'ig-c-1' }];
            const mediaRow = [{ id: 'media-1', pageId: 'page-1' }];
            const page = { id: 'page-1', accessToken: 'tok-abc' };

            let selectCallCount = 0;
            vi.mocked(db.select).mockImplementation(() => {
                selectCallCount++;
                if (selectCallCount === 1) {
                    // comment lookup
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue(commentRow),
                        }),
                    } as any;
                }
                // media lookup
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(mediaRow),
                    }),
                } as any;
            });

            const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
            const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockUpdateSet } as any);

            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            vi.mocked(instagramService.replyToComment).mockResolvedValue('reply-id-1');

            (mockRequest as any).params = { commentId: 'c-1' };
            (mockRequest as any).body = { message: 'Thanks!' };

            await instagramController.replyToComment(mockRequest as any, mockReply as any);

            expect(instagramService.replyToComment).toHaveBeenCalledWith('ig-c-1', 'Thanks!', pageLinkedInstagramCredential('tok-abc'));
            expect(db.update).toHaveBeenCalled();
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, replyId: 'reply-id-1' }),
            );
        });

        it('should return 400 when message is empty', async () => {
            (mockRequest as any).params = { commentId: 'c-1' };
            (mockRequest as any).body = { message: '' };

            await instagramController.replyToComment(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith({ error: 'Message is required' });
        });
    });

    // ─── toggleAutoReply ───────────────────────────────────

    describe('toggleAutoReply', () => {
        it('should toggle auto-reply and return updated page', async () => {
            const updatedPage = { id: 'page-1', instagramAutoReplyEnabled: true };
            vi.mocked(pagesService.toggleInstagramAutoReply).mockResolvedValue(updatedPage as any);
            (mockRequest as any).params = { id: 'page-1' };
            (mockRequest as any).body = { enabled: true };

            await instagramController.toggleAutoReply(mockRequest as any, mockReply as any);

            expect(pagesService.toggleInstagramAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page-1', true);
            expect(mockReply.send).toHaveBeenCalledWith(updatedPage);
        });

        it('should return 404 when page is not found', async () => {
            vi.mocked(pagesService.toggleInstagramAutoReply).mockResolvedValue(undefined as any);
            (mockRequest as any).params = { id: 'bad-page' };
            (mockRequest as any).body = { enabled: false };

            await instagramController.toggleAutoReply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(404);
        });

        it('409s BUSINESS_INFO_REQUIRED on enable when the page has nothing to answer from', async () => {
            vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
            vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1' } as any);
            (mockRequest as any).params = { id: 'page-1' };
            (mockRequest as any).body = { enabled: true };

            await instagramController.toggleAutoReply(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(409);
            expect(mockReply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'BUSINESS_INFO_REQUIRED' }));
            expect(pagesService.toggleInstagramAutoReply).not.toHaveBeenCalled();
        });

        it('never blocks DISABLING an ungrounded page', async () => {
            // A merchant who emptied their Business Info must still be able to
            // switch the bot off — the gate must never trap them with a live bot.
            vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
            vi.mocked(pagesService.toggleInstagramAutoReply).mockResolvedValue({ id: 'page-1' } as any);
            (mockRequest as any).params = { id: 'page-1' };
            (mockRequest as any).body = { enabled: false };

            await instagramController.toggleAutoReply(mockRequest as any, mockReply as any);

            expect(pagesService.toggleInstagramAutoReply).toHaveBeenCalledWith('test_workspace_id', 'page-1', false);
        });
    });

    // ─── syncMedia ─────────────────────────────────────────

    describe('syncMedia', () => {
        it('should sync media and return counts', async () => {
            const page = { id: 'page-1', instagramAccountId: 'ig-123', accessToken: 'tok' };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);

            // Instagram API returns 1 media item with 1 comment
            vi.mocked(instagramService.getMedia).mockResolvedValue({
                media: [
                    { id: 'ig-media-1', media_type: 'IMAGE', caption: 'Test', permalink: 'https://...', timestamp: '2024-01-01T00:00:00Z' },
                ],
                nextCursor: null,
            } as any);
            vi.mocked(instagramService.getComments).mockResolvedValue([
                { id: 'ig-comment-1', text: 'Cool!', from: { id: 'u1', username: 'fan' }, timestamp: '2024-01-01T01:00:00Z' },
            ] as any);

            // db.select(...).from(...).where(...) — used to look up existing
            // media and comment IDs for the new-vs-existing split. Empty = all new.
            vi.mocked(db.select).mockImplementation(() => ({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            } as any));

            // db.insert(media).values(...).onConflictDoUpdate(...).returning(...) → upserted rows
            // db.insert(comments).values(...).onConflictDoNothing(...) → resolves
            const mockMediaReturning = vi.fn().mockResolvedValue([
                { id: 'new-media-1', instagramMediaId: 'ig-media-1' },
            ]);
            const mockValues = vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockReturnValue({ returning: mockMediaReturning }),
                onConflictDoNothing: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 'new-comment-1' }]),
                }),
            });
            vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);

            (mockRequest as any).params = { pageId: 'page-1' };

            await instagramController.syncMedia(mockRequest as any, mockReply as any);

            expect(instagramService.getMedia).toHaveBeenCalledWith('ig-123', pageLinkedInstagramCredential('tok'));
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    synced: expect.objectContaining({
                        media: expect.any(Number),
                        comments: expect.any(Number),
                    }),
                }),
            );
        });

        it('should return 400 when no Instagram account is linked for sync', async () => {
            const page = { id: 'page-1', instagramAccountId: null };
            vi.mocked(pagesService.getPage).mockResolvedValue(page as any);
            (mockRequest as any).params = { pageId: 'page-1' };

            await instagramController.syncMedia(mockRequest as any, mockReply as any);

            expect(mockReply.status).toHaveBeenCalledWith(400);
            expect(mockReply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'No Instagram account linked to this page' }),
            );
        });
    });
});

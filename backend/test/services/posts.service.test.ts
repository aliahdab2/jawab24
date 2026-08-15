import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    postsService,
    PostNotOwnedError,
    SCHEDULED_MARKER_GRACE_MS,
    SCHEDULED_MARKER_RECHECK_MAX,
    staleMarkerCutoff,
} from '../../src/services/posts';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: {
        getPostContent: vi.fn(),
        getPagePosts: vi.fn(),
        getScheduledPosts: vi.fn(),
        getPostSchedule: vi.fn(),
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        getMedia: vi.fn(),
    },
}));

vi.mock('../../src/services/imageStorage', () => ({
    imageStorage: {
        isConfigured: vi.fn(() => true),
        put: vi.fn(),
        remove: vi.fn(),
    },
}));

// Small, controllable quota so the over-quota boundary is testable.
vi.mock('../../src/config', () => ({
    config: { objectStorage: { quotaBytes: 1000 } },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/pageTokenRecovery', () => ({
    handlePageTokenFailure: vi.fn().mockResolvedValue(null),
    // Pass-through by default so the Instagram tests exercise the real call; the
    // recovery behaviour itself is covered in pageTokenRecovery.test.ts.
    withPageTokenRetry: vi.fn(async (page: { accessToken: string }, call: (t: string) => Promise<unknown>) => call(page.accessToken)),
}));

// Import after mocking
const { facebookService } = await import('../../src/services/facebook');
const { instagramService } = await import('../../src/services/instagram');
const { imageStorage } = await import('../../src/services/imageStorage');
const { captureError } = await import('../../src/utils/sentryHelpers');
const { notificationService } = await import('../../src/services/notifications');
const { handlePageTokenFailure, withPageTokenRetry } = await import('../../src/services/pageTokenRecovery');

/** Column names referenced anywhere in a drizzle WHERE clause. Walks `queryChunks`
 *  rather than serializing (drizzle's column objects point back at their table, so
 *  JSON.stringify hits a cycle) — lets a test assert that a query is page-scoped. */
function columnsIn(clause: unknown): string[] {
    const names: string[] = [];
    const seen = new Set<unknown>();
    (function walk(node: unknown) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const rec = node as Record<string, unknown>;
        if (typeof rec.name === 'string' && 'table' in rec) names.push(rec.name);
        for (const value of [rec.queryChunks, rec.left, rec.right, rec.value]) {
            if (Array.isArray(value)) value.forEach(walk);
            else walk(value);
        }
    })(clause);
    return names;
}

/** A db.select() chain that resolves at `.from().innerJoin().where()` to `rows`. */
function selectInnerJoinWhere(rows: unknown) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(rows),
            }),
        }),
    };
}

/** Chainable mock helpers */
function mockInsertChain(returnValue: any) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([returnValue]),
        }),
    };
}

function mockUpdateChain(returnValue: any) {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([returnValue]),
            }),
        }),
    };
}

function mockDeleteChain() {
    return {
        where: vi.fn().mockResolvedValue(undefined),
    };
}

/** Ownership check: SELECT ... FROM posts INNER JOIN pages WHERE ... */
function mockOwnershipSelectChain(found: boolean) {
    const row = found ? [{ id: 'post-1' }] : [];
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(row),
            }),
        }),
    };
}

function mockSelectChain(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(returnValue),
        }),
    };
}

function mockSelectWithJoinAndOrder(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(returnValue),
                }),
            }),
        }),
    };
}

function mockSelectWithInnerJoinAndOrder(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    orderBy: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue(returnValue),
                    }),
                }),
            }),
        }),
    };
}

const samplePost = {
    id: 'post-1',
    pageId: 'page-1',
    facebookPostId: 'fb-post-1',
    message: 'Hello world',
    autoReplyEnabled: true,
    createdTime: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('PostsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: nothing scheduled. Tests about scheduling override these; every other
        // test exercises a Graph that reports no pending posts and no schedule.
        vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({ posts: [], failed: false, truncated: false });
        vi.mocked(facebookService.getPostSchedule).mockResolvedValue({ isPublished: true, scheduledPublishTime: null });
    });

    describe('createPost', () => {
        it('should create a post and return it', async () => {
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(samplePost) as any);

            const result = await postsService.createPost({
                pageId: 'page-1',
                facebookPostId: 'fb-post-1',
                message: 'Hello world',
            });

            expect(result).toEqual(samplePost);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });

        it('should default autoReplyEnabled to true', async () => {
            const chain = mockInsertChain(samplePost);
            vi.mocked(db.insert).mockReturnValue(chain as any);

            await postsService.createPost({
                pageId: 'page-1',
                facebookPostId: 'fb-post-1',
            });

            expect(chain.values).toHaveBeenCalledWith(
                expect.objectContaining({ autoReplyEnabled: true }),
            );
        });
    });

    describe('getPostsByPage', () => {
        it('should return posts ordered by createdAt desc', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectWithJoinAndOrder([samplePost]) as any);

            const result = await postsService.getPostsByPage('page-1');

            expect(result).toEqual([samplePost]);
            expect(db.select).toHaveBeenCalledTimes(1);
        });
    });

    describe('getPostsByWorkspace', () => {
        it('should return posts with page names', async () => {
            const postsWithPage = [{ ...samplePost, pageName: 'My Page' }];
            vi.mocked(db.select).mockReturnValue(mockSelectWithInnerJoinAndOrder(postsWithPage) as any);

            const result = await postsService.getPostsByWorkspace('workspace-1');

            expect(result).toEqual(postsWithPage);
        });
    });

    describe('getPost', () => {
        it('should return post by ID', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([samplePost]) as any);

            const result = await postsService.getPost('post-1');

            expect(result).toEqual(samplePost);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

            const result = await postsService.getPost('missing');

            expect(result).toBeNull();
        });
    });

    describe('getPostByFacebookId', () => {
        // `pageId` is a REQUIRED argument: facebook_post_id is globally unique, so an
        // unscoped lookup on a caller-influenced path returns another workspace's row.
        it('should return post by Facebook ID within the page', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([samplePost]) as any);

            const result = await postsService.getPostByFacebookId('fb-post-1', 'page-1');

            expect(result).toEqual(samplePost);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

            const result = await postsService.getPostByFacebookId('missing', 'page-1');

            expect(result).toBeNull();
        });
    });

    describe('updatePost', () => {
        it('should update and return the post', async () => {
            const updated = { ...samplePost, message: 'Updated' };
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(updated) as any);

            const result = await postsService.updatePost('post-1', { message: 'Updated' });

            expect(result).toEqual(updated);
        });
    });

    describe('deletePost', () => {
        it('should delete the post when workspace owns it', async () => {
            vi.mocked(db.select).mockReturnValue(mockOwnershipSelectChain(true) as any);
            vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

            const result = await postsService.deletePost('post-1', 'workspace-1');

            expect(result).toBe(true);
            expect(db.delete).toHaveBeenCalledTimes(1);
        });

        it('should return false when post not owned by workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockOwnershipSelectChain(false) as any);

            const result = await postsService.deletePost('post-1', 'other-workspace');

            expect(result).toBe(false);
            expect(db.delete).not.toHaveBeenCalled();
        });
    });

    describe('toggleAutoReply', () => {
        it('should toggle auto-reply and return the post', async () => {
            const toggled = { ...samplePost, autoReplyEnabled: false };
            vi.mocked(db.select).mockReturnValue(mockOwnershipSelectChain(true) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(toggled) as any);

            const result = await postsService.toggleAutoReply('post-1', false, 'workspace-1');

            expect(result).toEqual(toggled);
        });

        it('should return null when post not owned by workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockOwnershipSelectChain(false) as any);

            const result = await postsService.toggleAutoReply('post-1', false, 'other-workspace');

            expect(result).toBeNull();
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('findOrCreateFromWebhook', () => {
        it('should return existing post if found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([samplePost]) as any);

            const result = await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1');

            expect(result).toEqual(samplePost);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should create post if not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(samplePost) as any);

            const result = await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1', 'Post text');

            expect(result).toEqual(samplePost);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });

        it('should fetch post content from Facebook when no message and token provided', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(samplePost) as any);
            vi.mocked(facebookService.getPostContent).mockResolvedValue('Fetched content');

            await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1', undefined, 'access-token');

            expect(facebookService.getPostContent).toHaveBeenCalledWith('fb-post-1', 'access-token');
        });

        it('should update existing post with fetched content when message is missing', async () => {
            const postWithoutMsg = { ...samplePost, message: null };
            vi.mocked(db.select).mockReturnValue(mockSelectChain([postWithoutMsg]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain({ ...samplePost, message: 'Fetched' }) as any);
            vi.mocked(facebookService.getPostContent).mockResolvedValue('Fetched');

            const result = await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1', undefined, 'token');

            expect(facebookService.getPostContent).toHaveBeenCalled();
            expect(db.update).toHaveBeenCalled();
            expect(result.message).toBe('Fetched');
        });

        it('recovers the winning row when a concurrent insert for the same page wins the race', async () => {
            // The shape drizzle ACTUALLY throws: the SQLSTATE is on `.cause`, not on the
            // error itself. A flat `{ code: '23505' }` is a fiction that passed against the
            // old `err.code` check while production never entered the branch at all.
            const uniqueViolation = Object.assign(new Error('Failed query: insert into "posts"'), {
                cause: Object.assign(new Error('duplicate key'), { name: 'PostgresError', code: '23505' }),
            });
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([]) as any)            // scoped lookup: miss
                .mockReturnValueOnce(mockSelectChain([samplePost]) as any); // re-select after 23505: same-page row won
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(uniqueViolation) }),
            } as any);

            const result = await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1', 'text');

            expect(result).toEqual(samplePost);
            expect(captureError).not.toHaveBeenCalled();
        });

        it('adopts an UNOWNED row (page_id NULL) instead of stranding every comment on it', async () => {
            // posts.page_id is nullable and was only ever required by DTO convention, so
            // legacy/manual rows can have none. They belong to no workspace — rejecting
            // them would make this function throw on the per-comment path forever, losing
            // every comment on that post.
            // The shape drizzle ACTUALLY throws: the SQLSTATE is on `.cause`, not on the
            // error itself. A flat `{ code: '23505' }` is a fiction that passed against the
            // old `err.code` check while production never entered the branch at all.
            const uniqueViolation = Object.assign(new Error('Failed query: insert into "posts"'), {
                cause: Object.assign(new Error('duplicate key'), { name: 'PostgresError', code: '23505' }),
            });
            const orphanRow = { ...samplePost, pageId: null };
            const adopted = { ...samplePost, pageId: 'page-1' };
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([]) as any)           // scoped lookup: miss
                .mockReturnValueOnce(mockSelectChain([]) as any)           // scoped re-select after 23505: miss
                .mockReturnValueOnce(mockSelectChain([orphanRow]) as any); // unscoped probe: unowned row
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(uniqueViolation) }),
            } as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(adopted) as any);

            const result = await postsService.findOrCreateFromWebhook('page-1', 'fb-post-1', 'text');

            expect(result).toEqual(adopted);
            expect(captureError).not.toHaveBeenCalled();
        });

        it('throws PostNotOwnedError when the row is OWNED by another page (cross-tenant probe)', async () => {
            // facebook_post_id is globally unique: a page-scoped miss + 23505 + scoped
            // re-miss + a conflicting row with a different page_id can only mean the row is
            // another page's — must NOT be returned.
            // The shape drizzle ACTUALLY throws: the SQLSTATE is on `.cause`, not on the
            // error itself. A flat `{ code: '23505' }` is a fiction that passed against the
            // old `err.code` check while production never entered the branch at all.
            const uniqueViolation = Object.assign(new Error('Failed query: insert into "posts"'), {
                cause: Object.assign(new Error('duplicate key'), { name: 'PostgresError', code: '23505' }),
            });
            const foreignRow = { ...samplePost, pageId: 'page-someone-else' };
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([]) as any)            // scoped lookup: miss
                .mockReturnValueOnce(mockSelectChain([]) as any)            // scoped re-select: still miss
                .mockReturnValueOnce(mockSelectChain([foreignRow]) as any); // unscoped probe: owned elsewhere
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(uniqueViolation) }),
            } as any);

            await expect(postsService.findOrCreateFromWebhook('page-1', 'fb-post-foreign', 'text'))
                .rejects.toBeInstanceOf(PostNotOwnedError);
            expect(captureError).toHaveBeenCalledWith(uniqueViolation, expect.any(String), expect.objectContaining({
                fingerprint: ['post-ensure-foreign-post'],
                tags: { pageId: 'page-1' },
            }));
            // The row was never adopted — no page_id was rewritten on someone else's post.
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('findOrCreateInstagramMedia', () => {
        const media = { id: 'ig-row-1', instagramMediaId: 'ig-media-1', caption: 'cap', autoReplyEnabled: true, triggerKeyword: null, triggerReply: null, triggerType: 'keyword' };

        it('returns the existing media row without inserting', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([media]) as any);

            const result = await postsService.findOrCreateInstagramMedia('page-1', 'ig-media-1');

            expect(result).toEqual(media);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('creates the media row when absent', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(media) as any);

            const result = await postsService.findOrCreateInstagramMedia('page-1', 'ig-media-1');

            expect(result).toEqual(media);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });
    });

    describe('ensureContent', () => {
        const page = { id: 'page-1', facebookPageId: 'fb1', instagramAccountId: 'ig1', accessToken: 'tok' };

        it('routes facebook through findOrCreateFromWebhook and returns trigger fields incl. image URL', async () => {
            // Regression: the picker flow (ensureContent) must return triggerImageUrl so the
            // edit modal reopens with the saved image (was dropped → looked "not saved").
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ ...samplePost, triggerKeyword: 'سعر', triggerReply: 'تفضل', triggerType: 'keyword', triggerImageUrl: 'https://cdn/x.jpg' }]) as any);

            const result = await postsService.ensureContent(page, 'facebook', 'fb-post-1');

            // samplePost mock omits like_comment; ensureContent defaults it to false (matches the DB NOT NULL DEFAULT).
            expect(result).toEqual({ id: 'post-1', triggerKeyword: 'سعر', triggerReply: 'تفضل', triggerType: 'keyword', triggerExcludeKeyword: null, triggerImageUrl: 'https://cdn/x.jpg', likeComment: false, tagCommenter: false, triggerButtonLabel: null, triggerButtonUrl: null, scheduledPublishTime: null });
        });

        it('routes instagram through findOrCreateInstagramMedia (image URL null when absent)', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all' }]) as any);

            const result = await postsService.ensureContent(page, 'instagram', 'ig-media-1');

            expect(result).toEqual({ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all', triggerExcludeKeyword: null, triggerImageUrl: null, likeComment: false, tagCommenter: false, triggerButtonLabel: null, triggerButtonUrl: null, scheduledPublishTime: null });
            // No Instagram scheduled-media edge exists — never probe Graph for one.
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
        });

        it('records the scheduled publish time from Graph when arming a not-yet-live post', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ ...samplePost, scheduledPublishTime: null }]) as any);
            const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
            vi.mocked(db.update).mockReturnValue({ set: setSpy } as any);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue({
                isPublished: false,
                scheduledPublishTime: '2026-08-10T09:00:00.000Z',
            });

            const result = await postsService.ensureContent(page, 'facebook', 'fb-post-1');

            expect(result.scheduledPublishTime).toBe('2026-08-10T09:00:00.000Z');
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
                scheduledPublishTime: new Date('2026-08-10T09:00:00.000Z'),
            }));
        });

        it('clears a stale marker when Graph reports the post already published', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([
                { ...samplePost, scheduledPublishTime: new Date('2026-08-01T09:00:00.000Z') },
            ]) as any);
            const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
            vi.mocked(db.update).mockReturnValue({ set: setSpy } as any);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue({ isPublished: true, scheduledPublishTime: null });

            const result = await postsService.ensureContent(page, 'facebook', 'fb-post-1');

            expect(result.scheduledPublishTime).toBeNull();
            expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ scheduledPublishTime: null }));
        });

        it('keeps the stored marker when Graph cannot answer — unknown must not read as published', async () => {
            // A token blip clearing the marker would silently disarm the id-drift tripwire.
            const stored = new Date('2026-08-10T09:00:00.000Z');
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ ...samplePost, scheduledPublishTime: stored }]) as any);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue(null);

            const result = await postsService.ensureContent(page, 'facebook', 'fb-post-1');

            expect(result.scheduledPublishTime).toBe(stored.toISOString());
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    describe('listPublishedPosts', () => {
        const page = { id: 'page-1', facebookPageId: 'fb1', instagramAccountId: 'ig1', accessToken: 'tok' };

        it('merges facebook trigger state onto the Graph listing', async () => {
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [
                    { id: 'fb_A', message: 'armed post', imageUrl: 'img', createdTime: '2026-07-01', commentsCount: 3 },
                    { id: 'fb_B', message: 'plain post', imageUrl: null, createdTime: '2026-06-01', commentsCount: 0 },
                ],
                nextCursor: 'CUR',
            });
            // Only fb_A has a stored trigger (any-comment mode).
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ fbId: 'fb_A', triggerType: 'all' }]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(result.nextCursor).toBe('CUR');
            expect(result.partial).toBe(false);
            expect(result.posts).toEqual([
                { platformPostId: 'fb_A', source: 'facebook', message: 'armed post', imageUrl: 'img', createdTime: '2026-07-01', commentsCount: 3, hasTrigger: true, triggerType: 'all', scheduledPublishTime: null, isScheduled: false },
                { platformPostId: 'fb_B', source: 'facebook', message: 'plain post', imageUrl: null, createdTime: '2026-06-01', commentsCount: 0, hasTrigger: false, triggerType: null, scheduledPublishTime: null, isScheduled: false },
            ]);
        });

        it('recovers a dead page token and re-reads, instead of showing an empty picker', async () => {
            // 2026-08-14: this exact path answered «لا توجد منشورات حديثة» while the
            // real cause was a revoked credential (190/460). Both Graph reads fail
            // SOFT, so the recovery hangs off the returned `error`, not a throw.
            const tokenError = { isAxiosError: true, response: { status: 400, data: { error: { code: 190, error_subcode: 460 } } } };
            vi.mocked(facebookService.getPagePosts)
                .mockResolvedValueOnce({ posts: [], nextCursor: null, failed: true, error: tokenError } as any)
                .mockResolvedValueOnce({ posts: [{ id: 'fb_A', message: 'back', imageUrl: null, createdTime: '2026-08-14', commentsCount: 0 }], nextCursor: null, failed: false } as any);
            vi.mocked(handlePageTokenFailure).mockResolvedValue('fresh-token');
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(handlePageTokenFailure).toHaveBeenCalledWith('page-1', tokenError);
            // Re-read used the FRESH token, not the dead one.
            expect(vi.mocked(facebookService.getPagePosts).mock.calls[1][1]).toBe('fresh-token');
            expect(result.posts).toHaveLength(1);
            expect(result.partial).toBe(false);
        });

        it('does not re-read when recovery is impossible — one attempt, still `partial`', async () => {
            const tokenError = { isAxiosError: true, response: { status: 400, data: { error: { code: 190, error_subcode: 460 } } } };
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null, failed: true, error: tokenError } as any);
            vi.mocked(handlePageTokenFailure).mockResolvedValue(null);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(facebookService.getPagePosts).toHaveBeenCalledTimes(1);
            expect(result.partial).toBe(true);
        });

        it('does NOT read the scheduled edge unless the client opts in', async () => {
            // A shipped mobile bundle that predates scheduled posts must keep getting the
            // list it knows how to render — it would show one as published with no date.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(facebookService.getScheduledPosts).not.toHaveBeenCalled();
        });

        it('puts scheduled posts first, soonest-first, with no publish date or comment count', async () => {
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [{ id: 'fb_live', message: 'published', imageUrl: null, createdTime: '2026-07-01', commentsCount: 2 }],
                nextCursor: null,
            } as any);
            // Graph's order on the scheduled edge is unspecified — hand it back-to-front.
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({
                posts: [
                    { id: 'fb_later', message: 'next week', imageUrl: null, scheduledPublishTime: '2026-08-20T09:00:00.000Z' },
                    { id: 'fb_soon', message: 'tomorrow', imageUrl: 'img', scheduledPublishTime: '2026-08-05T09:00:00.000Z' },
                ],
                failed: false,
                truncated: false,
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ fbId: 'fb_soon', triggerType: 'keyword' }]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            expect(result.posts.map(p => p.platformPostId)).toEqual(['fb_soon', 'fb_later', 'fb_live']);
            expect(result.posts[0]).toEqual({
                platformPostId: 'fb_soon', source: 'facebook', message: 'tomorrow', imageUrl: 'img',
                createdTime: null, commentsCount: null,
                hasTrigger: true, triggerType: 'keyword',
                scheduledPublishTime: '2026-08-05T09:00:00.000Z',
                isScheduled: true,
            });
        });

        it('drops a scheduled twin of a post that is already in the published page', async () => {
            // At the publish boundary Graph can return the post on both edges; listing it
            // twice would render one post twice under a single React key.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [{ id: 'fb_both', message: 'just went live', imageUrl: null, createdTime: '2026-08-04', commentsCount: 0 }],
                nextCursor: null,
            } as any);
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({
                posts: [{ id: 'fb_both', message: 'just went live', imageUrl: null, scheduledPublishTime: '2026-08-04T09:00:00.000Z' }],
                failed: false,
                truncated: false,
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            // Exactly once, and as the PUBLISHED copy (it is live — the truthful state).
            expect(result.posts).toHaveLength(1);
            expect(result.posts[0]).toMatchObject({ platformPostId: 'fb_both', scheduledPublishTime: null, createdTime: '2026-08-04', isScheduled: false });
        });

        it('does not re-fetch scheduled posts on "load more" pages', async () => {
            // They are a bounded set pinned to the top; refetching would duplicate them
            // on every page and needs a second cursor to page independently.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            await postsService.listPublishedPosts(page, { source: 'facebook', after: 'CURSOR', includeScheduled: true });

            expect(facebookService.getScheduledPosts).not.toHaveBeenCalled();
        });

        it('runs the Instagram read through token recovery — same credential, and this path THROWS', async () => {
            // IG is columns on the page row, not a separate credential: one revoked
            // session kills both sources. This read throws (the controller 500s and
            // the app shows «حدث خطأ ما»), so it must go through the retry wrapper.
            vi.mocked(instagramService.getMedia).mockResolvedValue({ media: [], nextCursor: null } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            await postsService.listPublishedPosts(page, { source: 'instagram' });

            expect(withPageTokenRetry).toHaveBeenCalledWith(page, expect.any(Function));

            // The callback must USE the token the wrapper hands it — a callback
            // that closes over `page.accessToken` passes the wiring assertion
            // above while making the retry a no-op (mutation-checked: the
            // `() => getMedia(id, page.accessToken)` variant fails only here).
            const wrapped = vi.mocked(withPageTokenRetry).mock.calls[0][1];
            vi.mocked(instagramService.getMedia).mockClear();
            await wrapped('fresh-ig-token');
            expect(instagramService.getMedia).toHaveBeenCalledWith('ig1', 'fresh-ig-token', expect.any(Object));
        });

        it('does NOT treat a scheduled-edge failure as a page-credential verdict', async () => {
            // `/scheduled_posts` needs manage-level permission the published edge
            // does not, so it can fail 200|10 while the same token serves replies
            // fine. Feeding that to recovery could clear a WORKING page token
            // (dead user token → markPageNeedsReconnect). Scheduled-only failure
            // keeps its pre-existing answer: `partial: true`, no recovery.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [{ id: 'fb_ok', message: 'alive', imageUrl: null, createdTime: '2026-08-01', commentsCount: 0 }],
                nextCursor: null, failed: false,
            } as any);
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({
                posts: [], failed: true, truncated: false,
                error: { isAxiosError: true, response: { status: 400, data: { error: { code: 200, error_subcode: 10 } } } },
            } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            expect(handlePageTokenFailure).not.toHaveBeenCalled();
            expect(result.partial).toBe(true);
            expect(result.posts).toHaveLength(1);
        });

        it('maps instagram media (thumbnail preferred) and merges trigger state', async () => {
            vi.mocked(instagramService.getMedia).mockResolvedValue({
                media: [
                    { id: 'ig_A', media_type: 'VIDEO', caption: 'reel', media_url: 'video.mp4', thumbnail_url: 'poster.jpg', timestamp: '2026-07-02', comments_count: 5 },
                ],
                nextCursor: null,
            } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'instagram' });

            expect(result.posts[0]).toEqual({
                platformPostId: 'ig_A', source: 'instagram', message: 'reel',
                imageUrl: 'poster.jpg', createdTime: '2026-07-02', commentsCount: 5,
                hasTrigger: false, triggerType: null,
                // Explicit on BOTH sources, so the field means the same thing everywhere.
                scheduledPublishTime: null, isScheduled: false,
            });
        });

        it('marks the list partial when the scheduled read FAILED, instead of showing none', async () => {
            // The picker degrades a failed Graph read to "no scheduled posts". Without this
            // flag a broken token is indistinguishable from "I have nothing scheduled" —
            // which is exactly the conflation getScheduledPosts' `failed` exists to prevent.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null } as any);
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({ posts: [], failed: true, truncated: false });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            expect(result.partial).toBe(true);
        });

        it('marks the list partial when the scheduled edge was TRUNCATED', async () => {
            // A merchant silently unable to arm their 26th pending post is the same defect
            // in a quieter form — no silent caps.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null } as any);
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({
                posts: [{ id: 'fb_s', message: null, imageUrl: null, scheduledPublishTime: '2026-08-05T09:00:00.000Z' }],
                failed: false,
                truncated: true,
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            expect(result.partial).toBe(true);
        });

        it('still lists a pending post Graph gave no publish time for, as pending', async () => {
            // Inferring "published" from a missing timestamp would render it as live with
            // no date and no notice — the exact misreading this feature exists to prevent.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [{ id: 'fb_live', message: 'live', imageUrl: null, createdTime: '2026-07-01', commentsCount: 0 }],
                nextCursor: null,
            } as any);
            vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({
                posts: [
                    { id: 'fb_no_time', message: 'no time', imageUrl: null, scheduledPublishTime: null },
                    { id: 'fb_timed', message: 'timed', imageUrl: null, scheduledPublishTime: '2026-08-05T09:00:00.000Z' },
                ],
                failed: false,
                truncated: false,
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook', includeScheduled: true });

            // Timed first (it can be ordered), then the unknown one, then the published page.
            expect(result.posts.map(p => p.platformPostId)).toEqual(['fb_timed', 'fb_no_time', 'fb_live']);
            expect(result.posts[1]).toMatchObject({ isScheduled: true, scheduledPublishTime: null });
        });

        it('scopes the trigger-state lookup to the page', async () => {
            // Same shape as the cross-tenant read the ensure path closed: facebook_post_id
            // is globally unique, so this must not be a bare inArray on it.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({
                posts: [{ id: 'fb_A', message: 'p', imageUrl: null, createdTime: '2026-07-01', commentsCount: 0 }],
                nextCursor: null,
            } as any);
            const whereSpy = vi.fn().mockResolvedValue([]);
            vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue({ where: whereSpy }) } as any);

            await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(columnsIn(whereSpy.mock.calls[0][0])).toContain('page_id');
        });

        it('returns an empty page when the requested source is not connected', async () => {
            const fbOnly = { id: 'page-1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' };
            const result = await postsService.listPublishedPosts(fbOnly, { source: 'instagram' });
            expect(result).toEqual({ posts: [], nextCursor: null, partial: false });
            expect(instagramService.getMedia).not.toHaveBeenCalled();
        });
    });

    describe('staleMarkerCutoff', () => {
        // The grace window used to live only inside a SQL predicate, which meant every
        // test of it asserted against a mock it had stipulated itself. Pure function =
        // the boundary is actually checked.
        it('is exactly one grace window behind the given time', () => {
            const now = new Date('2026-08-04T12:00:00.000Z');
            expect(staleMarkerCutoff(now).toISOString()).toBe('2026-08-04T11:30:00.000Z');
            expect(now.getTime() - staleMarkerCutoff(now).getTime()).toBe(SCHEDULED_MARKER_GRACE_MS);
        });
    });

    describe('onPostPublished', () => {
        /** `db.update().set().where()` (+ `.returning()` on the first clear) and the
         *  overdue-marker SELECT. The SELECT returns whatever rows the test supplies —
         *  the service re-applies the grace cutoff in memory, so a row inside the window
         *  is filtered by real logic here, not by a stipulated empty array. */
        function mockPublishChains(clearedRows: unknown[], overdueRows: unknown[]) {
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue(clearedRows),
                        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
                    }),
                }),
            } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(overdueRows) }),
            } as any);
        }

        /** An armed row whose marker is `minutesPast` minutes beyond the grace window. */
        function overdueRow(id: string, fbId: string, minutesPastGrace: number) {
            return {
                id,
                fbId,
                scheduledPublishTime: new Date(Date.now() - SCHEDULED_MARKER_GRACE_MS - minutesPastGrace * 60_000),
            };
        }

        it('clears the marker for the post that went live', async () => {
            mockPublishChains([{ id: 'post-1' }], []);

            const result = await postsService.onPostPublished('page-1', 'fb_scheduled');

            expect(result).toEqual({ cleared: true, orphanedPostIds: [], healedPostIds: [], uncheckedPostIds: [] });
            expect(captureError).not.toHaveBeenCalled();
        });

        it('reports drift only after Graph CONFIRMS the armed post is still pending', async () => {
            // The scheduled post published under a NEW id: its own row keeps an overdue
            // marker, and Graph still reports it unpublished — the trigger is orphaned.
            mockPublishChains([], [overdueRow('post-9', 'fb_armed_old', 10)]);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue({
                isPublished: false,
                scheduledPublishTime: '2026-08-01T09:00:00.000Z',
            });

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', {
                accessToken: 'tok', workspaceId: 'ws-1', pageName: 'Test Page',
            });

            expect(result.orphanedPostIds).toEqual(['fb_armed_old']);
            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Post Reply armed on a scheduled post may be orphaned',
                expect.objectContaining({
                    level: 'warning',
                    // Per page: one global fingerprint would collapse every merchant's
                    // drift into a single Sentry issue.
                    fingerprint: ['post-reply-scheduled-id-drift', 'page-1'],
                    tags: { pageId: 'page-1' },
                    extra: expect.objectContaining({ publishedPostId: 'fb_fresh', orphanedPostIds: ['fb_armed_old'] }),
                }),
            );
            // The merchant is the only one who can re-arm the post, so Sentry is not enough.
            expect(notificationService.sendTemplateNotificationToWorkspace).toHaveBeenCalledWith(
                'ws-1', 'post_reply_orphaned', { pageName: 'Test Page' },
                expect.objectContaining({ orphanedPostIds: ['fb_armed_old'] }),
            );
        });

        it('heals a marker whose publish webhook we simply missed, and stays quiet', async () => {
            // The far likelier cause of an overdue marker: the post DID publish under its
            // own id and our clear-webhook never arrived. Alarming on this would make the
            // tripwire fire on every later publish, forever, with no way to clear it.
            mockPublishChains([], [overdueRow('post-9', 'fb_armed_old', 90)]);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue({
                isPublished: true, scheduledPublishTime: null,
            });

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', { accessToken: 'tok', workspaceId: 'ws-1' });

            expect(result.healedPostIds).toEqual(['fb_armed_old']);
            expect(result.orphanedPostIds).toEqual([]);
            expect(captureError).not.toHaveBeenCalled();
            expect(notificationService.sendTemplateNotificationToWorkspace).not.toHaveBeenCalled();
        });

        it('stays quiet when Graph cannot answer — unknown is not proof of drift', async () => {
            mockPublishChains([], [overdueRow('post-9', 'fb_armed_old', 30)]);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue(null);

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', { accessToken: 'tok', workspaceId: 'ws-1' });

            expect(result).toMatchObject({ orphanedPostIds: [], healedPostIds: [] });
            expect(captureError).not.toHaveBeenCalled();
        });

        it('never reports the post that just published as its own orphan', async () => {
            mockPublishChains([{ id: 'post-1' }], [overdueRow('post-1', 'fb_fresh', 45)]);

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', { accessToken: 'tok' });

            expect(result.orphanedPostIds).toEqual([]);
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
        });

        it('ignores a marker still INSIDE the grace window (real cutoff, not a stubbed empty set)', async () => {
            // The SQL bound would normally exclude this row; the in-memory re-check means
            // the grace logic is exercised even with a mocked database.
            const withinGrace = {
                id: 'post-9',
                fbId: 'fb_armed_old',
                scheduledPublishTime: new Date(Date.now() - SCHEDULED_MARKER_GRACE_MS / 2),
            };
            mockPublishChains([], [withinGrace]);

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', { accessToken: 'tok' });

            expect(result.orphanedPostIds).toEqual([]);
            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
            expect(captureError).not.toHaveBeenCalled();
        });

        it('caps the Graph re-checks and reports the remainder as unchecked, never as fine', async () => {
            const rows = Array.from({ length: SCHEDULED_MARKER_RECHECK_MAX + 2 }, (_, i) =>
                overdueRow(`post-${i}`, `fb_old_${i}`, 60),
            );
            mockPublishChains([], rows);
            vi.mocked(facebookService.getPostSchedule).mockResolvedValue({ isPublished: true, scheduledPublishTime: null });

            const result = await postsService.onPostPublished('page-1', 'fb_fresh', { accessToken: 'tok' });

            expect(facebookService.getPostSchedule).toHaveBeenCalledTimes(SCHEDULED_MARKER_RECHECK_MAX);
            expect(result.uncheckedPostIds).toEqual(['fb_old_5', 'fb_old_6']);
        });

        it('checks nothing without a token, rather than alarming on unverified markers', async () => {
            mockPublishChains([], [overdueRow('post-9', 'fb_armed_old', 60)]);

            const result = await postsService.onPostPublished('page-1', 'fb_fresh');

            expect(facebookService.getPostSchedule).not.toHaveBeenCalled();
            expect(result.orphanedPostIds).toEqual([]);
            expect(result.uncheckedPostIds).toEqual(['fb_armed_old']);
            expect(captureError).not.toHaveBeenCalled();
        });
    });

    describe('updateTrigger — image handling', () => {
        // Capture the columns written by db.update(...).set(...)
        let setSpy: ReturnType<typeof vi.fn>;
        beforeEach(() => {
            setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
            vi.mocked(db.update).mockReturnValue({ set: setSpy } as any);
            vi.mocked(imageStorage.put).mockResolvedValue({ url: 'https://cdn/new.jpg', key: 'trigger-images/ws-1/new.jpg' });
            vi.mocked(imageStorage.remove).mockResolvedValue(true);
        });

        const owned = (over?: Partial<{ imageKey: string | null; imageBytes: number | null }>) =>
            [{ id: 'post-1', imageKey: over?.imageKey ?? null, imageBytes: over?.imageBytes ?? null }];

        it('returns not_found when the row is not owned', async () => {
            vi.mocked(db.select).mockReturnValueOnce(selectInnerJoinWhere([]) as any);
            const res = await postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', image: { action: 'keep' } });
            expect(res).toEqual({ ok: false, reason: 'not_found' });
        });

        it('set: uploads first, writes the new columns, deletes the OLD key AFTER commit', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(selectInnerJoinWhere(owned({ imageKey: 'trigger-images/ws-1/old.jpg', imageBytes: 500 })) as any) // ownership
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any)   // posts sum
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any);  // ig sum

            const res = await postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'عرض', triggerType: 'keyword', image: { action: 'set', buffer: Buffer.alloc(100), mimeType: 'image/jpeg' } });

            expect(res).toEqual({ ok: true });
            expect(imageStorage.put).toHaveBeenCalledOnce();
            const cols = setSpy.mock.calls[0][0];
            expect(cols).toMatchObject({ triggerImageUrl: 'https://cdn/new.jpg', triggerImageKey: 'trigger-images/ws-1/new.jpg', triggerImageBytes: 100 });
            // old key swept only after the DB write
            expect(imageStorage.remove).toHaveBeenCalledWith('trigger-images/ws-1/old.jpg');
        });

        it('set: rejects with quota_exceeded and never uploads when over the cap', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(selectInnerJoinWhere(owned()) as any)              // ownership
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '900' }]) as any)   // posts sum
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any);    // ig sum (quota=1000)

            const res = await postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', image: { action: 'set', buffer: Buffer.alloc(200), mimeType: 'image/jpeg' } });

            expect(res).toEqual({ ok: false, reason: 'quota_exceeded' });
            expect(imageStorage.put).not.toHaveBeenCalled();
            expect(setSpy).not.toHaveBeenCalled();
        });

        it('set: an upload failure aborts the save (no DB write) and is captured', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(selectInnerJoinWhere(owned({ imageKey: 'old', imageBytes: 10 })) as any)
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any)
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any);
            vi.mocked(imageStorage.put).mockRejectedValueOnce(new Error('S3 down'));

            await expect(
                postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', image: { action: 'set', buffer: Buffer.alloc(50), mimeType: 'image/png' } }),
            ).rejects.toThrow('S3 down');

            // Old image untouched: no DB update, no delete of the old key.
            expect(setSpy).not.toHaveBeenCalled();
            expect(imageStorage.remove).not.toHaveBeenCalled();
            expect(captureError).toHaveBeenCalled();
        });

        it('remove: nulls the columns and deletes the old key', async () => {
            vi.mocked(db.select).mockReturnValueOnce(selectInnerJoinWhere(owned({ imageKey: 'trigger-images/ws-1/x.jpg', imageBytes: 40 })) as any);
            const res = await postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', image: { action: 'remove' } });
            expect(res).toEqual({ ok: true });
            expect(setSpy.mock.calls[0][0]).toMatchObject({ triggerImageUrl: null, triggerImageKey: null, triggerImageBytes: null });
            expect(imageStorage.remove).toHaveBeenCalledWith('trigger-images/ws-1/x.jpg');
        });

        it('keep with an existing image: leaves the image columns untouched', async () => {
            vi.mocked(db.select).mockReturnValueOnce(selectInnerJoinWhere(owned({ imageKey: 'has-image', imageBytes: 100 })) as any);
            const res = await postsService.updateTrigger({ contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1', triggerKeyword: 'k', triggerReply: 'x'.repeat(160), triggerType: 'keyword', image: { action: 'keep' } });
            expect(res).toEqual({ ok: true });
            expect(imageStorage.put).not.toHaveBeenCalled();
            // image columns not in the update set (keep)
            expect(setSpy.mock.calls[0][0]).not.toHaveProperty('triggerImageKey');
        });

        it('button + NO image + reply over 640 → button_text_too_long (button template cap)', async () => {
            vi.mocked(db.select).mockReturnValueOnce(selectInnerJoinWhere(owned()) as any); // no stored image
            const res = await postsService.updateTrigger({
                contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1',
                triggerKeyword: 'k', triggerReply: 'x'.repeat(641), triggerType: 'keyword',
                image: { action: 'keep' }, triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example',
            });
            expect(res).toEqual({ ok: false, reason: 'button_text_too_long' });
            expect(setSpy).not.toHaveBeenCalled();
        });

        it('button + a NEW image + reply over 640 → allowed (rides the image card, full cap)', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(selectInnerJoinWhere(owned()) as any)
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any)
                .mockReturnValueOnce(selectInnerJoinWhere([{ total: '0' }]) as any);
            const res = await postsService.updateTrigger({
                contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1',
                triggerKeyword: 'k', triggerReply: 'x'.repeat(700), triggerType: 'keyword',
                image: { action: 'set', buffer: Buffer.alloc(100), mimeType: 'image/jpeg' },
                triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example',
            });
            expect(res).toEqual({ ok: true });
        });

        it('writes the button columns on the facebook branch when intent is present', async () => {
            vi.mocked(db.select).mockReturnValueOnce(selectInnerJoinWhere(owned()) as any);
            await postsService.updateTrigger({
                contentId: 'post-1', source: 'facebook', workspaceId: 'ws-1',
                triggerKeyword: 'k', triggerReply: 'hi', triggerType: 'keyword', image: { action: 'keep' },
                triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example',
            });
            expect(setSpy.mock.calls[0][0]).toMatchObject({ triggerButtonLabel: 'Shop', triggerButtonUrl: 'https://shop.example' });
        });
    });
});

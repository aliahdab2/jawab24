import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postsService, PostNotOwnedError } from '../../src/services/posts';
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

// Import after mocking
const { facebookService } = await import('../../src/services/facebook');
const { instagramService } = await import('../../src/services/instagram');
const { imageStorage } = await import('../../src/services/imageStorage');
const { captureError } = await import('../../src/utils/sentryHelpers');

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
        vi.mocked(facebookService.getScheduledPosts).mockResolvedValue({ posts: [], failed: false });
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
        it('should return post by Facebook ID', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([samplePost]) as any);

            const result = await postsService.getPostByFacebookId('fb-post-1');

            expect(result).toEqual(samplePost);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

            const result = await postsService.getPostByFacebookId('missing');

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
            const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
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

        it('throws PostNotOwnedError when the post id belongs to another page (cross-tenant probe)', async () => {
            // facebook_post_id is globally unique: a page-scoped miss + 23505 + scoped
            // re-miss can only mean the row is another page's — must NOT be returned.
            const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectChain([]) as any)  // scoped lookup: miss
                .mockReturnValueOnce(mockSelectChain([]) as any); // re-select scoped: still miss → foreign row
            vi.mocked(db.insert).mockReturnValue({
                values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(uniqueViolation) }),
            } as any);

            await expect(postsService.findOrCreateFromWebhook('page-1', 'fb-post-foreign', 'text'))
                .rejects.toBeInstanceOf(PostNotOwnedError);
            expect(captureError).toHaveBeenCalledWith(uniqueViolation, expect.any(String), expect.objectContaining({
                fingerprint: ['post-ensure-foreign-post'],
            }));
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
            expect(result).toEqual({ id: 'post-1', triggerKeyword: 'سعر', triggerReply: 'تفضل', triggerType: 'keyword', triggerExcludeKeyword: null, triggerImageUrl: 'https://cdn/x.jpg', likeComment: false, triggerButtonLabel: null, triggerButtonUrl: null, scheduledPublishTime: null });
        });

        it('routes instagram through findOrCreateInstagramMedia (image URL null when absent)', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all' }]) as any);

            const result = await postsService.ensureContent(page, 'instagram', 'ig-media-1');

            expect(result).toEqual({ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all', triggerExcludeKeyword: null, triggerImageUrl: null, likeComment: false, triggerButtonLabel: null, triggerButtonUrl: null, scheduledPublishTime: null });
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
            expect(result.posts).toEqual([
                { platformPostId: 'fb_A', source: 'facebook', message: 'armed post', imageUrl: 'img', createdTime: '2026-07-01', commentsCount: 3, hasTrigger: true, triggerType: 'all', scheduledPublishTime: null },
                { platformPostId: 'fb_B', source: 'facebook', message: 'plain post', imageUrl: null, createdTime: '2026-06-01', commentsCount: 0, hasTrigger: false, triggerType: null, scheduledPublishTime: null },
            ]);
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
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ fbId: 'fb_soon', triggerType: 'keyword' }]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook' });

            expect(result.posts.map(p => p.platformPostId)).toEqual(['fb_soon', 'fb_later', 'fb_live']);
            expect(result.posts[0]).toEqual({
                platformPostId: 'fb_soon', source: 'facebook', message: 'tomorrow', imageUrl: 'img',
                createdTime: null, commentsCount: null,
                hasTrigger: true, triggerType: 'keyword',
                scheduledPublishTime: '2026-08-05T09:00:00.000Z',
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
            });
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            const result = await postsService.listPublishedPosts(page, { source: 'facebook' });

            // Exactly once, and as the PUBLISHED copy (it is live — the truthful state).
            expect(result.posts).toHaveLength(1);
            expect(result.posts[0]).toMatchObject({ platformPostId: 'fb_both', scheduledPublishTime: null, createdTime: '2026-08-04' });
        });

        it('does not re-fetch scheduled posts on "load more" pages', async () => {
            // They are a bounded set pinned to the top; refetching would duplicate them
            // on every page and needs a second cursor to page independently.
            vi.mocked(facebookService.getPagePosts).mockResolvedValue({ posts: [], nextCursor: null } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
            } as any);

            await postsService.listPublishedPosts(page, { source: 'facebook', after: 'CURSOR' });

            expect(facebookService.getScheduledPosts).not.toHaveBeenCalled();
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
            });
        });

        it('returns an empty page when the requested source is not connected', async () => {
            const fbOnly = { id: 'page-1', facebookPageId: 'fb1', instagramAccountId: null, accessToken: 'tok' };
            const result = await postsService.listPublishedPosts(fbOnly, { source: 'instagram' });
            expect(result).toEqual({ posts: [], nextCursor: null });
            expect(instagramService.getMedia).not.toHaveBeenCalled();
        });
    });

    describe('onPostPublished', () => {
        /** `db.update().set().where().returning()` + the follow-up overdue-marker SELECT. */
        function mockPublishChains(clearedRows: unknown[], overdueRows: unknown[]) {
            vi.mocked(db.update).mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(clearedRows) }),
                }),
            } as any);
            vi.mocked(db.select).mockReturnValue({
                from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(overdueRows) }),
            } as any);
        }

        it('clears the marker for the post that went live', async () => {
            mockPublishChains([{ id: 'post-1' }], []);

            const result = await postsService.onPostPublished('page-1', 'fb_scheduled');

            expect(result).toEqual({ cleared: true, orphanedPostIds: [] });
            expect(captureError).not.toHaveBeenCalled();
        });

        it('trips the id-drift alarm when another armed post is overdue', async () => {
            // The scheduled post published under a NEW id: its own row keeps an overdue
            // marker forever, so the trigger the merchant configured is orphaned.
            mockPublishChains([], [
                { id: 'post-9', fbId: 'fb_armed_old' },
                { id: 'post-1', fbId: 'fb_fresh' },
            ]);

            const result = await postsService.onPostPublished('page-1', 'fb_fresh');

            // The post that just published is excluded — only the stranded row is reported.
            expect(result).toEqual({ cleared: false, orphanedPostIds: ['fb_armed_old'] });
            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                'Post Reply armed on a scheduled post may be orphaned',
                expect.objectContaining({
                    level: 'warning',
                    extra: expect.objectContaining({ publishedPostId: 'fb_fresh', orphanedPostIds: ['fb_armed_old'] }),
                }),
            );
        });

        it('stays quiet when no marker is overdue (the normal publish path)', async () => {
            // Within the grace window the SQL filter returns nothing, so a slow webhook
            // never masquerades as an id change.
            mockPublishChains([{ id: 'post-1' }], []);

            const result = await postsService.onPostPublished('page-1', 'fb_scheduled');

            expect(result.orphanedPostIds).toEqual([]);
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

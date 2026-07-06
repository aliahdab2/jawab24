import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postsService } from '../../src/services/posts';
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
    },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        getMedia: vi.fn(),
    },
}));

// Import after mocking
const { facebookService } = await import('../../src/services/facebook');
const { instagramService } = await import('../../src/services/instagram');

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

        it('routes facebook through findOrCreateFromWebhook and returns trigger fields', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ ...samplePost, triggerKeyword: 'سعر', triggerReply: 'تفضل', triggerType: 'keyword' }]) as any);

            const result = await postsService.ensureContent(page, 'facebook', 'fb-post-1');

            expect(result).toEqual({ id: 'post-1', triggerKeyword: 'سعر', triggerReply: 'تفضل', triggerType: 'keyword' });
        });

        it('routes instagram through findOrCreateInstagramMedia', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([{ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all' }]) as any);

            const result = await postsService.ensureContent(page, 'instagram', 'ig-media-1');

            expect(result).toEqual({ id: 'ig-row-1', triggerKeyword: null, triggerReply: 'DM', triggerType: 'all' });
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
                { platformPostId: 'fb_A', source: 'facebook', message: 'armed post', imageUrl: 'img', createdTime: '2026-07-01', commentsCount: 3, hasTrigger: true, triggerType: 'all' },
                { platformPostId: 'fb_B', source: 'facebook', message: 'plain post', imageUrl: null, createdTime: '2026-06-01', commentsCount: 0, hasTrigger: false, triggerType: null },
            ]);
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
});

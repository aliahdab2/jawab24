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
    },
}));

// Import after mocking
const { facebookService } = await import('../../src/services/facebook');

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
        it('should delete the post', async () => {
            vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

            await postsService.deletePost('post-1');

            expect(db.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe('toggleAutoReply', () => {
        it('should toggle auto-reply and return the post', async () => {
            const toggled = { ...samplePost, autoReplyEnabled: false };
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(toggled) as any);

            const result = await postsService.toggleAutoReply('post-1', false);

            expect(result).toEqual(toggled);
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
});

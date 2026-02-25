import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commentsService } from '../../src/services/comments';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

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

function mockSelectFromWhere(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(returnValue),
        }),
    };
}

function mockSelectWithOrder(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

function mockSelectJoinJoinWhereOrder(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(returnValue),
                        }),
                    }),
                }),
            }),
        }),
    };
}

function mockSelectJoinJoinWhere(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(returnValue),
                }),
            }),
        }),
    };
}

function mockSelectJoinJoinWhereOrderNoLimit(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(returnValue),
                    }),
                }),
            }),
        }),
    };
}

const sampleComment = {
    id: 'comment-1',
    postId: 'post-1',
    facebookCommentId: 'fb-comment-1',
    message: 'Nice product!',
    fromId: 'user-fb-1',
    fromName: 'Test User',
    replied: false,
    replyText: null,
    replyMethod: null,
    detectedLanguage: null,
    createdTime: new Date(),
    repliedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    needsAttention: false,
    flagReason: null,
    aiIntent: null,
    resolved: false,
};

describe('CommentsService — CRUD & core methods', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createComment', () => {
        it('should create a comment and return it', async () => {
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleComment) as any);

            const result = await commentsService.createComment({
                postId: 'post-1',
                facebookCommentId: 'fb-comment-1',
                message: 'Nice product!',
                fromId: 'user-fb-1',
                fromName: 'Test User',
            });

            expect(result).toEqual(sampleComment);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCommentsByPost', () => {
        it('should return comments for a post', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectWithOrder([sampleComment]) as any);

            const result = await commentsService.getCommentsByPost('post-1');

            expect(result).toEqual([sampleComment]);
        });
    });

    describe('getComment', () => {
        it('should return comment by ID', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([sampleComment]) as any);

            const result = await commentsService.getComment('comment-1');

            expect(result).toEqual(sampleComment);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([]) as any);

            const result = await commentsService.getComment('missing');

            expect(result).toBeNull();
        });
    });

    describe('getCommentByFacebookId', () => {
        it('should return comment by Facebook ID', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([sampleComment]) as any);

            const result = await commentsService.getCommentByFacebookId('fb-comment-1');

            expect(result).toEqual(sampleComment);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([]) as any);

            const result = await commentsService.getCommentByFacebookId('missing');

            expect(result).toBeNull();
        });
    });

    describe('getCommentForWorkspace', () => {
        it('should return FB comment when found in workspace', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhere([{ comment: sampleComment }]) as any);

            const result = await commentsService.getCommentForWorkspace('comment-1', 'ws-1');

            expect(result).toEqual(sampleComment);
        });

        it('should fall back to Instagram comment when FB not found', async () => {
            const igComment = { ...sampleComment, id: 'ig-comment-1' };
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhere([]) as any)
                .mockReturnValueOnce(mockSelectJoinJoinWhere([{ comment: igComment }]) as any);

            const result = await commentsService.getCommentForWorkspace('ig-comment-1', 'ws-1');

            expect(result).toEqual(igComment);
        });

        it('should return null when not found in either platform', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhere([]) as any)
                .mockReturnValueOnce(mockSelectJoinJoinWhere([]) as any);

            const result = await commentsService.getCommentForWorkspace('missing', 'ws-1');

            expect(result).toBeNull();
        });
    });

    describe('updateComment', () => {
        it('should update and return the comment', async () => {
            const updated = { ...sampleComment, message: 'Edited comment' };
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(updated) as any);

            const result = await commentsService.updateComment('comment-1', { message: 'Edited comment' } as any);

            expect(result).toEqual(updated);
        });
    });

    describe('markAsReplied', () => {
        it('should mark comment as replied with all fields', async () => {
            const replied = {
                ...sampleComment,
                replied: true,
                replyText: 'Thank you!',
                replyMethod: 'ai',
            };
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(replied) as any);

            const result = await commentsService.markAsReplied(
                'comment-1',
                'Thank you!',
                'ai',
                undefined,
                'en',
                false,
                undefined,
                'purchase_inquiry',
            );

            expect(result.replied).toBe(true);
            expect(result.replyText).toBe('Thank you!');
        });
    });

    describe('resolveComment', () => {
        it('should resolve FB comment when found', async () => {
            const resolved = { ...sampleComment, resolved: true };
            vi.mocked(db.update).mockReturnValueOnce(mockUpdateChain(resolved) as any);

            const result = await commentsService.resolveComment('comment-1');

            expect(result.resolved).toBe(true);
        });

        it('should fall back to Instagram when FB returns nothing', async () => {
            const igResolved = { ...sampleComment, id: 'ig-1', resolved: true };
            // First update (FB) returns nothing
            vi.mocked(db.update)
                .mockReturnValueOnce({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                } as any)
                // Second update (IG) returns resolved
                .mockReturnValueOnce(mockUpdateChain(igResolved) as any);

            const result = await commentsService.resolveComment('ig-1');

            expect(result.resolved).toBe(true);
            expect(db.update).toHaveBeenCalledTimes(2);
        });
    });

    describe('unresolveComment', () => {
        it('should unresolve FB comment when found', async () => {
            const unresolved = { ...sampleComment, resolved: false };
            vi.mocked(db.update).mockReturnValueOnce(mockUpdateChain(unresolved) as any);

            const result = await commentsService.unresolveComment('comment-1');

            expect(result.resolved).toBe(false);
        });

        it('should fall back to Instagram when FB returns nothing', async () => {
            const igUnresolved = { ...sampleComment, id: 'ig-1', resolved: false };
            vi.mocked(db.update)
                .mockReturnValueOnce({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                } as any)
                .mockReturnValueOnce(mockUpdateChain(igUnresolved) as any);

            const result = await commentsService.unresolveComment('ig-1');

            expect(result.resolved).toBe(false);
            expect(db.update).toHaveBeenCalledTimes(2);
        });
    });

    describe('deleteComment', () => {
        it('should delete the comment', async () => {
            vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

            await commentsService.deleteComment('comment-1');

            expect(db.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe('findOrCreateFromWebhook', () => {
        it('should return existing comment with isNew false', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([sampleComment]) as any);

            const result = await commentsService.findOrCreateFromWebhook('post-1', 'fb-comment-1', 'Nice!');

            expect(result.comment).toEqual(sampleComment);
            expect(result.isNew).toBe(false);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should create comment when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleComment) as any);

            const result = await commentsService.findOrCreateFromWebhook('post-1', 'fb-comment-new', 'New comment');

            expect(result.comment).toEqual(sampleComment);
            expect(result.isNew).toBe(true);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });
    });

    describe('getCommentsByWorkspace (paginated)', () => {
        it('should return paginated results with hasMore', async () => {
            // 51 items = 50 results + 1 for hasMore check
            const items = Array.from({ length: 51 }, (_, i) => ({
                ...sampleComment,
                id: `comment-${i}`,
                source: 'facebook',
            }));

            // Mock: no cursor lookup needed (no cursor passed)
            // FB query returns 51 items, IG query returns 0
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder(items) as any)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder([]) as any);

            const result = await commentsService.getCommentsByWorkspace('ws-1');

            expect(result.data.length).toBe(50);
            expect(result.pagination.hasMore).toBe(true);
            expect(result.pagination.nextCursor).toBeDefined();
        });

        it('should return empty when no comments', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder([]) as any)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder([]) as any);

            const result = await commentsService.getCommentsByWorkspace('ws-empty');

            expect(result.data).toEqual([]);
            expect(result.pagination.hasMore).toBe(false);
            expect(result.pagination.nextCursor).toBeNull();
        });
    });

    describe('getAllCommentsByWorkspace', () => {
        it('should return all comments without pagination', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectJoinJoinWhereOrderNoLimit([sampleComment]) as any);

            const result = await commentsService.getAllCommentsByWorkspace('ws-1');

            expect(result).toEqual([sampleComment]);
        });
    });

    describe('getUnrepliedComments', () => {
        it('should delegate to getCommentsByWorkspace with replied=false', async () => {
            vi.mocked(db.select)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder([sampleComment]) as any)
                .mockReturnValueOnce(mockSelectJoinJoinWhereOrder([]) as any);

            const result = await commentsService.getUnrepliedComments('ws-1');

            // Returns array (unwrapped from paginated result)
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('logFeedback', () => {
        it('should log positive feedback', async () => {
            // Mock getComment
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([sampleComment]) as any);
            // Mock insert log
            const logEntry = { id: 'log-1', action: 'feedback_like' };
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(logEntry) as any);

            const result = await commentsService.logFeedback('comment-1', 'user-1', true, 'Great reply');

            expect(result).toEqual(logEntry);
        });

        it('should log negative feedback', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([sampleComment]) as any);
            const logEntry = { id: 'log-2', action: 'feedback_dislike' };
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(logEntry) as any);

            const result = await commentsService.logFeedback('comment-1', 'user-1', false, 'Not relevant');

            expect(result).toEqual(logEntry);
        });

        it('should throw when comment not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectFromWhere([]) as any);

            await expect(
                commentsService.logFeedback('missing', 'user-1', true),
            ).rejects.toThrow('Comment not found');
        });
    });
});

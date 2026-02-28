import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting
const mockRedis = vi.hoisted(() => ({
    set: vi.fn(),
    eval: vi.fn(),
}));
vi.mock('../../src/lib/redis', () => ({
    redis: mockRedis,
}));

const mockRandomUUID = vi.hoisted(() => vi.fn().mockReturnValue('test-token-123'));
vi.mock('crypto', () => ({
    randomUUID: mockRandomUUID,
}));

import { acquireReplyLock, releaseReplyLock } from '../../src/lib/replyLock';

describe('replyLock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('acquireReplyLock', () => {
        it('should return token when lock is acquired', async () => {
            mockRedis.set.mockResolvedValue('OK');

            const token = await acquireReplyLock('page-1', 'sender-1');

            expect(token).toBe('test-token-123');
            expect(mockRedis.set).toHaveBeenCalledWith(
                'reply_lock:page-1:sender-1',
                'test-token-123',
                'EX',
                60,
                'NX',
            );
        });

        it('should return null when lock is already held', async () => {
            mockRedis.set.mockResolvedValue(null);

            const token = await acquireReplyLock('page-1', 'sender-1');

            expect(token).toBeNull();
        });

        it('should use correct key format with pageId and senderId', async () => {
            mockRedis.set.mockResolvedValue('OK');

            await acquireReplyLock('page-abc', 'sender-xyz');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'reply_lock:page-abc:sender-xyz',
                expect.any(String),
                'EX',
                60,
                'NX',
            );
        });

        it('should support comment-level lock keys', async () => {
            mockRedis.set.mockResolvedValue('OK');

            await acquireReplyLock('comment:page-1', 'comment-id-123');

            expect(mockRedis.set).toHaveBeenCalledWith(
                'reply_lock:comment:page-1:comment-id-123',
                expect.any(String),
                'EX',
                60,
                'NX',
            );
        });
    });

    describe('releaseReplyLock', () => {
        it('should call Redis eval with CAS Lua script', async () => {
            mockRedis.eval.mockResolvedValue(1);

            await releaseReplyLock('page-1', 'sender-1', 'my-token');

            expect(mockRedis.eval).toHaveBeenCalledWith(
                expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
                1,
                'reply_lock:page-1:sender-1',
                'my-token',
            );
        });

        it('should not throw when token does not match (CAS returns 0)', async () => {
            mockRedis.eval.mockResolvedValue(0);

            await expect(releaseReplyLock('page-1', 'sender-1', 'wrong-token')).resolves.toBeUndefined();
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const redisMock = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    incr: vi.fn(),
}));

vi.mock('../../src/lib/redis', () => ({ redis: redisMock }));

import { postReplyCap } from '../../src/services/protection/post-reply-cap';

describe('postReplyCap', () => {
    const originalCap = process.env.POST_REPLY_ANY_COMMENT_CAP;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.POST_REPLY_ANY_COMMENT_CAP;
    });

    afterEach(() => {
        if (originalCap === undefined) delete process.env.POST_REPLY_ANY_COMMENT_CAP;
        else process.env.POST_REPLY_ANY_COMMENT_CAP = originalCap;
    });

    describe('isOverCap', () => {
        it('returns false below the cap', async () => {
            redisMock.get.mockResolvedValueOnce('299');
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(false);
            expect(redisMock.get).toHaveBeenCalledWith('comment:postreplycap:page:post');
        });

        it('returns true at the cap (default 300)', async () => {
            redisMock.get.mockResolvedValueOnce('300');
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(true);
        });

        it('returns false when no key exists yet', async () => {
            redisMock.get.mockResolvedValueOnce(null);
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(false);
        });

        it('honors a custom cap from POST_REPLY_ANY_COMMENT_CAP', async () => {
            process.env.POST_REPLY_ANY_COMMENT_CAP = '5';
            redisMock.get.mockResolvedValueOnce('5');
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(true);
        });

        it('cap 0 disables the check entirely', async () => {
            process.env.POST_REPLY_ANY_COMMENT_CAP = '0';
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(false);
            expect(redisMock.get).not.toHaveBeenCalled();
        });

        it('fails open on Redis errors — a blip must not silence replies', async () => {
            redisMock.get.mockRejectedValueOnce(new Error('redis down'));
            await expect(postReplyCap.isOverCap('page', 'post')).resolves.toBe(false);
        });
    });

    describe('increment', () => {
        it('creates the key with its TTL (SET NX EX) BEFORE incrementing — the key can never exist without a TTL', async () => {
            // Regression: INCR-then-EXPIRE could crash between the two and leave a
            // permanent counter, capping the post forever after 300 lifetime sends.
            redisMock.set.mockResolvedValueOnce('OK');
            redisMock.incr.mockResolvedValueOnce(1);

            await postReplyCap.increment('page', 'post');

            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:postreplycap:page:post', '0', 'EX', 24 * 60 * 60, 'NX',
            );
            expect(redisMock.incr).toHaveBeenCalledWith('comment:postreplycap:page:post');
            // SET NX must land before INCR so the TTL exists before the count moves.
            expect(redisMock.set.mock.invocationCallOrder[0])
                .toBeLessThan(redisMock.incr.mock.invocationCallOrder[0]);
        });

        it('cap 0 skips Redis entirely', async () => {
            process.env.POST_REPLY_ANY_COMMENT_CAP = '0';
            await postReplyCap.increment('page', 'post');
            expect(redisMock.set).not.toHaveBeenCalled();
            expect(redisMock.incr).not.toHaveBeenCalled();
        });

        it('fails open on Redis errors', async () => {
            redisMock.set.mockRejectedValueOnce(new Error('redis down'));
            await expect(postReplyCap.increment('page', 'post')).resolves.toBeUndefined();
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const redisMock = vi.hoisted(() => ({
    exists: vi.fn(),
    set: vi.fn(),
}));

vi.mock('../../src/lib/redis', () => ({ redis: redisMock }));

import { commentDebounce } from '../../src/services/protection/comment-debounce';

describe('commentDebounce', () => {
    const originalWindow = process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS;
    });

    afterEach(() => {
        if (originalWindow === undefined) delete process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS;
        else process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = originalWindow;
    });

    describe('isCoolingDown', () => {
        it('returns true when the Redis key exists', async () => {
            redisMock.exists.mockResolvedValueOnce(1);
            await expect(commentDebounce.isCoolingDown('p', 'post', 'sender'))
                .resolves.toBe(true);
            expect(redisMock.exists).toHaveBeenCalledWith('comment:debounce:p:post:sender');
        });

        it('returns false when the Redis key is absent', async () => {
            redisMock.exists.mockResolvedValueOnce(0);
            await expect(commentDebounce.isCoolingDown('p', 'post', 'sender'))
                .resolves.toBe(false);
        });

        it('fails open and returns false on Redis errors', async () => {
            redisMock.exists.mockRejectedValueOnce(new Error('redis down'));
            await expect(commentDebounce.isCoolingDown('p', 'post', 'sender'))
                .resolves.toBe(false);
        });

        it('returns false (disabled) when window is set to 0', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '0';
            await expect(commentDebounce.isCoolingDown('p', 'post', 'sender'))
                .resolves.toBe(false);
            expect(redisMock.exists).not.toHaveBeenCalled();
        });
    });

    describe('key isolation', () => {
        it('different senders on the same post use different keys', async () => {
            redisMock.exists.mockResolvedValue(0);
            await commentDebounce.isCoolingDown('p', 'post', 'sender-A');
            await commentDebounce.isCoolingDown('p', 'post', 'sender-B');
            expect(redisMock.exists).toHaveBeenNthCalledWith(1, 'comment:debounce:p:post:sender-A');
            expect(redisMock.exists).toHaveBeenNthCalledWith(2, 'comment:debounce:p:post:sender-B');
        });

        it('same sender on different posts uses different keys', async () => {
            redisMock.exists.mockResolvedValue(0);
            await commentDebounce.isCoolingDown('p', 'post-1', 'sender-A');
            await commentDebounce.isCoolingDown('p', 'post-2', 'sender-A');
            expect(redisMock.exists).toHaveBeenNthCalledWith(1, 'comment:debounce:p:post-1:sender-A');
            expect(redisMock.exists).toHaveBeenNthCalledWith(2, 'comment:debounce:p:post-2:sender-A');
        });

        it('same sender + post but different page uses different keys', async () => {
            redisMock.exists.mockResolvedValue(0);
            await commentDebounce.isCoolingDown('page-1', 'post', 'sender-A');
            await commentDebounce.isCoolingDown('page-2', 'post', 'sender-A');
            expect(redisMock.exists).toHaveBeenNthCalledWith(1, 'comment:debounce:page-1:post:sender-A');
            expect(redisMock.exists).toHaveBeenNthCalledWith(2, 'comment:debounce:page-2:post:sender-A');
        });
    });

    describe('arm', () => {
        it('SET NX EX with the configured window (default 60s)', async () => {
            redisMock.set.mockResolvedValueOnce('OK');
            await commentDebounce.arm('p', 'post', 'sender');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender',
                '1',
                'EX',
                60,
                'NX',
            );
        });

        it('honors a custom window via COMMENT_DEBOUNCE_WINDOW_SECONDS', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '120';
            redisMock.set.mockResolvedValueOnce('OK');
            await commentDebounce.arm('p', 'post', 'sender');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender', '1', 'EX', 120, 'NX',
            );
        });

        it('is a no-op when window is 0', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '0';
            await commentDebounce.arm('p', 'post', 'sender');
            expect(redisMock.set).not.toHaveBeenCalled();
        });

        it('falls back to default when env var is unparseable or negative', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = 'not-a-number';
            redisMock.set.mockResolvedValueOnce('OK');
            await commentDebounce.arm('p', 'post', 'sender');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender', '1', 'EX', 60, 'NX',
            );
        });

        it('swallows Redis errors (fail-open)', async () => {
            redisMock.set.mockRejectedValueOnce(new Error('redis down'));
            await expect(commentDebounce.arm('p', 'post', 'sender')).resolves.toBeUndefined();
        });
    });
});

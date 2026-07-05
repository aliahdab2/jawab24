import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const redisMock = vi.hoisted(() => ({
    set: vi.fn(),
    eval: vi.fn(),
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

    describe('tryAcquire', () => {
        it('claims the slot with SET NX EX (default 60s window) and returns a token', async () => {
            redisMock.set.mockResolvedValueOnce('OK');
            const token = await commentDebounce.tryAcquire('p', 'post', 'sender');
            expect(token).toBeTypeOf('string');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender',
                token,
                'EX',
                60,
                'NX',
            );
        });

        it('returns null when the slot is already held (SET NX returns null)', async () => {
            redisMock.set.mockResolvedValueOnce(null);
            await expect(commentDebounce.tryAcquire('p', 'post', 'sender')).resolves.toBeNull();
        });

        it('honors a custom window via COMMENT_DEBOUNCE_WINDOW_SECONDS', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '120';
            redisMock.set.mockResolvedValueOnce('OK');
            const token = await commentDebounce.tryAcquire('p', 'post', 'sender');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender', token, 'EX', 120, 'NX',
            );
        });

        it('falls back to the default window when the env var is unparseable or negative', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = 'not-a-number';
            redisMock.set.mockResolvedValueOnce('OK');
            const token = await commentDebounce.tryAcquire('p', 'post', 'sender');
            expect(redisMock.set).toHaveBeenCalledWith(
                'comment:debounce:p:post:sender', token, 'EX', 60, 'NX',
            );
        });

        it('returns a token without touching Redis when the window is 0 (disabled)', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '0';
            await expect(commentDebounce.tryAcquire('p', 'post', 'sender')).resolves.toBeTypeOf('string');
            expect(redisMock.set).not.toHaveBeenCalled();
        });

        it('fails open (returns a token) on Redis errors so replies are never blocked', async () => {
            redisMock.set.mockRejectedValueOnce(new Error('redis down'));
            await expect(commentDebounce.tryAcquire('p', 'post', 'sender')).resolves.toBeTypeOf('string');
        });
    });

    describe('release', () => {
        it('deletes only when the held token matches (compare-and-delete via Lua)', async () => {
            redisMock.eval.mockResolvedValueOnce(1);
            await commentDebounce.release('p', 'post', 'sender', 'the-token');
            expect(redisMock.eval).toHaveBeenCalledWith(
                expect.stringContaining('redis.call("del", KEYS[1])'),
                1,
                'comment:debounce:p:post:sender',
                'the-token',
            );
        });

        it('is a no-op when the window is 0 (disabled)', async () => {
            process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS = '0';
            await commentDebounce.release('p', 'post', 'sender', 'the-token');
            expect(redisMock.eval).not.toHaveBeenCalled();
        });

        it('swallows Redis errors (fail-open — TTL expires the key regardless)', async () => {
            redisMock.eval.mockRejectedValueOnce(new Error('redis down'));
            await expect(commentDebounce.release('p', 'post', 'sender', 'the-token')).resolves.toBeUndefined();
        });
    });

    describe('race + key isolation', () => {
        it('grants the slot to exactly one caller in a concurrent burst', async () => {
            // Model SET NX: first call stores, the rest see the key and get null.
            let held = false;
            redisMock.set.mockImplementation(async () => {
                if (held) return null;
                held = true;
                return 'OK';
            });
            const results = await Promise.all(
                Array.from({ length: 8 }, () => commentDebounce.tryAcquire('p', 'post', 'sender')),
            );
            expect(results.filter((r) => r !== null)).toHaveLength(1);
        });

        it('scopes the key per (page, post, sender)', async () => {
            redisMock.set.mockResolvedValue('OK');
            await commentDebounce.tryAcquire('p', 'post', 'sender-A');
            await commentDebounce.tryAcquire('p', 'post', 'sender-B');
            await commentDebounce.tryAcquire('p', 'post-2', 'sender-A');
            await commentDebounce.tryAcquire('page-2', 'post', 'sender-A');
            const keys = redisMock.set.mock.calls.map((c) => c[0]);
            expect(new Set(keys).size).toBe(4);
            expect(keys).toContain('comment:debounce:p:post:sender-A');
            expect(keys).toContain('comment:debounce:p:post:sender-B');
            expect(keys).toContain('comment:debounce:p:post-2:sender-A');
            expect(keys).toContain('comment:debounce:page-2:post:sender-A');
        });
    });
});

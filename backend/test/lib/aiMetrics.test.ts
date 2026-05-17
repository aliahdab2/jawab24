import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the redis singleton before importing aiMetrics so the test never
// touches a real connection. vi.mock is hoisted above imports, so the
// mock factory must use vi.hoisted to share state with the test scope.
const { incrMock } = vi.hoisted(() => ({ incrMock: vi.fn().mockResolvedValue(1) }));
vi.mock('../../src/lib/redis', () => ({
    redis: { incr: incrMock },
    redisScanDelete: vi.fn(),
    isRedisAuthFailed: () => false,
}));

import {
    recordAiAttempt,
    recordAiReturn,
    recordAiLogged,
    recordAiFailedBeforeLog,
} from '../../src/lib/aiMetrics';

describe('aiMetrics', () => {
    beforeEach(() => {
        incrMock.mockClear();
        incrMock.mockResolvedValue(1);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('recordAiAttempt builds the attempts key with pipeline + model', () => {
        recordAiAttempt('dm_reply', 'gpt-4.1-mini');
        expect(incrMock).toHaveBeenCalledExactlyOnceWith('metrics:ai:attempts:dm_reply:gpt-4.1-mini');
    });

    it('recordAiReturn builds the returns key', () => {
        recordAiReturn('comment_reply', 'gpt-4.1-mini');
        expect(incrMock).toHaveBeenCalledExactlyOnceWith('metrics:ai:returns:comment_reply:gpt-4.1-mini');
    });

    it('recordAiLogged builds the logged key', () => {
        recordAiLogged('translation', 'gpt-4.1-mini');
        expect(incrMock).toHaveBeenCalledExactlyOnceWith('metrics:ai:logged:translation:gpt-4.1-mini');
    });

    it('recordAiFailedBeforeLog appends error_class as a fourth segment', () => {
        recordAiFailedBeforeLog('ecommerce_tools', 'gpt-4.1-mini', 'ZeroTokens');
        expect(incrMock).toHaveBeenCalledExactlyOnceWith(
            'metrics:ai:failed_before_log:ecommerce_tools:gpt-4.1-mini:ZeroTokens',
        );
    });

    it('falls back to "unknown" when pipeline is undefined', () => {
        recordAiAttempt(undefined, 'gpt-4.1-mini');
        expect(incrMock).toHaveBeenCalledExactlyOnceWith('metrics:ai:attempts:unknown:gpt-4.1-mini');
    });

    it('swallows Redis errors silently (must never block AI calls)', async () => {
        incrMock.mockRejectedValueOnce(new Error('Redis down'));
        // No try/catch in caller — must not throw.
        expect(() => recordAiAttempt('dm_reply', 'gpt-4.1-mini')).not.toThrow();
        // Give the rejected promise a tick to settle without unhandled-rejection noise.
        await new Promise((r) => setImmediate(r));
        expect(incrMock).toHaveBeenCalledTimes(1);
    });

    it('is fire-and-forget — does not await Redis (returns void synchronously)', () => {
        // Slow Redis: never resolves. The function must still return without blocking.
        incrMock.mockReturnValueOnce(new Promise(() => { /* never */ }));
        const result = recordAiReturn('dm_reply', 'gpt-4.1-mini');
        expect(result).toBeUndefined();
        expect(incrMock).toHaveBeenCalledTimes(1);
    });
});

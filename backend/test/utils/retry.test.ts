import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, createRetryable } from '../../src/utils/retry';

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and succeed', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('network timeout'))
            .mockResolvedValueOnce('recovered');

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 100,
            retryableErrors: () => true,
        });

        // Advance timers to allow the sleep to resolve
        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;

        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting all attempts', async () => {
        vi.useRealTimers(); // use real timers for this test to avoid unhandled rejections
        const error = new Error('persistent failure');
        const fn = vi.fn().mockRejectedValue(error);

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 1,
                maxDelayMs: 5,
                retryableErrors: () => true,
            }),
        ).rejects.toThrow('persistent failure');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
        const error = new Error('validation error');
        const fn = vi.fn().mockRejectedValue(error);

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                baseDelayMs: 10,
                retryableErrors: () => false,
            }),
        ).rejects.toThrow('validation error');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback before each retry', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValueOnce('ok');

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 50,
            retryableErrors: () => true,
            onRetry,
        });

        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });

    it('should abort immediately when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        const fn = vi.fn().mockResolvedValue('ok');

        await expect(
            withRetry(fn, { maxAttempts: 3, signal: controller.signal }),
        ).rejects.toThrow('Retry aborted');
        expect(fn).not.toHaveBeenCalled();
    });

    it('should use default retryableErrors that retries network errors', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('network timeout'))
            .mockResolvedValueOnce('ok');

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 50,
        });

        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use default retryableErrors that retries 429 status', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' })
            .mockResolvedValueOnce('ok');

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 50,
        });

        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;
        expect(result).toBe('ok');
    });

    it('should use default retryableErrors that retries ECONNRESET code', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'connection reset' })
            .mockResolvedValueOnce('ok');

        const promise = withRetry(fn, {
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 50,
        });

        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;
        expect(result).toBe('ok');
    });

    it('should NOT retry 400 errors with default retryableErrors', async () => {
        const fn = vi.fn().mockRejectedValue({ response: { status: 400 }, message: 'bad request' });

        await expect(
            withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 }),
        ).rejects.toEqual(expect.objectContaining({ message: 'bad request' }));
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('createRetryable', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return a wrapped function that retries', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce('done');

        const retryableFn = createRetryable(fn, {
            maxAttempts: 2,
            baseDelayMs: 10,
            maxDelayMs: 50,
            retryableErrors: () => true,
        });

        const promise = retryableFn('arg1', 'arg2');
        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;

        expect(result).toBe('done');
        expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
});

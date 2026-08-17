/**
 * The Graph retry observer: one Redis counter and one log line per decision.
 *
 * `retry_suppressed` is the counter that quantifies the duplicate-comment defect this
 * whole change exists to close — each increment is one duplicate public comment or DM
 * that the old blanket-retry interceptor would have created. It has to be emitted with a
 * stable key shape, or the number is unreadable after the fact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIncr } = vi.hoisted(() => ({ mockIncr: vi.fn(() => Promise.resolve(1)) }));
vi.mock('../../src/lib/redis', () => ({ redis: { incr: mockIncr } }));

import { graphRetryObserver } from '../../src/lib/graphRetryMetrics';
import type { GraphRetryEvent } from '../../src/lib/fbAxios';

const SUPPRESSED: GraphRetryEvent = {
    outcome: 'retry_suppressed',
    method: 'post',
    url: 'https://graph.facebook.com/v23.0/123_456/comments',
    reason: 'econnaborted',
    proven: false,
};

function newLogger() {
    return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

describe('graphRetryObserver', () => {
    beforeEach(() => mockIncr.mockReset().mockImplementation(() => Promise.resolve(1)));

    it('counts a suppressed replay under a stable metrics key', () => {
        graphRetryObserver(newLogger())(SUPPRESSED);

        expect(mockIncr).toHaveBeenCalledWith('metrics:graph:retry_suppressed:post:econnaborted');
    });

    it('logs a suppressed replay — the failure mode used to be entirely silent', () => {
        const logger = newLogger();

        graphRetryObserver(logger)(SUPPRESSED);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('not replaying'),
            expect.objectContaining({ method: 'post', reason: 'econnaborted' }),
        );
    });

    it('counts retried and exhausted decisions under their own keys', () => {
        const observer = graphRetryObserver(newLogger());

        observer({ ...SUPPRESSED, outcome: 'retried', reason: 'http_429', proven: true, attempt: 1, waitMs: 0 });
        observer({ ...SUPPRESSED, outcome: 'exhausted', reason: 'http_429', proven: true, attempt: 2 });

        expect(mockIncr).toHaveBeenCalledWith('metrics:graph:retried:post:http_429');
        expect(mockIncr).toHaveBeenCalledWith('metrics:graph:exhausted:post:http_429');
    });

    it('redacts credentials out of the logged URL', () => {
        const logger = newLogger();

        graphRetryObserver(logger)({
            ...SUPPRESSED,
            url: 'https://graph.facebook.com/v23.0/debug_token?input_token=EAAsecret&other=1',
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ url: expect.not.stringContaining('EAAsecret') }),
        );
    });

    it('never lets a synchronous Redis failure escape into the caller', () => {
        mockIncr.mockImplementationOnce(() => { throw new Error('redis down'); });

        expect(() => graphRetryObserver(newLogger())(SUPPRESSED)).not.toThrow();
    });

    it('never lets a rejected Redis promise become an unhandled rejection', async () => {
        mockIncr.mockImplementationOnce(() => Promise.reject(new Error('redis down')));

        graphRetryObserver(newLogger())(SUPPRESSED);
        await Promise.resolve();

        expect(mockIncr).toHaveBeenCalledTimes(1);
    });
});

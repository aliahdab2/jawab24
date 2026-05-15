/**
 * Integration tests for the full failover chain:
 *   N consecutive OpenAI failures → circuit opens → next request uses Claude
 *
 * These tests complement:
 *   - circuitBreaker.test.ts  (unit tests for state machine)
 *   - ai.test.ts "Provider Failover" block  (unit tests with mocked CircuitOpenError)
 *
 * What's new here:
 *   - Simulated OpenAI outage (500), timeout, rate limit (429)
 *   - Circuit opens organically from repeated failures (not pre-mocked)
 *   - Full chain: failures → circuit open → failover reply → recovery
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

/** In-memory circuit breaker that mirrors the real Redis-backed state machine */
function makeInMemoryCircuitBreaker(threshold: number) {
    let failures = 0;
    let isOpen = false;

    class CircuitOpenError extends Error {
        constructor() { super('Circuit open'); this.name = 'CircuitOpenError'; }
    }

    return {
        CircuitOpenError,
        circuit: {
            execute: vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
                if (isOpen) throw new CircuitOpenError();
                try {
                    const result = await fn();
                    failures = 0;
                    isOpen = false;
                    return result;
                } catch (err) {
                    failures++;
                    if (failures >= threshold) isOpen = true;
                    throw err;
                }
            }),
            getState: vi.fn(async () => isOpen ? 'open' : 'closed'),
        },
        isOpen: () => isOpen,
        reset: () => { failures = 0; isOpen = false; },
    };
}

/** Shared mock setup — avoids duplicating boilerplate across tests */
function setupMocks(opts: {
    failureThreshold: number;
    axiosPost: ReturnType<typeof vi.fn>;
}) {
    const cb = makeInMemoryCircuitBreaker(opts.failureThreshold);

    vi.doMock('../../src/lib/circuitBreaker', () => ({
        aiWorkerCircuit: cb.circuit,
        CircuitOpenError: cb.CircuitOpenError,
    }));

    vi.doMock('../../src/lib/redis', () => ({
        redis: {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue('OK'),
            quit: vi.fn(),
            incr: vi.fn().mockResolvedValue(1),
        },
    }));

    vi.doMock('../../src/db', () => ({
        db: {
            select: vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }),
            insert: vi.fn().mockReturnValue({
                values: vi.fn().mockReturnValue({
                    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
                    returning: vi.fn().mockResolvedValue([]),
                }),
            }),
            update: vi.fn().mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            }),
        },
    }));

    vi.doMock('../../src/db/schema', () => ({
        aiCache: {},
        aiUsageLog: {},
        deviceTokens: {},
        notifications: {},
        settings: {},
    }));

    vi.doMock('drizzle-orm', () => ({
        eq: vi.fn(),
        and: vi.fn(),
        desc: vi.fn(),
        count: vi.fn(),
        sql: vi.fn().mockReturnValue('sql-mock'),
    }));

    vi.doMock('axios', () => ({ default: { post: opts.axiosPost } }));

    vi.doMock('../../src/config', () => ({
        config: {
            ai: {
                enabled: true,
                cacheEnabled: true,
                serviceUrl: 'http://localhost:3002',
                model: 'gpt-4.1-mini',
                fallbackModel: FALLBACK_MODEL,
            },
            openai: { apiKey: '' },
        },
    }));

    vi.doMock('@sentry/node', () => ({
        startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        addBreadcrumb: vi.fn(),
    }));

    return cb;
}

/** Creates an axios mock that fails primary calls and succeeds/fails failover calls */
function makeAxiosMock(opts: {
    primaryError: Error;
    fallbackReply?: Record<string, unknown>;
    fallbackError?: Error;
}) {
    return vi.fn(async (_url: string, body: Record<string, unknown>) => {
        if (body.model === FALLBACK_MODEL) {
            if (opts.fallbackError) throw opts.fallbackError;
            return {
                data: opts.fallbackReply ?? {
                    reply: 'Claude handled it',
                    language: 'en',
                    intent: 'QUESTION',
                    confidence: 'high',
                    flags: [],
                    tokensIn: 80,
                    tokensOut: 40,
                },
            };
        }
        throw opts.primaryError;
    });
}

describe('AI Failover — Full Chain Integration', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('opens circuit after N consecutive OpenAI 500 errors, then failover succeeds', async () => {
        const axiosPost = makeAxiosMock({
            primaryError: new Error('Request failed with status code 500'),
        });
        const cb = setupMocks({ failureThreshold: 3, axiosPost });

        const { AiService } = await import('../../src/services/ai');
        const service = new AiService();

        // 3 failures → circuit opens. New contract: each primary failure throws
        // (no static fallback returned). The circuit breaker still counts these
        // failures and trips after the threshold.
        for (let i = 0; i < 3; i++) {
            await expect(
                service.generateReply({ comment: `test ${i}`, context: { userId: 'u1' } }),
            ).rejects.toThrow();
        }
        expect(cb.isOpen()).toBe(true);

        // 4th call: circuit open → failover to Claude
        const result = await service.generateReply({ comment: 'test after open', context: { userId: 'u1' } });
        expect(result.reply).toBe('Claude handled it');
        expect(result.model).toBe(FALLBACK_MODEL);
        expect(result.flags).toContain('provider_failover');
    });

    it('handles OpenAI timeout (ECONNABORTED) → failover to Claude', async () => {
        const axiosPost = makeAxiosMock({
            primaryError: Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }),
        });
        const cb = setupMocks({ failureThreshold: 2, axiosPost });

        const { AiService } = await import('../../src/services/ai');
        const service = new AiService();

        // 2 timeouts → circuit opens. New contract: throws on each timeout.
        await expect(service.generateReply({ comment: 'test 1', context: { userId: 'u1' } })).rejects.toThrow();
        await expect(service.generateReply({ comment: 'test 2', context: { userId: 'u1' } })).rejects.toThrow();
        expect(cb.isOpen()).toBe(true);

        // Once the circuit is open, the failover provider kicks in and returns
        // a real reply (this path is unchanged by the fallback removal).
        const result = await service.generateReply({ comment: 'after timeout', context: { userId: 'u1' } });
        expect(result.model).toBe(FALLBACK_MODEL);
        expect(result.flags).toContain('provider_failover');
    });

    it('handles OpenAI rate limit (429) → failover to Claude', async () => {
        const axiosPost = makeAxiosMock({
            primaryError: Object.assign(new Error('Request failed with status code 429'), {
                response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
            }),
        });
        const cb = setupMocks({ failureThreshold: 2, axiosPost });

        const { AiService } = await import('../../src/services/ai');
        const service = new AiService();

        // Pre-trip the circuit. New contract: each call throws.
        await expect(service.generateReply({ comment: 'test 1', context: { userId: 'u1' } })).rejects.toThrow();
        await expect(service.generateReply({ comment: 'test 2', context: { userId: 'u1' } })).rejects.toThrow();
        expect(cb.isOpen()).toBe(true);

        const result = await service.generateReply({ comment: 'after rate limit', context: { userId: 'u1' } });
        expect(result.model).toBe(FALLBACK_MODEL);
    });

    it('throws when both GPT and Claude fail (no fake fallback)', async () => {
        // Previously the catch tail returned a templated "Thank you for your comment!"
        // mid-conversation. New contract: rethrow so BullMQ retries or
        // flagStuckJobOnFinalFailure marks the row needs_attention.
        const axiosPost = makeAxiosMock({
            primaryError: new Error('GPT down'),
            fallbackError: new Error('Claude also down'),
        });
        const cb = setupMocks({ failureThreshold: 1, axiosPost });

        const { AiService } = await import('../../src/services/ai');
        const service = new AiService();

        // 1 failure → circuit opens. Throws (no fallback).
        await expect(service.generateReply({ comment: 'test', context: { userId: 'u1' } }))
            .rejects.toThrow();
        expect(cb.isOpen()).toBe(true);

        // Circuit open → Claude fails → throws (no fallback substitution)
        await expect(service.generateReply({ comment: 'both down', context: { userId: 'u1' } }))
            .rejects.toThrow();
    });

    it('recovers to primary after circuit resets', async () => {
        let callIdx = 0;
        const axiosPost = vi.fn(async (_url: string, body: Record<string, unknown>) => {
            if (body.model === FALLBACK_MODEL) {
                return { data: { reply: 'Claude reply', language: 'en', intent: 'QUESTION', confidence: 'high', flags: [], tokensIn: 50, tokensOut: 30 } };
            }
            callIdx++;
            if (callIdx <= 2) throw new Error('GPT down');
            return { data: { reply: 'GPT recovered!', language: 'en', intent: 'GREETING', confidence: 'high', flags: [] } };
        });
        const cb = setupMocks({ failureThreshold: 2, axiosPost });

        const { AiService } = await import('../../src/services/ai');
        const service = new AiService();

        // 2 failures → circuit opens. New contract: each call throws (no
        // fake fallback substitution). The circuit breaker still trips on
        // the count of underlying failures.
        await expect(service.generateReply({ comment: 'fail 1', context: { userId: 'u1' } })).rejects.toThrow();
        await expect(service.generateReply({ comment: 'fail 2', context: { userId: 'u1' } })).rejects.toThrow();
        expect(cb.isOpen()).toBe(true);

        // Failover to Claude
        const failoverResult = await service.generateReply({ comment: 'during outage', context: { userId: 'u1' } });
        expect(failoverResult.model).toBe(FALLBACK_MODEL);

        // Simulate circuit recovery (in production: TTL expires → half-open probe succeeds)
        cb.reset();

        // Primary handles requests again
        const recoveryResult = await service.generateReply({ comment: 'after recovery', context: { userId: 'u1' } });
        expect(recoveryResult.reply).toBe('GPT recovered!');
        expect(recoveryResult.flags).not.toContain('provider_failover');
    });
});

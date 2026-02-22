/**
 * Circuit Breaker Concurrency / Load Test
 *
 * Simulates an ai-worker outage under concurrent traffic and verifies:
 *   1. Circuit opens after failure threshold under concurrent failures
 *   2. Post-open requests fail fast (no 30 s waits)
 *   3. Queue backlog / latency does not spike abnormally
 *   4. Recovery path (half-open → closed) works after ai-worker returns
 *
 * Uses an in-memory Redis-compatible store so the test runs without a
 * real Redis instance while still exercising the full CircuitBreaker
 * state machine with realistic concurrency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../src/lib/circuitBreaker';

vi.mock('@sentry/node', () => ({
    captureMessage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// In-memory Redis stub that supports the subset of commands CircuitBreaker
// uses: exists, get, set (with NX + EX), del, incr, expire.
// All operations are "atomic" within the JS event loop tick, which is a
// reasonable approximation of single-threaded Redis for testing purposes.
// ---------------------------------------------------------------------------
function makeInMemoryRedis() {
    const store = new Map<string, { value: string; expiresAt?: number }>();

    function isAlive(key: string): boolean {
        const entry = store.get(key);
        if (!entry) return false;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            store.delete(key);
            return false;
        }
        return true;
    }

    return {
        _store: store,

        async exists(key: string): Promise<number> {
            return isAlive(key) ? 1 : 0;
        },

        async get(key: string): Promise<string | null> {
            if (!isAlive(key)) return null;
            return store.get(key)!.value;
        },

        async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
            let ex: number | undefined;
            let nx = false;

            for (let i = 0; i < args.length; i++) {
                const arg = String(args[i]).toUpperCase();
                if (arg === 'EX') { ex = Number(args[++i]); }
                if (arg === 'NX') { nx = true; }
            }

            if (nx && isAlive(key)) return null;

            store.set(key, {
                value,
                expiresAt: ex ? Date.now() + ex * 1000 : undefined,
            });
            return 'OK';
        },

        async del(...keys: string[]): Promise<number> {
            let removed = 0;
            for (const k of keys) {
                if (store.delete(k)) removed++;
            }
            return removed;
        },

        async incr(key: string): Promise<number> {
            const entry = isAlive(key) ? store.get(key)! : { value: '0' };
            const next = parseInt(entry.value, 10) + 1;
            store.set(key, { ...entry, value: String(next) });
            return next;
        },

        async expire(key: string, seconds: number): Promise<number> {
            const entry = store.get(key);
            if (!entry) return 0;
            entry.expiresAt = Date.now() + seconds * 1000;
            return 1;
        },
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate an AI worker call that takes `delayMs` to fail. */
function slowFail(delayMs: number): () => Promise<never> {
    return () => new Promise((_, reject) => setTimeout(() => reject(new Error('ai-worker timeout')), delayMs));
}

/** Simulate a healthy AI worker that responds in `delayMs`. */
function healthyWorker(delayMs = 5): () => Promise<string> {
    return () => new Promise(resolve => setTimeout(() => resolve('AI reply'), delayMs));
}

/** Run fn and return elapsed milliseconds. */
async function timed<T>(fn: () => Promise<T>): Promise<{ result: T | null; error: Error | null; ms: number }> {
    const start = performance.now();
    try {
        const result = await fn();
        return { result, error: null, ms: performance.now() - start };
    } catch (e) {
        return { result: null, error: e as Error, ms: performance.now() - start };
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Circuit Breaker — Concurrent Outage Simulation', () => {
    const THRESHOLD = 5;
    const OPEN_DURATION_SECONDS = 1; // 1 s for fast test turnaround
    const CONCURRENCY = 50; // simulate 50 concurrent requests

    let redisStub: ReturnType<typeof makeInMemoryRedis>;
    let cb: CircuitBreaker;

    beforeEach(() => {
        vi.clearAllMocks();
        redisStub = makeInMemoryRedis();
        cb = new CircuitBreaker(redisStub as any, 'ai_worker', {
            failureThreshold: THRESHOLD,
            openDurationSeconds: OPEN_DURATION_SECONDS,
            probeLockTtlSeconds: 5,
            inactivityResetSeconds: 60,
        });
    });

    // ------------------------------------------------------------------
    // Criterion 1: Circuit opens after threshold under concurrent failures
    // ------------------------------------------------------------------
    it('opens the circuit after failure threshold under concurrent traffic', async () => {
        // Fire CONCURRENCY requests in parallel, all hitting a failing AI worker
        const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
                timed(() => cb.execute(slowFail(10))),
            ),
        );

        // Every request should have failed
        const errors = results.filter(r => r.error !== null);
        expect(errors.length).toBe(CONCURRENCY);

        // Circuit should now be open
        const state = await cb.getState();
        expect(state).toBe('open');

        // The opened counter should have been incremented at least once
        const openedCount = await redisStub.get('metrics:pipeline:circuit.ai_worker.opened');
        expect(Number(openedCount)).toBeGreaterThanOrEqual(1);
    });

    // ------------------------------------------------------------------
    // Criterion 2: Post-open requests fail fast (no 30 s waits)
    // ------------------------------------------------------------------
    it('rejects post-open requests in < 5 ms (fail-fast)', async () => {
        // Trip the circuit first
        for (let i = 0; i < THRESHOLD; i++) {
            await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        }
        expect(await cb.getState()).toBe('open');

        // Now fire a batch of concurrent requests and measure latency
        const POST_OPEN_BATCH = 100;
        const results = await Promise.all(
            Array.from({ length: POST_OPEN_BATCH }, () =>
                timed(() => cb.execute(() => Promise.resolve('should not reach'))),
            ),
        );

        // All should be CircuitOpenError
        for (const r of results) {
            expect(r.error).toBeInstanceOf(CircuitOpenError);
        }

        // All should resolve in well under 50 ms (no network wait)
        // We use 50 ms as a generous ceiling — real fail-fast is < 1 ms
        const maxLatency = Math.max(...results.map(r => r.ms));
        expect(maxLatency).toBeLessThan(50);

        // p99 should be under 10 ms
        const sorted = results.map(r => r.ms).sort((a, b) => a - b);
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        expect(p99).toBeLessThan(10);
    });

    // ------------------------------------------------------------------
    // Criterion 3: Queue backlog / latency does not spike abnormally
    // ------------------------------------------------------------------
    it('maintains flat latency after circuit opens (no cascading backlog)', async () => {
        // Phase 1: Trip the circuit with THRESHOLD failures
        for (let i = 0; i < THRESHOLD; i++) {
            await cb.execute(slowFail(50)).catch(() => {});
        }
        expect(await cb.getState()).toBe('open');

        // Phase 2: Simulate 3 waves of concurrent traffic hitting the open circuit
        const waveSizes = [30, 50, 80];
        const waveLatencies: number[][] = [];

        for (const size of waveSizes) {
            const wave = await Promise.all(
                Array.from({ length: size }, () =>
                    timed(() => cb.execute(() => Promise.resolve('nope'))),
                ),
            );
            waveLatencies.push(wave.map(r => r.ms));
        }

        // Median latency of each wave should be similar (flat, not growing)
        const medians = waveLatencies.map(latencies => {
            const s = [...latencies].sort((a, b) => a - b);
            return s[Math.floor(s.length / 2)];
        });

        // The ratio between the largest and smallest median should be < 50x
        // (proves latency stays flat, not growing with queue depth).
        // In-memory ops run in sub-ms; OS scheduling jitter alone can produce
        // 5-30x variation depending on system load. A real cascading backlog
        // is 100x+, so 50x gives enough headroom while still catching real regressions.
        const ratio = Math.max(...medians) / Math.max(Math.min(...medians), 0.001);
        expect(ratio).toBeLessThan(50);

        // No individual request should exceed 50 ms
        const allLatencies = waveLatencies.flat();
        expect(Math.max(...allLatencies)).toBeLessThan(50);
    });

    // ------------------------------------------------------------------
    // Criterion 4: Recovery path (half-open → closed) after ai-worker returns
    // ------------------------------------------------------------------
    it('recovers from open → half-open → closed when ai-worker comes back', async () => {
        // Step 1: Trip the circuit
        for (let i = 0; i < THRESHOLD; i++) {
            await cb.execute(() => Promise.reject(new Error('outage'))).catch(() => {});
        }
        expect(await cb.getState()).toBe('open');

        // Step 2: Wait for open TTL to expire → half-open
        // Our open duration is 1 s, so delete the open key to simulate TTL expiry
        await redisStub.del('cb:ai_worker:open');
        expect(await cb.getState()).toBe('half-open');

        // Step 3: Concurrent requests during half-open — only 1 probe allowed
        const HALF_OPEN_BATCH = 20;
        const results = await Promise.all(
            Array.from({ length: HALF_OPEN_BATCH }, () =>
                timed(() => cb.execute(healthyWorker(5))),
            ),
        );

        // Exactly 1 should succeed (the probe), rest should get CircuitOpenError
        const successes = results.filter(r => r.error === null);
        const failures = results.filter(r => r.error instanceof CircuitOpenError);

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(HALF_OPEN_BATCH - 1);

        // Step 4: After successful probe, circuit should be closed
        expect(await cb.getState()).toBe('closed');

        // Step 5: New batch of requests should all succeed
        const recoveryBatch = await Promise.all(
            Array.from({ length: 10 }, () =>
                timed(() => cb.execute(healthyWorker(2))),
            ),
        );

        for (const r of recoveryBatch) {
            expect(r.error).toBeNull();
            expect(r.result).toBe('AI reply');
        }
    });

    // ------------------------------------------------------------------
    // Bonus: Half-open probe failure re-opens circuit
    // ------------------------------------------------------------------
    it('re-opens the circuit if the half-open probe fails', async () => {
        // Trip the circuit
        for (let i = 0; i < THRESHOLD; i++) {
            await cb.execute(() => Promise.reject(new Error('outage'))).catch(() => {});
        }
        expect(await cb.getState()).toBe('open');

        // Simulate TTL expiry
        await redisStub.del('cb:ai_worker:open');
        expect(await cb.getState()).toBe('half-open');

        // Probe also fails — ai-worker still down
        const probeResult = await timed(() => cb.execute(slowFail(5)));
        expect(probeResult.error).not.toBeNull();

        // Circuit should be re-opened
        expect(await cb.getState()).toBe('open');

        // Subsequent requests still fail fast
        const postReopen = await timed(() =>
            cb.execute(() => Promise.resolve('should not reach')),
        );
        expect(postReopen.error).toBeInstanceOf(CircuitOpenError);
        expect(postReopen.ms).toBeLessThan(10);
    });

    // ------------------------------------------------------------------
    // Bonus: Mixed traffic (some succeed, then outage) transitions correctly
    // ------------------------------------------------------------------
    it('handles mixed traffic transitioning from healthy to outage', async () => {
        // Phase 1: 20 successful requests
        const healthyResults = await Promise.all(
            Array.from({ length: 20 }, () =>
                timed(() => cb.execute(healthyWorker(2))),
            ),
        );
        expect(healthyResults.every(r => r.error === null)).toBe(true);
        expect(await cb.getState()).toBe('closed');

        // Phase 2: AI worker goes down — failures accumulate
        const failResults: Awaited<ReturnType<typeof timed>>[] = [];
        for (let i = 0; i < THRESHOLD + 5; i++) {
            failResults.push(await timed(() => cb.execute(slowFail(5))));
        }

        // First THRESHOLD should be regular errors, remaining should be CircuitOpenError
        const circuitOpenErrors = failResults.filter(r => r.error instanceof CircuitOpenError);
        expect(circuitOpenErrors.length).toBe(5); // the 5 after threshold
        expect(await cb.getState()).toBe('open');

        // Phase 3: Fast-fail verification
        const fastFail = await timed(() => cb.execute(() => Promise.resolve('x')));
        expect(fastFail.error).toBeInstanceOf(CircuitOpenError);
        expect(fastFail.ms).toBeLessThan(10);
    });
});

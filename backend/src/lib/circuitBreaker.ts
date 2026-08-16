/**
 * Redis-backed circuit breaker for the AI worker HTTP call.
 *
 * State machine:
 *   closed  → normal operation; failures are counted
 *   open    → circuit is open; all calls fail fast for `openDurationSeconds`
 *   half-open → open TTL expired; ONE probe call is allowed through
 *               success → closed, failure → open again
 *
 * All state is stored in Redis so it is shared across multiple backend
 * processes/replicas. The circuit breaker never throws on Redis errors;
 * it fails open (allows the call through) to avoid masking real issues.
 *
 * Observability:
 *   - Sentry warning captured on first open (closed → open transition only)
 *   - Redis counter `metrics:pipeline:circuit.<name>.opened` incremented on every open
 *     (visible in GET /health/pipeline-metrics)
 *   - Thresholds configurable via CIRCUIT_BREAKER_FAILURE_THRESHOLD and
 *     CIRCUIT_BREAKER_OPEN_DURATION_SECONDS env vars
 */
import type { Redis as RedisClient } from 'ioredis';
import * as Sentry from '@sentry/node';
import { redis } from './redis';
import { config } from '../config';

export class CircuitOpenError extends Error {
    constructor() {
        super('Circuit breaker is open');
        this.name = 'CircuitOpenError';
    }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    /** Consecutive failures before opening (default: CIRCUIT_BREAKER_FAILURE_THRESHOLD env or 5) */
    failureThreshold?: number;
    /** Seconds to stay open before allowing one probe (default: CIRCUIT_BREAKER_OPEN_DURATION_SECONDS env or 30) */
    openDurationSeconds?: number;
    /** Max seconds a half-open probe lock is held (default: 15) */
    probeLockTtlSeconds?: number;
    /** Failure counter auto-expires after N idle seconds (default: 300) */
    inactivityResetSeconds?: number;
    /**
     * Decides whether a thrown error indicates the PROTECTED SERVICE is sick
     * (count it toward opening) or is an application-level outcome delivered
     * successfully over a healthy hop (rethrow without counting). Default:
     * everything counts — the pre-2026-08-16 behavior.
     */
    countsAsFailure?: (err: unknown) => boolean;
}

export class CircuitBreaker {
    private readonly name: string;
    private readonly failureKey: string;
    private readonly circuitOpenKey: string;
    private readonly probeLockKey: string;
    private readonly openedCounterKey: string;
    private readonly failureThreshold: number;
    private readonly openDurationSeconds: number;
    private readonly probeLockTtlSeconds: number;
    private readonly inactivityResetSeconds: number;
    private readonly countsAsFailure: (err: unknown) => boolean;

    constructor(private readonly client: RedisClient, name: string, opts: CircuitBreakerOptions = {}) {
        this.name = name;
        this.failureKey = `cb:${name}:failures`;
        this.circuitOpenKey = `cb:${name}:open`;
        this.probeLockKey = `cb:${name}:probe_lock`;
        this.openedCounterKey = `metrics:pipeline:circuit.${name}.opened`;
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.openDurationSeconds = opts.openDurationSeconds ?? 30;
        this.probeLockTtlSeconds = opts.probeLockTtlSeconds ?? 15;
        this.inactivityResetSeconds = opts.inactivityResetSeconds ?? 300;
        this.countsAsFailure = opts.countsAsFailure ?? (() => true);
    }

    async getState(): Promise<CircuitState> {
        const isOpen = await this.client.exists(this.circuitOpenKey);
        if (isOpen) return 'open';
        const failures = parseInt((await this.client.get(this.failureKey)) ?? '0', 10);
        if (failures >= this.failureThreshold) return 'half-open';
        return 'closed';
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        const state = await this.getState();

        if (state === 'open') {
            throw new CircuitOpenError();
        }

        if (state === 'half-open') {
            // Only allow one concurrent probe — atomic SET NX
            const acquired = await this.client.set(
                this.probeLockKey, '1', 'EX', this.probeLockTtlSeconds, 'NX',
            );
            if (!acquired) {
                throw new CircuitOpenError();
            }
        }

        try {
            const result = await fn();
            // Success: reset all circuit breaker state
            await this.client.del(this.failureKey, this.circuitOpenKey, this.probeLockKey);
            return result;
        } catch (error) {
            // An application-level outcome (e.g. the ai-worker's typed AiRefusalError
            // 500) reached us over a HEALTHY hop — the service answered. For circuit
            // purposes that is evidence of health, identical to a success: reset state
            // (a half-open probe that yields one heals the circuit) and rethrow for the
            // caller to handle. Before 2026-08-16 these counted as failures, so five
            // refusals from ONE corrupted thread opened the fleet-shared ai_worker
            // circuit and starved every other page's replies for the open window.
            if (!this.countsAsFailure(error)) {
                await this.client.del(this.failureKey, this.circuitOpenKey, this.probeLockKey);
                throw error;
            }
            const count = await this.client.incr(this.failureKey);
            // Set inactivity expiry only on the first failure (don't refresh on subsequent ones)
            if (count === 1) {
                await this.client.expire(this.failureKey, this.inactivityResetSeconds);
            }
            if (count >= this.failureThreshold) {
                await this.client.set(this.circuitOpenKey, '1', 'EX', this.openDurationSeconds);

                // Increment the observable counter (shown in /health/pipeline-metrics)
                this.client.incr(this.openedCounterKey).catch(() => {});

                // Sentry alert only on first open (closed → open), not on probe failures
                // that re-open an already-triggered circuit (half-open → open).
                if (state === 'closed') {
                    Sentry.captureMessage(`Circuit breaker '${this.name}' opened`, {
                        level: 'warning',
                        tags: { circuit: this.name },
                        extra: {
                            failureThreshold: this.failureThreshold,
                            openDurationSeconds: this.openDurationSeconds,
                        },
                    });
                }
            }
            if (state === 'half-open') {
                // Release probe lock so the next open→half-open cycle can try again
                await this.client.del(this.probeLockKey);
            }
            throw error;
        }
    }

    /** Reset all circuit breaker state (for admin / testing). */
    async reset(): Promise<void> {
        await this.client.del(this.failureKey, this.circuitOpenKey, this.probeLockKey);
    }
}

/**
 * Typed ai-worker errors that are APPLICATION OUTCOMES, not worker sickness.
 * The worker serializes them as `{ error: { name, message } }` on an HTTP 500
 * (routes.ts) — the hop itself succeeded. AiTimeoutError and
 * AiQuotaExhaustedError are deliberately NOT here: a sustained quota outage is
 * *supposed* to trip this circuit (see the failover note in services/ai.ts).
 */
const NON_CIRCUIT_ERROR_NAMES = new Set(['AiRefusalError', 'AiEmptyReplyError']);

export function isWorkerApplicationOutcome(err: unknown): boolean {
    const name = (err as { response?: { data?: { error?: { name?: unknown } } } })
        ?.response?.data?.error?.name;
    return typeof name === 'string' && NON_CIRCUIT_ERROR_NAMES.has(name);
}

export const aiWorkerCircuit = new CircuitBreaker(redis, 'ai_worker', {
    failureThreshold: config.circuitBreaker.failureThreshold,
    openDurationSeconds: config.circuitBreaker.openDurationSeconds,
    countsAsFailure: (err) => !isWorkerApplicationOutcome(err),
});

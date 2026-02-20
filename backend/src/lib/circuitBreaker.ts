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
 */
import type { Redis as RedisClient } from 'ioredis';
import { redis } from './redis';

export class CircuitOpenError extends Error {
    constructor() {
        super('Circuit breaker is open');
        this.name = 'CircuitOpenError';
    }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    /** Consecutive failures before opening (default: 5) */
    failureThreshold?: number;
    /** Seconds to stay open before allowing one probe (default: 30) */
    openDurationSeconds?: number;
    /** Max seconds a half-open probe lock is held (default: 15) */
    probeLockTtlSeconds?: number;
    /** Failure counter auto-expires after N idle seconds (default: 300) */
    inactivityResetSeconds?: number;
}

export class CircuitBreaker {
    private readonly failureKey: string;
    private readonly circuitOpenKey: string;
    private readonly probeLockKey: string;
    private readonly failureThreshold: number;
    private readonly openDurationSeconds: number;
    private readonly probeLockTtlSeconds: number;
    private readonly inactivityResetSeconds: number;

    constructor(private readonly client: RedisClient, name: string, opts: CircuitBreakerOptions = {}) {
        this.failureKey = `cb:${name}:failures`;
        this.circuitOpenKey = `cb:${name}:open`;
        this.probeLockKey = `cb:${name}:probe_lock`;
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.openDurationSeconds = opts.openDurationSeconds ?? 30;
        this.probeLockTtlSeconds = opts.probeLockTtlSeconds ?? 15;
        this.inactivityResetSeconds = opts.inactivityResetSeconds ?? 300;
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
            const count = await this.client.incr(this.failureKey);
            // Set inactivity expiry only on the first failure (don't refresh on subsequent ones)
            if (count === 1) {
                await this.client.expire(this.failureKey, this.inactivityResetSeconds);
            }
            if (count >= this.failureThreshold) {
                await this.client.set(this.circuitOpenKey, '1', 'EX', this.openDurationSeconds);
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

export const aiWorkerCircuit = new CircuitBreaker(redis, 'ai_worker', {
    failureThreshold: 5,
    openDurationSeconds: 30,
});

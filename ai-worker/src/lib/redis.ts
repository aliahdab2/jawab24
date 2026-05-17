/**
 * Shared Redis client for ai-worker. Used by the Phase 6.5 diagnostic metrics
 * emit only; BullMQ keeps its own internal connection. Mirrors the backend
 * pattern in backend/src/lib/redis.ts.
 *
 * Lazy-initialised so tests that mock `../config` without a `redis` block
 * don't crash module load. Production reads from env-defaulted config.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { Sentry } from './sentry';

let _client: Redis | null = null;
let _authFailed = false;

function build(): Redis {
    const r = new Redis({
        host: config.redis?.host ?? 'localhost',
        port: config.redis?.port ?? 6379,
        password: config.redis?.password,
        lazyConnect: true,
        retryStrategy(times) {
            if (_authFailed) return null;
            return Math.min(times * 50, 2000);
        },
    });

    r.on('error', (err) => {
        if (err.message?.includes('WRONGPASS') || err.message?.includes('NOAUTH')) {
            if (!_authFailed) {
                _authFailed = true;
                console.error('Redis auth failed — check REDIS_PASSWORD in env. Retries stopped.');
                Sentry.captureException(err, { tags: { service: 'redis', type: 'auth_failure' }, level: 'fatal' });
            }
            return;
        }
        console.error('Redis Client Error:', err);
        Sentry.captureException(err, { tags: { service: 'redis' } });
    });

    return r;
}

/**
 * Lazy singleton — instantiated on first access. Keeps test modules that
 * mock `../config` (without a `redis` block) from crashing during import.
 */
export const redis = {
    incr(key: string): Promise<number> {
        if (!_client) {
            try {
                _client = build();
            } catch (err) {
                // Config unavailable (test env without redis mock) — degrade silently.
                return Promise.reject(err);
            }
        }
        return _client.incr(key);
    },
};

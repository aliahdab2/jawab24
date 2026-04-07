import Redis from 'ioredis';
import { config } from '../config';
import * as Sentry from '@sentry/node';

// Track whether Redis has failed due to an auth error.
// Auth errors (WRONGPASS / NOAUTH) are permanent until config is fixed —
// retrying them generates noise and never recovers.
let redisAuthFailed = false;
export const isRedisAuthFailed = () => redisAuthFailed;

// Create a shared Redis instance.
// Redis command tracing is handled automatically by @sentry/node v10+
// which instruments ioredis out of the box (spans for every command).
export const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    lazyConnect: true, // Don't connect immediately on import
    retryStrategy(times) {
        // Stop retrying immediately on auth failures — they won't resolve
        // without a config change, and retrying every 2s just floods Sentry.
        if (redisAuthFailed) return null;
        return Math.min(times * 50, 2000);
    },
});

redis.on('error', (err) => {
    if (err.message?.includes('WRONGPASS') || err.message?.includes('NOAUTH')) {
        if (!redisAuthFailed) {
            redisAuthFailed = true;
            console.error('Redis auth failed — check REDIS_PASSWORD in env. Retries stopped.');
            Sentry.captureException(err, { tags: { service: 'redis', type: 'auth_failure' }, level: 'fatal' });
        }
        return;
    }
    console.error('Redis Client Error:', err);
    Sentry.captureException(err, { tags: { service: 'redis' } });
});

redis.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('✅ Redis Client Connected');
});

redis.on('ready', () => {
    // 'ready' fires after AUTH + SELECT succeed — safe to reset auth failure flag here
    redisAuthFailed = false;
});

/**
 * Scan Redis for keys matching a pattern and delete them in batches.
 * Uses SCAN (non-blocking) instead of KEYS to avoid blocking Redis in production.
 * @param pattern - Redis glob pattern (e.g. 'cache:ai_reply:*')
 * @param filter  - Optional predicate to exclude specific keys from deletion
 * @param batchSize - Keys per DEL command (default 100)
 * @returns Number of keys deleted
 */
export async function redisScanDelete(
    pattern: string,
    filter?: (key: string) => boolean,
    batchSize: number = 100,
): Promise<number> {
    let cursor = '0';
    const keysToDelete: string[] = [];
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
            if (!filter || filter(key)) keysToDelete.push(key);
        }
    } while (cursor !== '0');

    let deleted = 0;
    for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        if (batch.length > 0) {
            await redis.del(...batch);
            deleted += batch.length;
        }
    }
    return deleted;
}

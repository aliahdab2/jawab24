import { redis } from '../lib/redis';

/**
 * Workspace stats caching — shared keys + helpers.
 *
 * Three caches, one invalidation story:
 *  - pages stats   (dashboard per-page breakdown, services/pages.ts getPages)
 *  - messages stats (/messages/stats — full-history FILTER aggregation)
 *  - comments stats (/comments/stats — same shape over FB + IG comments)
 *
 * The messages/comments aggregations scan the workspace's entire history
 * (200k+ rows for the biggest workspace) on every page load, so they are
 * cached briefly. Freshness is preserved by two invalidation paths:
 *  - webhook/reply pipeline → invalidateWorkspaceStatsCache (pages.ts),
 *    throttled to once per 30s so high message volume can't defeat the cache
 *  - user-initiated mutations (manual reply, resolve…) → invalidateEndpointStatsCaches,
 *    unthrottled, so the UI's own refetch after an action always sees fresh counts
 */

/** How long workspace stats stay cached in Redis (seconds). */
export const STATS_CACHE_TTL = 300;
/** TTL for the per-endpoint stats aggregations (seconds). */
export const ENDPOINT_STATS_CACHE_TTL = 60;

export const pagesStatsCacheKey = (workspaceId: string) => `stats:workspace:${workspaceId}:v2`;
export const messagesStatsCacheKey = (workspaceId: string) => `stats:messages:${workspaceId}:v1`;
export const commentsStatsCacheKey = (workspaceId: string) => `stats:comments:${workspaceId}:v1`;

/** All stats keys for a workspace — what a full invalidation must delete. */
export const allStatsCacheKeys = (workspaceId: string): string[] => [
    pagesStatsCacheKey(workspaceId),
    messagesStatsCacheKey(workspaceId),
    commentsStatsCacheKey(workspaceId),
];

/** Best-effort cache read — Redis being down must never break stats. */
async function readStatsCache<T>(key: string): Promise<T | null> {
    const cached = await redis.get(key).catch(() => null);
    if (!cached) return null;
    try {
        return JSON.parse(cached) as T;
    } catch {
        return null;
    }
}

/** Fire-and-forget cache write. */
function writeStatsCache(key: string, value: unknown, ttlSeconds: number): void {
    redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
}

/**
 * Cache-through wrapper for stats aggregations: returns the cached value when
 * present, otherwise computes, stores (fire-and-forget), and returns it.
 * Pass `cacheKey: null` to bypass caching entirely (e.g. page-filtered calls).
 */
export async function withStatsCache<T>(
    cacheKey: string | null,
    ttlSeconds: number,
    compute: () => Promise<T>,
): Promise<T> {
    if (cacheKey) {
        const cached = await readStatsCache<T>(cacheKey);
        if (cached !== null) return cached;
    }
    const value = await compute();
    if (cacheKey) writeStatsCache(cacheKey, value, ttlSeconds);
    return value;
}

/**
 * Unthrottled invalidation of the endpoint stats caches (messages + comments).
 * For user-initiated mutations (manual reply, resolve, delete) where the UI
 * refetches immediately and must see the change. Fire-and-forget.
 */
export function invalidateEndpointStatsCaches(workspaceId: string): void {
    redis.del(messagesStatsCacheKey(workspaceId), commentsStatsCacheKey(workspaceId)).catch(() => {});
}

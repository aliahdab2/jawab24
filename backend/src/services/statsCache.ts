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
 * cached briefly. Freshness is preserved by these invalidation paths:
 *  - webhook/reply pipeline → invalidateWorkspaceStatsCache (below). The
 *    endpoint (messages + comments) caches are dropped UNTHROTTLED there, so the
 *    SSE-driven chip refetch always reads a fresh count; only the heavier
 *    dashboard/pages aggregate stays throttled to once per 30s.
 *  - user-initiated mutations (manual reply, resolve…) → invalidateEndpointStatsCaches,
 *    unthrottled, so the UI's own refetch after an action always sees fresh counts
 *
 * Why endpoint invalidation must stay unthrottled: the inbox "needs action" chip
 * reads a cached count while the comment/message list is uncached. A throttled
 * DEL let the chip's SSE-triggered refetch read a stale count that then stuck
 * (chip shows N, list shows 0). The DEL is cheap; recompute happens on the next
 * (debounced) read, so unthrottled invalidation can't storm the DB.
 */

/** How long workspace stats stay cached in Redis (seconds). */
export const STATS_CACHE_TTL = 300;
/** TTL for the per-endpoint stats aggregations (seconds). */
export const ENDPOINT_STATS_CACHE_TTL = 60;
/** Minimum interval between dashboard/pages-aggregate invalidations per workspace (seconds). */
export const STATS_INVALIDATION_THROTTLE = 30;

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

/**
 * Invalidate a workspace's stats caches after a reply/webhook mutation.
 *
 * Two caches with different freshness needs:
 *
 *  - Endpoint stats (messages + comments) back the inbox "needs action" chips.
 *    The client refetches them the instant an SSE reply_sent/received event fires,
 *    and the chip query has no polling fallback. These are dropped UNTHROTTLED:
 *    throttling this DEL let an SSE-driven refetch read a stale count that then
 *    stuck forever (chip shows N, the uncached list shows 0 → the "stuck
 *    needs-attention counter" bug). The DEL is a cheap O(1) Redis op; the
 *    expensive recompute only happens on the next read, which is already
 *    debounced client-side, so unthrottled invalidation cannot storm the DB.
 *
 *  - The dashboard/pages aggregate is heavier and read far less often (dashboard
 *    load, nav badge). It keeps the throttle so high reply volume can't defeat
 *    its cache.
 *
 * Fire-and-forget — Redis being down must never break the reply pipeline.
 */
export function invalidateWorkspaceStatsCache(workspaceId: string): void {
    // Inbox chip counts — must always be fresh for the SSE-driven refetch.
    invalidateEndpointStatsCaches(workspaceId);

    // Dashboard/pages aggregate — throttled. SET NX EX: only sets if the key
    // doesn't exist, auto-expiring after the window; if it already exists (recently
    // invalidated), the DEL is skipped.
    const throttleKey = `stats:throttle:${workspaceId}`;
    redis.set(throttleKey, '1', 'EX', STATS_INVALIDATION_THROTTLE, 'NX').then((result) => {
        if (result === 'OK') {
            redis.del(pagesStatsCacheKey(workspaceId)).catch(() => {});
        }
    }).catch(() => {});
}

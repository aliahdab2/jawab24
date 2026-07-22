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
/**
 * Per-workspace invalidation counter, bumped on every endpoint-stats invalidation.
 * Lets a cache write detect that the data changed while it was computing — see
 * writeStatsCacheIfFresh below.
 */
export const statsEpochKey = (workspaceId: string) => `stats:epoch:${workspaceId}`;
/** TTL refreshed on every epoch bump — the counter only needs to outlive a compute. */
const STATS_EPOCH_TTL = 86400;

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
 * Guarded cache write: stores the value ONLY if the workspace's invalidation
 * epoch is unchanged since the compute started.
 *
 * Without this guard, a DEL that lands mid-compute is undone by the compute's own
 * write — the classic read-compute-write race:
 *   1. SSE `comment:received` → chip refetches stats → compute reads the DB and
 *      sees 1 action-required comment
 *   2. the AI replies → reply pipeline DELs the (not yet written) cache key
 *   3. the compute from step 1 finishes and writes `actionRequired: 1`, TTL 60s
 *   4. the `comment:reply_sent` refetch reads that stale 1, while the uncached
 *      list correctly returns 0 → chip shows 1 over an empty list, and sticks
 *      (react-query has no polling fallback, so it holds the value until the next
 *      SSE event — on a quiet page, indefinitely)
 *
 * The epoch is bumped by the same call that DELs, so a stale write is detected and
 * skipped; the next read simply recomputes. Missing epoch key (never invalidated /
 * expired) is represented as '' on both sides so a first write still lands.
 */
function writeStatsCacheIfFresh(
    key: string,
    epochKey: string,
    epochAtStart: string,
    value: unknown,
    ttlSeconds: number,
): void {
    redis.eval(
        `local cur = redis.call('GET', KEYS[2])
         if cur == false then cur = '' end
         if cur == ARGV[3] then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) end
         return 1`,
        2,
        key,
        epochKey,
        JSON.stringify(value),
        String(ttlSeconds),
        epochAtStart,
    ).catch(() => {});
}

/** Read the current invalidation epoch — '' when the counter doesn't exist yet. */
async function readStatsEpoch(epochKey: string): Promise<string> {
    return (await redis.get(epochKey).catch(() => null)) ?? '';
}

/**
 * Cache-through wrapper for stats aggregations: returns the cached value when
 * present, otherwise computes, stores (fire-and-forget), and returns it.
 * Pass `cacheKey: null` to bypass caching entirely (e.g. page-filtered calls).
 *
 * Pass `epochKey` (endpoint stats do) to make the write race-safe against an
 * invalidation that lands mid-compute — see writeStatsCacheIfFresh.
 */
export async function withStatsCache<T>(
    cacheKey: string | null,
    ttlSeconds: number,
    compute: () => Promise<T>,
    epochKey?: string,
): Promise<T> {
    if (cacheKey) {
        const cached = await readStatsCache<T>(cacheKey);
        if (cached !== null) return cached;
    }
    // Captured BEFORE the compute reads the DB, so any invalidation racing the
    // compute is visible as a changed epoch at write time.
    const epochAtStart = cacheKey && epochKey ? await readStatsEpoch(epochKey) : '';
    const value = await compute();
    if (cacheKey) {
        if (epochKey) writeStatsCacheIfFresh(cacheKey, epochKey, epochAtStart, value, ttlSeconds);
        else writeStatsCache(cacheKey, value, ttlSeconds);
    }
    return value;
}

/**
 * Unthrottled invalidation of the endpoint stats caches (messages + comments).
 * For user-initiated mutations (manual reply, resolve, delete) where the UI
 * refetches immediately and must see the change. Fire-and-forget.
 */
export function invalidateEndpointStatsCaches(workspaceId: string): void {
    // Bump the epoch in the same pipeline as the DEL: a compute already in flight
    // must not be able to write its pre-mutation snapshot after this DEL lands.
    redis.multi()
        .del(messagesStatsCacheKey(workspaceId), commentsStatsCacheKey(workspaceId))
        .incr(statsEpochKey(workspaceId))
        .expire(statsEpochKey(workspaceId), STATS_EPOCH_TTL)
        .exec()
        .catch(() => {});
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

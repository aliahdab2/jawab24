/**
 * Per-entity daily usage cap backed by Redis.
 *
 * One home for the "N per day, keyed by {something}:{id}:{date}" pattern so the
 * paid-AI abuse guards (KB Vision extraction, customer-image understanding, …)
 * don't each hand-roll their own `redis.get`/`incr`/`expire` dance.
 *
 * `checkDailyCap` THROWS if Redis is unreachable — callers decide their own
 * fail-closed policy (a daily cap is the only bound on a real cost vector, so
 * "can't check" should mean "don't proceed", not "proceed uncounted").
 */
import { redis } from './redis';

/** Build a daily-cap key: `${prefix}:${id}:YYYY-MM-DD` (UTC day). */
export function dailyCapKey(prefix: string, id: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `${prefix}:${id}:${today}`;
}

export interface DailyCapStatus {
    allowed: boolean;
    used: number;
    limit: number;
}

/**
 * Read today's usage for `key` and compare against `limit`.
 * Throws if Redis is unreachable (caller fails closed).
 */
export async function checkDailyCap(key: string, limit: number): Promise<DailyCapStatus> {
    const used = parseInt((await redis.get(key)) || '0', 10);
    return { allowed: used < limit, used, limit };
}

/**
 * Claim `key` for the rest of the day, returning true only for the FIRST
 * caller. The "tell the merchant once, not once per event" primitive: a page
 * that hits a cap fifty times in an evening should produce one notification.
 *
 * Same SET-NX shape the throttled admin alerts use (`services/adminAlerts.ts`),
 * lifted here because it is a Redis key primitive, not an alerting concern —
 * and because merchant-facing notifications need it without dragging in Sentry
 * and the email service.
 *
 * Best-effort: if Redis is unreachable the claim SUCCEEDS. For a notification,
 * a duplicate beats silence — the opposite of `checkDailyCap`, which fails
 * closed because it bounds real spend.
 */
export async function claimDailyOnce(key: string, ttlSeconds = 86400): Promise<boolean> {
    try {
        return (await redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch {
        return true;
    }
}

/**
 * Increment today's counter for `key` with a 24h TTL. Best-effort — never
 * throws, so a Redis blip at increment time costs at most one extra call.
 */
export async function incrementDailyCap(key: string): Promise<void> {
    try {
        await redis.incr(key);
        await redis.expire(key, 86400);
    } catch {
        // Non-critical — a missed increment grants one extra call.
    }
}

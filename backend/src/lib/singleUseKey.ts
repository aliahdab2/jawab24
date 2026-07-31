import { redis } from './redis';

/**
 * One-shot Redis markers: written once, readable exactly once.
 *
 * Two flows need a credential that a replay cannot reuse — the app→browser
 * handoff code (`services/auth.ts`) and the app-minted WhatsApp connect state
 * (`controllers/whatsappRedirect.ts`) — and both must consume ATOMICALLY, or
 * two concurrent redemptions each see the value before either deletes it.
 *
 * MULTI GET+DEL rather than GETDEL so no Redis ≥6.2 requirement sneaks in.
 */

/** Write a one-shot marker. `ttlMs` bounds how long redemption stays possible. */
export async function issueSingleUse(key: string, value: string, ttlMs: number): Promise<void> {
    await redis.set(key, value, 'PX', ttlMs);
}

/** The stored value on the FIRST call; null for replays, expiry, or unknown keys. */
export async function consumeSingleUse(key: string): Promise<string | null> {
    const results = await redis.multi().get(key).del(key).exec();
    const value = results?.[0]?.[1];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

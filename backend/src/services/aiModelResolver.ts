import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { DEFAULT_AI_MODEL, isAllowedAiModel } from '@jawab24/shared';

/**
 * Resolves which AI model a given user is configured to use.
 *
 * Reads `settings.ai_model` for the user. Returns `DEFAULT_AI_MODEL` when the
 * row is missing, the value is empty, or the value is not in
 * `ALLOWED_AI_MODELS` — a typo in the DB column is a silent fallback, not
 * a runtime error, so a misconfigured row never breaks reply delivery.
 *
 * Called on every reply (comment + DM + lead extraction), so the lookup is
 * cached in-memory with a short TTL. The cache is invalidated explicitly by
 * the admin override endpoint via `clearAiModelCache(userId)`.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;

interface CacheEntry {
    model: string;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function evictExpiredOrOldest(): void {
    if (cache.size < MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size < MAX_ENTRIES) return;
    // Drop oldest insertion (Map preserves insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
}

export async function getModelForUser(userId: string | null | undefined): Promise<string> {
    if (!userId) return DEFAULT_AI_MODEL;

    const cached = cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.model;

    const rows = await db
        .select({ aiModel: settings.aiModel })
        .from(settings)
        .where(eq(settings.userId, userId))
        .limit(1);

    const raw: string | null = rows[0]?.aiModel ?? null;
    const resolved: string = isAllowedAiModel(raw) ? raw : DEFAULT_AI_MODEL;

    evictExpiredOrOldest();
    cache.set(userId, { model: resolved, expiresAt: Date.now() + TTL_MS });
    return resolved;
}

/** Invalidate the cached resolution for a user — call after PATCH /admin/users/:userId/ai-model. */
export function clearAiModelCache(userId?: string): void {
    if (userId) cache.delete(userId);
    else cache.clear();
}

/** Test-only: inspect cache state. */
export function _internalCacheSize(): number {
    return cache.size;
}

import { normalizeArabic } from '@jawab24/shared';

/**
 * The exact-cache key text normalization — THE single definition.
 *
 * Both the cache key builder (ai.ts buildCacheKey) and the post-deploy warm
 * ranking (services/cacheWarming.ts) must group messages exactly the same way:
 * if these ever diverged, warmed entries would land under keys production
 * never reads. Sharing one function makes drift impossible.
 *
 * Pipeline: Arabic normalization (alef variants, tatweel, Arabic-Indic digits —
 * same call the embedding path uses) → lowercase → strip everything that isn't
 * a letter/number/whitespace (diacritics are \p{M}, so they go too) → collapse
 * whitespace → trim.
 */
export function normalizeForExactCacheKey(text: string): string {
    return normalizeArabic(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

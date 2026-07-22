import type { FacebookMessageTag } from '../utils/commentText';
import { normalizeForExactCacheKey } from '../utils/exactCacheNormalize';

/**
 * Candidate selection for the post-deploy reply-cache warm job
 * (scripts/warm-reply-cache.ts).
 *
 * The exact cache is keyed per (normalized text, page, post context, …) — see
 * ai.ts buildCacheKey. Warming replays the most *frequent* recent (message,
 * page, post) combinations, because frequency over the last week predicts which
 * keys will be read again this week. Pure module — the script does the I/O.
 */

export interface WarmCandidateRow {
    /** Raw inbound comment text (what production replied to). */
    message: string;
    pageId: string;
    /** The post/media caption — part of the cache key (`p:` segment). */
    postMessage: string | null;
    platform: 'facebook' | 'instagram';
    /** Facebook `message_tags` (null for Instagram) — replayed so the friend-tag skip rule applies. */
    messageTags: FacebookMessageTag[] | null;
}

export interface RankedCandidate extends WarmCandidateRow {
    /** How many times this (normalized message, page, post) group appeared in the window. */
    count: number;
}

/**
 * Group rows by (cache-key-normalized message, pageId, postMessage), rank by
 * frequency descending, cap at topN.
 *
 * - Normalization is THE shared exact-cache function (utils/exactCacheNormalize)
 *   so grouping matches key construction — «كم السعر؟» and «كم  السعر» are one
 *   candidate, but the same question on two posts (different `p:` segment) or
 *   two pages stays two candidates.
 * - Rows are expected newest-first; each group keeps the raw fields of the
 *   newest row (freshest messageTags/postMessage variant is what gets replayed).
 * - Rows whose text normalizes to empty are dropped (nothing to key on).
 */
export function rankWarmCandidates(rows: readonly WarmCandidateRow[], topN: number): RankedCandidate[] {
    const groups = new Map<string, RankedCandidate>();

    for (const row of rows) {
        const normalized = normalizeForExactCacheKey(row.message);
        if (!normalized) continue;
        const key = [normalized, row.pageId, row.postMessage ?? ''].join('\u0000');
        const existing = groups.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            groups.set(key, { ...row, count: 1 });
        }
    }

    return [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, Math.max(0, topN));
}

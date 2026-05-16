import type { InfiniteData, QueryClient } from '@tanstack/react-query';

/**
 * Trim infinite-query caches under `queryKey` (prefix match) to just their
 * first page. Use before invalidating an infinite list key — otherwise
 * `invalidateQueries` refetches every loaded page, turning one action or
 * SSE event into N concurrent requests against the api rate-limit.
 *
 * The user is looking at page 1 (newest data); older pages reload on demand
 * when they scroll.
 */
export function trimInfinitePagesToFirst(qc: QueryClient, queryKey: readonly unknown[]): void {
    qc.setQueriesData<InfiniteData<unknown> | undefined>(
        { queryKey },
        (old) => {
            if (!old || !Array.isArray(old.pages) || old.pages.length <= 1) return old;
            return {
                ...old,
                pages: old.pages.slice(0, 1),
                pageParams: old.pageParams.slice(0, 1),
            };
        },
    );
}

/**
 * Invalidate an infinite-query list key without refetching every loaded page.
 * Trims cached pages to the first one, then invalidates — the first page
 * refetches (newest data), older pages reload only when the user scrolls.
 *
 * Use this anywhere you'd otherwise call `invalidateQueries({ queryKey })`
 * on a key backed by `useInfiniteQuery` (messages, comments, leads).
 */
export function invalidateInfiniteListFresh(qc: QueryClient, queryKey: readonly unknown[]): void {
    trimInfinitePagesToFirst(qc, queryKey);
    qc.invalidateQueries({ queryKey });
}

export interface DebouncedInvalidator {
    /**
     * Queue an invalidation for `queryKey`. Bursts within `debounceMs` coalesce
     * into a single fire; sustained streams fire at `maxWaitMs` from the first
     * queued call so the UI is not starved indefinitely.
     *
     * `trimInfinite: true` resets infinite-query pages to the first page before
     * invalidating — required for infinite list keys to avoid refetching every
     * loaded page. If any caller in a burst opts in, the fire honors it.
     */
    invalidate(queryKey: readonly unknown[], opts?: { trimInfinite?: boolean }): void;
    /** Cancel all pending invalidations without firing. Call on unmount. */
    flush(): void;
}

/**
 * Per-queryKey debounced invalidator with a max-wait cap.
 *
 * Each invalidate() resets the trailing-edge timer (debounceMs), but the
 * refetch is forced after maxWaitMs from the first queued call. Both timers
 * race-safely: whichever wins, the other is cleared in `fire()`.
 *
 * Use case: SSE event handlers that invalidate the same queryKey on every
 * event would otherwise hammer the API on bursts (AI worker flush, webhook
 * waves). The debouncer collapses N events to one refetch per key.
 */
export function createDebouncedInvalidator(
    qc: QueryClient,
    debounceMs: number,
    maxWaitMs: number,
): DebouncedInvalidator {
    interface Pending {
        trailing: ReturnType<typeof setTimeout>;
        maxWait: ReturnType<typeof setTimeout>;
        trimInfinite: boolean;
    }
    const pending = new Map<string, Pending>();

    const fire = (key: string, queryKey: readonly unknown[]) => {
        const entry = pending.get(key);
        if (!entry) return;
        clearTimeout(entry.trailing);
        clearTimeout(entry.maxWait);
        pending.delete(key);
        if (entry.trimInfinite) trimInfinitePagesToFirst(qc, queryKey);
        qc.invalidateQueries({ queryKey });
    };

    return {
        invalidate(queryKey, opts) {
            const key = JSON.stringify(queryKey);
            const trimInfinite = opts?.trimInfinite ?? false;
            const existing = pending.get(key);
            if (existing) {
                clearTimeout(existing.trailing);
                existing.trailing = setTimeout(() => fire(key, queryKey), debounceMs);
                // Sticky: if any caller in the burst requested trim, honor it.
                existing.trimInfinite = existing.trimInfinite || trimInfinite;
                return;
            }
            const trailing = setTimeout(() => fire(key, queryKey), debounceMs);
            const maxWait = setTimeout(() => fire(key, queryKey), maxWaitMs);
            pending.set(key, { trailing, maxWait, trimInfinite });
        },
        flush() {
            for (const entry of pending.values()) {
                clearTimeout(entry.trailing);
                clearTimeout(entry.maxWait);
            }
            pending.clear();
        },
    };
}

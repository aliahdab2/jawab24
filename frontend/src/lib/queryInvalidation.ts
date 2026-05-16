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

import { useEffect, type RefObject } from 'react';

interface UseInfiniteScrollObserverOptions<T extends HTMLElement> {
  /** Sentinel element rendered at the end of the list. */
  targetRef: RefObject<T | null>;
  /** Whether the server has more pages to load. */
  hasNextPage: boolean;
  /** Whether a page fetch is currently in flight. */
  isFetchingNextPage: boolean;
  /** Loads the next page (typically react-query's `fetchNextPage`). */
  fetchNextPage: () => void;
  /**
   * When `false`, auto-loading is suspended (manual "Load More" still works).
   *
   * Pass `false` while a client-side search/filter is active: filtering shrinks
   * the rendered list, leaving the sentinel inside the viewport. The observer
   * would then page through the entire dataset back-to-back to feed a filter
   * that only ever looks at already-loaded rows — a burst of requests that
   * floods the network/console. Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Auto-loads the next page when a sentinel element scrolls into view.
 *
 * Shared by the messages, comments, and leads inboxes. The observer is a
 * browser API that fires on any intersection change, so it must be gated by
 * `enabled` whenever the list is filtered client-side (see option docs).
 */
export function useInfiniteScrollObserver<T extends HTMLElement>({
  targetRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  enabled = true,
}: UseInfiniteScrollObserverOptions<T>): void {
  useEffect(() => {
    const target = targetRef.current;
    if (!target || !hasNextPage || isFetchingNextPage || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '100px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef, hasNextPage, isFetchingNextPage, fetchNextPage, enabled]);
}

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { Page } from '@jawab24/shared';

const DEFAULT_STORAGE_KEY = 'inbox-page-filter';

interface UsePageFilterOptions {
  /** Storage key for localStorage persistence. Defaults to the inbox key. */
  storageKey?: string;
  /**
   * Which pages count as "valid" for this surface.
   *   - 'auto-reply' (default): only pages with autoReplyEnabled || instagramAutoReplyEnabled.
   *     Used by /comments and /messages — those surfaces only show traffic from
   *     active pages.
   *   - 'all': any connected page. Used by /leads — leads exist on every page,
   *     not only auto-reply-enabled ones.
   */
  validateAgainst?: 'auto-reply' | 'all';
}

/**
 * Shared page-filter logic for any inbox-style surface (comments, messages, leads).
 *
 * Responsibilities:
 *   - Restore pageId from localStorage on mount.
 *   - Sync pageId to URL query (`?page=<id>`) for deep-linkability.
 *   - Validate stored pageId against the configured valid-page set; reset if stale.
 *   - Expose `validPages` (filtered) for the dropdown so the consumer doesn't repeat the rule.
 *
 * URL takes precedence over localStorage on initial mount via `syncFromUrl`.
 */
export function usePageFilter(pages: Page[], options: UsePageFilterOptions = {}) {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const validateAgainst = options.validateAgainst ?? 'auto-reply';

  const router = useRouter();
  const [pageId, setPageId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(storageKey) || '';
  });

  const validPages = useMemo(() => {
    if (!Array.isArray(pages)) return [];
    if (validateAgainst === 'all') return pages;
    return pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled);
  }, [pages, validateAgainst]);

  // Validate stored pageId against the valid-page set once pages load.
  useEffect(() => {
    if (validPages.length === 0 || !pageId) return;
    if (!validPages.some(p => p.id === pageId)) {
      setPageId('');
      localStorage.removeItem(storageKey);
    }
  }, [validPages, pageId, storageKey]);

  const updatePageId = useCallback((newPageId: string) => {
    setPageId(newPageId);
    if (newPageId) {
      localStorage.setItem(storageKey, newPageId);
    } else {
      localStorage.removeItem(storageKey);
    }
    const params = new URLSearchParams(window.location.search);
    if (newPageId) {
      params.set('page', newPageId);
    } else {
      params.delete('page');
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [router, storageKey]);

  /** Call from URL-sync useEffect to restore pageId from query params.
   *  URL param takes precedence over localStorage (for deep links). */
  const syncFromUrl = useCallback((pageParam: string | undefined) => {
    if (pageParam) {
      setPageId(pageParam);
      localStorage.setItem(storageKey, pageParam);
    }
    // If no URL param, keep the localStorage-restored value from useState init
  }, [storageKey]);

  return {
    pageId,
    /** @deprecated Use `validPages` for clearer semantics; kept for /comments + /messages. */
    activePages: validPages,
    validPages,
    updatePageId,
    syncFromUrl,
  };
}

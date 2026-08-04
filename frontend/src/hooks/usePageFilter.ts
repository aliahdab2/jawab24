import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { Page } from '@jawab24/shared';
import { isPageAutoReplyEnabled } from '@/utils/page';

const DEFAULT_STORAGE_KEY = 'inbox-page-filter';

interface UsePageFilterOptions {
  /** Storage key for localStorage persistence. Defaults to the inbox key. */
  storageKey?: string;
  /**
   * Which pages count as "valid" for this surface.
   *   - 'auto-reply' (default): only pages with autoReplyEnabled || instagramAutoReplyEnabled.
   *     Used by /comments and /messages — those surfaces only show traffic from
   *     active pages.
   *   - 'all': every page, connected or not. Used by /leads — leads already
   *     collected exist (and stay reachable) even after a page disconnects.
   *   - 'connected': only pages whose primary channel credential is currently
   *     valid (`isConnected !== false` — absent means connected, the flag's
   *     convention across the app). Used by /business: a disconnected page
   *     receives no messages, so configuring its business info is dead work,
   *     and a 10-page selector where 8 are dead reads as clutter (owner
   *     report, 2026-08-04).
   */
  validateAgainst?: 'auto-reply' | 'all' | 'connected';
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
    if (validateAgainst === 'connected') return pages.filter((p) => p.isConnected !== false);
    return pages.filter(isPageAutoReplyEnabled);
  }, [pages, validateAgainst]);

  // Validate stored pageId against the valid-page set once pages load.
  //
  // Gate on `pages` being loaded (non-empty), NOT on `validPages` being non-empty:
  // an empty `pages` array means the query hasn't resolved yet, so clearing here
  // would clobber the localStorage-restored selection before we can validate it.
  // But once pages HAVE loaded, a stored id that's invalid for this surface must be
  // dropped even if zero pages qualify — otherwise a stale id (deleted workspace,
  // or a page whose auto-reply is now off) gets queried and 404s the list.
  useEffect(() => {
    if (!Array.isArray(pages) || pages.length === 0 || !pageId) return;
    if (!validPages.some(p => p.id === pageId)) {
      setPageId('');
      localStorage.removeItem(storageKey);
    }
  }, [pages, validPages, pageId, storageKey]);

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

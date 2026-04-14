import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { Page } from '@jawab24/shared';

const STORAGE_KEY = 'inbox-page-filter';

/**
 * Shared page filter logic for /comments and /messages pages.
 * Manages pageId state, URL sync (?page=<id>), localStorage persistence,
 * and active page list.
 */
export function usePageFilter(pages: Page[]) {
  const router = useRouter();
  const [pageId, setPageId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  const activePages = useMemo(() =>
    Array.isArray(pages) ? pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled) : [],
  [pages]);

  // Validate stored pageId against active pages once they load
  useEffect(() => {
    if (activePages.length === 0 || !pageId) return;
    if (!activePages.some(p => p.id === pageId)) {
      setPageId('');
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [activePages, pageId]);

  const updatePageId = useCallback((newPageId: string) => {
    setPageId(newPageId);
    if (newPageId) {
      localStorage.setItem(STORAGE_KEY, newPageId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    const params = new URLSearchParams(window.location.search);
    if (newPageId) {
      params.set('page', newPageId);
    } else {
      params.delete('page');
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [router]);

  /** Call from URL-sync useEffect to restore pageId from query params.
   *  URL param takes precedence over localStorage (for deep links). */
  const syncFromUrl = useCallback((pageParam: string | undefined) => {
    if (pageParam) {
      setPageId(pageParam);
      localStorage.setItem(STORAGE_KEY, pageParam);
    }
    // If no URL param, keep the localStorage-restored value from useState init
  }, []);

  return { pageId, activePages, updatePageId, syncFromUrl };
}

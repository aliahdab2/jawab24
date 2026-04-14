import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import type { Page } from '@jawab24/shared';

/**
 * Shared page filter logic for /comments and /messages pages.
 * Manages pageId state, URL sync (?page=<id>), and active page list.
 */
export function usePageFilter(pages: Page[]) {
  const router = useRouter();
  const [pageId, setPageId] = useState('');

  const activePages = useMemo(() =>
    Array.isArray(pages) ? pages.filter(p => p.autoReplyEnabled || p.instagramAutoReplyEnabled) : [],
  [pages]);

  const updatePageId = useCallback((newPageId: string) => {
    setPageId(newPageId);
    const params = new URLSearchParams(window.location.search);
    if (newPageId) {
      params.set('page', newPageId);
    } else {
      params.delete('page');
    }
    router.push({ pathname: router.pathname, query: params.toString() }, undefined, { shallow: true });
  }, [router]);

  /** Call from URL-sync useEffect to restore pageId from query params */
  const syncFromUrl = useCallback((pageParam: string | undefined) => {
    setPageId(pageParam || '');
  }, []);

  return { pageId, activePages, updatePageId, syncFromUrl };
}

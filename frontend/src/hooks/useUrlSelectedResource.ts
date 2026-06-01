import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/router';
import { useDeepLinkResource } from './useDeepLinkResource';

export interface UseUrlSelectedResourceOptions<T> {
  /** Query param that mirrors the open item in the URL (e.g. 'comment', 'lead'). */
  urlParam: string;
  /** Extract the URL key for an item (e.g. c => c.id). Must be stable (useCallback). */
  getKey: (item: T) => string;
  /** The already-loaded list — fast path to resolve the URL key without a fetch. */
  list: T[];
  /** Notification deep-link handoff: ?<paramName>=<id> is fetched directly and opened. */
  deepLink: {
    paramName: string;
    /** Fetch the resource by id (bypasses list pagination/filters). Must be stable (useCallback). */
    fetch: (id: string) => Promise<T | null>;
    notFoundMessage: string;
    errorTag: { page: string; action: string };
  };
  /** Optional page-specific side effect run just before any open (click or deep-link), e.g. closing a sibling modal. */
  onBeforeOpen?: () => void;
}

export interface UrlSelectedResource<T> {
  selected: T | null;
  /** Imperatively set the selected item (e.g. to live-sync an open item from SSE). */
  setSelected: Dispatch<SetStateAction<T | null>>;
  /** Open an item: pushes ?<urlParam>=<key> (shallow) so back/swipe-back closes it. */
  open: (item: T) => void;
  /** Close: router.back() when we pushed the entry, otherwise strips the param via replace. */
  close: () => void;
}

/**
 * URL-as-source-of-truth selection drawer, shared by the Comments and Leads
 * pages. Owns the selected item, the open/close navigation (so browser back /
 * swipe-back / hardware back close the drawer), and the deep-link handoff from a
 * notification: ?<paramName>=<id> is fetched directly (bypassing list pagination
 * /filters) and opened exactly like a click.
 *
 * Replaces the per-page copies of pendingOpenRef + pushedModalRef + the
 * sync-from-URL effect. (The Messages page keeps its own copy: its selection
 * state lives in useConversationActions, which mutates it for reply/resolve/
 * pause flows and is shared with the dashboard — not a fit for this hook.)
 */
export function useUrlSelectedResource<T>(
  opts: UseUrlSelectedResourceOptions<T>,
): UrlSelectedResource<T> {
  const { urlParam, getKey, list, deepLink } = opts;
  const router = useRouter();
  const [selected, setSelected] = useState<T | null>(null);

  // Whether the open navigation added a history entry, so close() knows to pop it
  // (router.back) vs strip the param (router.replace) — the latter covers items
  // opened by a direct URL load or by the sync effect, which never pushed.
  const pushedRef = useRef(false);
  // Items opened before they appear in the paginated list (deep-link fetch results)
  // are stashed here so the sync effect can show them without a list round-trip.
  const pendingRef = useRef<Map<string, T>>(new Map());

  // Keep onBeforeOpen in a ref so open() stays stable regardless of caller identity.
  const onBeforeOpenRef = useRef(opts.onBeforeOpen);
  useEffect(() => { onBeforeOpenRef.current = opts.onBeforeOpen; });

  const open = useCallback((item: T) => {
    onBeforeOpenRef.current?.();
    const key = getKey(item);
    pendingRef.current.set(key, item);
    pushedRef.current = true;
    router.push(
      { pathname: router.pathname, query: { ...router.query, [urlParam]: key } },
      undefined,
      { shallow: true },
    );
  }, [router, urlParam, getKey]);

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      router.back();
    } else {
      const { [urlParam]: _omit, ...rest } = router.query;
      void _omit;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router, urlParam]);

  // Deep-link: notification ?<paramName>=<id> → fetch directly → open like a click.
  useDeepLinkResource<T>(deepLink.paramName, {
    fetch: deepLink.fetch,
    onOpen: open,
    notFoundMessage: deepLink.notFoundMessage,
    errorTag: deepLink.errorTag,
  });

  // Sync the selected item from the URL (?<urlParam>=<key>). Drives open via
  // click/deep-link AND close via browser back / swipe-back / hardware back.
  const rawKey = router.query[urlParam];
  const urlKey = typeof rawKey === 'string' ? rawKey : undefined;
  useEffect(() => {
    if (!router.isReady) return;
    if (!urlKey) {
      if (selected) setSelected(null);
      return;
    }
    if (selected && getKey(selected) === urlKey) return;
    const pending = pendingRef.current.get(urlKey);
    if (pending) {
      pendingRef.current.delete(urlKey);
      setSelected(pending);
      return;
    }
    const found = list.find(item => getKey(item) === urlKey);
    if (found) setSelected(found);
  }, [router.isReady, urlKey, list, selected, getKey]);

  return { selected, setSelected, open, close };
}

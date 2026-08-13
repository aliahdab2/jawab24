import { useQuery } from '@tanstack/react-query';
import { leadsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/** One page's share of the workspace queue. */
export interface NewLeadsPageShare {
  pageId: string;
  count: number;
  oldestAt: string | null;
}

export interface NewLeadsSummary {
  /** `new`-status leads across EVERY page in the workspace. */
  count: number;
  /** Name on the most recent waiting lead — the row shows who is waiting. */
  latestName: string | null;
  latestAt: string | null;
  /**
   * When the OLDEST waiting lead arrived — the queue's urgency, and what the
   * attention row displays. `latestAt` would read "5 minutes ago" for a queue
   * whose worst case has waited ten days.
   */
  oldestAt: string | null;
  /**
   * `count` split per page, LONGEST-WAITING FIRST (the server's ordering).
   *
   * The badge counts the whole workspace while the leads list shows one page,
   * so this is what stops the badge's deep link from opening a page that holds
   * none of the waiting leads — and what lets the page picker show where the
   * work actually is.
   */
  byPage: NewLeadsPageShare[];
}

const EMPTY: NewLeadsSummary = { count: 0, latestName: null, latestAt: null, oldestAt: null, byPage: [] };

/**
 * Coerce whatever the endpoint actually returned into the declared shape.
 *
 * The `useQuery<NewLeadsSummary>` type parameter is a compile-time claim, not a
 * runtime guarantee — a 200 carrying a different body (an older/newer backend, a
 * proxy, a test mock) yields `count: undefined` while TypeScript still believes
 * it is a `number`. That is not theoretical: `UnreadBadge` used to guard with
 * `count <= 0`, and `undefined <= 0` is `false`, so an undefined count fell
 * straight through and rendered an EMPTY badge pill in the sidebar — on every
 * authenticated page, since the sidebar is part of the shared layout.
 *
 * Normalizing here keeps that guarantee in ONE place instead of asking every
 * consumer to re-check it. (The badge's own guard was also tightened to
 * `!(count > 0)`, so the two are belt and braces rather than one or the other.)
 */
function normalize(data: unknown): NewLeadsSummary {
  if (!data || typeof data !== 'object') return EMPTY;
  const raw = data as Partial<Record<keyof NewLeadsSummary, unknown>>;
  const count = typeof raw.count === 'number' && Number.isFinite(raw.count)
    ? Math.max(0, Math.trunc(raw.count))
    : 0;
  return {
    count,
    latestName: typeof raw.latestName === 'string' ? raw.latestName : null,
    latestAt: typeof raw.latestAt === 'string' ? raw.latestAt : null,
    oldestAt: typeof raw.oldestAt === 'string' ? raw.oldestAt : null,
    // Absent on a backend older than the breakdown — an empty list simply means
    // "no idea where the queue is", which the consumers already handle by
    // leaving the merchant's own page selection alone.
    byPage: normalizeByPage(raw.byPage),
  };
}

function normalizeByPage(value: unknown): NewLeadsPageShare[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Partial<Record<keyof NewLeadsPageShare, unknown>>;
    if (typeof raw.pageId !== 'string' || !raw.pageId) return [];
    const count = typeof raw.count === 'number' && Number.isFinite(raw.count)
      ? Math.max(0, Math.trunc(raw.count))
      : 0;
    if (count === 0) return [];
    return [{
      pageId: raw.pageId,
      count,
      oldestAt: typeof raw.oldestAt === 'string' ? raw.oldestAt : null,
    }];
  });
}

/**
 * The workspace's standing queue of leads nobody has worked yet.
 *
 * Read from the SERVER, not from the session counter in the UI store. The store's
 * `newLeads` only ever increments on a live `lead:captured` SSE event and starts at
 * zero every app load, so a merchant whose leads arrive while the app is closed sees
 * a zero badge over a queue that is not empty (found live 2026-08-04: 19 unworked
 * leads, badge showing nothing, and the merchant had never opened the section).
 *
 * Workspace-wide by design — the dashboard is workspace-scoped, and a multi-page
 * merchant must see every page's waiting customers in one number.
 *
 * The query key is shared with useSSE's `lead:captured` invalidation
 * (['leads-count']), so a lead arriving while the app IS open refetches this
 * instead of drifting from it.
 */
export function useNewLeadsSummary(): NewLeadsSummary {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);

  const { data } = useQuery<NewLeadsSummary>({
    // Scoped to the active workspace: switching workspaces does not clear the
    // query cache, so an unscoped key served the PREVIOUS workspace's count —
    // and its customer's name — for the whole staleTime. The `['leads-count']`
    // invalidations in useSSE / leads.tsx / dashboard.tsx still match this by
    // prefix, so they keep working untouched.
    queryKey: ['leads-count', activeWorkspaceId],
    queryFn: () => leadsApi.getNewSummary().then((r) => normalize(r.data)),
    enabled: hasHydrated && isAuthenticated,
    staleTime: 60_000,
    // A dropped request must not read as "all clear". Falling back to 0 is the
    // exact failure this feature exists to fix (a zero over a queue that is not
    // empty), so retry a transient blip instead of instantly showing nothing.
    // Once a value has been fetched, React Query keeps it across a failed
    // refetch, so this only guards the first load.
    retry: 2,
  });

  return data ?? EMPTY;
}

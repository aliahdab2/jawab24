import { useQuery } from '@tanstack/react-query';
import { leadsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export interface NewLeadsSummary {
  /** `new`-status leads across EVERY page in the workspace. */
  count: number;
  /** Name on the most recent waiting lead — the row shows who is waiting. */
  latestName: string | null;
  latestAt: string | null;
}

const EMPTY: NewLeadsSummary = { count: 0, latestName: null, latestAt: null };

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

  const { data } = useQuery<NewLeadsSummary>({
    queryKey: ['leads-count'],
    queryFn: () => leadsApi.getNewSummary().then((r) => r.data),
    enabled: hasHydrated && isAuthenticated,
    staleTime: 60_000,
    retry: false,
  });

  return data ?? EMPTY;
}

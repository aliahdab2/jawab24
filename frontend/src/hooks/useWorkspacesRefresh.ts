import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workspaceApi } from '@/lib/api';
import { useAuthStore, type WorkspaceSummary } from '@/lib/store';

/**
 * Refreshes the auth store's workspace list from the server for a standing
 * session.
 *
 * The list is otherwise written ONLY at login (login.tsx, auth/callback,
 * auth/sync) and then persisted, so a session that stays alive — web cookie
 * or native token — keeps serving that login-time snapshot forever. Anything
 * that changes a user's memberships after login (accepting a team invite,
 * a feature gate widened to a workspace, being removed from one) was
 * invisible until the user logged out and back in.
 *
 * staleTime: Infinity → one fetch per app load, cached across page
 * navigations. The query key is scoped by user id so a cached list can never
 * leak across an account switch that happens without a full page reload
 * (logout while already on /login, then a different login).
 */
export function useWorkspacesRefresh(): void {
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);
  const setWorkspaces = useAuthStore((s) => s.setWorkspaces);

  const { data } = useQuery<WorkspaceSummary[]>({
    queryKey: ['workspaces', 'session-refresh', userId],
    queryFn: () => workspaceApi.list().then((r) => r.data as WorkspaceSummary[]),
    enabled: hasHydrated && isAuthenticated && !!userId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    // Same guard as login.tsx: only a non-empty array overwrites the persisted
    // list. An empty/malformed response never wipes a working snapshot — a
    // user genuinely removed from every workspace is stopped by the backend's
    // own access checks regardless of what this cache holds.
    if (Array.isArray(data) && data.length > 0) {
      setWorkspaces(data);
    }
  }, [data, setWorkspaces]);
}

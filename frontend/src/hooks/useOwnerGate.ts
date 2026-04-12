import { useAuthStore } from '@/lib/store';
import { useWorkspaceRole } from './useWorkspaceRole';

/**
 * Returns whether the current authenticated user is blocked from owner-only actions.
 *
 * Returns `true` only after the store has hydrated AND the user is authenticated
 * AND is not an owner. Safe to use before hydration — always returns `false` while
 * the store is loading (avoids acting on the default `owner` role).
 *
 * Used by `withOwnerOnly` HOC (full-page redirect) and inline action guards
 * (e.g. pricing page subscribe button).
 */
export function useOwnerGate(): boolean {
  const _hasHydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isOwner } = useWorkspaceRole();
  return _hasHydrated && isAuthenticated && !isOwner;
}

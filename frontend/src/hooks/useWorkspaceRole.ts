import { useAuthStore } from '@/lib/store';
import type { WorkspaceRole } from '@jawab24/shared';

/**
 * Returns the current user's workspace role and derived permission flags.
 *
 * - `canEdit` (admin+): can modify templates, rules, settings, pages, integrations
 * - `isOwner`: can delete workspace and change member roles
 *
 * Defaults to `owner` for single-user workspaces (the common case).
 */
export function useWorkspaceRole() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);

  const active = Array.isArray(workspaces) ? workspaces.find((w) => w.id === activeWorkspaceId) : undefined;
  const role: WorkspaceRole = active?.role ?? 'owner';

  return {
    role,
    isOwner: role === 'owner',
    isAdmin: role === 'owner' || role === 'admin',
    canEdit: role === 'owner' || role === 'admin',
  };
}

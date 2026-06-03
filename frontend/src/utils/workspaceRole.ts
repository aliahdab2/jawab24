import type { WorkspaceRole } from '@jawab24/shared';

/**
 * Tailwind classes for a workspace-role badge (owner / admin / member).
 * Single source of truth shared by the team panel and the admin customer
 * detail page so role colors stay consistent. Uses semantic globals.css
 * classes (status-*) so dark mode is handled automatically.
 */
const ROLE_BADGE_COLORS: Record<WorkspaceRole, string> = {
    owner: 'status-warning',
    admin: 'status-brand',
    member: 'bg-surface-100 text-muted-foreground dark:bg-surface-800',
};

export function getRoleBadgeColor(role: WorkspaceRole): string {
    return ROLE_BADGE_COLORS[role];
}

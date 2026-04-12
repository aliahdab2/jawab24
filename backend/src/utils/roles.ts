import type { WorkspaceRole } from '@jawab24/shared';

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
    owner: 3,
    admin: 2,
    member: 1,
};

import { FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaceMembers, workspaces } from '../db/schema';
import type { AuthenticatedRequest } from './auth';
import type { WorkspaceRole } from '@jawab24/shared';

export interface WorkspaceRequest extends AuthenticatedRequest {
    workspaceId?: string;
    workspaceRole?: WorkspaceRole;
    workspaceOwnerId?: string;
}

/**
 * Narrowed type used inside controllers — workspaceId is guaranteed to be a
 * string because resolveWorkspace middleware always sets it before any handler runs.
 * Cast to this type inside controller functions to avoid non-null assertions.
 */
export type ResolvedWorkspaceRequest = WorkspaceRequest & { workspaceId: string };

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
    owner: 3,
    admin: 2,
    member: 1,
};

/**
 * Resolves the workspace context for the current request.
 *
 * 1. If `X-Workspace-Id` header is present, verify the user is a member.
 * 2. If no header, auto-select if the user belongs to exactly 1 workspace.
 * 3. If >1 workspace and no header, return 409 (workspace_selection_required).
 * 4. If 0 workspaces, return 404 (NO_WORKSPACE) — should not happen after
 *    running scripts/migrate-workspaces.ts and deploying the workspace-aware
 *    auth service (which calls ensureWorkspace on every login).
 *
 * Must be used AFTER the `authenticate` middleware.
 */
export async function resolveWorkspace(request: WorkspaceRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
        return reply.status(401).send({
            error: true,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }

    const headerWorkspaceId = request.headers['x-workspace-id'] as string | undefined;

    if (headerWorkspaceId) {
        // Verify user is a member of this workspace
        const membership = await db
            .select({
                role: workspaceMembers.role,
                ownerId: workspaces.ownerId,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(
                and(
                    eq(workspaceMembers.workspaceId, headerWorkspaceId),
                    eq(workspaceMembers.userId, userId),
                )
            )
            .limit(1);

        if (membership.length === 0) {
            return reply.status(403).send({
                error: true,
                message: 'You are not a member of this workspace',
                code: 'WORKSPACE_ACCESS_DENIED',
            });
        }

        request.workspaceId = headerWorkspaceId;
        request.workspaceRole = membership[0].role as WorkspaceRole;
        request.workspaceOwnerId = membership[0].ownerId;
        return;
    }

    // No header — auto-select if exactly 1 workspace
    const memberships = await db
        .select({
            workspaceId: workspaceMembers.workspaceId,
            role: workspaceMembers.role,
            name: workspaces.name,
            ownerId: workspaces.ownerId,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId));

    if (memberships.length === 0) {
        return reply.status(404).send({
            error: true,
            message: 'No workspace found. Please log out and log back in.',
            code: 'NO_WORKSPACE',
        });
    }

    if (memberships.length === 1) {
        request.workspaceId = memberships[0].workspaceId;
        request.workspaceRole = memberships[0].role as WorkspaceRole;
        request.workspaceOwnerId = memberships[0].ownerId;
        return;
    }

    // Multiple workspaces — user must specify which one
    return reply.status(409).send({
        error: 'workspace_selection_required',
        message: 'You belong to multiple workspaces. Please select one.',
        workspaces: memberships.map((m) => ({
            id: m.workspaceId,
            name: m.name,
            role: m.role,
        })),
    });
}

/**
 * Factory for role-checking middleware.
 * Returns a preHandler that verifies the user's workspace role meets the minimum.
 *
 * Must be used AFTER `resolveWorkspace`.
 *
 * Usage: `protectedRoutes.addHook('preHandler', requireRole('admin'));`
 */
export function requireRole(minRole: WorkspaceRole) {
    return async (request: WorkspaceRequest, reply: FastifyReply) => {
        if (!request.workspaceRole) {
            return reply.status(403).send({
                error: true,
                message: 'Workspace context required',
                code: 'WORKSPACE_REQUIRED',
            });
        }

        const userLevel = ROLE_HIERARCHY[request.workspaceRole] ?? 0;
        const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;

        if (userLevel < requiredLevel) {
            return reply.status(403).send({
                error: true,
                message: `This action requires ${minRole} role or higher`,
                code: 'INSUFFICIENT_ROLE',
            });
        }
    };
}

import { FastifyReply } from 'fastify';
import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { workspaceMembers, workspaces } from '../db/schema';
import type { AuthenticatedRequest } from './auth';
import type { WorkspaceRole } from '@jawab24/shared';
import { ROLE_HIERARCHY } from '../utils/roles';

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
export type ResolvedWorkspaceRequest = WorkspaceRequest & { workspaceId: string; workspaceOwnerId: string; workspaceRole: WorkspaceRole };


/**
 * Resolves the workspace context for the current request.
 *
 * 1. If `X-Workspace-Id` header is present, verify the user is a member.
 * 2. If no header, auto-select a default workspace (owned-first, then oldest membership).
 *    This matches standard SaaS behaviour and unblocks clients whose workspace
 *    sync fell through silently (e.g. older mobile builds before X-Workspace-Id
 *    plumbing was reliable).
 * 3. If 0 workspaces, return 404 (NO_WORKSPACE) — should not happen after
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

    // No header — auto-select a default workspace.
    // Order: workspace the user owns first (role='owner'), then oldest membership.
    // This matches standard SaaS UX (Slack, Linear, Notion): pick a sensible default
    // and let the client switch via the workspace switcher. Returning 409 here
    // strands clients that don't yet handle workspace_selection_required (e.g. older
    // mobile builds where the auth-sync /workspaces fetch fell through silently).
    const memberships = await db
        .select({
            workspaceId: workspaceMembers.workspaceId,
            role: workspaceMembers.role,
            name: workspaces.name,
            ownerId: workspaces.ownerId,
            joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId))
        .orderBy(sql`CASE WHEN ${workspaceMembers.role} = 'owner' THEN 0 ELSE 1 END`, asc(workspaceMembers.joinedAt));

    if (memberships.length === 0) {
        return reply.status(404).send({
            error: true,
            message: 'No workspace found. Please log out and log back in.',
            code: 'NO_WORKSPACE',
        });
    }

    request.workspaceId = memberships[0].workspaceId;
    request.workspaceRole = memberships[0].role as WorkspaceRole;
    request.workspaceOwnerId = memberships[0].ownerId;
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

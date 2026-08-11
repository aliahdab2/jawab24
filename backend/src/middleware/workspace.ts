import { FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaceMembers, workspaces } from '../db/schema';
import { workspaceService } from '../services/workspace';
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
 * 0. If the TOKEN pins a workspace (restricted embedded session — see
 *    TokenScope), that pin wins over the header and over the default resolver.
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

    // A restricted session is PINNED to the workspace named in its own token.
    // The client cannot widen it by sending a different X-Workspace-Id: the
    // embedded credential proves the store, so the session must not reach the
    // owner's other workspaces (their other pages, stores, and billing).
    // Enforced here rather than at each handler so no route can forget it.
    const scopedWorkspaceId = request.user?.scopedWorkspaceId;
    if (scopedWorkspaceId) {
        const requested = request.headers['x-workspace-id'] as string | undefined;
        if (requested && requested !== scopedWorkspaceId) {
            request.log.warn({
                userId,
                route: request.url,
                requested,
                scopedWorkspaceId,
                embeddedPlatform: request.user?.embeddedPlatform,
            }, 'Embedded session tried to use a workspace outside its scope');
            return reply.status(403).send({
                error: true,
                message: 'This session is limited to a single workspace',
                code: 'WORKSPACE_SCOPE_DENIED',
            });
        }
        return applyMembership(request, reply, userId, scopedWorkspaceId, 'out-of-scope');
    }

    const headerWorkspaceId = request.headers['x-workspace-id'] as string | undefined;

    if (headerWorkspaceId) {
        return applyMembership(request, reply, userId, headerWorkspaceId, 'not-a-member');
    }

    // No header — defer to the server-authoritative resolver. Same logic used
    // everywhere we pick a default (auth response, invite acceptance): honor
    // last-active when valid, otherwise heuristic (most pages → owner-first →
    // oldest membership). Keeps middleware in lockstep with the auth response
    // the client just received, so the chosen workspace is always reproducible.
    const defaultWorkspaceId = await workspaceService.resolveDefaultWorkspaceId(userId);

    if (!defaultWorkspaceId) {
        return reply.status(404).send({
            error: true,
            message: 'No workspace found. Please log out and log back in.',
            code: 'NO_WORKSPACE',
        });
    }

    // Resolver returning an id the user is no longer a member of should be
    // impossible (it membership-checks), but guard anyway.
    return applyMembership(request, reply, userId, defaultWorkspaceId, 'no-workspace');
}

/**
 * Load the caller's membership of `workspaceId` and attach the resolved
 * workspace context to the request, or answer with the caller-appropriate
 * failure. One body for all three entry paths (token-pinned, header, resolved
 * default) so the membership check cannot drift between them.
 */
async function applyMembership(
    request: WorkspaceRequest,
    reply: FastifyReply,
    userId: string,
    workspaceId: string,
    onMissing: 'not-a-member' | 'no-workspace' | 'out-of-scope',
) {
    const [membership] = await db
        .select({
            role: workspaceMembers.role,
            ownerId: workspaces.ownerId,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(
            and(
                eq(workspaceMembers.workspaceId, workspaceId),
                eq(workspaceMembers.userId, userId),
            )
        )
        .limit(1);

    if (!membership) {
        if (onMissing === 'no-workspace') {
            return reply.status(404).send({
                error: true,
                message: 'No workspace found. Please log out and log back in.',
                code: 'NO_WORKSPACE',
            });
        }
        if (onMissing === 'out-of-scope') {
            // A pinned session whose workspace it no longer belongs to. It cannot
            // fall back to another one by design, so say so rather than sending
            // the merchant to a login page they cannot use inside a frame.
            return reply.status(403).send({
                error: true,
                message: 'This session is limited to a single workspace',
                code: 'WORKSPACE_SCOPE_DENIED',
            });
        }
        return reply.status(403).send({
            error: true,
            message: 'You are not a member of this workspace',
            code: 'WORKSPACE_ACCESS_DENIED',
        });
    }

    request.workspaceId = workspaceId;
    request.workspaceRole = membership.role as WorkspaceRole;
    request.workspaceOwnerId = membership.ownerId;
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

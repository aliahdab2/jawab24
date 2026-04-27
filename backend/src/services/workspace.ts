import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { workspaces, workspaceMembers, users, pages } from '../db/schema';
import type { WorkspaceRole, WorkspaceSummary } from '@jawab24/shared';

/** Internal member limit — quietly enforced, no UI for managing this. */
const MAX_MEMBERS_PER_WORKSPACE = 5;

/** Thrown by setLastActiveWorkspace when the user isn't a member of the target workspace. */
export class WorkspaceAccessDeniedError extends Error {
    constructor(public readonly userId: string, public readonly workspaceId: string) {
        super(`User ${userId} is not a member of workspace ${workspaceId}`);
        this.name = 'WorkspaceAccessDeniedError';
    }
}

export class WorkspaceService {
    /**
     * Create a workspace and add the creator as owner.
     */
    async createWorkspace(userId: string, name: string): Promise<typeof workspaces.$inferSelect> {
        const [workspace] = await db
            .insert(workspaces)
            .values({
                ownerId: userId,
                name,
                settings: {},
            })
            .returning();

        await db.insert(workspaceMembers).values({
            workspaceId: workspace.id,
            userId,
            role: 'owner',
        });

        return workspace;
    }

    /**
     * List all workspaces the user belongs to.
     */
    async getUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
        const rows = await db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                role: workspaceMembers.role,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
            .where(eq(workspaceMembers.userId, userId))
            // Oldest membership first — invited-to workspaces (accepted after own workspace creation)
            // end up last, but the frontend preserves activeWorkspaceId across logins so this
            // only affects first-ever workspace selection.
            // Most-recently-joined first: for team members whose own workspace was created
            // before accepting an invite, the invited workspace sorts to the top.
            .orderBy(desc(workspaceMembers.joinedAt));
        return rows as WorkspaceSummary[];
    }

    /**
     * Get a workspace by ID.
     */
    async getWorkspace(workspaceId: string) {
        const [workspace] = await db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);
        return workspace ?? null;
    }

    /**
     * Update workspace name or logo.
     */
    async updateWorkspace(workspaceId: string, updates: { name?: string; logoUrl?: string }) {
        const [updated] = await db
            .update(workspaces)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(workspaces.id, workspaceId))
            .returning();
        return updated;
    }

    /**
     * Delete a workspace (owner only). CASCADE handles members + invites.
     */
    async deleteWorkspace(workspaceId: string): Promise<void> {
        await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }

    /**
     * List members of a workspace with user details.
     */
    async getMembers(workspaceId: string) {
        return db
            .select({
                id: workspaceMembers.id,
                userId: workspaceMembers.userId,
                role: workspaceMembers.role,
                joinedAt: workspaceMembers.joinedAt,
                invitedBy: workspaceMembers.invitedBy,
                userName: users.name,
                userEmail: users.email,
                userPicture: users.picture,
                lastSeenAt: users.lastSeenAt,
            })
            .from(workspaceMembers)
            .innerJoin(users, eq(workspaceMembers.userId, users.id))
            .where(eq(workspaceMembers.workspaceId, workspaceId));
    }

    /**
     * Get a single member's role. Returns null if not a member.
     */
    async getMemberRole(workspaceId: string, userId: string): Promise<{ role: WorkspaceRole } | null> {
        const [row] = await db
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId),
                )
            )
            .limit(1);
        return row ? { role: row.role as WorkspaceRole } : null;
    }

    /**
     * Add a member to a workspace. Enforces internal member limit.
     */
    async addMember(
        workspaceId: string,
        userId: string,
        role: WorkspaceRole = 'member',
        invitedBy?: string,
    ) {
        // Check if already a member
        const [existing] = await db
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
            .limit(1);

        if (existing) {
            throw new Error('User has already been added to this workspace');
        }

        // Check member count
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaceId));

        if (count >= MAX_MEMBERS_PER_WORKSPACE) {
            throw new Error('Member limit reached. Please contact support to add more team members.');
        }

        const [member] = await db
            .insert(workspaceMembers)
            .values({
                workspaceId,
                userId,
                role,
                invitedBy: invitedBy ?? null,
            })
            .returning();

        return member;
    }

    /**
     * Remove a member from a workspace.
     * G3: Rejects if the target is the last owner.
     */
    async removeMember(workspaceId: string, targetUserId: string): Promise<void> {
        await db.transaction(async (tx) => {
            // Check if target is an owner
            const [target] = await tx
                .select({ role: workspaceMembers.role })
                .from(workspaceMembers)
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, workspaceId),
                        eq(workspaceMembers.userId, targetUserId),
                    )
                )
                .limit(1);

            if (!target) {
                throw new Error('Member not found');
            }

            if (target.role === 'owner') {
                const [{ ownerCount }] = await tx
                    .select({ ownerCount: sql<number>`count(*)::int` })
                    .from(workspaceMembers)
                    .where(
                        and(
                            eq(workspaceMembers.workspaceId, workspaceId),
                            eq(workspaceMembers.role, 'owner'),
                        )
                    );

                if (ownerCount <= 1) {
                    throw new Error('Cannot remove the last owner. Transfer ownership first.');
                }
            }

            await tx
                .delete(workspaceMembers)
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, workspaceId),
                        eq(workspaceMembers.userId, targetUserId),
                    )
                );
        });
    }

    /**
     * Change a member's role.
     * G3: Rejects if demoting the last owner.
     */
    async updateMemberRole(
        workspaceId: string,
        targetUserId: string,
        newRole: WorkspaceRole,
    ): Promise<void> {
        await db.transaction(async (tx) => {
            const [target] = await tx
                .select({ role: workspaceMembers.role })
                .from(workspaceMembers)
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, workspaceId),
                        eq(workspaceMembers.userId, targetUserId),
                    )
                )
                .limit(1);

            if (!target) {
                throw new Error('Member not found');
            }

            // If demoting from owner, check there's at least one other owner
            if (target.role === 'owner' && newRole !== 'owner') {
                const [{ ownerCount }] = await tx
                    .select({ ownerCount: sql<number>`count(*)::int` })
                    .from(workspaceMembers)
                    .where(
                        and(
                            eq(workspaceMembers.workspaceId, workspaceId),
                            eq(workspaceMembers.role, 'owner'),
                        )
                    );

                if (ownerCount <= 1) {
                    throw new Error('Cannot demote the last owner. Assign another owner first.');
                }
            }

            await tx
                .update(workspaceMembers)
                .set({ role: newRole })
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, workspaceId),
                        eq(workspaceMembers.userId, targetUserId),
                    )
                );
        });
    }

    /**
     * Persist the user's last-active workspace. Membership-checked: throws
     * WorkspaceAccessDeniedError if the user isn't a member of the target
     * workspace, so this can't be used to leak access.
     */
    async setLastActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
        const role = await this.getMemberRole(workspaceId, userId);
        if (!role) {
            throw new WorkspaceAccessDeniedError(userId, workspaceId);
        }
        // Note: do NOT bump users.updatedAt here. updatedAt is exposed on the
        // /me profile response and signals "user profile was modified" — a
        // workspace switch isn't a profile change.
        await db
            .update(users)
            .set({ lastActiveWorkspaceId: workspaceId })
            .where(eq(users.id, userId));
    }

    /**
     * Resolve which workspace the user should land in. Read-only — never writes.
     * Order: stored last-active (membership-checked) → heuristic (most connected
     * pages, then owner-first, then oldest membership). Returns null when the
     * user has zero memberships (caller maps to NO_WORKSPACE).
     */
    async resolveDefaultWorkspaceId(userId: string): Promise<string | null> {
        // 1. Honor stored last-active when still valid.
        const [user] = await db
            .select({ lastActive: users.lastActiveWorkspaceId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (user?.lastActive) {
            const [stillMember] = await db
                .select({ id: workspaceMembers.id })
                .from(workspaceMembers)
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, user.lastActive),
                        eq(workspaceMembers.userId, userId),
                    )
                )
                .limit(1);
            if (stillMember) return user.lastActive;
        }

        // 2. Heuristic: workspace with most connected pages, owner-first, oldest first.
        // `access_token` non-empty (sentinel for "page is connected", per isPageDisconnected).
        const [picked] = await db
            .select({ workspaceId: workspaceMembers.workspaceId })
            .from(workspaceMembers)
            .leftJoin(
                pages,
                and(
                    eq(pages.workspaceId, workspaceMembers.workspaceId),
                    sql`${pages.accessToken} IS NOT NULL AND ${pages.accessToken} <> ''`,
                ),
            )
            .where(eq(workspaceMembers.userId, userId))
            .groupBy(workspaceMembers.workspaceId, workspaceMembers.role, workspaceMembers.joinedAt)
            .orderBy(
                sql`COUNT(${pages.id}) DESC`,
                sql`CASE WHEN ${workspaceMembers.role} = 'owner' THEN 0 ELSE 1 END`,
                sql`${workspaceMembers.joinedAt} ASC`,
            )
            .limit(1);

        return picked?.workspaceId ?? null;
    }
}

export const workspaceService = new WorkspaceService();

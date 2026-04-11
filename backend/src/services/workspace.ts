import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { workspaces, workspaceMembers, users } from '../db/schema';
import type { WorkspaceRole, WorkspaceSummary } from '@jawab24/shared';

/** Internal member limit — quietly enforced, no UI for managing this. */
const MAX_MEMBERS_PER_WORKSPACE = 5;

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
            .where(eq(workspaceMembers.userId, userId));
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
     * Add a member to a workspace. Enforces internal member limit.
     */
    async addMember(
        workspaceId: string,
        userId: string,
        role: WorkspaceRole = 'member',
        invitedBy?: string,
    ) {
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
}

export const workspaceService = new WorkspaceService();

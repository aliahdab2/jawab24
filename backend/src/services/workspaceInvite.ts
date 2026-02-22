import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaceInvites } from '../db/schema';
import { workspaceService } from './workspace';
import type { WorkspaceRole } from '@jawab24/shared';

/** Invite expiry: 48 hours */
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

export class WorkspaceInviteService {
    /**
     * Create an invite for a workspace.
     * Returns the raw token (for the invite URL) and the invite record.
     */
    async createInvite(
        workspaceId: string,
        email: string,
        role: WorkspaceRole = 'member',
        createdBy: string,
    ) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);

        // Upsert: if an invite already exists for this email+workspace, update it
        // (handles re-inviting after expiry/revocation)
        const existing = await db
            .select({ id: workspaceInvites.id })
            .from(workspaceInvites)
            .where(
                and(
                    eq(workspaceInvites.workspaceId, workspaceId),
                    eq(workspaceInvites.email, email),
                )
            )
            .limit(1);

        let invite;
        if (existing.length > 0) {
            // Update existing invite (re-invite)
            [invite] = await db
                .update(workspaceInvites)
                .set({
                    tokenHash,
                    role,
                    status: 'pending',
                    createdBy,
                    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
                    usedAt: null,
                    usedBy: null,
                })
                .where(eq(workspaceInvites.id, existing[0].id))
                .returning();
        } else {
            [invite] = await db
                .insert(workspaceInvites)
                .values({
                    workspaceId,
                    email,
                    tokenHash,
                    role,
                    status: 'pending',
                    createdBy,
                    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
                })
                .returning();
        }

        return { invite, rawToken };
    }

    /**
     * Accept an invite using the raw token.
     * Verifies: token valid, not expired, not used, status is pending.
     * Adds user as member, marks invite as accepted.
     */
    async acceptInvite(rawToken: string, userId: string) {
        const tokenHash = this.hashToken(rawToken);

        const [invite] = await db
            .select()
            .from(workspaceInvites)
            .where(eq(workspaceInvites.tokenHash, tokenHash))
            .limit(1);

        if (!invite) {
            throw new Error('Invalid invite token');
        }

        if (invite.status !== 'pending') {
            throw new Error(`Invite has already been ${invite.status}`);
        }

        if (new Date() > invite.expiresAt) {
            // Mark as expired
            await db
                .update(workspaceInvites)
                .set({ status: 'expired' })
                .where(eq(workspaceInvites.id, invite.id));
            throw new Error('Invite has expired');
        }

        // Add user as member
        const member = await workspaceService.addMember(
            invite.workspaceId,
            userId,
            (invite.role as WorkspaceRole) || 'member',
            invite.createdBy ?? undefined,
        );

        // Mark invite as accepted
        await db
            .update(workspaceInvites)
            .set({
                status: 'accepted',
                usedAt: new Date(),
                usedBy: userId,
            })
            .where(eq(workspaceInvites.id, invite.id));

        return {
            workspaceId: invite.workspaceId,
            role: invite.role,
            member,
        };
    }

    /**
     * List active (pending, not expired) invites for a workspace.
     */
    async getActiveInvites(workspaceId: string) {
        return db
            .select()
            .from(workspaceInvites)
            .where(
                and(
                    eq(workspaceInvites.workspaceId, workspaceId),
                    eq(workspaceInvites.status, 'pending'),
                )
            );
    }

    /**
     * Revoke an invite.
     */
    async revokeInvite(inviteId: string, workspaceId: string): Promise<void> {
        await db
            .update(workspaceInvites)
            .set({ status: 'revoked' })
            .where(
                and(
                    eq(workspaceInvites.id, inviteId),
                    eq(workspaceInvites.workspaceId, workspaceId),
                )
            );
    }

    /**
     * Hash a raw token for storage.
     */
    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }
}

export const workspaceInviteService = new WorkspaceInviteService();

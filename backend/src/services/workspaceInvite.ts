import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaceInvites, users } from '../db/schema';
import { workspaceService } from './workspace';
import { emailService } from './email';
import { inviteEmailTemplate } from '../utils/emailTemplates';
import { detectContactType } from '@jawab24/shared';
import type { WorkspaceRole } from '@jawab24/shared';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { sha256Hex } from '../utils/hash';

/** Invite expiry: 48 hours */
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

/**
 * The invite contact is not an email address. Team invites are email-only —
 * a phone invite had no transport left once the SMS rail was retired (D-123).
 */
export class InvalidInviteContactError extends Error {
    constructor() {
        super('Team invites require an email address');
        this.name = 'InvalidInviteContactError';
    }
}

export class WorkspaceInviteService {
    /**
     * Create an invite for a workspace. `contact` must be an EMAIL address.
     * Returns the raw token (for the invite URL) and the invite record.
     *
     * Phone invites are refused: their only transport was SMS, retired with the
     * Vonage provider (D-123). The dashboard has rejected phone contacts since
     * #233, but only client-side — an API client could still create an invite
     * whose link was guaranteed never to arrive. The rule now lives on the
     * server, where it is actually enforced.
     */
    async createInvite(
        workspaceId: string,
        contact: string,
        role: WorkspaceRole = 'member',
        createdBy: string,
    ) {
        const { email, phone } = detectContactType(contact);
        if (phone || !email) {
            throw new InvalidInviteContactError();
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256Hex(rawToken);

        // Upsert: if an invite already exists for this contact+workspace, update it
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

        const inviteUrl = new URL('/invites/accept', config.frontendUrl);
        inviteUrl.searchParams.set('token', rawToken);

        // Awaited so we can report delivery status. When this fails (provider
        // down, bounce at send time), the controller still returns the raw token
        // so the UI can fall back to the copy-and-share link. The email_sends
        // audit row is written by the email service for both success and failure.
        let emailSent = false;
        const workspace = await workspaceService.getWorkspace(workspaceId);
        const { subject, html } = inviteEmailTemplate({
            workspaceName: workspace?.name ?? 'Jawab24',
            inviteUrl: inviteUrl.toString(),
        });
        try {
            const result = await emailService.send({ to: email, subject, html, type: 'invite' });
            emailSent = result.success;
        } catch (err) {
            captureError(err, 'Failed to send invite email', {
                tags: { context: 'workspace' },
            });
        }

        return { invite, rawToken, emailSent };
    }

    /**
     * Accept an invite using the raw token.
     * Verifies: token valid, not expired, not used, status is pending.
     * Adds user as member, marks invite as accepted.
     */
    async acceptInvite(rawToken: string, userId: string) {
        const tokenHash = sha256Hex(rawToken);

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
            await db
                .update(workspaceInvites)
                .set({ status: 'expired' })
                .where(eq(workspaceInvites.id, invite.id));
            throw new Error('Invite has expired');
        }

        const [userRow] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!userRow) {
            throw new Error('User account not found');
        }

        const member = await workspaceService.addMember(
            invite.workspaceId,
            userId,
            (invite.role as WorkspaceRole) || 'member',
            invite.createdBy ?? undefined,
        );

        await db
            .update(workspaceInvites)
            .set({
                status: 'accepted',
                usedAt: new Date(),
                usedBy: userId,
            })
            .where(eq(workspaceInvites.id, invite.id));

        // Make the just-joined workspace the user's last-active. Future logins
        // and middleware fallback both honor this — invitees who came in via an
        // invite link land directly in the inviter's workspace next time, with
        // no need for a picker or workspace-switcher dance.
        await workspaceService.setLastActiveWorkspace(userId, invite.workspaceId);

        const workspaces = await workspaceService.getUserWorkspaces(userId);

        return {
            workspaceId: invite.workspaceId,
            // Explicit alias for clients: this is the workspace the user just joined,
            // and the recommended active workspace going forward.
            acceptedWorkspaceId: invite.workspaceId,
            role: invite.role,
            member,
            workspaces,
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

}

export const workspaceInviteService = new WorkspaceInviteService();

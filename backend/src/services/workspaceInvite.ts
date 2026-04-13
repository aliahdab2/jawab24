import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { workspaceInvites, users } from '../db/schema';
import { workspaceService } from './workspace';
import { smsService } from './sms';
import { detectContactType, isArabicPhone } from '@jawab24/shared';
import type { WorkspaceRole } from '@jawab24/shared';
import { config } from '../config';
import { t } from '../utils/i18n';
import { captureError } from '../utils/sentryHelpers';

/** Invite expiry: 48 hours */
const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000;

export class WorkspaceInviteService {
    /**
     * Create an invite for a workspace.
     * `contact` can be an email address or an E.164 phone number (+966xxxxxxxxx).
     * Returns the raw token (for the invite URL) and the invite record.
     * For phone invites, sends the invite link via SMS.
     */
    async createInvite(
        workspaceId: string,
        contact: string,
        role: WorkspaceRole = 'member',
        createdBy: string,
    ) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);
        const { email, phone } = detectContactType(contact);

        // Upsert: if an invite already exists for this contact+workspace, update it
        // (handles re-inviting after expiry/revocation)
        const existing = await db
            .select({ id: workspaceInvites.id })
            .from(workspaceInvites)
            .where(
                and(
                    eq(workspaceInvites.workspaceId, workspaceId),
                    phone
                        ? eq(workspaceInvites.phone, phone)
                        : eq(workspaceInvites.email, email ?? ''),
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
                    phone,
                    tokenHash,
                    role,
                    status: 'pending',
                    createdBy,
                    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
                })
                .returning();
        }

        // Send SMS for phone invites — awaited so we can report delivery status
        let smsSent = false;
        if (phone) {
            const inviteUrl = new URL('/invites/accept', config.frontendUrl);
            inviteUrl.searchParams.set('token', rawToken);
            const lang = isArabicPhone(phone) ? 'ar' : 'en';
            const message = t('inviteSms', lang, { link: inviteUrl.toString() });
            try {
                await smsService.send(phone, message);
                smsSent = true;
            } catch (err) {
                captureError(err, 'Failed to send invite SMS', {
                    tags: { context: 'workspace' },
                });
            }
        }

        return { invite, rawToken, smsSent };
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

        const workspaces = await workspaceService.getUserWorkspaces(userId);

        return {
            workspaceId: invite.workspaceId,
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

    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }
}

export const workspaceInviteService = new WorkspaceInviteService();

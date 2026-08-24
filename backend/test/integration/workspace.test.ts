/**
 * Workspace Integration Tests — real Postgres
 *
 * Covers:
 *  - WorkspaceService  : CRUD, member management, ownership guards
 *  - WorkspaceInviteService : create / accept / revoke / expire
 *  - WorkspaceSettingsService : get/update with DB + cache bypass
 *  - auth.ensureWorkspace    : workspace created on first login
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import { workspaceService } from '../../src/services/workspace';
import { workspaceInviteService } from '../../src/services/workspaceInvite';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { eq, and } from 'drizzle-orm';
import { workspaceMembers, workspaceInvites } from '../../src/db/schema';

// Silence Redis for settings tests — we test DB behaviour, not cache
vi.mock('../../src/lib/redis', () => ({
    redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
    },
}));

// ── WorkspaceService ──────────────────────────────────────────────────────────

describe('WorkspaceService — Integration', () => {
    it('createWorkspace: creates workspace and adds creator as owner member', async () => {
        const user = await createTestUser();
        const ws = await workspaceService.createWorkspace(user.id, 'My Store');

        expect(ws.name).toBe('My Store');
        expect(ws.ownerId).toBe(user.id);

        const members = await testDb
            .select()
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, ws.id));

        expect(members).toHaveLength(1);
        expect(members[0].role).toBe('owner');
        expect(members[0].userId).toBe(user.id);
    });

    it('getUserWorkspaces: returns all workspaces for a user', async () => {
        const user = await createTestUser();
        await workspaceService.createWorkspace(user.id, 'WS 1');
        await workspaceService.createWorkspace(user.id, 'WS 2');

        const workspaces = await workspaceService.getUserWorkspaces(user.id);

        expect(workspaces).toHaveLength(2);
        expect(workspaces.map(w => w.name)).toEqual(expect.arrayContaining(['WS 1', 'WS 2']));
    });

    it('getWorkspace: returns null for non-existent workspace', async () => {
        const result = await workspaceService.getWorkspace('00000000-0000-0000-0000-000000000000');
        expect(result).toBeNull();
    });

    it('updateWorkspace: updates name and returns updated workspace', async () => {
        const user = await createTestUser();
        const ws = await createTestWorkspace(user.id);

        const updated = await workspaceService.updateWorkspace(ws.id, { name: 'Renamed' });

        expect(updated.name).toBe('Renamed');
    });

    it('addMember: adds second user to workspace', async () => {
        const owner = await createTestUser();
        const member = await createTestUser({ facebookId: 'fb-m1', email: 'member@test.com' });
        const ws = await createTestWorkspace(owner.id);

        await workspaceService.addMember(ws.id, member.id, 'admin', owner.id);

        const members = await workspaceService.getMembers(ws.id);
        expect(members).toHaveLength(2);
        const added = members.find(m => m.userId === member.id);
        expect(added?.role).toBe('admin');
    });

    it('addMember: throws when member limit (5) is reached', async () => {
        const users = await Promise.all([
            createTestUser({ facebookId: 'fb-lim-0', email: 'l0@t.com' }),
            createTestUser({ facebookId: 'fb-lim-1', email: 'l1@t.com' }),
            createTestUser({ facebookId: 'fb-lim-2', email: 'l2@t.com' }),
            createTestUser({ facebookId: 'fb-lim-3', email: 'l3@t.com' }),
            createTestUser({ facebookId: 'fb-lim-4', email: 'l4@t.com' }),
            createTestUser({ facebookId: 'fb-lim-5', email: 'l5@t.com' }),
        ]);

        const ws = await createTestWorkspace(users[0].id);
        // Add users 1–4 (total 5 including owner)
        for (let i = 1; i <= 4; i++) {
            await workspaceService.addMember(ws.id, users[i].id);
        }

        // 6th member should be rejected
        await expect(workspaceService.addMember(ws.id, users[5].id))
            .rejects.toThrow('Member limit reached');
    });

    it('removeMember: removes a non-owner member', async () => {
        const owner = await createTestUser();
        const member = await createTestUser({ facebookId: 'fb-rm1', email: 'rm@test.com' });
        const ws = await createTestWorkspace(owner.id);
        await workspaceService.addMember(ws.id, member.id);

        await workspaceService.removeMember(ws.id, member.id);

        const remaining = await workspaceService.getMembers(ws.id);
        expect(remaining.map(m => m.userId)).not.toContain(member.id);
    });

    it('removeMember: throws when removing the last owner', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await expect(workspaceService.removeMember(ws.id, owner.id))
            .rejects.toThrow('Cannot remove the last owner');
    });

    it('removeMember: throws when member not found', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await expect(workspaceService.removeMember(ws.id, '00000000-0000-0000-0000-000000000000'))
            .rejects.toThrow('Member not found');
    });

    it('updateMemberRole: promotes member to admin', async () => {
        const owner = await createTestUser();
        const member = await createTestUser({ facebookId: 'fb-role1', email: 'role@test.com' });
        const ws = await createTestWorkspace(owner.id);
        await workspaceService.addMember(ws.id, member.id, 'member');

        await workspaceService.updateMemberRole(ws.id, member.id, 'admin');

        const [updated] = await testDb
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(and(
                eq(workspaceMembers.workspaceId, ws.id),
                eq(workspaceMembers.userId, member.id),
            ));

        expect(updated.role).toBe('admin');
    });

    it('updateMemberRole: throws when demoting last owner', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await expect(workspaceService.updateMemberRole(ws.id, owner.id, 'member'))
            .rejects.toThrow('Cannot demote the last owner');
    });

    it('deleteWorkspace: removes workspace and cascades members', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await workspaceService.deleteWorkspace(ws.id);

        const result = await workspaceService.getWorkspace(ws.id);
        expect(result).toBeNull();

        const members = await testDb
            .select()
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, ws.id));
        expect(members).toHaveLength(0);
    });
});

// ── WorkspaceInviteService ────────────────────────────────────────────────────

describe('WorkspaceInviteService — Integration', () => {
    it('createInvite: creates invite with hashed token', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        const { invite, rawToken } = await workspaceInviteService.createInvite(
            ws.id, 'invitee@example.com', 'member', owner.id,
        );

        expect(invite.workspaceId).toBe(ws.id);
        expect(invite.email).toBe('invitee@example.com');
        expect(invite.status).toBe('pending');
        expect(rawToken).toHaveLength(64); // 32 bytes hex
    });

    it('createInvite: re-inviting same email refreshes the invite', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        const { invite: first } = await workspaceInviteService.createInvite(
            ws.id, 'reinvite@example.com', 'member', owner.id,
        );
        const { invite: second } = await workspaceInviteService.createInvite(
            ws.id, 'reinvite@example.com', 'admin', owner.id,
        );

        // Same DB row, updated token and role
        expect(second.id).toBe(first.id);
        expect(second.role).toBe('admin');
        expect(second.status).toBe('pending');
    });

    it('acceptInvite: adds user as member and marks invite accepted', async () => {
        const owner = await createTestUser();
        const invitee = await createTestUser({ facebookId: 'fb-inv', email: 'invitee@test.com' });
        const ws = await createTestWorkspace(owner.id);

        const { rawToken } = await workspaceInviteService.createInvite(
            ws.id, 'invitee@test.com', 'admin', owner.id,
        );

        const result = await workspaceInviteService.acceptInvite(rawToken, invitee.id);

        expect(result.workspaceId).toBe(ws.id);
        expect(result.role).toBe('admin');

        // Invite marked accepted
        const [inv] = await testDb
            .select({ status: workspaceInvites.status, usedBy: workspaceInvites.usedBy })
            .from(workspaceInvites)
            .where(eq(workspaceInvites.workspaceId, ws.id));

        expect(inv.status).toBe('accepted');
        expect(inv.usedBy).toBe(invitee.id);

        // User is now a member
        const members = await workspaceService.getMembers(ws.id);
        expect(members.find(m => m.userId === invitee.id)?.role).toBe('admin');
    });

    it('acceptInvite: throws for invalid token', async () => {
        await expect(workspaceInviteService.acceptInvite('bad-token', 'user-1'))
            .rejects.toThrow('Invalid invite token');
    });

    it('acceptInvite: throws for already-accepted invite', async () => {
        const owner = await createTestUser();
        const invitee = await createTestUser({ facebookId: 'fb-acc', email: 'acc@test.com' });
        const ws = await createTestWorkspace(owner.id);

        const { rawToken } = await workspaceInviteService.createInvite(
            ws.id, 'acc@test.com', 'member', owner.id,
        );
        await workspaceInviteService.acceptInvite(rawToken, invitee.id);

        await expect(workspaceInviteService.acceptInvite(rawToken, invitee.id))
            .rejects.toThrow('already been accepted');
    });

    it('acceptInvite: throws for expired invite', async () => {
        const owner = await createTestUser();
        const invitee = await createTestUser({ facebookId: 'fb-exp', email: 'exp@test.com' });
        const ws = await createTestWorkspace(owner.id);

        const { invite, rawToken } = await workspaceInviteService.createInvite(
            ws.id, 'exp@test.com', 'member', owner.id,
        );

        // Force expiry by updating expiresAt to the past
        await testDb
            .update(workspaceInvites)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(workspaceInvites.id, invite.id));

        await expect(workspaceInviteService.acceptInvite(rawToken, invitee.id))
            .rejects.toThrow('expired');
    });

    it('revokeInvite: marks invite as revoked', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);
        const { invite } = await workspaceInviteService.createInvite(
            ws.id, 'revoke@test.com', 'member', owner.id,
        );

        await workspaceInviteService.revokeInvite(invite.id, ws.id);

        const [updated] = await testDb
            .select({ status: workspaceInvites.status })
            .from(workspaceInvites)
            .where(eq(workspaceInvites.id, invite.id));

        expect(updated.status).toBe('revoked');
    });

    it('getActiveInvites: returns only pending invites', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        const { invite: pending } = await workspaceInviteService.createInvite(
            ws.id, 'pending@test.com', 'member', owner.id,
        );
        const { invite: toRevoke } = await workspaceInviteService.createInvite(
            ws.id, 'revoked@test.com', 'member', owner.id,
        );
        await workspaceInviteService.revokeInvite(toRevoke.id, ws.id);

        const active = await workspaceInviteService.getActiveInvites(ws.id);

        expect(active.map(i => i.id)).toContain(pending.id);
        expect(active.map(i => i.id)).not.toContain(toRevoke.id);
    });
});

// ── WorkspaceSettingsService ──────────────────────────────────────────────────

describe('WorkspaceSettingsService — Integration', () => {
    it('getSettings: returns defaults for a fresh workspace', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        const settings = await workspaceSettingsService.getSettings(ws.id);

        expect(settings.aiEnabled).toBe(true);
        expect(settings.commentsAutoReply).toBe(true);
        expect(settings.messagesAutoReply).toBe(true);
        expect(settings.replyDelay).toBe(2); // defaults to the "Natural" preset (2s since 2026-08-24 — see backend/docs/SETTINGS.md)
        expect(settings.defaultReplyLanguage).toBe('ar');
    });

    it('updateSettings: persists changes and merges with defaults', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await workspaceSettingsService.updateSettings(ws.id, {
            aiEnabled: false,
            replyDelay: 5,
        });

        const settings = await workspaceSettingsService.getSettings(ws.id);

        expect(settings.aiEnabled).toBe(false);
        expect(settings.replyDelay).toBe(5);
        expect(settings.commentsAutoReply).toBe(true); // Default preserved
    });

    it('updateSettings: two workspaces are fully isolated', async () => {
        const user1 = await createTestUser();
        const user2 = await createTestUser({ facebookId: 'fb-ws2', email: 'ws2@test.com' });
        const ws1 = await createTestWorkspace(user1.id);
        const ws2 = await createTestWorkspace(user2.id);

        await workspaceSettingsService.updateSettings(ws1.id, { replyDelay: 10 });
        await workspaceSettingsService.updateSettings(ws2.id, { replyDelay: 20 });

        const s1 = await workspaceSettingsService.getSettings(ws1.id);
        const s2 = await workspaceSettingsService.getSettings(ws2.id);

        expect(s1.replyDelay).toBe(10);
        expect(s2.replyDelay).toBe(20);
    });

    it('getAwayMessage: returns configured message in correct language', async () => {
        const owner = await createTestUser();
        const ws = await createTestWorkspace(owner.id);

        await workspaceSettingsService.updateSettings(ws.id, {
            awayMessageMulti: {
                en: 'We are away',
                ar: 'نحن غائبون',
            },
        });

        expect(await workspaceSettingsService.getAwayMessage(ws.id, 'en')).toBe('We are away');
        expect(await workspaceSettingsService.getAwayMessage(ws.id, 'ar')).toBe('نحن غائبون');
    });
});

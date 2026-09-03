import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceInviteService, InvalidInviteContactError } from '../../src/services/workspaceInvite';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn(),
    },
}));

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        addMember: vi.fn().mockResolvedValue({ id: 'member-1', role: 'member' }),
        getUserWorkspaces: vi.fn().mockResolvedValue([
            { id: 'ws-1', name: 'My Workspace', role: 'member' },
        ]),
        // getWorkspace is called inside createInvite for email invites to put the
        // workspace name in the invite email. Mocked to return a named workspace.
        getWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'My Workspace' }),
        // setLastActiveWorkspace is called inside acceptInvite so the freshly-joined
        // workspace becomes the user's default on next login. Mocked to no-op for unit tests.
        setLastActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/email', () => ({
    emailService: {
        send: vi.fn().mockResolvedValue({ success: true, id: 'email-1' }),
    },
}));

vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        // inviteEmailTemplate reads config.resend.fromName for the email header.
        resend: { apiKey: '', fromEmail: 'info@jawab24.com', fromName: 'Jawab24' },
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

const { workspaceService } = await import('../../src/services/workspace');
const { emailService } = await import('../../src/services/email');

function mockSelectLimitChain(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(returnValue),
            }),
        }),
    };
}

function mockSelectWhereChain(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(returnValue),
        }),
    };
}

function mockInsertChain(returnValue: any) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([returnValue]),
        }),
    };
}

function mockUpdateChain(returnValue: any) {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([returnValue]),
            }),
        }),
    };
}

function mockUpdateNoReturn() {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        }),
    };
}

const sampleInvite = {
    id: 'invite-1',
    workspaceId: 'ws-1',
    email: 'test@example.com',
    tokenHash: 'hashed-token',
    role: 'member',
    status: 'pending',
    createdBy: 'user-1',
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    usedAt: null,
    usedBy: null,
};

describe('WorkspaceInviteService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createInvite', () => {
        it('should create a new invite when none exists', async () => {
            // No existing invite
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleInvite) as any);

            const result = await workspaceInviteService.createInvite('ws-1', 'test@example.com', 'member', 'user-1');

            expect(result.invite).toEqual(sampleInvite);
            expect(result.rawToken).toBeDefined();
            expect(typeof result.rawToken).toBe('string');
            expect(result.rawToken.length).toBe(64); // 32 bytes hex
            expect(result.emailSent).toBe(true);
            expect(emailService.send).toHaveBeenCalledTimes(1);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });

        it('should send an email with the workspace name when inviting an email address', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleInvite) as any);

            const result = await workspaceInviteService.createInvite('ws-1', 'test@example.com', 'member', 'user-1');

            expect(result.emailSent).toBe(true);
            expect(emailService.send).toHaveBeenCalledTimes(1);
            const sent = vi.mocked(emailService.send).mock.calls[0][0];
            expect(sent.to).toBe('test@example.com');
            expect(sent.type).toBe('invite');
            // Bilingual subject carries the workspace name in both AR and EN.
            expect(sent.subject).toContain('My Workspace');
            expect(sent.html).toContain('My Workspace');
        });

        it('should still create invite if the email send fails', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleInvite) as any);
            vi.mocked(emailService.send).mockResolvedValueOnce({ success: false, error: 'provider down' });

            const result = await workspaceInviteService.createInvite('ws-1', 'test@example.com', 'member', 'user-1');

            expect(result.invite).toEqual(sampleInvite);
            expect(result.rawToken).toBeDefined();
            // emailSent reflects the failed send so the controller can fall back to the link.
            expect(result.emailSent).toBe(false);
        });

        // A phone invite has no transport since the SMS rail retired (D-123).
        // The dashboard has rejected phone contacts since #233, but client-side
        // ONLY — an API client could still create an invite whose link was
        // guaranteed never to arrive. The rule is now enforced here, where it
        // cannot be bypassed.
        it('refuses a phone contact instead of creating an undeliverable invite', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([]) as any);
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleInvite) as any);

            await expect(
                workspaceInviteService.createInvite('ws-1', '+966501234567', 'member', 'user-1'),
            ).rejects.toBeInstanceOf(InvalidInviteContactError);

            // Refused BEFORE the row is written: a pending invite nobody can
            // receive would sit in the team panel forever.
            expect(db.insert).not.toHaveBeenCalled();
            expect(emailService.send).not.toHaveBeenCalled();
        });

        it('should update existing invite on re-invite', async () => {
            // Existing invite found
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([{ id: 'invite-1' }]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(sampleInvite) as any);

            const result = await workspaceInviteService.createInvite('ws-1', 'test@example.com', 'admin', 'user-1');

            expect(result.invite).toEqual(sampleInvite);
            expect(db.update).toHaveBeenCalledTimes(1);
            expect(db.insert).not.toHaveBeenCalled();
        });
    });

    describe('acceptInvite', () => {
        it('should accept a valid pending invite', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([sampleInvite]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            const result = await workspaceInviteService.acceptInvite('raw-token', 'user-2');

            expect(result.workspaceId).toBe('ws-1');
            expect(result.role).toBe('member');
            expect(workspaceService.addMember).toHaveBeenCalledWith('ws-1', 'user-2', 'member', 'user-1');
        });

        it('should return updated workspaces list after accepting', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([sampleInvite]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            const result = await workspaceInviteService.acceptInvite('raw-token', 'user-2');

            expect(result.workspaces).toBeDefined();
            expect(result.workspaces).toEqual([{ id: 'ws-1', name: 'My Workspace', role: 'member' }]);
            expect(workspaceService.getUserWorkspaces).toHaveBeenCalledWith('user-2');
        });

        // Regression guard: prevents the orphan-empty-workspace UX bug. If the
        // invite-accept path doesn't set last_active_workspace_id, an invitee
        // with a stale persisted activeWorkspaceId on their device will still
        // land in the wrong (often empty) workspace on next login.
        it('sets the invitee\'s last_active_workspace_id to the just-joined workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([sampleInvite]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            await workspaceInviteService.acceptInvite('raw-token', 'user-2');

            expect(workspaceService.setLastActiveWorkspace).toHaveBeenCalledWith('user-2', 'ws-1');
        });

        it('returns acceptedWorkspaceId so the client can auto-switch without diffing the list', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([sampleInvite]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            const result = await workspaceInviteService.acceptInvite('raw-token', 'user-2');

            expect(result.acceptedWorkspaceId).toBe('ws-1');
        });

        it('should throw for invalid token', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([]) as any);

            await expect(
                workspaceInviteService.acceptInvite('bad-token', 'user-2'),
            ).rejects.toThrow('Invalid invite token');
        });

        it('should throw for already accepted invite', async () => {
            const accepted = { ...sampleInvite, status: 'accepted' };
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([accepted]) as any);

            await expect(
                workspaceInviteService.acceptInvite('raw-token', 'user-2'),
            ).rejects.toThrow('Invite has already been accepted');
        });

        it('should throw and mark as expired for expired invite', async () => {
            const expired = {
                ...sampleInvite,
                expiresAt: new Date(Date.now() - 1000), // expired 1s ago
            };
            vi.mocked(db.select).mockReturnValue(mockSelectLimitChain([expired]) as any);
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            await expect(
                workspaceInviteService.acceptInvite('raw-token', 'user-2'),
            ).rejects.toThrow('Invite has expired');

            expect(db.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('getActiveInvites', () => {
        it('should return pending invites for a workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectWhereChain([sampleInvite]) as any);

            const result = await workspaceInviteService.getActiveInvites('ws-1');

            expect(result).toEqual([sampleInvite]);
        });
    });

    describe('revokeInvite', () => {
        it('should revoke an invite', async () => {
            vi.mocked(db.update).mockReturnValue(mockUpdateNoReturn() as any);

            await workspaceInviteService.revokeInvite('invite-1', 'ws-1');

            expect(db.update).toHaveBeenCalledTimes(1);
        });
    });
});

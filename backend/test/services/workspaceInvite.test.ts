import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceInviteService } from '../../src/services/workspaceInvite';
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
    },
}));

const { workspaceService } = await import('../../src/services/workspace');

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
            expect(db.insert).toHaveBeenCalledTimes(1);
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

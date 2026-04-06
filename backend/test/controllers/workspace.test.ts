import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceController } from '../../src/controllers/workspace';

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getUserWorkspaces: vi.fn(),
        createWorkspace: vi.fn(),
        getWorkspace: vi.fn(),
        updateWorkspace: vi.fn(),
        deleteWorkspace: vi.fn(),
        getMembers: vi.fn(),
        removeMember: vi.fn(),
        updateMemberRole: vi.fn(),
    },
}));

vi.mock('../../src/services/workspaceInvite', () => ({
    workspaceInviteService: {
        createInvite: vi.fn(),
        getActiveInvites: vi.fn(),
        revokeInvite: vi.fn(),
        acceptInvite: vi.fn(),
    },
}));

vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
    },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { workspaceService } from '../../src/services/workspace';
import { workspaceInviteService } from '../../src/services/workspaceInvite';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';

const WS_ID = 'ws-1';
const USER_ID = 'user-1';

function makeReply() {
    const r: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
    return r;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
        user: { userId: USER_ID },
        workspaceId: WS_ID,
        workspaceRole: 'owner',
        headers: {},
        params: {},
        body: {},
        ...overrides,
    } as any;
}

describe('WorkspaceController', () => {
    beforeEach(() => vi.clearAllMocks());

    // ── list ──────────────────────────────────────────────────────────────
    describe('list', () => {
        it('returns user workspaces', async () => {
            const workspaces = [{ id: WS_ID, name: 'WS', role: 'owner' }];
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue(workspaces as any);
            const reply = makeReply();

            await workspaceController.list(makeRequest(), reply);

            expect(reply.send).toHaveBeenCalledWith(workspaces);
        });

        it('returns 401 when not authenticated', async () => {
            const reply = makeReply();
            await workspaceController.list(makeRequest({ user: undefined }), reply);
            expect(reply.status).toHaveBeenCalledWith(401);
        });
    });

    // ── create ────────────────────────────────────────────────────────────
    describe('create', () => {
        it('creates workspace and returns 201', async () => {
            const workspace = { id: WS_ID, name: 'New WS' };
            vi.mocked(workspaceService.createWorkspace).mockResolvedValue(workspace as any);
            const reply = makeReply();

            await workspaceController.create(makeRequest({ body: { name: 'New WS' } }), reply);

            expect(reply.status).toHaveBeenCalledWith(201);
            expect(reply.send).toHaveBeenCalledWith(workspace);
        });

        it('returns 400 when name is missing', async () => {
            const reply = makeReply();
            await workspaceController.create(makeRequest({ body: {} }), reply);
            expect(reply.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 when name is only whitespace', async () => {
            const reply = makeReply();
            await workspaceController.create(makeRequest({ body: { name: '   ' } }), reply);
            expect(reply.status).toHaveBeenCalledWith(400);
        });
    });

    // ── getOne ────────────────────────────────────────────────────────────
    describe('getOne', () => {
        it('returns workspace when found', async () => {
            vi.mocked(workspaceService.getWorkspace).mockResolvedValue({ id: WS_ID } as any);
            const reply = makeReply();

            await workspaceController.getOne(makeRequest(), reply);

            expect(reply.send).toHaveBeenCalledWith({ id: WS_ID });
        });

        it('returns 404 when workspace not found', async () => {
            vi.mocked(workspaceService.getWorkspace).mockResolvedValue(null);
            const reply = makeReply();

            await workspaceController.getOne(makeRequest(), reply);

            expect(reply.status).toHaveBeenCalledWith(404);
        });
    });

    // ── update ────────────────────────────────────────────────────────────
    describe('update', () => {
        it('updates and returns workspace', async () => {
            const updated = { id: WS_ID, name: 'Updated' };
            vi.mocked(workspaceService.updateWorkspace).mockResolvedValue(updated as any);
            const reply = makeReply();

            await workspaceController.update(makeRequest({ body: { name: 'Updated' } }), reply);

            expect(reply.send).toHaveBeenCalledWith(updated);
        });
    });

    // ── remove ────────────────────────────────────────────────────────────
    describe('remove', () => {
        it('deletes workspace and returns 204', async () => {
            vi.mocked(workspaceService.deleteWorkspace).mockResolvedValue();
            const reply = makeReply();

            await workspaceController.remove(makeRequest(), reply);

            expect(reply.status).toHaveBeenCalledWith(204);
        });
    });

    // ── getMembers ────────────────────────────────────────────────────────
    describe('getMembers', () => {
        it('returns members list', async () => {
            const members = [{ userId: USER_ID, role: 'owner' }];
            vi.mocked(workspaceService.getMembers).mockResolvedValue(members as any);
            const reply = makeReply();

            await workspaceController.getMembers(makeRequest(), reply);

            expect(reply.send).toHaveBeenCalledWith(members);
        });
    });

    // ── removeMember ──────────────────────────────────────────────────────
    describe('removeMember', () => {
        it('removes member and returns 204', async () => {
            vi.mocked(workspaceService.removeMember).mockResolvedValue();
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ params: { userId: 'user-2' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(204);
        });

        it('returns 400 when removing last owner', async () => {
            vi.mocked(workspaceService.removeMember).mockRejectedValue(
                new Error('Cannot remove the last owner. Transfer ownership first.'),
            );
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ params: { userId: USER_ID } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('last owner'),
            }));
        });
    });

    // ── updateMemberRole ──────────────────────────────────────────────────
    describe('updateMemberRole', () => {
        it('updates role and returns 204', async () => {
            vi.mocked(workspaceService.updateMemberRole).mockResolvedValue();
            const reply = makeReply();

            await workspaceController.updateMemberRole(
                makeRequest({ params: { userId: 'user-2' }, body: { role: 'admin' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(204);
        });

        it('returns 400 for invalid role', async () => {
            const reply = makeReply();

            await workspaceController.updateMemberRole(
                makeRequest({ params: { userId: 'user-2' }, body: { role: 'superuser' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid role' }));
        });
    });

    // ── createInvite ──────────────────────────────────────────────────────
    describe('createInvite', () => {
        it('creates invite and returns 201 with token', async () => {
            vi.mocked(workspaceInviteService.createInvite).mockResolvedValue({
                invite: { id: 'invite-1' } as any,
                rawToken: 'abc123',
            });
            const reply = makeReply();

            await workspaceController.createInvite(
                makeRequest({ body: { email: 'new@example.com', role: 'member' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(201);
            expect(reply.send).toHaveBeenCalledWith(
                expect.objectContaining({ token: 'abc123' }),
            );
        });

        it('returns 400 when email is missing', async () => {
            const reply = makeReply();

            await workspaceController.createInvite(
                makeRequest({ body: {} }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
        });
    });

    // ── acceptInvite ──────────────────────────────────────────────────────
    describe('acceptInvite', () => {
        it('accepts invite and returns result', async () => {
            const result = { workspaceId: WS_ID, role: 'member', member: {} };
            vi.mocked(workspaceInviteService.acceptInvite).mockResolvedValue(result as any);
            const reply = makeReply();

            await workspaceController.acceptInvite(
                makeRequest({ body: { token: 'valid-token' } }),
                reply,
            );

            expect(reply.send).toHaveBeenCalledWith(result);
        });

        it('returns 400 when token is missing', async () => {
            const reply = makeReply();
            await workspaceController.acceptInvite(makeRequest({ body: {} }), reply);
            expect(reply.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 when token is expired', async () => {
            vi.mocked(workspaceInviteService.acceptInvite).mockRejectedValue(
                new Error('Invite has expired'),
            );
            const reply = makeReply();

            await workspaceController.acceptInvite(
                makeRequest({ body: { token: 'expired-token' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 when member limit reached', async () => {
            vi.mocked(workspaceInviteService.acceptInvite).mockRejectedValue(
                new Error('Member limit reached'),
            );
            const reply = makeReply();

            await workspaceController.acceptInvite(
                makeRequest({ body: { token: 'valid-token' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
        });
    });

    // ── getSettings / updateSettings ──────────────────────────────────────
    describe('getSettings', () => {
        it('returns workspace settings', async () => {
            const settings = { aiEnabled: true, replyDelay: 0 };
            vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue(settings as any);
            const reply = makeReply();

            await workspaceController.getSettings(makeRequest(), reply);

            expect(reply.send).toHaveBeenCalledWith(settings);
        });
    });

    describe('updateSettings', () => {
        it('updates and returns settings', async () => {
            const updated = { aiEnabled: false, replyDelay: 5 };
            vi.mocked(workspaceSettingsService.updateSettings).mockResolvedValue(updated as any);
            const reply = makeReply();

            await workspaceController.updateSettings(
                makeRequest({ body: { aiEnabled: false, replyDelay: 5 } }),
                reply,
            );

            expect(reply.send).toHaveBeenCalledWith(updated);
        });
    });
});

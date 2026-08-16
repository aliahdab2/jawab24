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
        getMemberRole: vi.fn(),
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

        it('shows a PINNED session only its own workspace', async () => {
            vi.mocked(workspaceService.getUserWorkspaces).mockResolvedValue([
                { id: 'ws-1', name: 'Personal', role: 'owner' },
                { id: 'ws-9', name: 'Store', role: 'owner' },
            ] as any);
            const reply = makeReply();

            await workspaceController.list(
                makeRequest({ user: { userId: USER_ID, embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-9' } }),
                reply,
            );

            // resolveWorkspace already refuses to ACT on the others, but listing
            // them names the owner's other stores and pages to a credential that
            // only ever proved one store — and the client renders them as a
            // switcher whose every other entry 403s.
            expect(reply.send).toHaveBeenCalledWith([{ id: 'ws-9', name: 'Store', role: 'owner' }]);
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
        it('owner removes a member — returns 204', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'member' });
            vi.mocked(workspaceService.removeMember).mockResolvedValue();
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ workspaceRole: 'owner', params: { userId: 'user-2' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(204);
        });

        it('admin removes a member — returns 204', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'member' });
            vi.mocked(workspaceService.removeMember).mockResolvedValue();
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ workspaceRole: 'admin', params: { userId: 'user-2' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(204);
        });

        it('admin cannot remove another admin — returns 403', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'admin' });
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ workspaceRole: 'admin', params: { userId: 'user-2' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(403);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
                code: 'INSUFFICIENT_ROLE',
            }));
        });

        it('admin cannot remove an owner — returns 403', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'owner' });
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ workspaceRole: 'admin', params: { userId: 'user-2' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(403);
        });

        it('returns 404 when target member not found', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue(null);
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ params: { userId: 'ghost-user' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(404);
        });

        it('owner cannot remove another owner — blocked at controller level', async () => {
            vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'owner' });
            const reply = makeReply();

            await workspaceController.removeMember(
                makeRequest({ workspaceRole: 'owner', params: { userId: 'other-owner' } }),
                reply,
            );

            // Controller blocks this before reaching the service (equal role level)
            expect(reply.status).toHaveBeenCalledWith(403);
            expect(workspaceService.removeMember).not.toHaveBeenCalled();
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

        it('drops unknown keys before they reach the JSONB merge (mass-assignment pin)', async () => {
            // The route has no body schema and the service merges its input
            // straight into workspaces.settings JSONB — this filter is the only
            // guard. Break it (remove the isWorkspaceSettingsKey filter) and
            // this test fails on the smuggled keys reaching the service.
            vi.mocked(workspaceSettingsService.updateSettings).mockResolvedValue({} as any);
            const reply = makeReply();

            await workspaceController.updateSettings(
                makeRequest({
                    body: {
                        aiEnabled: true,                       // known — must pass
                        replyDelay: 7,                         // known — must pass
                        notAField: 'planted',                  // unknown — must drop
                        __proto__pollution: 'x',               // unknown — must drop
                        futureFeatureFlag: true,               // unknown — must drop
                    },
                }),
                reply,
            );

            expect(workspaceSettingsService.updateSettings).toHaveBeenCalledTimes(1);
            const [wsId, forwarded] = vi.mocked(workspaceSettingsService.updateSettings).mock.calls[0];
            expect(wsId).toBe(WS_ID);
            expect(forwarded).toEqual({ aiEnabled: true, replyDelay: 7 });
        });

        it('keeps the leadStages sanitize path working through the filter', async () => {
            // leadStages is a known key — the filter must not interfere with its
            // dedicated sanitizer (invalid config still 400s).
            const reply = makeReply();

            await workspaceController.updateSettings(
                makeRequest({ body: { leadStages: 'not-a-config' } }),
                reply,
            );

            expect(reply.status).toHaveBeenCalledWith(400);
            expect(workspaceSettingsService.updateSettings).not.toHaveBeenCalled();
        });
    });
});

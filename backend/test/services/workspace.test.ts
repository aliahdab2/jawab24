import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceService, WorkspaceAccessDeniedError } from '../../src/services/workspace';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

import { db } from '../../src/db';

const WS_ID = 'ws-1';
const USER_ID = 'user-1';
const USER_2_ID = 'user-2';

// ── Query chain builders ────────────────────────────────────────────────────

function mockSelect(result: unknown) {
    const chain: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
        // Thenable so queries without .limit() can be awaited directly
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    vi.mocked(db.select).mockReturnValue(chain);
    return chain;
}

function mockInsert(result: unknown) {
    const chain: any = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
    };
    vi.mocked(db.insert).mockReturnValue(chain);
    return chain;
}

function mockUpdate(result: unknown = []) {
    const chain: any = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(result),
    };
    vi.mocked(db.update).mockReturnValue(chain);
    return chain;
}

describe('WorkspaceService', () => {
    let service: WorkspaceService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new WorkspaceService();
    });

    // ── createWorkspace ───────────────────────────────────────────────────
    describe('createWorkspace', () => {
        it('creates workspace and adds creator as owner', async () => {
            const workspace = { id: WS_ID, name: 'My WS', ownerId: USER_ID };
            let insertCallCount = 0;

            vi.mocked(db.insert).mockImplementation(() => {
                insertCallCount++;
                if (insertCallCount === 1) {
                    // First insert: workspace
                    return { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([workspace]) } as any;
                }
                // Second insert: workspace_members
                return { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{}]) } as any;
            });

            const result = await service.createWorkspace(USER_ID, 'My WS');

            expect(result).toEqual(workspace);
            expect(db.insert).toHaveBeenCalledTimes(2);
        });

        it('seeds settings.greetingMessageMulti with default AR + EN strings', async () => {
            const workspace = { id: WS_ID, name: 'My WS', ownerId: USER_ID };
            let insertCallCount = 0;
            const valuesMock = vi.fn().mockReturnThis();

            vi.mocked(db.insert).mockImplementation(() => {
                insertCallCount++;
                if (insertCallCount === 1) {
                    return { values: valuesMock, returning: vi.fn().mockResolvedValue([workspace]) } as any;
                }
                return { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{}]) } as any;
            });

            await service.createWorkspace(USER_ID, 'My WS');

            // settings also carries NEW_SIGNUP_SETTINGS_SEED (auto-reply off + dual, D-025);
            // this test only owns the greeting seeding, so match it with objectContaining.
            expect(valuesMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    settings: expect.objectContaining({
                        greetingMessageMulti: {
                            ar: 'مرحباً بك! كيف يمكننا مساعدتك اليوم؟',
                            en: 'Hello! How can we help you?',
                            sourceLang: 'default',
                        },
                    }),
                }),
            );
        });
    });

    // ── getUserWorkspaces ─────────────────────────────────────────────────
    describe('getUserWorkspaces', () => {
        it('returns list of workspaces for user', async () => {
            const workspaces = [
                { id: 'ws-1', name: 'WS 1', role: 'owner' },
                { id: 'ws-2', name: 'WS 2', role: 'member' },
            ];
            mockSelect(workspaces);

            const result = await service.getUserWorkspaces(USER_ID);
            expect(result).toEqual(workspaces);
        });

        it('returns empty array when user has no workspaces', async () => {
            mockSelect([]);
            const result = await service.getUserWorkspaces(USER_ID);
            expect(result).toEqual([]);
        });
    });

    // ── getWorkspace ──────────────────────────────────────────────────────
    describe('getWorkspace', () => {
        it('returns workspace when found', async () => {
            mockSelect([{ id: WS_ID, name: 'My WS' }]);
            const result = await service.getWorkspace(WS_ID);
            expect(result).toEqual({ id: WS_ID, name: 'My WS' });
        });

        it('returns null when workspace not found', async () => {
            mockSelect([]);
            const result = await service.getWorkspace('nonexistent');
            expect(result).toBeNull();
        });
    });

    // ── updateWorkspace ───────────────────────────────────────────────────
    describe('updateWorkspace', () => {
        it('updates and returns the workspace', async () => {
            const updated = { id: WS_ID, name: 'New Name' };
            mockUpdate([updated]);

            const result = await service.updateWorkspace(WS_ID, { name: 'New Name' });
            expect(result).toEqual(updated);
        });
    });

    // ── addMember ─────────────────────────────────────────────────────────
    describe('addMember', () => {
        it('adds member when under limit', async () => {
            const member = { id: 'mem-1', workspaceId: WS_ID, userId: USER_2_ID, role: 'member' };

            // First select: existing-member check — returns [] (not a member yet)
            // Second select: count check — returns 2 (under limit)
            const existingChain: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve([]).then(resolve, reject),
            };
            const countChain: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ count: 2 }]),
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve([{ count: 2 }]).then(resolve, reject),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(existingChain)
                .mockReturnValueOnce(countChain);
            mockInsert([member]);

            const result = await service.addMember(WS_ID, USER_2_ID, 'member');
            expect(result).toEqual(member);
        });

        it('throws when already a member', async () => {
            // First select: existing-member check — returns a row (already member)
            mockSelect([{ id: 'mem-1' }]);

            await expect(service.addMember(WS_ID, USER_2_ID)).rejects.toThrow('already been');
        });

        it('throws when member limit reached', async () => {
            // First select: existing-member check — returns [] (not yet a member)
            // Second select: count check — returns 5 (at limit)
            const existingChain: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([]),
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve([]).then(resolve, reject),
            };
            const countChain: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ count: 5 }]),
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve([{ count: 5 }]).then(resolve, reject),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(existingChain)
                .mockReturnValueOnce(countChain);

            await expect(service.addMember(WS_ID, USER_2_ID)).rejects.toThrow('Member limit reached');
        });
    });

    // ── removeMember ─────────────────────────────────────────────────────
    describe('removeMember', () => {
        it('removes a non-owner member successfully', async () => {
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockImplementation(() => ({
                        from: vi.fn().mockReturnThis(),
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockResolvedValue([{ role: 'member' }]),
                    })),
                    delete: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                };
                return fn(tx);
            });

            await expect(service.removeMember(WS_ID, USER_2_ID)).resolves.not.toThrow();
        });

        it('throws when removing the last owner', async () => {
            // First select: target → owner role (uses .limit(1))
            // Second select: owner count (no .limit(), awaited directly)
            const results = [[{ role: 'owner' }], [{ ownerCount: 1 }]];
            let selectCount = 0;
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockImplementation(() => {
                        const r = results[selectCount++] ?? [];
                        const chain: any = {
                            from: vi.fn().mockReturnThis(),
                            where: vi.fn().mockReturnThis(),
                            limit: vi.fn().mockResolvedValue(r),
                            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                                Promise.resolve(r).then(resolve, reject),
                        };
                        return chain;
                    }),
                };
                return fn(tx);
            });

            await expect(service.removeMember(WS_ID, USER_ID))
                .rejects.toThrow('Cannot remove the last owner');
        });

        it('throws when member not found', async () => {
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnThis(),
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                };
                return fn(tx);
            });

            await expect(service.removeMember(WS_ID, 'unknown-user'))
                .rejects.toThrow('Member not found');
        });
    });

    // ── updateMemberRole ──────────────────────────────────────────────────
    describe('updateMemberRole', () => {
        it('updates role of a non-owner member', async () => {
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnThis(),
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockResolvedValue([{ role: 'member' }]),
                    }),
                    update: vi.fn().mockReturnValue({
                        set: vi.fn().mockReturnThis(),
                        where: vi.fn().mockResolvedValue([]),
                    }),
                };
                return fn(tx);
            });

            await expect(service.updateMemberRole(WS_ID, USER_2_ID, 'admin')).resolves.not.toThrow();
        });

        it('throws when demoting the last owner', async () => {
            // First select: target → owner role (uses .limit(1))
            // Second select: owner count (no .limit(), awaited directly)
            const results = [[{ role: 'owner' }], [{ ownerCount: 1 }]];
            let selectCount = 0;
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockImplementation(() => {
                        const r = results[selectCount++] ?? [];
                        const chain: any = {
                            from: vi.fn().mockReturnThis(),
                            where: vi.fn().mockReturnThis(),
                            limit: vi.fn().mockResolvedValue(r),
                            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                                Promise.resolve(r).then(resolve, reject),
                        };
                        return chain;
                    }),
                };
                return fn(tx);
            });

            await expect(service.updateMemberRole(WS_ID, USER_ID, 'member'))
                .rejects.toThrow('Cannot demote the last owner');
        });

        it('allows promoting a member to owner', async () => {
            vi.mocked(db.transaction).mockImplementation(async (fn) => {
                const tx: any = {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnThis(),
                        where: vi.fn().mockReturnThis(),
                        limit: vi.fn().mockResolvedValue([{ role: 'member' }]),
                    }),
                    update: vi.fn().mockReturnValue({
                        set: vi.fn().mockReturnThis(),
                        where: vi.fn().mockResolvedValue([]),
                    }),
                };
                return fn(tx);
            });

            await expect(service.updateMemberRole(WS_ID, USER_2_ID, 'owner')).resolves.not.toThrow();
        });
    });

    // ── Last-active workspace ────────────────────────────────────────────────
    // These pin the contract that protects users from each other:
    // - setLastActiveWorkspace MUST membership-check before writing.
    // - resolveDefaultWorkspaceId MUST honor a stored last-active when valid,
    //   and MUST fall through to the heuristic when the stored one is stale
    //   (e.g. user removed from workspace after last login).
    describe('setLastActiveWorkspace', () => {
        it('throws WorkspaceAccessDeniedError when the user is not a member', async () => {
            // Membership check returns no row → typed error, no UPDATE.
            mockSelect([]);
            const updateChain = mockUpdate();

            await expect(service.setLastActiveWorkspace(USER_ID, 'ws-other'))
                .rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
            expect(updateChain.set).not.toHaveBeenCalled();
        });

        it('updates last_active_workspace_id when the user is a member', async () => {
            mockSelect([{ role: 'admin' }]);
            const updateChain = mockUpdate();

            await service.setLastActiveWorkspace(USER_ID, WS_ID);

            expect(updateChain.set).toHaveBeenCalledWith({ lastActiveWorkspaceId: WS_ID });
        });

        it('does NOT bump users.updatedAt — workspace switch is not a profile change', async () => {
            mockSelect([{ role: 'admin' }]);
            const updateChain = mockUpdate();

            await service.setLastActiveWorkspace(USER_ID, WS_ID);

            const setArgs = updateChain.set.mock.calls[0][0];
            expect(setArgs).not.toHaveProperty('updatedAt');
        });
    });

    describe('resolveDefaultWorkspaceId', () => {
        it('returns the stored last_active_workspace_id when the user is still a member', async () => {
            // First select: read users.last_active_workspace_id.
            // Second select: membership check.
            // We can't easily distinguish the two with the simple chain mock,
            // so fall back to vi.fn().mockReturnValueOnce stacking.
            const userRow = [{ lastActive: WS_ID }];
            const memberRow = [{ id: 'member-row' }];
            const chain1: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(userRow),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(userRow).then(resolve),
            };
            const chain2: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(memberRow),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(memberRow).then(resolve),
            };
            vi.mocked(db.select).mockReturnValueOnce(chain1).mockReturnValueOnce(chain2);

            const result = await service.resolveDefaultWorkspaceId(USER_ID);
            expect(result).toBe(WS_ID);
        });

        it('falls back to heuristic when stored last-active is stale (user no longer a member)', async () => {
            const userRow = [{ lastActive: 'ws-stale' }];
            const memberRow: unknown[] = []; // no longer a member
            const heuristicRow = [{ workspaceId: 'ws-heuristic' }];
            const chain1: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(userRow),
                then: (r: (v: unknown) => unknown) => Promise.resolve(userRow).then(r),
            };
            const chain2: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(memberRow),
                then: (r: (v: unknown) => unknown) => Promise.resolve(memberRow).then(r),
            };
            const chain3: any = {
                from: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(heuristicRow),
                then: (r: (v: unknown) => unknown) => Promise.resolve(heuristicRow).then(r),
            };
            vi.mocked(db.select)
                .mockReturnValueOnce(chain1)
                .mockReturnValueOnce(chain2)
                .mockReturnValueOnce(chain3);

            const result = await service.resolveDefaultWorkspaceId(USER_ID);
            expect(result).toBe('ws-heuristic');
        });

        it('returns null when the user has no memberships at all', async () => {
            const userRow = [{ lastActive: null }];
            const heuristicRow: unknown[] = [];
            const chain1: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(userRow),
                then: (r: (v: unknown) => unknown) => Promise.resolve(userRow).then(r),
            };
            const chain2: any = {
                from: vi.fn().mockReturnThis(),
                leftJoin: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(heuristicRow),
                then: (r: (v: unknown) => unknown) => Promise.resolve(heuristicRow).then(r),
            };
            vi.mocked(db.select).mockReturnValueOnce(chain1).mockReturnValueOnce(chain2);

            const result = await service.resolveDefaultWorkspaceId(USER_ID);
            expect(result).toBeNull();
        });
    });
});

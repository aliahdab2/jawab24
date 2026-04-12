import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceService } from '../../src/services/workspace';

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

            // Count query (no .limit()) returns 2 members — under the limit of 5
            const countResult = [{ count: 2 }];
            const chain: any = {
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue(countResult),
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve(countResult).then(resolve, reject),
            };
            vi.mocked(db.select).mockReturnValue(chain);
            mockInsert([member]);

            const result = await service.addMember(WS_ID, USER_2_ID, 'member');
            expect(result).toEqual(member);
        });

        it('throws when member limit reached', async () => {
            mockSelect([{ count: 5 }]);

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
});

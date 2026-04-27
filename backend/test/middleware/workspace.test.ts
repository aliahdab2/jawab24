import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveWorkspace, requireRole } from '../../src/middleware/workspace';

vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

import { db } from '../../src/db';

// Helper to build a chainable Drizzle mock.
// Chains are made thenable so queries without a terminal .limit() can be awaited directly.
function mockQuery(result: unknown[]) {
    const chain: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    vi.mocked(db.select).mockReturnValue(chain);
    return chain;
}

function makeReply() {
    const reply: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    return reply;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
        user: { userId: 'user-1' },
        headers: {},
        ...overrides,
    } as any;
}

describe('resolveWorkspace', () => {
    beforeEach(() => vi.clearAllMocks());

    // ── 401 ──────────────────────────────────────────────────────────────
    it('returns 401 when user is not authenticated', async () => {
        const req = makeRequest({ user: undefined });
        const reply = makeReply();

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    });

    // ── X-Workspace-Id header ─────────────────────────────────────────────
    it('resolves workspace from header when user is a member', async () => {
        const req = makeRequest({ headers: { 'x-workspace-id': 'ws-1' } });
        const reply = makeReply();
        mockQuery([{ role: 'admin' }]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-1');
        expect(req.workspaceRole).toBe('admin');
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('returns 403 when header workspace is present but user is not a member', async () => {
        const req = makeRequest({ headers: { 'x-workspace-id': 'ws-other' } });
        const reply = makeReply();
        mockQuery([]);

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WORKSPACE_ACCESS_DENIED' }));
    });

    // ── Auto-select ───────────────────────────────────────────────────────
    it('auto-selects workspace when user belongs to exactly one', async () => {
        const req = makeRequest();
        const reply = makeReply();
        mockQuery([{ workspaceId: 'ws-1', role: 'owner', name: 'My WS', ownerId: 'user-1', joinedAt: new Date('2025-01-01') }]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-1');
        expect(req.workspaceRole).toBe('owner');
        expect(req.workspaceOwnerId).toBe('user-1');
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('returns 404 when user has no workspaces', async () => {
        const req = makeRequest();
        const reply = makeReply();
        mockQuery([]);

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_WORKSPACE' }));
    });

    // ── Multi-workspace auto-select (regression guard, 2026-04-27) ──────────
    // Background: production mobile app 1.1.1 (5)/(6) shipped without robust
    // X-Workspace-Id header plumbing. When a user belonged to multiple
    // workspaces, the middleware previously returned 409
    // (workspace_selection_required), which neither the mobile build nor the
    // older web bundle had a UI handler for — every dashboard panel rendered
    // "failed to load this section" until the user logged out. Standard SaaS
    // behaviour (Slack, Linear, Notion) is to pick a sensible default and let
    // the workspace switcher handle changes. These tests pin that contract so
    // a future refactor cannot silently re-introduce the 409.
    it('auto-selects a default workspace for users with multiple memberships (no header)', async () => {
        const req = makeRequest();
        const reply = makeReply();
        // The DB query is expected to ORDER BY owner-first, then oldest joinedAt.
        // The test mock returns rows already in that order; the middleware must
        // pick the first row without ever calling reply.status.
        mockQuery([
            { workspaceId: 'ws-owned', role: 'owner', name: 'My WS', ownerId: 'user-1', joinedAt: new Date('2025-01-01') },
            { workspaceId: 'ws-other', role: 'member', name: 'Other WS', ownerId: 'user-2', joinedAt: new Date('2025-02-01') },
        ]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-owned');
        expect(req.workspaceRole).toBe('owner');
        expect(req.workspaceOwnerId).toBe('user-1');
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('never returns 409 for multi-workspace users — guards against regression', async () => {
        const req = makeRequest();
        const reply = makeReply();
        mockQuery([
            { workspaceId: 'ws-1', role: 'member', name: 'WS 1', ownerId: 'other', joinedAt: new Date('2025-01-01') },
            { workspaceId: 'ws-2', role: 'member', name: 'WS 2', ownerId: 'other', joinedAt: new Date('2025-02-01') },
            { workspaceId: 'ws-3', role: 'member', name: 'WS 3', ownerId: 'other', joinedAt: new Date('2025-03-01') },
        ]);

        await resolveWorkspace(req, reply);

        expect(reply.status).not.toHaveBeenCalledWith(409);
        expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({ error: 'workspace_selection_required' }));
        expect(req.workspaceId).toBeDefined();
    });

    it('passes orderBy to the query so the default workspace is deterministic', async () => {
        // Without a deterministic ORDER BY clause, Postgres is free to return rows
        // in any order, which means consecutive requests from the same user could
        // resolve to different workspaces. Pin that the middleware chains orderBy.
        const req = makeRequest();
        const reply = makeReply();
        const chain = mockQuery([
            { workspaceId: 'ws-1', role: 'owner', name: 'WS', ownerId: 'user-1', joinedAt: new Date('2025-01-01') },
        ]);

        await resolveWorkspace(req, reply);

        expect(chain.orderBy).toHaveBeenCalled();
    });
});

describe('requireRole', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 403 when workspace context is missing', async () => {
        const req = makeRequest({ workspaceRole: undefined });
        const reply = makeReply();

        await requireRole('member')(req, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WORKSPACE_REQUIRED' }));
    });

    it('allows access when role meets the minimum', async () => {
        const reply = makeReply();

        await requireRole('member')(makeRequest({ workspaceRole: 'admin' }), reply);
        expect(reply.status).not.toHaveBeenCalled();

        await requireRole('admin')(makeRequest({ workspaceRole: 'owner' }), reply);
        expect(reply.status).not.toHaveBeenCalled();

        await requireRole('owner')(makeRequest({ workspaceRole: 'owner' }), reply);
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('returns 403 when role is insufficient', async () => {
        const reply = makeReply();

        await requireRole('admin')(makeRequest({ workspaceRole: 'member' }), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'INSUFFICIENT_ROLE' }));
    });

    it('enforces hierarchy: owner > admin > member', async () => {
        const cases = [
            { min: 'owner', role: 'admin', expectFail: true },
            { min: 'owner', role: 'member', expectFail: true },
            { min: 'admin', role: 'member', expectFail: true },
            { min: 'admin', role: 'admin', expectFail: false },
            { min: 'member', role: 'member', expectFail: false },
        ] as const;

        for (const { min, role, expectFail } of cases) {
            const reply = makeReply();
            await requireRole(min)(makeRequest({ workspaceRole: role }), reply);
            if (expectFail) {
                expect(reply.status, `min=${min} role=${role}`).toHaveBeenCalledWith(403);
            } else {
                expect(reply.status, `min=${min} role=${role}`).not.toHaveBeenCalled();
            }
        }
    });
});

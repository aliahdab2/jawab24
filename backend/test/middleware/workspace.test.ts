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

vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        resolveDefaultWorkspaceId: vi.fn(),
    },
}));

import { db } from '../../src/db';
import { workspaceService } from '../../src/services/workspace';

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
        url: '/some/route',
        log: { warn: vi.fn() },
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
    // The middleware delegates default-workspace resolution to
    // workspaceService.resolveDefaultWorkspaceId — same code path used by the
    // auth response. Tests below mock the resolver and only assert the
    // middleware's own membership lookup + request hydration.
    it('auto-selects workspace when resolver returns one', async () => {
        const req = makeRequest();
        const reply = makeReply();
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue('ws-1');
        mockQuery([{ role: 'owner', ownerId: 'user-1' }]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-1');
        expect(req.workspaceRole).toBe('owner');
        expect(req.workspaceOwnerId).toBe('user-1');
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('returns 404 when resolver returns null (no memberships)', async () => {
        const req = makeRequest();
        const reply = makeReply();
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue(null);

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_WORKSPACE' }));
    });

    // ── Scoped (embedded) session pin ───────────────────────────────────────
    // A session minted for a platform dashboard iframe carries scopedWorkspaceId
    // in its token. It must be PINNED to that workspace: it may not widen scope
    // via X-Workspace-Id, and it never runs the default resolver.
    it('pins a scoped session to its token workspace and ignores the resolver', async () => {
        const req = makeRequest({ user: { userId: 'user-1', embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-scoped' } });
        const reply = makeReply();
        mockQuery([{ role: 'owner', ownerId: 'user-1' }]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-scoped');
        expect(workspaceService.resolveDefaultWorkspaceId).not.toHaveBeenCalled();
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('rejects a scoped session that asks for a DIFFERENT workspace via header', async () => {
        const req = makeRequest({
            user: { userId: 'user-1', embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-scoped' },
            headers: { 'x-workspace-id': 'ws-other' },
        });
        const reply = makeReply();

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WORKSPACE_SCOPE_DENIED' }));
    });

    it('allows a scoped session that re-states its OWN workspace in the header', async () => {
        const req = makeRequest({
            user: { userId: 'user-1', embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-scoped' },
            headers: { 'x-workspace-id': 'ws-scoped' },
        });
        const reply = makeReply();
        mockQuery([{ role: 'owner', ownerId: 'user-1' }]);

        await resolveWorkspace(req, reply);

        expect(req.workspaceId).toBe('ws-scoped');
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('refuses (scope-denied) rather than fall back when a scoped session lost its membership', async () => {
        const req = makeRequest({ user: { userId: 'user-1', embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-scoped' } });
        const reply = makeReply();
        mockQuery([]); // no membership row

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WORKSPACE_SCOPE_DENIED' }));
    });

    // ── Multi-workspace auto-select (regression guard, 2026-04-27) ──────────
    // Background: production mobile app 1.1.1 (5)/(6) shipped without robust
    // X-Workspace-Id header plumbing. When a user belonged to multiple
    // workspaces, the middleware previously returned 409
    // (workspace_selection_required), which neither the mobile build nor the
    // older web bundle had a UI handler for — every dashboard panel rendered
    // "failed to load this section" until the user logged out. Pin that the
    // middleware always picks a default and never returns 409.
    it('never returns 409 for multi-workspace users — guards against regression', async () => {
        const req = makeRequest();
        const reply = makeReply();
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue('ws-1');
        mockQuery([{ role: 'member', ownerId: 'someone-else' }]);

        await resolveWorkspace(req, reply);

        expect(reply.status).not.toHaveBeenCalledWith(409);
        expect(reply.send).not.toHaveBeenCalledWith(expect.objectContaining({ error: 'workspace_selection_required' }));
        expect(req.workspaceId).toBe('ws-1');
    });

    it('returns 404 when resolver returned a workspace the user is no longer a member of', async () => {
        // Defensive guard: resolver does its own membership check, but if it
        // ever stales out (workspace deleted between resolver-read and
        // middleware-read), the middleware must not crash or hand back a bogus
        // workspace context.
        const req = makeRequest();
        const reply = makeReply();
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue('ws-stale');
        mockQuery([]); // membership lookup returns empty

        await resolveWorkspace(req, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
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

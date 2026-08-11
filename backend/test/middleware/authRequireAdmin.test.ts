/**
 * requireAdmin (middleware/auth.ts) — the gate on the admin console routes.
 *
 * It trusts the JWT `isAdmin` flag. A scoped embedded session has that flag
 * force-cleared at mint time, but this middleware ALSO rejects it explicitly on
 * the `embeddedPlatform` marker: the admin console is the highest-value surface,
 * so it must not depend on one upstream line staying correct.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: { update: vi.fn() } }));
vi.mock('../../src/services/auth', () => ({ authService: { verifyToken: vi.fn() } }));

import { requireAdmin } from '../../src/middleware/auth';

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeReply(): any {
    const reply: any = {};
    reply.status = vi.fn(() => reply);
    reply.send = vi.fn(() => reply);
    return reply;
}
function makeRequest(user: unknown): any {
    return { user, url: '/admin/overview', log: { warn: vi.fn() } };
}

describe('requireAdmin (auth.ts)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('passes a real admin', async () => {
        const reply = makeReply();
        await requireAdmin(makeRequest({ userId: 'u1', isAdmin: true }), reply);
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('rejects a non-admin with 403 ADMIN_REQUIRED', async () => {
        const reply = makeReply();
        await requireAdmin(makeRequest({ userId: 'u1', isAdmin: false }), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'ADMIN_REQUIRED' }));
    });

    it('rejects an embedded session outright, before the isAdmin check', async () => {
        const reply = makeReply();
        // isAdmin:true here to prove the embedded marker wins over the flag.
        await requireAdmin(makeRequest({ userId: 'owner-1', isAdmin: true, embeddedPlatform: 'zid' }), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'ADMIN_REQUIRED' }));
    });

    it('returns 401 when unauthenticated', async () => {
        const reply = makeReply();
        await requireAdmin(makeRequest(undefined), reply);
        expect(reply.status).toHaveBeenCalledWith(401);
    });
});

/**
 * Regression tests for csrfProtection (middleware/auth.ts).
 *
 * Incident 2026-07-18: /auth/demo, /auth/phone/request, and /auth/logout all
 * returned 403 in production for any visitor whose browser still held a stale
 * `token` cookie — the CSRF gate engaged, but these identity-establishing
 * endpoints are called by clients that don't attach X-CSRF-Token. Routes that
 * derive no authority from the session cookie must be CSRF-exempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
    db: { update: vi.fn() },
}));
vi.mock('../services/auth', () => ({
    authService: { verifyToken: vi.fn() },
}));

import { csrfProtection } from '../middleware/auth';
import crypto from 'crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeRequest(overrides: {
    method?: string;
    route?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
} = {}): any {
    return {
        method: overrides.method ?? 'POST',
        routeOptions: { url: overrides.route ?? '/some/route' },
        cookies: overrides.cookies ?? {},
        headers: overrides.headers ?? {},
    };
}

function makeReply(): any {
    const reply: any = {
        statusCode: undefined,
        payload: undefined,
    };
    reply.status = vi.fn((code: number) => {
        reply.statusCode = code;
        return reply;
    });
    reply.send = vi.fn((payload: unknown) => {
        reply.payload = payload;
        return reply;
    });
    return reply;
}

describe('csrfProtection', () => {
    let reply: any;

    beforeEach(() => {
        reply = makeReply();
    });

    describe('exempt routes', () => {
        // The first six mint identity from a body credential (OAuth code, OTP)
        // or from nothing (demo) — never from the session cookie. A stale token
        // cookie without X-CSRF-Token must NOT block them. /auth/logout is the
        // standard logout-CSRF exemption: session-destroying only, and a forged
        // cross-site logout carries no cookie (sameSite:strict) so it's a no-op.
        const exemptRoutes = [
            '/auth/facebook',
            '/auth/facebook/native',
            '/auth/facebook/link',
            '/auth/demo',
            '/auth/phone/request',
            '/auth/phone/verify',
            '/auth/logout',
        ];

        it.each(exemptRoutes)('allows POST %s with stale token cookie and no CSRF header', async (route) => {
            const request = makeRequest({ route, cookies: { token: 'stale-session' } });
            await csrfProtection(request, reply);
            expect(reply.status).not.toHaveBeenCalled();
        });
    });

    it('blocks a non-exempt mutation with token cookie and no CSRF header', async () => {
        const request = makeRequest({ route: '/settings', cookies: { token: 'session' } });
        await csrfProtection(request, reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.payload).toMatchObject({ code: 'CSRF_INVALID' });
    });

    it('blocks a non-exempt mutation when header does not match cookie', async () => {
        const request = makeRequest({
            route: '/settings',
            cookies: { token: 'session', csrfToken: 'aaaa' },
            headers: { 'x-csrf-token': 'bbbb' },
        });
        await csrfProtection(request, reply);
        expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('allows a non-exempt mutation when header matches cookie', async () => {
        const csrf = crypto.randomBytes(16).toString('hex');
        const request = makeRequest({
            route: '/settings',
            cookies: { token: 'session', csrfToken: csrf },
            headers: { 'x-csrf-token': csrf },
        });
        await csrfProtection(request, reply);
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('skips CSRF entirely when no token cookie is present (Bearer/unauthenticated)', async () => {
        const request = makeRequest({ route: '/settings', cookies: {} });
        await csrfProtection(request, reply);
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('skips safe methods', async () => {
        const request = makeRequest({ method: 'GET', route: '/settings', cookies: { token: 'session' } });
        await csrfProtection(request, reply);
        expect(reply.status).not.toHaveBeenCalled();
    });
});

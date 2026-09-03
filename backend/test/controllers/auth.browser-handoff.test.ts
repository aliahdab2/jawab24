import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';

vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/db/schema', () => ({ users: {}, ecommerceStores: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn(),
        generateToken: vi.fn(),
        mintBrowserHandoffCode: vi.fn(),
        consumeBrowserHandoffCode: vi.fn(),
    },
    ACCESS_TOKEN_EXPIRY: 15 * 60 * 1000,
    MOBILE_DEEP_LINK_TOKEN_EXPIRY: 7 * 24 * 60 * 60 * 1000,
    EMBEDDED_BREAKOUT_TOKEN_EXPIRY: 60 * 60 * 1000,
}));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/services/workspace', () => ({
    workspaceService: { resolveDefaultWorkspaceId: vi.fn() },
}));
vi.mock('../../src/services/cookies', () => ({
    cookiesService: {
        setAuthCookies: vi.fn(), setRefreshTokenCookie: vi.fn(), clearRefreshTokenCookie: vi.fn(),
    },
    COOKIE_OPTIONS: {}, CSRF_COOKIE_OPTIONS: {}, REFRESH_COOKIE_OPTIONS: {},
}));
vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: { createRefreshToken: vi.fn() },
}));
vi.mock('../../src/services/otp', () => ({ otpService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLogService: { record: vi.fn() } }));
vi.mock('../../src/integrations', () => ({}));

import { authController } from '../../src/controllers/auth';
// Pulled from the module under mock so the assertion and the controller read one
// declaration — a literal copied into the test would drift if the expiry changed.
import { authService, EMBEDDED_BREAKOUT_TOKEN_EXPIRY } from '../../src/services/auth';
import { refreshTokenService } from '../../src/services/refreshToken';
import { cookiesService } from '../../src/services/cookies';
import { workspaceService } from '../../src/services/workspace';

function buildReply() {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe('AuthController.browserHandoff (mint)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(authService.getUserById).mockResolvedValue({ id: 'user-1' } as never);
        vi.mocked(authService.mintBrowserHandoffCode).mockResolvedValue('opaque-code');
    });

    it('mints a single-use CODE — never a session token — for the session user', async () => {
        const reply = buildReply();
        await authController.browserHandoff({ user: { userId: 'user-1' } } as never, reply);

        expect(authService.mintBrowserHandoffCode).toHaveBeenCalledWith('user-1', undefined);
        expect(reply.send).toHaveBeenCalledWith({ code: 'opaque-code' });
        // The code rides a URL (Custom Tab history, nginx logs) — a session
        // token must never take its place.
        expect(authService.generateToken).not.toHaveBeenCalled();
    });

    it('CARRIES the caller scope into the code — a restricted session cannot buy an unrestricted one', async () => {
        const reply = buildReply();
        await authController.browserHandoff({
            user: { userId: 'user-1', embeddedPlatform: 'zid', scopedWorkspaceId: 'ws-9' },
        } as never, reply);

        // Without this the iframe trades its workspace-pinned, admin-stripped
        // token for a full session — defeating TokenScope entirely.
        expect(authService.mintBrowserHandoffCode).toHaveBeenCalledWith('user-1', {
            embeddedPlatform: 'zid',
            workspaceId: 'ws-9',
        });
    });

    it('does not fabricate a scope from a half-populated session', async () => {
        const reply = buildReply();
        await authController.browserHandoff({
            user: { userId: 'user-1', embeddedPlatform: 'zid' },
        } as never, reply);

        // An embedded marker with no pinned workspace is not a usable scope; a
        // scope built from it would pin the session to `undefined`.
        expect(authService.mintBrowserHandoffCode).toHaveBeenCalledWith('user-1', undefined);
    });

    it('401 without a session — the bridge only carries an EXISTING login', async () => {
        const reply = buildReply();
        await authController.browserHandoff({ user: undefined } as never, reply);
        expect(reply.status).toHaveBeenCalledWith(401);
        expect(authService.mintBrowserHandoffCode).not.toHaveBeenCalled();
    });

    it('404 when the session user no longer exists', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue(null as never);
        const reply = buildReply();
        await authController.browserHandoff({ user: { userId: 'ghost' } } as never, reply);
        expect(reply.status).toHaveBeenCalledWith(404);
        expect(authService.mintBrowserHandoffCode).not.toHaveBeenCalled();
    });
});

describe('AuthController.browserHandoffExchange', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue({ userId: 'user-1' });
        vi.mocked(authService.getUserById).mockResolvedValue({ id: 'user-1' } as never);
        vi.mocked(authService.generateToken).mockReturnValue('session-token');
        vi.mocked(refreshTokenService.createRefreshToken).mockResolvedValue('refresh-token' as never);
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue('ws-1' as never);
    });

    it('trades a valid code for a FIRST-CLASS login: token + refresh cookie + auth cookies', async () => {
        const reply = buildReply();
        await authController.browserHandoffExchange({ body: { code: 'opaque-code' } } as never, reply);

        expect(authService.consumeBrowserHandoffCode).toHaveBeenCalledWith('opaque-code');
        // Full-TTL session token (no expiry override) — the browser session
        // must outlive Meta's wizard, unlike the earlier 10-min URL token.
        expect(authService.generateToken).toHaveBeenCalledWith({ id: 'user-1' });
        expect(refreshTokenService.createRefreshToken).toHaveBeenCalledWith('user-1');
        expect(cookiesService.setAuthCookies).toHaveBeenCalledWith(reply, 'session-token');
        expect(cookiesService.setRefreshTokenCookie).toHaveBeenCalledWith(reply, 'refresh-token');
        // The scoped branch's cookie clearing must not leak into this one.
        expect(cookiesService.clearRefreshTokenCookie).not.toHaveBeenCalled();
        expect(reply.send).toHaveBeenCalledWith({ token: 'session-token', defaultWorkspaceId: 'ws-1' });
    });

    describe('scoped handoff (embedded break-out)', () => {
        beforeEach(() => {
            vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue({
                userId: 'user-1',
                scope: { embeddedPlatform: 'zid', workspaceId: 'ws-9' },
            });
        });

        it('mints a token that is STILL scoped — the break-out is not an escalation', async () => {
            const reply = buildReply();
            await authController.browserHandoffExchange({ body: { code: 'scoped-code' } } as never, reply);

            expect(authService.generateToken).toHaveBeenCalledWith(
                { id: 'user-1' },
                EMBEDDED_BREAKOUT_TOKEN_EXPIRY,
                { embeddedPlatform: 'zid', workspaceId: 'ws-9' },
            );
            expect(reply.send).toHaveBeenCalledWith({
                token: 'session-token',
                defaultWorkspaceId: 'ws-9',
            });
        });

        it('issues NO refresh cookie — a rotation would launder the scope away', async () => {
            const reply = buildReply();
            await authController.browserHandoffExchange({ body: { code: 'scoped-code' } } as never, reply);

            // /auth/refresh mints an UNSCOPED token, so handing this tab a
            // refresh cookie would re-open the escalation one step later.
            expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
            expect(cookiesService.setRefreshTokenCookie).not.toHaveBeenCalled();
            // The auth cookie IS set — the tab has to work.
            expect(cookiesService.setAuthCookies).toHaveBeenCalledWith(reply, 'session-token');
        });

        it('CLEARS a pre-existing refresh cookie — not issuing one is not enough', async () => {
            const reply = buildReply();
            await authController.browserHandoffExchange({ body: { code: 'scoped-code' } } as never, reply);

            // This tab shares a cookie jar with every other jawab24.com tab. A
            // refresh cookie left from an EARLIER ordinary login on this browser
            // is still there, and the client's 401 interceptor would rotate it
            // into an unscoped token the moment the scoped one expires — the same
            // laundering, just on a timer.
            expect(cookiesService.clearRefreshTokenCookie).toHaveBeenCalledWith(reply);
        });

        it('pins the workspace from the SCOPE, never from the resolver', async () => {
            const reply = buildReply();
            await authController.browserHandoffExchange({ body: { code: 'scoped-code' } } as never, reply);

            // Resolving the user's default workspace could return a different
            // one, silently widening the session past the store it came from.
            expect(workspaceService.resolveDefaultWorkspaceId).not.toHaveBeenCalled();
        });
    });

    it('401 on an invalid, expired, or ALREADY-USED code — no login artifacts issued', async () => {
        vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue(null);
        const reply = buildReply();
        await authController.browserHandoffExchange({ body: { code: 'stale' } } as never, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(authService.generateToken).not.toHaveBeenCalled();
        expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
        expect(cookiesService.setAuthCookies).not.toHaveBeenCalled();
    });

    it('404 when the code resolves to a user that no longer exists', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue(null as never);
        const reply = buildReply();
        await authController.browserHandoffExchange({ body: { code: 'opaque-code' } } as never, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(authService.generateToken).not.toHaveBeenCalled();
    });
});

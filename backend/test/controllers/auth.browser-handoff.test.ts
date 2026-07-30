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
}));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/services/workspace', () => ({
    workspaceService: { resolveDefaultWorkspaceId: vi.fn() },
}));
vi.mock('../../src/services/cookies', () => ({
    cookiesService: { setAuthCookies: vi.fn(), setRefreshTokenCookie: vi.fn() },
    COOKIE_OPTIONS: {}, CSRF_COOKIE_OPTIONS: {}, REFRESH_COOKIE_OPTIONS: {},
}));
vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: { createRefreshToken: vi.fn() },
}));
vi.mock('../../src/services/otp', () => ({ otpService: {} }));
vi.mock('../../src/services/sms', () => ({ smsService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLogService: { record: vi.fn() } }));
vi.mock('../../src/integrations', () => ({}));

import { authController } from '../../src/controllers/auth';
import { authService } from '../../src/services/auth';
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

        expect(authService.mintBrowserHandoffCode).toHaveBeenCalledWith('user-1');
        expect(reply.send).toHaveBeenCalledWith({ code: 'opaque-code' });
        // The code rides a URL (Custom Tab history, nginx logs) — a session
        // token must never take its place.
        expect(authService.generateToken).not.toHaveBeenCalled();
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
        vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue('user-1');
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
        expect(reply.send).toHaveBeenCalledWith({ token: 'session-token', defaultWorkspaceId: 'ws-1' });
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

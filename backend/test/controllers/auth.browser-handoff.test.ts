import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';

vi.mock('../../src/db', () => ({ db: {} }));
vi.mock('../../src/db/schema', () => ({ users: {}, ecommerceStores: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock('../../src/services/auth', () => ({
    authService: { getUserById: vi.fn(), generateToken: vi.fn() },
    ACCESS_TOKEN_EXPIRY: 15 * 60 * 1000,
    MOBILE_DEEP_LINK_TOKEN_EXPIRY: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/pages', () => ({ pagesService: {} }));
vi.mock('../../src/services/workspace', () => ({ workspaceService: {} }));
vi.mock('../../src/services/cookies', () => ({ cookiesService: {}, COOKIE_OPTIONS: {}, CSRF_COOKIE_OPTIONS: {}, REFRESH_COOKIE_OPTIONS: {} }));
vi.mock('../../src/services/refreshToken', () => ({ refreshTokenService: {} }));
vi.mock('../../src/services/otp', () => ({ otpService: {} }));
vi.mock('../../src/services/sms', () => ({ smsService: {} }));
vi.mock('../../src/services/settings', () => ({ settingsService: {} }));
vi.mock('../../src/services/auditLog', () => ({ auditLogService: { record: vi.fn() } }));
vi.mock('../../src/integrations', () => ({}));

import { authController } from '../../src/controllers/auth';
import { authService } from '../../src/services/auth';

function buildReply() {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe('AuthController.browserHandoff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(authService.getUserById).mockResolvedValue({ id: 'user-1' } as never);
        vi.mocked(authService.generateToken).mockReturnValue('short-lived-token');
    });

    it('mints a SHORT-lived token (10 min — it rides in a Custom Tab URL) for the session user', async () => {
        const reply = buildReply();
        await authController.browserHandoff({ user: { userId: 'user-1' } } as never, reply);

        expect(authService.generateToken).toHaveBeenCalledWith({ id: 'user-1' }, 10 * 60 * 1000);
        expect(reply.send).toHaveBeenCalledWith({ token: 'short-lived-token' });
    });

    it('401 without a session — the bridge only carries an EXISTING login', async () => {
        const reply = buildReply();
        await authController.browserHandoff({ user: undefined } as never, reply);
        expect(reply.status).toHaveBeenCalledWith(401);
        expect(authService.generateToken).not.toHaveBeenCalled();
    });

    it('404 when the session user no longer exists', async () => {
        vi.mocked(authService.getUserById).mockResolvedValue(null as never);
        const reply = buildReply();
        await authController.browserHandoff({ user: { userId: 'ghost' } } as never, reply);
        expect(reply.status).toHaveBeenCalledWith(404);
        expect(authService.generateToken).not.toHaveBeenCalled();
    });
});

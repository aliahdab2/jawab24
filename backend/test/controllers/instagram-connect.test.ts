import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import instagramConnectRoutes from '../../src/routes/instagramConnect';
import { instagramLoginService } from '../../src/services/instagramLogin';
import { pagesService } from '../../src/services/pages';
import { subscriptionsService } from '../../src/services/subscriptions';
import { issueSingleUse, consumeSingleUse } from '../../src/lib/singleUseKey';

vi.mock('../../src/services/instagramLogin', () => ({
    instagramLoginService: {
        isConfigured: vi.fn().mockReturnValue(true),
        buildAuthorizeUrl: vi.fn((state: string) => `https://www.instagram.com/oauth/authorize?state=${state}`),
        completeConnect: vi.fn(),
    },
    InstagramLoginError: class InstagramLoginError extends Error {
        constructor(message: string, public readonly code: string) { super(message); }
    },
}));
vi.mock('../../src/services/pages', () => ({
    pagesService: { connectInstagramDirect: vi.fn() },
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { canEnablePage: vi.fn().mockResolvedValue({ allowed: true, limit: 5 }) },
}));
vi.mock('../../src/lib/singleUseKey', () => ({
    issueSingleUse: vi.fn().mockResolvedValue(undefined),
    consumeSingleUse: vi.fn(),
}));
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => { req.user = { userId: 'owner_1' }; },
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: async (req: any) => {
        req.workspaceId = 'ws_1';
        req.workspaceOwnerId = 'owner_1';
        req.workspaceRole = 'owner';
    },
    requireRole: () => async () => {},
}));
vi.mock('../../src/config', () => ({
    config: {
        frontendUrl: 'https://jawab24.com',
        instagram: { appId: 'x', appSecret: 'y', redirectUri: 'z' },
        facebook: { graphApiVersion: 'v23.0', tokenEncryptionKey: '' },
    },
}));

const PROFILE = { userId: '17841400000', username: 'oum.anas.sweets', name: 'أم أنس', profilePictureUrl: null };
const TOKEN = { accessToken: 'long_tok', expiresAt: new Date('2026-10-15') };

describe('Instagram connect flow', () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(instagramLoginService.isConfigured).mockReturnValue(true);
        vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true, limit: 5 } as never);
        app = fastify();
        app.register(instagramConnectRoutes);
        await app.ready();
    });

    describe('POST /auth/instagram/start', () => {
        it('mints single-use state and returns the instagram.com authorize URL', async () => {
            const response = await app.inject({ method: 'POST', url: '/auth/instagram/start', payload: {} });

            expect(response.statusCode).toBe(200);
            const { url } = JSON.parse(response.payload);
            expect(url).toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize\?state=[0-9a-f]{32}$/);
            const [key, value] = vi.mocked(issueSingleUse).mock.calls[0];
            expect(key).toMatch(/^ig:state:[0-9a-f]{32}$/);
            expect(JSON.parse(value)).toMatchObject({ userId: 'owner_1', workspaceId: 'ws_1' });
        });

        it('is dark (404) when the Instagram app is not configured', async () => {
            vi.mocked(instagramLoginService.isConfigured).mockReturnValue(false);

            const response = await app.inject({ method: 'POST', url: '/auth/instagram/start', payload: {} });
            expect(response.statusCode).toBe(404);
            expect(issueSingleUse).not.toHaveBeenCalled();
        });

        it('fails before OAuth when the page slot limit is reached', async () => {
            vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: false, limit: 1 } as never);

            const response = await app.inject({ method: 'POST', url: '/auth/instagram/start', payload: {} });
            expect(response.statusCode).toBe(403);
            expect(JSON.parse(response.payload).code).toBe('PAGE_LIMIT_REACHED');
        });
    });

    describe('GET /auth/instagram/callback', () => {
        const VALID_STATE = JSON.stringify({ userId: 'owner_1', workspaceId: 'ws_1', locale: 'ar' });

        it('refuses a missing/replayed state before touching Meta or the DB', async () => {
            vi.mocked(consumeSingleUse).mockResolvedValue(null);

            const response = await app.inject({ method: 'GET', url: '/auth/instagram/callback?code=c&state=deadbeef' });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toContain('igError%3Dstate');
            expect(instagramLoginService.completeConnect).not.toHaveBeenCalled();
            expect(pagesService.connectInstagramDirect).not.toHaveBeenCalled();
        });

        it('connects the account for the workspace recorded IN THE STATE and returns the app-sync page', async () => {
            vi.mocked(consumeSingleUse).mockResolvedValue(VALID_STATE);
            vi.mocked(instagramLoginService.completeConnect).mockResolvedValue({ token: TOKEN, profile: PROFILE } as never);
            vi.mocked(pagesService.connectInstagramDirect).mockResolvedValue({ taken: false, page: { id: 'p1' } } as never);

            const response = await app.inject({ method: 'GET', url: '/auth/instagram/callback?code=the_code&state=abc123' });

            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain('text/html');
            expect(pagesService.connectInstagramDirect).toHaveBeenCalledWith('ws_1', 'owner_1', PROFILE, TOKEN);
            expect(response.payload).toContain('/auth/app-sync');
            expect(response.payload).toContain('instagramConnected%3D1');
        });

        it('surfaces a cross-workspace claim as igError=taken, never a silent move', async () => {
            vi.mocked(consumeSingleUse).mockResolvedValue(VALID_STATE);
            vi.mocked(instagramLoginService.completeConnect).mockResolvedValue({ token: TOKEN, profile: PROFILE } as never);
            vi.mocked(pagesService.connectInstagramDirect).mockResolvedValue({ taken: true } as never);

            const response = await app.inject({ method: 'GET', url: '/auth/instagram/callback?code=c&state=abc' });
            expect(response.payload).toContain('igError%3Dtaken');
        });

        it('treats a dialog cancel as a normal return, without calling Meta', async () => {
            vi.mocked(consumeSingleUse).mockResolvedValue(VALID_STATE);

            const response = await app.inject({ method: 'GET', url: '/auth/instagram/callback?error=access_denied&state=abc' });

            expect(response.payload).toContain('igError%3Dcancelled');
            expect(instagramLoginService.completeConnect).not.toHaveBeenCalled();
        });
    });
});

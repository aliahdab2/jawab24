import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { instagramLoginService, InstagramLoginError, INSTAGRAM_LOGIN_SCOPES } from '../../src/services/instagramLogin';
import { db } from '../../src/db';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
    },
}));

vi.mock('../../src/db', () => ({
    db: { select: vi.fn(), update: vi.fn() },
}));

vi.mock('../../src/config', () => ({
    config: {
        instagram: {
            appId: 'ig_app_id',
            appSecret: 'ig_app_secret',
            redirectUri: 'https://jawab24.com/auth/instagram/callback',
        },
        facebook: { graphApiVersion: 'v23.0', tokenEncryptionKey: '' },
    },
}));

const mockedAxios = vi.mocked(axios, true);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('instagramLoginService.buildAuthorizeUrl', () => {
    it('points at instagram.com with the app credentials, all three scopes and the state', () => {
        const url = new URL(instagramLoginService.buildAuthorizeUrl('one-time-state'));

        expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
        expect(url.searchParams.get('client_id')).toBe('ig_app_id');
        expect(url.searchParams.get('redirect_uri')).toBe('https://jawab24.com/auth/instagram/callback');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('state')).toBe('one-time-state');
        for (const scope of INSTAGRAM_LOGIN_SCOPES) {
            expect(url.searchParams.get('scope')).toContain(scope);
        }
    });
});

describe('instagramLoginService.exchangeCode', () => {
    it('posts the form-encoded exchange and returns the short-lived token', async () => {
        mockedAxios.post.mockResolvedValue({ data: { access_token: 'short_tok', user_id: '178414123' } });

        const token = await instagramLoginService.exchangeCode('auth_code_1');

        expect(token).toBe('short_tok');
        const [url, body, opts] = mockedAxios.post.mock.calls[0];
        expect(url).toBe('https://api.instagram.com/oauth/access_token');
        expect(String(body)).toContain('grant_type=authorization_code');
        expect(String(body)).toContain('code=auth_code_1');
        expect((opts as { headers: Record<string, string> }).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('wraps a missing token in InstagramLoginError', async () => {
        mockedAxios.post.mockResolvedValue({ data: {} });

        await expect(instagramLoginService.exchangeCode('c')).rejects.toBeInstanceOf(InstagramLoginError);
    });
});

describe('instagramLoginService.exchangeToLongLived', () => {
    it('maps expires_in to an absolute expiry', async () => {
        mockedAxios.get.mockResolvedValue({ data: { access_token: 'long_tok', expires_in: 5_184_000 } });

        const before = Date.now();
        const result = await instagramLoginService.exchangeToLongLived('short_tok');

        expect(result.accessToken).toBe('long_tok');
        const days = (result.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(59);
        expect(days).toBeLessThanOrEqual(60.01);
    });

    it('falls back to ~59 days when expires_in is missing (never NULL)', async () => {
        mockedAxios.get.mockResolvedValue({ data: { access_token: 'long_tok' } });

        const result = await instagramLoginService.exchangeToLongLived('short_tok');
        const days = (result.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(58);
        expect(days).toBeLessThanOrEqual(59.01);
    });
});

describe('instagramLoginService.getProfile', () => {
    it('maps the professional account profile', async () => {
        mockedAxios.get.mockResolvedValue({
            data: { user_id: 17841400000000, username: 'sweets.by.oum.anas', name: 'أم أنس', profile_picture_url: 'https://cdn/pic.jpg' },
        });

        const profile = await instagramLoginService.getProfile('long_tok');

        expect(profile).toEqual({
            userId: '17841400000000',
            username: 'sweets.by.oum.anas',
            name: 'أم أنس',
            profilePictureUrl: 'https://cdn/pic.jpg',
        });
    });

    it('rejects a profile without user_id/username', async () => {
        mockedAxios.get.mockResolvedValue({ data: { username: 'x' } });

        await expect(instagramLoginService.getProfile('t')).rejects.toBeInstanceOf(InstagramLoginError);
    });
});

describe('instagramLoginService.completeConnect', () => {
    it('chains code → short → long-lived → profile', async () => {
        mockedAxios.post.mockResolvedValue({ data: { access_token: 'short_tok' } });
        mockedAxios.get
            .mockResolvedValueOnce({ data: { access_token: 'long_tok', expires_in: 5_184_000 } })
            .mockResolvedValueOnce({ data: { user_id: '1', username: 'shop' } });

        const { token, profile } = await instagramLoginService.completeConnect('the_code');

        expect(token.accessToken).toBe('long_tok');
        expect(profile.username).toBe('shop');
    });
});

describe('instagramLoginService.runRefreshSweep', () => {
    const selectRows = (rows: { id: string; token: string }[]) => {
        vi.mocked(db.select).mockReturnValue({
            from: () => ({ where: () => Promise.resolve(rows) }),
        } as never);
    };

    it('refreshes an expiring token and persists the new token + expiry', async () => {
        selectRows([{ id: 'page_ig_1', token: 'old_long_tok' }]);
        const whereSpy = vi.fn().mockResolvedValue(undefined);
        vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereSpy }) } as never);
        mockedAxios.get.mockResolvedValue({ data: { access_token: 'new_long_tok', expires_in: 5_184_000 } });

        const result = await instagramLoginService.runRefreshSweep();

        expect(result).toEqual({ refreshed: 1, failed: 0 });
        const setArg = (vi.mocked(db.update).mock.results[0].value as { set: ReturnType<typeof vi.fn> }).set.mock.calls[0][0];
        expect(setArg.instagramAccessToken).toBe('new_long_tok'); // no key configured → stored as-is
        expect(setArg.instagramTokenExpiresAt).toBeInstanceOf(Date);
        expect(whereSpy).toHaveBeenCalled();
    });

    it('counts a failing row and keeps sweeping instead of throwing', async () => {
        selectRows([
            { id: 'page_bad', token: 'dead_tok' },
            { id: 'page_ok', token: 'ok_tok' },
        ]);
        const whereSpy = vi.fn().mockResolvedValue(undefined);
        vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: whereSpy }) } as never);
        mockedAxios.get
            .mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: { message: 'expired' } } }, message: 'expired' })
            .mockResolvedValueOnce({ data: { access_token: 'fresh', expires_in: 5_184_000 } });

        const result = await instagramLoginService.runRefreshSweep();

        expect(result).toEqual({ refreshed: 1, failed: 1 });
        expect(whereSpy).toHaveBeenCalledTimes(1); // only the healthy row was written
    }, 10_000);
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { instagramLoginService, InstagramLoginError, INSTAGRAM_LOGIN_SCOPES } from '../../src/services/instagramLogin';
import { db } from '../../src/db';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        // `create` returning undefined is what makes lib/fbAxios fall back to this
        // same mocked default (`instance ?? axios`), so the subscribed_apps call
        // routed through fbAxios lands on the `post` spy below. Omit it and the
        // module throws at import.
        create: vi.fn(),
        isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
    },
}));

vi.mock('../../src/db', () => ({
    db: { select: vi.fn(), update: vi.fn() },
}));

// Mirror the method the service ACTUALLY calls. A mock that exposes a different
// one turns every `not.toHaveBeenCalled()` below into a vacuous pass — the call
// throws on `undefined is not a function`, the service's catch swallows it, and
// the spy is legitimately never called.
const mockSendTemplateNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotification: (...a: unknown[]) => mockSendTemplateNotification(...a) },
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

        expect(result).toEqual({ refreshed: 1, failed: 0, dead: 0 });
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

        expect(result).toEqual({ refreshed: 1, failed: 1, dead: 0 });
        expect(whereSpy).toHaveBeenCalledTimes(1); // only the healthy row was written
    }, 10_000);
});

describe('instagramLoginService.runRefreshSweep — terminal 190 (review M1)', () => {
    const selectRows = (rows: Record<string, unknown>[]) => {
        vi.mocked(db.select).mockReturnValue({
            from: () => ({ where: () => Promise.resolve(rows) }),
        } as never);
    };
    const graph190 = {
        isAxiosError: true,
        message: 'Error validating access token',
        response: { data: { error: { message: 'Error validating access token: The session has been invalidated', type: 'OAuthException', code: 190 } } },
    };

    it("Meta's 190 clears the credential (to '', the was-connected sentinel) and notifies the merchant once", async () => {
        selectRows([{ id: 'page_dead', token: 'revoked_tok', userId: 'user-1', name: 'متجر', instagramUsername: 'shop' }]);
        const returningSpy = vi.fn().mockResolvedValue([{ id: 'page_dead' }]);
        const whereSpy = vi.fn().mockReturnValue({ returning: returningSpy });
        const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
        vi.mocked(db.update).mockReturnValue({ set: setSpy } as never);
        mockedAxios.get.mockRejectedValue(graph190);

        const result = await instagramLoginService.runRefreshSweep();

        expect(result).toEqual({ refreshed: 0, failed: 0, dead: 1 });
        expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ instagramAccessToken: '' }));
        // Sent THROUGH the template registry, with the account label as the
        // `{account}` variable — the merchant-facing copy lives in exactly one
        // place (NOTIFICATION_TEMPLATES), never restated at the call site.
        expect(mockSendTemplateNotification).toHaveBeenCalledWith(
            'user-1',
            'instagram_reconnect_needed',
            { account: '@shop' },
            expect.objectContaining({ action: 'reconnect_instagram', pageId: 'page_dead' }),
        );
    });

    // The guarded UPDATE is the idempotency gate: a second sweep racing the first
    // finds '' already written, gets no row back, and must NOT notify again.
    it('does not notify when another sweep already cleared the row', async () => {
        selectRows([{ id: 'page_dead', token: 'revoked_tok', userId: 'user-1', name: null, instagramUsername: null }]);
        const returningSpy = vi.fn().mockResolvedValue([]);
        vi.mocked(db.update).mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: returningSpy }) }),
        } as never);
        mockedAxios.get.mockRejectedValue(graph190);

        await instagramLoginService.runRefreshSweep();

        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });

    // A transient failure carries no Graph verdict — the token MUST survive for
    // tomorrow's retry. Mutation-checked: classifying every failure as terminal
    // fails here (the credential-destroying false positive the WhatsApp sweep's
    // history warns about).
    it('a network error keeps the token — no clear, no notification', async () => {
        selectRows([{ id: 'page_blip', token: 'ok_tok', userId: 'user-1', name: null, instagramUsername: null }]);
        const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) });
        vi.mocked(db.update).mockReturnValue({ set: setSpy } as never);
        mockedAxios.get.mockRejectedValue({ isAxiosError: true, message: 'ETIMEDOUT', code: 'ETIMEDOUT' });

        const result = await instagramLoginService.runRefreshSweep();

        expect(result).toEqual({ refreshed: 0, failed: 1, dead: 0 });
        expect(setSpy).not.toHaveBeenCalled();
        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });
});

describe('instagramLoginService.subscribeToWebhooks', () => {
    // Instagram Login delivers NOTHING to an account that has not installed the app
    // on itself (Meta docs, verified 2026-08-16). Without this call the connect looks
    // healthy and answers no one — the silent-channel failure mode Instagram has
    // already produced twice on this codebase.
    it('POSTs subscribed_apps for THIS account on graph.instagram.com with messages+comments', async () => {
        mockedAxios.post.mockResolvedValue({ data: { success: true } });

        const ok = await instagramLoginService.subscribeToWebhooks('ig-user-1', 'ig-token');

        expect(ok).toBe(true);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'https://graph.instagram.com/v23.0/ig-user-1/subscribed_apps',
            null,
            expect.objectContaining({
                params: { subscribed_fields: 'messages,comments', access_token: 'ig-token' },
            }),
        );
    });

    // Meta answers 200 with {"success": false} rather than an error status when it
    // declines. Reading the BODY — not the status — is the difference between
    // knowing the channel is live and assuming it.
    it('reports FALSE when Meta answers 200 without success:true', async () => {
        mockedAxios.post.mockResolvedValue({ data: { success: false } });
        await expect(instagramLoginService.subscribeToWebhooks('ig-user-1', 'ig-token')).resolves.toBe(false);
    });

    // The merchant holds a valid credential by this point; losing the whole connect
    // to a transient Graph error would be worse than a channel we can re-subscribe.
    it('never throws on a Graph failure — reports false so the caller can warn', async () => {
        mockedAxios.post.mockRejectedValue(Object.assign(new Error('boom'), { isAxiosError: true }));
        await expect(instagramLoginService.subscribeToWebhooks('ig-user-1', 'ig-token')).resolves.toBe(false);
    });
});

describe('instagramLoginService.runWebhookResubscribeSweep — the deaf-channel self-heal (re-review)', () => {
    const selectRows = (rows: Record<string, unknown>[]) => {
        vi.mocked(db.select).mockReturnValue({
            from: () => ({ where: () => Promise.resolve(rows) }),
        } as never);
    };

    // A connect-time subscription failure used to survive only as one transient
    // toast; this sweep is what turns that state self-healing. Mutation-checked:
    // dropping the runWebhookResubscribeSweep call from the cron chain (or the
    // subscribeToWebhooks call inside it) fails here.
    it('re-issues the idempotent subscribed_apps install for every live direct row', async () => {
        selectRows([
            { id: 'p1', token: 'ig-tok-1', instagramAccountId: 'ig-acct-1' },
            { id: 'p2', token: 'ig-tok-2', instagramAccountId: 'ig-acct-2' },
        ]);
        mockedAxios.post.mockResolvedValue({ data: { success: true } });

        const result = await instagramLoginService.runWebhookResubscribeSweep();

        expect(result).toEqual({ resubscribed: 2, failed: 0 });
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'https://graph.instagram.com/v23.0/ig-acct-1/subscribed_apps',
            null,
            expect.objectContaining({ params: expect.objectContaining({ access_token: 'ig-tok-1' }) }),
        );
        expect(mockedAxios.post).toHaveBeenCalledWith(
            'https://graph.instagram.com/v23.0/ig-acct-2/subscribed_apps',
            null,
            expect.objectContaining({ params: expect.objectContaining({ access_token: 'ig-tok-2' }) }),
        );
    }, 10_000);

    it('a failing row is counted and never aborts the sweep', async () => {
        selectRows([
            { id: 'p_bad', token: 'dead-tok', instagramAccountId: 'ig-bad' },
            { id: 'p_ok', token: 'ok-tok', instagramAccountId: 'ig-ok' },
        ]);
        mockedAxios.post
            .mockRejectedValueOnce(Object.assign(new Error('boom'), { isAxiosError: true }))
            .mockResolvedValueOnce({ data: { success: true } });

        await expect(instagramLoginService.runWebhookResubscribeSweep())
            .resolves.toEqual({ resubscribed: 1, failed: 1 });
    }, 10_000);

    // A direct row without an account id has nothing to install onto — skip,
    // never call Meta with an empty path segment.
    it('skips rows with no instagramAccountId', async () => {
        selectRows([{ id: 'p_null', token: 'tok', instagramAccountId: null }]);

        await expect(instagramLoginService.runWebhookResubscribeSweep())
            .resolves.toEqual({ resubscribed: 0, failed: 0 });
        expect(mockedAxios.post).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

// ── Mocks (before imports) ──────────────────────────────────────────────────

// Spread the REAL config so transitive imports (redis, logging, …) keep their
// defaults; override only what this suite pins.
vi.mock('../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config')>();
    return {
        ...actual,
        config: {
            ...actual.config,
            frontendUrl: 'https://jawab24.com',
            publicApiBaseUrl: 'https://jawab24.com/api',
            jwt: { ...actual.config.jwt, secret: 'test-state-secret' },
            facebook: { ...actual.config.facebook, appId: 'app-1', appSecret: 'shh', graphApiVersion: 'v23.0' },
            whatsappAllowlist: [] as string[],
            whatsappConfigId: 'cfg-1',
            whatsappConnectRedirect: true,
        },
    };
});

// Membership query used by reverifyGates: db.select(...).from(...).innerJoin(...)
// .where(...).limit(1). One mutable result cell per test.
const membershipResult: { rows: Array<{ role: string; ownerId: string }> } = { rows: [] };
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: () => ({
                innerJoin: () => ({
                    where: () => ({
                        limit: async () => membershipResult.rows,
                    }),
                }),
            }),
        })),
    },
}));
vi.mock('../../src/db/schema', () => ({
    users: {}, workspaces: { ownerId: 'ownerId' }, workspaceMembers: { workspaceId: 'workspaceId', userId: 'userId', role: 'role' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
        getPageByWhatsAppPhoneNumberId: vi.fn(),
        connectWhatsApp: vi.fn(),
        createWhatsAppOnlyPage: vi.fn(),
    },
    isPageDisconnected: vi.fn(),
}));

vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        exchangeCodeForToken: vi.fn(),
        debugToken: vi.fn(),
        listWabaPhoneNumbers: vi.fn(),
        subscribeAppToWaba: vi.fn(),
        registerPhoneNumber: vi.fn(),
        getPhoneNumberInfo: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { getUserSubscription: vi.fn(), canEnablePage: vi.fn() },
}));
vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: { evaluate: vi.fn(), record: vi.fn(), channelsForPage: vi.fn() },
}));
vi.mock('../../src/services/businessReadiness', () => ({ businessInfoGate: vi.fn() }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/auth', () => ({ authService: { getUserById: vi.fn().mockResolvedValue(null) } }));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { whatsappRedirectController, pickPhoneCandidate, WHATSAPP_NONCE_COOKIE } from '../../src/controllers/whatsappRedirect';
import { mintWhatsAppConnectState } from '../../src/utils/whatsappConnectState';
import { pagesService } from '../../src/services/pages';
import { whatsappService } from '../../src/services/whatsapp';
import { subscriptionsService } from '../../src/services/subscriptions';

const entitled = { status: 'active', plan: { slug: 'business', whatsappEnabled: true } };
const starter = { status: 'active', plan: { slug: 'starter', whatsappEnabled: false } };

function buildReply() {
    const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
    };
    return reply as unknown as FastifyReply & typeof reply;
}

function buildStartRequest(body: Record<string, unknown> = {}) {
    return {
        user: { userId: 'user-1', facebookId: 'fb-1' },
        workspaceId: 'ws-1',
        workspaceOwnerId: 'owner-1',
        workspaceRole: 'owner',
        body,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as FastifyRequest<{ Body: { pageId?: string | null; coexistence?: boolean; locale?: string } }>;
}

function buildCallbackRequest(query: Record<string, string>, nonce?: string) {
    return {
        query,
        cookies: nonce !== undefined ? { [WHATSAPP_NONCE_COOKIE]: `signed:${nonce}` } : {},
        unsignCookie: vi.fn((raw: string) => ({ valid: raw.startsWith('signed:'), value: raw.replace(/^signed:/, '') })),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as FastifyRequest<{ Querystring: { code?: string; state?: string; error?: string } }>;
}

/** Mint a real signed state (the controller verifies real signatures). */
function mintState(overrides: Partial<Parameters<typeof mintWhatsAppConnectState>[0]> = {}) {
    return mintWhatsAppConnectState({
        userId: 'user-1', workspaceId: 'ws-1', pageId: 'page-1', coexistence: false, locale: 'en', ...overrides,
    });
}

const PHONE = { id: 'phone-9', displayPhoneNumber: '+966 55 111 2222', verifiedName: 'Noor Store', platformType: 'CLOUD_API' as string | undefined, lastOnboardedTime: undefined as string | undefined };

function primeHappyMeta(phone: Partial<typeof PHONE> = {}) {
    vi.mocked(whatsappService.exchangeCodeForToken).mockResolvedValue({ token: 'wa-business-token', expiresIn: 5184000 });
    vi.mocked(whatsappService.debugToken).mockResolvedValue({
        isValid: true, scopes: [], wabaIds: ['waba-1'],
    } as Awaited<ReturnType<typeof whatsappService.debugToken>>);
    vi.mocked(whatsappService.listWabaPhoneNumbers).mockResolvedValue([{ ...PHONE, ...phone }]);
    vi.mocked(whatsappService.subscribeAppToWaba).mockResolvedValue(undefined);
    vi.mocked(whatsappService.registerPhoneNumber).mockResolvedValue(undefined);
    vi.mocked(whatsappService.getPhoneNumberInfo).mockResolvedValue({ displayPhoneNumber: '+966 55 111 2222', verifiedName: 'Noor Store' });
}

beforeEach(() => {
    vi.clearAllMocks();
    membershipResult.rows = [{ role: 'owner', ownerId: 'owner-1' }];
    vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(entitled as never);
    vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', whatsappPhoneNumberId: null, whatsappCoexistence: null } as never);
    vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(null as never);
    vi.mocked(pagesService.connectWhatsApp).mockResolvedValue({ id: 'page-1' } as never);
    vi.mocked(pagesService.createWhatsAppOnlyPage).mockResolvedValue({ id: 'page-new' } as never);
});

// ── start ────────────────────────────────────────────────────────────────────

describe('WhatsAppRedirectController.start', () => {
    it('mints a dialog URL: config_id present, NO scope param, extras carry the requested path', async () => {
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: null, coexistence: true, locale: 'en' }), reply);

        expect(reply.setCookie).toHaveBeenCalledWith(WHATSAPP_NONCE_COOKIE, expect.any(String), expect.objectContaining({ sameSite: 'lax', signed: true }));
        const { url } = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { url: string };
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
        expect(parsed.searchParams.get('client_id')).toBe('app-1');
        expect(parsed.searchParams.get('config_id')).toBe('cfg-1');
        expect(parsed.searchParams.get('redirect_uri')).toBe('https://jawab24.com/api/auth/whatsapp/callback');
        expect(parsed.searchParams.get('response_type')).toBe('code');
        // A Login-for-Business config defines its own permissions — sending scope
        // alongside config_id is rejected by Meta.
        expect(parsed.searchParams.has('scope')).toBe(false);
        expect(JSON.parse(parsed.searchParams.get('extras') as string)).toEqual({
            setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3',
        });
        expect(parsed.searchParams.get('state')).toBeTruthy();
    });

    it('RECONNECT overrides the client path with the STORED coexistence (server-side invariant)', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', whatsappPhoneNumberId: 'phone-9', whatsappCoexistence: true } as never);
        const reply = buildReply();
        // Client (buggy or malicious) asks for migration on a coexistence number:
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1', coexistence: false, locale: 'en' }), reply);
        const { url } = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { url: string };
        const extras = JSON.parse(new URL(url).searchParams.get('extras') as string);
        expect(extras.featureType).toBe('whatsapp_business_app_onboarding');
    });

    it('plan gate fires before any URL is minted', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starter as never);
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({}), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect((reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ code: 'WHATSAPP_PLAN_REQUIRED' });
        expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('404s when the rollout flag is off', async () => {
        const { config } = await import('../../src/config');
        (config as { whatsappConnectRedirect: boolean }).whatsappConnectRedirect = false;
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({}), reply);
        expect(reply.status).toHaveBeenCalledWith(404);
        (config as { whatsappConnectRedirect: boolean }).whatsappConnectRedirect = true;
    });
});

// ── callback ────────────────────────────────────────────────────────────────

describe('WhatsAppRedirectController.callback', () => {
    it('invalid state → error redirect to the default-locale channels page, nothing exchanged', async () => {
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state: 'garbage.sig' }), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/pages?whatsappError=WHATSAPP_CONNECT_FAILED');
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('nonce mismatch → error redirect, nothing exchanged (state minted for another browser)', async () => {
        const { state } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, 'a-different-nonce'), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_CONNECT_FAILED');
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('merchant cancelled inside the wizard → plain channels page, no error param', async () => {
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ error: 'access_denied', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages');
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('happy path (attach to page): exchange WITH redirect_uri → discover → register → connect → success redirect', async () => {
        primeHappyMeta();
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'the-code', state }, nonce), reply);

        // Redirect-flow codes are bound to the redirect_uri — the exchange must repeat it.
        expect(whatsappService.exchangeCodeForToken).toHaveBeenCalledWith('the-code', 'https://jawab24.com/api/auth/whatsapp/callback');
        expect(whatsappService.subscribeAppToWaba).toHaveBeenCalledWith('waba-1', 'wa-business-token');
        expect(whatsappService.registerPhoneNumber).toHaveBeenCalledWith('phone-9', 'wa-business-token');
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1', expect.objectContaining({
            phoneNumberId: 'phone-9', businessAccountId: 'waba-1', coexistence: false,
            tokenExpiresAt: expect.any(Date),
        }));
        const target = (reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(target).toBe('https://jawab24.com/en/pages?whatsappConnected=1&waPageId=page-1');
        // The business token must never ride in a URL.
        expect(target).not.toContain('wa-business-token');
    });

    it('pageId null → creates a WhatsApp-only card', async () => {
        primeHappyMeta();
        const { state, nonce } = mintState({ pageId: null });
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(pagesService.createWhatsAppOnlyPage).toHaveBeenCalledWith('ws-1', 'user-1', expect.objectContaining({
            phoneNumberId: 'phone-9', verifiedName: 'Noor Store',
        }));
        expect((reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('whatsappConnected=1&waPageId=page-new');
    });

    it('coexistence OUTCOME (platform_type SMB_APP) wins over the requested migration path — never registered', async () => {
        primeHappyMeta({ platformType: 'SMB_APP' });
        const { state, nonce } = mintState({ coexistence: false }); // requested migration…
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        // …but Meta says the number stayed on the merchant's phone: registering it
        // would take it off — the exact outcome coexistence exists to prevent.
        expect(whatsappService.registerPhoneNumber).not.toHaveBeenCalled();
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1', expect.objectContaining({ coexistence: true }));
    });

    it('platform_type missing → falls back to the REQUESTED path from the signed state', async () => {
        primeHappyMeta({ platformType: undefined });
        const { state, nonce } = mintState({ coexistence: true });
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(whatsappService.registerPhoneNumber).not.toHaveBeenCalled();
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1', expect.objectContaining({ coexistence: true }));
    });

    it('number held by ANOTHER page → WHATSAPP_NUMBER_TAKEN, nothing subscribed', async () => {
        primeHappyMeta();
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue({ id: 'someone-elses-page' } as never);
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_NUMBER_TAKEN');
        expect(whatsappService.subscribeAppToWaba).not.toHaveBeenCalled();
    });

    it('same-page reconnect is allowed through the number-taken check', async () => {
        primeHappyMeta();
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue({ id: 'page-1' } as never);
        const { state, nonce } = mintState({ pageId: 'page-1' });
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect((reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('whatsappConnected=1');
    });

    it('no WABA on the token → WHATSAPP_NO_NUMBER', async () => {
        primeHappyMeta();
        vi.mocked(whatsappService.debugToken).mockResolvedValue({ isValid: true, scopes: [], wabaIds: [] } as never);
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_NO_NUMBER');
    });

    it('two numbers with no onboarding timestamps → WHATSAPP_AMBIGUOUS — never guesses the webhook routing key', async () => {
        primeHappyMeta();
        vi.mocked(whatsappService.listWabaPhoneNumbers).mockResolvedValue([
            { id: 'phone-a', displayPhoneNumber: '+1', verifiedName: 'A', platformType: 'CLOUD_API', lastOnboardedTime: undefined },
            { id: 'phone-b', displayPhoneNumber: '+2', verifiedName: 'B', platformType: 'CLOUD_API', lastOnboardedTime: undefined },
        ]);
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_AMBIGUOUS');
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
    });

    it('membership no longer owner → error redirect BEFORE any Meta call', async () => {
        membershipResult.rows = [{ role: 'admin', ownerId: 'owner-1' }];
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_CONNECT_FAILED');
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('PIN mismatch (Meta 133005) → WHATSAPP_PIN_MISMATCH', async () => {
        primeHappyMeta();
        vi.mocked(whatsappService.registerPhoneNumber).mockRejectedValue(Object.assign(new Error('pin'), { metaCode: 133005 }));
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_PIN_MISMATCH');
    });

    it('unique-index race (23505) → WHATSAPP_NUMBER_TAKEN', async () => {
        primeHappyMeta();
        vi.mocked(pagesService.connectWhatsApp).mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/en/pages?whatsappError=WHATSAPP_NUMBER_TAKEN');
    });
});

// ── pickPhoneCandidate ──────────────────────────────────────────────────────

describe('pickPhoneCandidate', () => {
    const base = { wabaId: 'w', displayPhoneNumber: '+1', verifiedName: 'X' };
    it('empty → null; single → it', () => {
        expect(pickPhoneCandidate([])).toBeNull();
        expect(pickPhoneCandidate([{ ...base, id: 'a' }])?.id).toBe('a');
    });
    it('several → strictly most recently onboarded', () => {
        expect(pickPhoneCandidate([
            { ...base, id: 'old', lastOnboardedTime: '2026-07-01T00:00:00+0000' },
            { ...base, id: 'new', lastOnboardedTime: '2026-07-30T00:00:00+0000' },
        ])?.id).toBe('new');
    });
    it('ties and undated sets → null (ambiguous, never guess)', () => {
        const t = '2026-07-30T00:00:00+0000';
        expect(pickPhoneCandidate([
            { ...base, id: 'a', lastOnboardedTime: t },
            { ...base, id: 'b', lastOnboardedTime: t },
        ])).toBeNull();
        expect(pickPhoneCandidate([{ ...base, id: 'a' }, { ...base, id: 'b' }])).toBeNull();
    });
});

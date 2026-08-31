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
    // Module-load access only (PLAYGROUND_PAGE_COLUMNS reads schema.pages at
    // import time); no select runs against it in this suite.
    pages: {},
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
    // checkSubscriptionStatus backs the connect status gate (checkWhatsAppSubscriptionStatus);
    // defaulted to allowed in beforeEach, flipped by the expired-trial tests.
    subscriptionsService: { getUserSubscription: vi.fn(), canEnablePage: vi.fn(), checkSubscriptionStatus: vi.fn() },
}));

// Channel-availability gate (Zid block, D-117). Default "available" so the
// existing gate-ladder tests are unchanged; the marketplace tests flip it.
const mockGetWaUnavailable = vi.fn().mockResolvedValue(null);
vi.mock('../../src/services/whatsappAvailability', () => ({
    getWhatsAppUnavailableReason: (...args: unknown[]) => mockGetWaUnavailable(...args),
    WHATSAPP_MARKETPLACE_BLOCKED_RESPONSE: {
        error: 'WhatsApp isn\'t available for stores connected through Zid.',
        code: 'WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE',
        marketplace: 'zid',
    },
}));
vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: { evaluate: vi.fn(), record: vi.fn(), channelsForPage: vi.fn() },
}));
vi.mock('../../src/services/businessReadiness', () => ({ businessInfoGate: vi.fn() }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));

// In-memory Redis: the app-state single-use registry (SET PX + MULTI GET/DEL).
const appStates = new Map<string, string>();
vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: vi.fn(async (key: string, value: string) => { appStates.set(key, value); return 'OK'; }),
        multi: vi.fn(() => {
            let readKey = '';
            const chain = {
                get(key: string) { readKey = key; return chain; },
                del(_key: string) { return chain; },
                exec: async () => {
                    const value = appStates.get(readKey) ?? null;
                    appStates.delete(readKey);
                    return [[null, value], [null, 1]] as [Error | null, unknown][];
                },
            };
            return chain;
        }),
    },
}));
vi.mock('../../src/services/auth', () => ({
    authService: {
        getUserById: vi.fn().mockResolvedValue(null),
        consumeBrowserHandoffCode: vi.fn().mockResolvedValue(null),
        generateToken: vi.fn().mockReturnValue('session-token'),
    },
}));
vi.mock('../../src/services/refreshToken', () => ({
    refreshTokenService: { createRefreshToken: vi.fn().mockResolvedValue('refresh-token') },
}));
vi.mock('../../src/services/workspace', () => ({
    workspaceService: {
        getMemberRole: vi.fn(),
        getWorkspace: vi.fn(),
        resolveDefaultWorkspaceId: vi.fn(),
    },
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import { whatsappRedirectController, pickPhoneCandidate, WHATSAPP_NONCE_COOKIE } from '../../src/controllers/whatsappRedirect';
import { mintWhatsAppConnectState, verifyWhatsAppConnectState } from '../../src/utils/whatsappConnectState';
import { pagesService } from '../../src/services/pages';
import { whatsappService } from '../../src/services/whatsapp';
import { subscriptionsService } from '../../src/services/subscriptions';
import { authService } from '../../src/services/auth';
import { refreshTokenService } from '../../src/services/refreshToken';
import { workspaceService } from '../../src/services/workspace';

const entitled = { status: 'active', plan: { slug: 'business', whatsappEnabled: true } };
// Basic is the only paid plan without WhatsApp (D-118) — the non-entitled fixture.
const basic = { status: 'active', plan: { slug: 'basic', whatsappEnabled: false } };
// Plan includes WhatsApp but the trial lapsed — passes the plan gate, must be
// stopped by the status gate BEFORE a Meta redirect URL is minted (D-118 gap).
const pastDueStarter = { status: 'past_due', plan: { slug: 'starter', whatsappEnabled: true } };

function buildReply() {
    const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
        type: vi.fn().mockReturnThis(),
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
    vi.mocked(subscriptionsService.checkSubscriptionStatus).mockReturnValue({ allowed: true } as never);
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
        const { url, urls } = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { url: string; urls: { coexistence: string; dedicated: string } };
        const extras = JSON.parse(new URL(url).searchParams.get('extras') as string);
        expect(extras.featureType).toBe('whatsapp_business_app_onboarding');
        // BOTH pre-minted variants collapse onto the stored path — whichever the
        // client navigates to, a coexistence number stays on the merchant's phone.
        for (const variant of [urls.coexistence, urls.dedicated]) {
            const e = JSON.parse(new URL(variant).searchParams.get('extras') as string);
            expect(e.featureType).toBe('whatsapp_business_app_onboarding');
        }
    });

    it('pre-mints BOTH variants sharing ONE nonce — either state passes the callback nonce check', async () => {
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: null, coexistence: false, locale: 'en' }), reply);

        const { urls } = (reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { urls: { coexistence: string; dedicated: string } };
        const cookieNonce = (reply.setCookie as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
        const stateOf = (u: string) => new URL(u).searchParams.get('state') as string;
        const { verifyWhatsAppConnectState } = await import('../../src/utils/whatsappConnectState');

        const coex = verifyWhatsAppConnectState(stateOf(urls.coexistence));
        const dedicated = verifyWhatsAppConnectState(stateOf(urls.dedicated));
        expect(coex).toMatchObject({ coexistence: true, nonce: cookieNonce });
        expect(dedicated).toMatchObject({ coexistence: false, nonce: cookieNonce });
        // And the extras match each state's variant.
        expect(JSON.parse(new URL(urls.coexistence).searchParams.get('extras') as string).featureType).toBe('whatsapp_business_app_onboarding');
        expect(JSON.parse(new URL(urls.dedicated).searchParams.get('extras') as string).featureType).toBe('');
    });

    it('plan gate fires before any URL is minted', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(basic as never);
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({}), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect((reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ code: 'WHATSAPP_PLAN_REQUIRED' });
        expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('status gate fires before any URL is minted — expired-trial Starter → 402, no cookie (D-118 gap)', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(pastDueStarter as never);
        vi.mocked(subscriptionsService.checkSubscriptionStatus).mockReturnValue({
            allowed: false, reason: 'Trial has expired. Please upgrade to continue.', code: 'subscription_inactive', cause: 'trial_expired',
        } as never);
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({}), reply);
        expect(reply.status).toHaveBeenCalledWith(402);
        expect((reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ code: 'WHATSAPP_SUBSCRIPTION_INACTIVE' });
        expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('marketplace block fires (entitled Zid account) → 403 JSON, no URL, no cookie', async () => {
        // Entitled by default — the block is independent of the plan gate (D-117).
        // Mutation: delete the getWhatsAppUnavailableReason branch in
        // prepareStartUrls and a URL is minted — this fails.
        mockGetWaUnavailable.mockResolvedValueOnce('zid_marketplace');
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({}), reply);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect((reply.send as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ code: 'WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE' });
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

// ── appStart (native leg: code → cookies → 302 to Meta) ─────────────────────

function buildAppStartRequest(query: Record<string, string>) {
    return {
        query,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as FastifyRequest<{ Querystring: { code?: string; pageId?: string; coexistence?: string; locale?: string; workspaceId?: string } }>;
}

function primeAppStartHappy() {
    vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue({ userId: 'user-1' });
    vi.mocked(authService.getUserById).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'owner' } as never);
    vi.mocked(workspaceService.getWorkspace).mockResolvedValue({ id: 'ws-1', ownerId: 'owner-1' } as never);
}

describe('WhatsAppRedirectController.appStart', () => {
    it('happy path: consume code → sign the browser in → serve the handoff page anchored at Meta', async () => {
        primeAppStartHappy();
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), pageId: 'page-1', coexistence: 'false', locale: 'en', workspaceId: 'ws-1' }),
            reply,
        );

        // The browser session is REAL login artifacts — the wizard's return to
        // /pages must find it, and even gate failures render their toast.
        expect(refreshTokenService.createRefreshToken).toHaveBeenCalledWith('user-1');
        expect(reply.type).toHaveBeenCalledWith('text/html; charset=utf-8');
        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        // The ONLY way onward is the merchant's own tap on a real anchor: every
        // non-tap navigation to facebook.com from an app-launched browser died
        // silently on a real device (2026-07-30/31).
        expect(html).toContain('<a class="cta" href="https://www.facebook.com/v23.0/dialog/oauth');
        expect(html).toContain('config_id=cfg-1');
        // No auto-redirect may sneak back in — it would bounce the merchant
        // away before they ever see the button.
        expect(html).not.toContain('<script');
        expect(html).not.toContain('http-equiv="refresh"');
        expect(reply.redirect).not.toHaveBeenCalled();
        // Branded: tab icon + the mark, so the merchant can see whose page is
        // asking before they hand themselves to Facebook.
        expect(html).toContain('rel="icon"');
        expect(html).toContain('/brand/icon-vector.svg');
        expect(html).toContain('alt="Jawab24"');
        // Nonce cookie set alongside the session cookies.
        expect(vi.mocked(reply.setCookie).mock.calls.some(c => c[0] === WHATSAPP_NONCE_COOKIE)).toBe(true);
    });

    it('coexistence=true rides into the dialog extras (Business-app onboarding path)', async () => {
        primeAppStartHappy();
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), coexistence: 'true', locale: 'ar', workspaceId: 'ws-1' }),
            reply,
        );
        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        // `extras` is JSON inside a query param inside an HTML attribute, so it
        // arrives double-encoded. Decode the href ONLY — the surrounding CSS
        // carries literal `%` (width:100%) that decodeURIComponent rejects.
        const href = /<a class="cta" href="([^"]+)"/.exec(html)?.[1] ?? '';
        expect(decodeURIComponent(href.replace(/&amp;/g, '&'))).toContain('whatsapp_business_app_onboarding');
        // Arabic renders RTL — this page is merchant-facing, not a redirect.
        expect(html).toContain('dir="rtl"');
    });

    it('expired/used code → /login redirect, no session artifacts minted', async () => {
        vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue(null);
        const reply = buildReply();
        await whatsappRedirectController.appStart(buildAppStartRequest({ code: 'stale-code-stale-code' }), reply);

        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/login');
        expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
    });

    it('REFUSES a code minted by a restricted embedded session — no full session, no WhatsApp credentials', async () => {
        primeAppStartHappy();
        vi.mocked(authService.consumeBrowserHandoffCode).mockResolvedValue({
            userId: 'user-1',
            scope: { embeddedPlatform: 'zid', workspaceId: 'ws-9' },
        });
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), pageId: 'page-1', workspaceId: 'ws-9' }),
            reply,
        );

        // This flow signs the browser in with a FULL session (refresh cookie and
        // all) and hands over workspace-level WhatsApp credential material —
        // exactly what an iframe credential must not be able to buy.
        expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
        // Arabic is the default locale and carries NO path prefix.
        expect(reply.redirect).toHaveBeenCalledWith('https://jawab24.com/login');
    });

    it('plan gate → signed-in redirect to /pages?whatsappError=WHATSAPP_PLAN_REQUIRED', async () => {
        primeAppStartHappy();
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(basic as never);
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), workspaceId: 'ws-1' }),
            reply,
        );
        const target = vi.mocked(reply.redirect).mock.calls[0][0] as string;
        expect(target).toContain('/pages?');
        expect(target).toContain('whatsappError=WHATSAPP_PLAN_REQUIRED');
        // The failure page renders AUTHENTICATED — cookies were set first.
        expect(refreshTokenService.createRefreshToken).toHaveBeenCalled();
    });

    it('status gate → signed-in redirect to /pages?whatsappError=WHATSAPP_SUBSCRIPTION_INACTIVE (expired-trial Starter)', async () => {
        primeAppStartHappy();
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(pastDueStarter as never);
        vi.mocked(subscriptionsService.checkSubscriptionStatus).mockReturnValue({
            allowed: false, reason: 'Trial has expired. Please upgrade to continue.', code: 'subscription_inactive', cause: 'trial_expired',
        } as never);
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), workspaceId: 'ws-1' }),
            reply,
        );
        const target = vi.mocked(reply.redirect).mock.calls[0][0] as string;
        expect(target).toContain('/pages?');
        expect(target).toContain('whatsappError=WHATSAPP_SUBSCRIPTION_INACTIVE');
    });

    it('marketplace block → signed-in redirect to /pages?whatsappError=WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE', async () => {
        primeAppStartHappy();
        mockGetWaUnavailable.mockResolvedValueOnce('zid_marketplace');
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), workspaceId: 'ws-1' }),
            reply,
        );
        const target = vi.mocked(reply.redirect).mock.calls[0][0] as string;
        expect(target).toContain('/pages?');
        expect(target).toContain('whatsappError=WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE');
    });

    it('non-owner member → error redirect BEFORE any state is minted (owner scope, like POST /start)', async () => {
        primeAppStartHappy();
        vi.mocked(workspaceService.getMemberRole).mockResolvedValue({ role: 'admin' } as never);
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), workspaceId: 'ws-1' }),
            reply,
        );
        const target = vi.mocked(reply.redirect).mock.calls[0][0] as string;
        expect(target).toContain('whatsappError=WHATSAPP_CONNECT_FAILED');
        expect(vi.mocked(reply.setCookie).mock.calls.some(c => c[0] === WHATSAPP_NONCE_COOKIE)).toBe(false);
    });

    it('no workspaceId param → falls back to the server-authoritative default workspace', async () => {
        primeAppStartHappy();
        vi.mocked(workspaceService.resolveDefaultWorkspaceId).mockResolvedValue('ws-1');
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43) }),
            reply,
        );
        expect(workspaceService.resolveDefaultWorkspaceId).toHaveBeenCalledWith('user-1');
        expect(vi.mocked(reply.send).mock.calls[0][0] as string).toContain('dialog/oauth');
    });

    it('escapes the dialog URL into the anchor — & becomes &amp;, so the href is not truncated', async () => {
        primeAppStartHappy();
        const reply = buildReply();
        await whatsappRedirectController.appStart(
            buildAppStartRequest({ code: 'x'.repeat(43), workspaceId: 'ws-1' }),
            reply,
        );
        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        // A raw & inside an attribute is an unterminated entity — browsers cope,
        // but the state/extras params are exactly what must survive intact.
        expect(html).toContain('&amp;config_id=');
        expect(html).not.toMatch(/href="[^"]*[^m]&(?!amp;|#)/);
    });

    it('404s when the rollout flag is off', async () => {
        const { config } = await import('../../src/config');
        const original = config.whatsappConnectRedirect;
        (config as { whatsappConnectRedirect: boolean }).whatsappConnectRedirect = false;
        try {
            const reply = buildReply();
            await whatsappRedirectController.appStart(buildAppStartRequest({ code: 'x'.repeat(43) }), reply);
            expect(reply.status).toHaveBeenCalledWith(404);
        } finally {
            (config as { whatsappConnectRedirect: boolean }).whatsappConnectRedirect = original;
        }
    });
});

// ── native app flow: dialog opened directly, App-Link return ────────────────

describe('native app connect (mirrors the working Facebook page-connect flow)', () => {
    beforeEach(() => appStates.clear());
    it('start with nativeApp marks the SIGNED state so the callback can skip the nonce pairing', async () => {
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1', nativeApp: true }), reply);

        const { urls } = vi.mocked(reply.send).mock.calls[0][0] as { urls: { dedicated: string } };
        const stateParam = new URL(urls.dedicated).searchParams.get('state') ?? '';
        // The flag must live INSIDE the HMAC — a web-minted state must never be
        // able to opt out of the nonce check.
        expect(verifyWhatsAppConnectState(stateParam)?.app).toBe(true);
    });

    it('a WEB start does NOT set the flag (default stays nonce-paired)', async () => {
        const reply = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1' }), reply);
        const { urls } = vi.mocked(reply.send).mock.calls[0][0] as { urls: { dedicated: string } };
        const stateParam = new URL(urls.dedicated).searchParams.get('state') ?? '';
        expect(verifyWhatsAppConnectState(stateParam)?.app).toBeUndefined();
    });

    it('callback: app state succeeds with NO nonce cookie and returns through the App Link', async () => {
        primeHappyMeta();
        const reply0 = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1', nativeApp: true }), reply0);
        const { urls } = vi.mocked(reply0.send).mock.calls[0][0] as { urls: { dedicated: string } };
        const state = new URL(urls.dedicated).searchParams.get('state') ?? '';
        const reply = buildReply();
        // No nonce cookie at all — the browser tab never had one.
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), reply);

        // Delivered as a PAGE that navigates, never a 302: Android intercepts
        // an App Link a page opens, not one the browser follows inside a
        // redirect chain (a 302 stranded the merchant in the browser after a
        // SUCCESSFUL connect, 2026-07-31).
        expect(reply.redirect).not.toHaveBeenCalled();
        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        expect(html).toContain('/auth/app-sync?redirect=');
        expect(html).toContain('location.replace(');
        expect(decodeURIComponent(html)).toContain('/pages?whatsappConnected=1');
        // A manual way back if the script never runs.
        expect(html).toMatch(/<a href="[^"]*auth\/app-sync/);
        // No session token may ride the App Link: the app never lost its session.
        expect(html).not.toContain('token=');
    });

    it('callback: an app state is SINGLE-USE — the replay is refused', async () => {
        primeHappyMeta();
        const reply0 = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1', nativeApp: true }), reply0);
        const { urls } = vi.mocked(reply0.send).mock.calls[0][0] as { urls: { dedicated: string } };
        const state = new URL(urls.dedicated).searchParams.get('state') ?? '';

        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), buildReply());
        vi.mocked(whatsappService.exchangeCodeForToken).mockClear();

        // Replay within the state's 30-min TTL: without this the replayer's
        // OWN WhatsApp number would attach to the victim's workspace, since the
        // callback re-verifies the STATE's user, not the caller's.
        const replay = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), replay);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
        expect(decodeURIComponent(vi.mocked(replay.send).mock.calls[0][0] as string)).toContain('whatsappError=WHATSAPP_CONNECT_FAILED');
    });

    it('callback: an app state NEVER registered (forged/expired) is refused', async () => {
        primeHappyMeta();
        const { state } = mintState({ app: true }); // minted outside start → never registered
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), reply);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('callback: a WEB state with no nonce cookie still FAILS (the skip is app-only)', async () => {
        primeHappyMeta();
        const { state } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), reply);

        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
        expect(vi.mocked(reply.redirect).mock.calls[0][0]).toContain('whatsappError=WHATSAPP_CONNECT_FAILED');
    });

    it('callback: app-state errors also come home through the App Link, not a web page', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(basic as never);
        const { state } = mintState({ app: true });
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'fb-code', state }), reply);

        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        expect(html).toContain('/auth/app-sync?redirect=');
        expect(decodeURIComponent(html)).toContain('whatsappError=');
    });

    it('callback: merchant cancelled in the wizard on app flow → App Link home, no error param', async () => {
        const reply0 = buildReply();
        await whatsappRedirectController.start(buildStartRequest({ pageId: 'page-1', nativeApp: true }), reply0);
        const { urls } = vi.mocked(reply0.send).mock.calls[0][0] as { urls: { dedicated: string } };
        const state = new URL(urls.dedicated).searchParams.get('state') ?? '';
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ error: 'access_denied', state }), reply);

        const html = vi.mocked(reply.send).mock.calls[0][0] as string;
        expect(html).toContain('/auth/app-sync?redirect=');
        expect(decodeURIComponent(html)).not.toContain('whatsappError');
    });
});

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

    it('reverify refuses an entitled Zid account mid-connect → whatsappError=WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE, no exchange', async () => {
        // The ~10-min window between start and callback: a Zid store connected
        // in between must still block. Mutation: delete the
        // getWhatsAppUnavailableReason branch in reverifyGates and the code is
        // exchanged — this fails.
        primeHappyMeta();
        mockGetWaUnavailable.mockResolvedValueOnce('zid_marketplace');
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'the-code', state }, nonce), reply);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
        expect((reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('whatsappError=WHATSAPP_UNAVAILABLE_FOR_MARKETPLACE');
    });

    it('reverify refuses an expired-trial account mid-connect → whatsappError=WHATSAPP_SUBSCRIPTION_INACTIVE, no exchange', async () => {
        // The trial can lapse in the ~10-min window between start and callback.
        // Mutation: delete the status check in reverifyGates and the code is
        // exchanged — this fails.
        primeHappyMeta();
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(pastDueStarter as never);
        vi.mocked(subscriptionsService.checkSubscriptionStatus).mockReturnValue({
            allowed: false, reason: 'Trial has expired. Please upgrade to continue.', code: 'subscription_inactive', cause: 'trial_expired',
        } as never);
        const { state, nonce } = mintState();
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'the-code', state }, nonce), reply);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
        expect((reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('whatsappError=WHATSAPP_SUBSCRIPTION_INACTIVE');
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

    // Regression, production 2026-08-29: the FIRST real coexistence connect came
    // back platform_type CLOUD_API for a number Meta then refused to register
    // («Register endpoint is not available for SMB businesses», metaCode 100).
    // The old ternary let CLOUD_API override the signed request, so we registered
    // — and every coexistence connect died there, leaving the merchant with a
    // number linked at Meta and no page here. A requested coexistence path must
    // never be undone by platform_type.
    it('requested coexistence SURVIVES a CLOUD_API platform_type — never registered', async () => {
        primeHappyMeta({ platformType: 'CLOUD_API' });
        const { state, nonce } = mintState({ coexistence: true });
        const reply = buildReply();
        await whatsappRedirectController.callback(buildCallbackRequest({ code: 'c', state }, nonce), reply);
        expect(whatsappService.registerPhoneNumber).not.toHaveBeenCalled();
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1', expect.objectContaining({ coexistence: true }));
        expect((reply.redirect as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('whatsappConnected=1');
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

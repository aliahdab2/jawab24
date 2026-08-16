import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Mock dependencies before imports
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
        getPageByWhatsAppPhoneNumberId: vi.fn(),
        connectWhatsApp: vi.fn(),
        disconnectWhatsApp: vi.fn(),
        toggleWhatsAppAutoReply: vi.fn(),
        createWhatsAppOnlyPage: vi.fn(),
    },
    isPageDisconnected: vi.fn((page: { accessToken: string } | null) => !!page && page.accessToken === ''),
}));

vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        exchangeCodeForToken: vi.fn(),
        subscribeAppToWaba: vi.fn(),
        registerPhoneNumber: vi.fn(),
        getPhoneNumberInfo: vi.fn(),
    },
}));

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        canEnablePage: vi.fn(),
        getUserSubscription: vi.fn(),
    },
}));

vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: {
        evaluate: vi.fn(),
        record: vi.fn(),
        channelsForPage: vi.fn().mockReturnValue([{ type: 'whatsapp', id: 'phone-1' }]),
    },
}));

// The readiness gate hits the DB (catalog probe) and the store service. These
// suites are about the billing/trial gates, so default to "the page is grounded"
// and let the dedicated tests below flip it.
vi.mock('../../src/services/businessReadiness', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/services/businessReadiness')>()),
    businessInfoGate: vi.fn().mockResolvedValue(null),
}));

// serializePage comes from controllers/pages — mock its heavy service imports
vi.mock('../../src/services/facebook', () => ({
    facebookService: {},
}));
vi.mock('../../src/services/auth', () => ({
    authService: { getUserById: vi.fn().mockResolvedValue(null) },
}));

// Import after mocks
import { whatsappController } from '../../src/controllers/whatsapp';
import { pagesService } from '../../src/services/pages';
import { whatsappService } from '../../src/services/whatsapp';
import { subscriptionsService } from '../../src/services/subscriptions';
import { channelTrialService } from '../../src/services/channelTrial';
import { businessInfoGate } from '../../src/services/businessReadiness';

// What businessInfoGate returns for a page with nothing to answer from.
const BUSINESS_INFO_REFUSAL = {
    status: 409,
    body: { error: 'Add your Business Info', code: 'BUSINESS_INFO_REQUIRED' },
} as const;

const basePage = {
    id: 'page-1',
    workspaceId: 'ws-1',
    accessToken: 'fb-token',
    whatsappPhoneNumberId: null as string | null,
    whatsappAccessToken: null as string | null,
};

// Plan-gate fixtures: WhatsApp is a Business+ entitlement (plans.whatsapp_enabled).
const entitledSubscription = { status: 'active', plan: { slug: 'business', whatsappEnabled: true } };
const starterSubscription = { status: 'active', plan: { slug: 'starter', whatsappEnabled: false } };
const trialingStarterSubscription = { status: 'trialing', plan: { slug: 'starter', whatsappEnabled: false } };

const connectedPage = {
    ...basePage,
    whatsappPhoneNumberId: 'phone-1',
    whatsappBusinessAccountId: 'waba-1',
    whatsappDisplayPhoneNumber: '+966 55 000 0000',
    whatsappAccessToken: 'wa-token',
    whatsappAutoReplyEnabled: false,
};

function buildReply(): FastifyReply {
    return {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
}

function buildRequest(overrides: Record<string, unknown> = {}): WorkspaceRequest {
    return {
        user: { userId: 'user-1', facebookId: 'fb-1' },
        workspaceId: 'ws-1',
        workspaceOwnerId: 'user-1',
        workspaceRole: 'owner',
        params: { id: 'page-1' },
        body: { code: 'es-code', phoneNumberId: 'phone-1', wabaId: 'waba-1' },
        log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        ...overrides,
    } as unknown as WorkspaceRequest;
}

describe('WhatsAppController.connect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pagesService.getPage).mockResolvedValue(basePage as never);
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(null as never);
        vi.mocked(whatsappService.exchangeCodeForToken).mockResolvedValue({ token: 'wa-business-token', expiresIn: 5184000 });
        vi.mocked(whatsappService.subscribeAppToWaba).mockResolvedValue(undefined);
        vi.mocked(whatsappService.registerPhoneNumber).mockResolvedValue(undefined);
        vi.mocked(whatsappService.getPhoneNumberInfo).mockResolvedValue({
            displayPhoneNumber: '+966 55 000 0000',
            verifiedName: 'Test Store',
        });
        vi.mocked(pagesService.connectWhatsApp).mockResolvedValue(connectedPage as never);
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(entitledSubscription as never);
    });

    // ── Coexistence ────────────────────────────────────────────────────────
    // A Coexistence number stays live in the merchant's WhatsApp Business app.
    // Cloud API /register belongs to the MIGRATION path: running it on a
    // coexistence number would either fail or take the number OFF their phone —
    // the exact outcome Coexistence exists to prevent. The token exchange and
    // WABA webhook subscribe still run; only registration is skipped.
    it('COEXISTENCE: skips Cloud-API registration but still exchanges + subscribes', async () => {
        const reply = buildReply();
        await whatsappController.connect(
            buildRequest({ body: { code: 'es-code', phoneNumberId: 'phone-1', wabaId: 'waba-1', coexistence: true } }) as never,
            reply,
        );

        expect(whatsappService.registerPhoneNumber).not.toHaveBeenCalled();
        expect(whatsappService.exchangeCodeForToken).toHaveBeenCalledWith('es-code');
        expect(whatsappService.subscribeAppToWaba).toHaveBeenCalledWith('waba-1', 'wa-business-token');
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1',
            expect.objectContaining({ coexistence: true }));
    });

    // Only an explicit `true` may skip registration — a missing, null or
    // string-y value must take the safe migration path rather than silently
    // leaving a number unregistered and unable to send.
    it.each([
        ['omitted', {}],
        ['false', { coexistence: false }],
        ['a truthy string', { coexistence: 'yes' }],
        ['null', { coexistence: null }],
    ])('treats coexistence %s as the migration path (registers the number)', async (_label, extra) => {
        const reply = buildReply();
        await whatsappController.connect(
            buildRequest({ body: { code: 'es-code', phoneNumberId: 'phone-1', wabaId: 'waba-1', ...extra } }) as never,
            reply,
        );

        expect(whatsappService.registerPhoneNumber).toHaveBeenCalledWith('phone-1', 'wa-business-token');
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1',
            expect.objectContaining({ coexistence: false }));
    });

    it('runs the full connect flow: exchange → subscribe → register → store', async () => {
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(whatsappService.exchangeCodeForToken).toHaveBeenCalledWith('es-code');
        expect(whatsappService.subscribeAppToWaba).toHaveBeenCalledWith('waba-1', 'wa-business-token');
        expect(whatsappService.registerPhoneNumber).toHaveBeenCalledWith('phone-1', 'wa-business-token');
        expect(pagesService.connectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1', {
            phoneNumberId: 'phone-1',
            businessAccountId: 'waba-1',
            displayPhoneNumber: '+966 55 000 0000',
            accessToken: 'wa-business-token',
            // Meta forces a 60-day expiry on this login variation and only tells us
            // at exchange time, so the deadline must be persisted here — without it
            // we cannot warn the merchant before their number goes silent.
            tokenExpiresAt: expect.any(Date),
            // Migration path: the number moves to the Cloud API and leaves the
            // merchant's phone. Persisted so a reconnect takes the same path.
            coexistence: false,
        });
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
            whatsappPhoneNumberId: 'phone-1',
            whatsappConnected: true,
        }));
    });

    it('never returns the WhatsApp token in the response', async () => {
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        const sent = vi.mocked(reply.send).mock.calls[0][0] as Record<string, unknown>;
        expect(sent).not.toHaveProperty('whatsappAccessToken');
        expect(sent).not.toHaveProperty('accessToken');
    });

    it('400s when body fields are missing', async () => {
        const reply = buildReply();
        await whatsappController.connect(buildRequest({ body: { code: 'x' } }) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('404s when the page is not in the workspace', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue(null as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('409s when the number is already connected to another page', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue({
            ...connectedPage, id: 'other-page',
        } as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(409);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_NUMBER_TAKEN' }));
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('allows reconnecting the same number to the same page', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(connectedPage as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).not.toHaveBeenCalledWith(409);
        expect(pagesService.connectWhatsApp).toHaveBeenCalled();
    });

    it('422s with WHATSAPP_PIN_MISMATCH on Meta error 133005', async () => {
        vi.mocked(whatsappService.registerPhoneNumber).mockRejectedValue({
            response: { data: { error: { code: 133005 } } },
        });
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(422);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PIN_MISMATCH' }));
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
    });

    it('409s WHATSAPP_NUMBER_TAKEN when the DB unique index rejects a race (23505)', async () => {
        // Both concurrent connects passed the pre-check; the DB index catches the loser.
        vi.mocked(pagesService.connectWhatsApp).mockRejectedValue({ code: '23505' });
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(409);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_NUMBER_TAKEN' }));
    });

    it('502s when the code exchange fails', async () => {
        vi.mocked(whatsappService.exchangeCodeForToken).mockRejectedValue(new Error('bad code'));
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(502);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_CONNECT_FAILED' }));
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
    });

    it('403s WHATSAPP_PLAN_REQUIRED on a plan without WhatsApp, before any Meta call', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starterSubscription as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
            code: 'WHATSAPP_PLAN_REQUIRED',
            requiredPlan: 'business',
        }));
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('403s WHATSAPP_PLAN_REQUIRED when there is no subscription at all (fail closed)', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(null as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }));
    });

    it('403s for a trialing user — trial rides on Starter, which has no WhatsApp', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(trialingStarterSubscription as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }));
    });

    it('keys the plan gate on the workspace OWNER, not the acting user', async () => {
        const reply = buildReply();
        await whatsappController.connect(buildRequest({
            user: { userId: 'member-1', facebookId: 'fb-2' },
            workspaceOwnerId: 'owner-1',
            workspaceRole: 'admin',
        }) as never, reply);

        expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('owner-1');
    });
});

describe('WhatsAppController.toggleAutoReply', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pagesService.getPage).mockResolvedValue(connectedPage as never);
        vi.mocked(pagesService.toggleWhatsAppAutoReply).mockResolvedValue({
            ...connectedPage, whatsappAutoReplyEnabled: true,
        } as never);
        vi.mocked(subscriptionsService.canEnablePage).mockResolvedValue({ allowed: true } as never);
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(entitledSubscription as never);
        vi.mocked(channelTrialService.evaluate).mockResolvedValue({ blocked: false } as never);
        vi.mocked(channelTrialService.record).mockResolvedValue(undefined as never);
        // Re-armed after clearAllMocks: a cleared mock resolves undefined, which
        // the gate reads as "ungrounded" and would 409 every test in this block.
        vi.mocked(businessInfoGate).mockResolvedValue(null);
    });

    function toggleRequest(enabled: boolean) {
        return buildRequest({ body: { enabled } });
    }

    it('enables auto-reply and claims the channel trial', async () => {
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(pagesService.toggleWhatsAppAutoReply).toHaveBeenCalledWith('ws-1', 'page-1', true);
        expect(channelTrialService.record).toHaveBeenCalled();
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ whatsappAutoReplyEnabled: true }));
    });

    it('400s when WhatsApp is not connected', async () => {
        vi.mocked(pagesService.getPage).mockResolvedValue(basePage as never);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_NOT_CONNECTED' }));
    });

    it('blocks enabling when the channel already used its free trial', async () => {
        vi.mocked(channelTrialService.evaluate).mockResolvedValue({ blocked: true } as never);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(402);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'TRIAL_ALREADY_USED' }));
        expect(pagesService.toggleWhatsAppAutoReply).not.toHaveBeenCalled();
    });

    it('always allows disabling (no billing gates)', async () => {
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(false) as never, reply);

        expect(subscriptionsService.canEnablePage).not.toHaveBeenCalled();
        expect(channelTrialService.evaluate).not.toHaveBeenCalled();
        expect(pagesService.toggleWhatsAppAutoReply).toHaveBeenCalledWith('ws-1', 'page-1', false);
    });

    // A WhatsApp-only card is created with no Business Info (no Facebook page to
    // seed it), so without this gate the GA happy path put an AI with nothing to
    // answer from in front of real customers.
    it('409s BUSINESS_INFO_REQUIRED on enable when the page has nothing to answer from', async () => {
        vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(409);
        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'BUSINESS_INFO_REQUIRED' }),
        );
        expect(pagesService.toggleWhatsAppAutoReply).not.toHaveBeenCalled();
    });

    it('never blocks DISABLING an ungrounded page', async () => {
        // Otherwise a merchant who emptied their Business Info could not switch
        // the bot off — the gate would trap them with a live bot.
        vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(false) as never, reply);

        expect(pagesService.toggleWhatsAppAutoReply).toHaveBeenCalledWith('ws-1', 'page-1', false);
    });

    it('reports the plan gate before the readiness gate', async () => {
        // A Starter merchant must be told to upgrade: filling Business Info would
        // not unlock WhatsApp for them, so "add your info" would be a wrong
        // instruction that wastes their time.
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starterSubscription as never);
        vi.mocked(businessInfoGate).mockResolvedValue(BUSINESS_INFO_REFUSAL);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }),
        );
    });

    it('403s WHATSAPP_PLAN_REQUIRED on enable for a plan without WhatsApp, before slot/trial gates', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starterSubscription as never);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(true) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }));
        expect(subscriptionsService.canEnablePage).not.toHaveBeenCalled();
        expect(channelTrialService.evaluate).not.toHaveBeenCalled();
        expect(pagesService.toggleWhatsAppAutoReply).not.toHaveBeenCalled();
    });

    it('still allows disabling on a plan without WhatsApp', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starterSubscription as never);
        const reply = buildReply();
        await whatsappController.toggleAutoReply(toggleRequest(false) as never, reply);

        expect(subscriptionsService.getUserSubscription).not.toHaveBeenCalled();
        expect(pagesService.toggleWhatsAppAutoReply).toHaveBeenCalledWith('ws-1', 'page-1', false);
    });

    it('keys the plan gate on the workspace OWNER for team admins', async () => {
        const reply = buildReply();
        await whatsappController.toggleAutoReply(buildRequest({
            body: { enabled: true },
            user: { userId: 'member-1', facebookId: 'fb-2' },
            workspaceOwnerId: 'owner-1',
            workspaceRole: 'admin',
        }) as never, reply);

        expect(subscriptionsService.getUserSubscription).toHaveBeenCalledWith('owner-1');
    });
});

describe('WhatsAppController.disconnect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pagesService.disconnectWhatsApp).mockResolvedValue({
            ...basePage, whatsappAutoReplyEnabled: false,
        } as never);
    });

    it('clears the WhatsApp fields and reports whatsappConnected=false', async () => {
        const reply = buildReply();
        await whatsappController.disconnect(buildRequest({ body: undefined }) as never, reply);

        expect(pagesService.disconnectWhatsApp).toHaveBeenCalledWith('ws-1', 'page-1');
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ whatsappConnected: false }));
    });

    it('404s for a page outside the workspace', async () => {
        vi.mocked(pagesService.disconnectWhatsApp).mockResolvedValue(undefined as never);
        const reply = buildReply();
        await whatsappController.disconnect(buildRequest({ body: undefined }) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
    });
});

describe('WhatsAppController.connectNew (WhatsApp-only page)', () => {
    const waOnlyPage = {
        id: 'wa-page-1',
        workspaceId: 'ws-1',
        facebookPageId: null,
        name: 'Noor Store',
        accessToken: '',
        whatsappPhoneNumberId: 'phone-1',
        whatsappBusinessAccountId: 'waba-1',
        whatsappDisplayPhoneNumber: '+966 50 111 2233',
        whatsappAccessToken: 'enc-wa-token',
        whatsappAutoReplyEnabled: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(null as never);
        vi.mocked(whatsappService.exchangeCodeForToken).mockResolvedValue({ token: 'wa-business-token', expiresIn: 5184000 });
        vi.mocked(whatsappService.subscribeAppToWaba).mockResolvedValue(undefined);
        vi.mocked(whatsappService.registerPhoneNumber).mockResolvedValue(undefined);
        vi.mocked(whatsappService.getPhoneNumberInfo).mockResolvedValue({
            displayPhoneNumber: '+966 50 111 2233',
            verifiedName: 'Noor Store',
        });
        vi.mocked(pagesService.createWhatsAppOnlyPage).mockResolvedValue(waOnlyPage as never);
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(entitledSubscription as never);
    });

    function newRequest(overrides: Record<string, unknown> = {}) {
        return buildRequest({ params: {}, ...overrides });
    }

    it('creates a WhatsApp-only page named after the verified business name', async () => {
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(pagesService.createWhatsAppOnlyPage).toHaveBeenCalledWith('ws-1', 'user-1', {
            phoneNumberId: 'phone-1',
            businessAccountId: 'waba-1',
            displayPhoneNumber: '+966 50 111 2233',
            accessToken: 'wa-business-token',
            tokenExpiresAt: expect.any(Date),
            verifiedName: 'Noor Store',
            coexistence: false,
        });
        expect(reply.status).toHaveBeenCalledWith(201);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
            whatsappPhoneNumberId: 'phone-1',
            whatsappConnected: true,
            // WA-only page: primary credential is the WABA token, so it reads connected
            isConnected: true,
        }));
    });

    it('never returns tokens in the response', async () => {
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        const sent = vi.mocked(reply.send).mock.calls[0][0] as Record<string, unknown>;
        expect(sent).not.toHaveProperty('whatsappAccessToken');
        expect(sent).not.toHaveProperty('accessToken');
    });

    it('409s when the number is already connected anywhere', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(waOnlyPage as never);
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(409);
        expect(pagesService.createWhatsAppOnlyPage).not.toHaveBeenCalled();
    });

    it('422s with WHATSAPP_PIN_MISMATCH on Meta error 133005', async () => {
        vi.mocked(whatsappService.registerPhoneNumber).mockRejectedValue({
            response: { data: { error: { code: 133005 } } },
        });
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(422);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PIN_MISMATCH' }));
        expect(pagesService.createWhatsAppOnlyPage).not.toHaveBeenCalled();
    });

    it('400s when body fields are missing', async () => {
        const reply = buildReply();
        await whatsappController.connectNew(newRequest({ body: { code: 'x' } }) as never, reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('502s when a Meta step fails', async () => {
        vi.mocked(whatsappService.subscribeAppToWaba).mockRejectedValue(new Error('waba error'));
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(502);
        expect(pagesService.createWhatsAppOnlyPage).not.toHaveBeenCalled();
    });

    it('403s WHATSAPP_PLAN_REQUIRED on a plan without WhatsApp, before any Meta call', async () => {
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(starterSubscription as never);
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }));
        expect(whatsappService.exchangeCodeForToken).not.toHaveBeenCalled();
        expect(pagesService.createWhatsAppOnlyPage).not.toHaveBeenCalled();
    });

    it('proceeds on an entitled plan', async () => {
        const reply = buildReply();
        await whatsappController.connectNew(newRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(201);
        expect(pagesService.createWhatsAppOnlyPage).toHaveBeenCalled();
    });
});

describe('serializePage isConnected semantics', () => {
    it('Facebook-backed page: isConnected follows the FB token', async () => {
        const { serializePage } = await import('../../src/controllers/pages');
        expect(serializePage({ facebookPageId: 'fb-1', accessToken: 'tok', whatsappAccessToken: null }).isConnected).toBe(true);
        expect(serializePage({ facebookPageId: 'fb-1', accessToken: '', whatsappAccessToken: 'wa' }).isConnected).toBe(false);
    });

    it('WhatsApp-only page: isConnected follows the WABA token', async () => {
        const { serializePage } = await import('../../src/controllers/pages');
        expect(serializePage({ facebookPageId: null, accessToken: '', whatsappAccessToken: 'wa' }).isConnected).toBe(true);
        expect(serializePage({ facebookPageId: null, accessToken: '', whatsappAccessToken: null }).isConnected).toBe(false);
    });

    // IDENTITY must survive LIVENESS death (PR #772 re-review, High). The sweep
    // clears a Meta-190 credential to '' — the was-connected sentinel — and in
    // that exact state the card must still say "Instagram-direct" or the
    // reconnect banner has no card to render on. Mutation-checked: deriving
    // instagramDirect from `instagramDirectConnected` (the liveness bit) fails
    // the dead-credential case below.
    it('Instagram-direct identity: instagramDirect stays true when the credential is cleared to the \'\' sentinel', async () => {
        const { serializePage } = await import('../../src/controllers/pages');

        const live = serializePage({ facebookPageId: null, accessToken: '', instagramAccessToken: 'enc:v1:ig' });
        expect(live.instagramDirect).toBe(true);
        expect(live.instagramDirectConnected).toBe(true);
        expect(live.isConnected).toBe(true);

        const dead = serializePage({ facebookPageId: null, accessToken: '', instagramAccessToken: '' });
        expect(dead.instagramDirect).toBe(true);          // identity survives
        expect(dead.instagramDirectConnected).toBe(false); // liveness does not
        expect(dead.isConnected).toBe(false);

        // NULL = never was Instagram-direct: a WhatsApp-only card and a
        // Facebook-backed page must not acquire the identity.
        expect(serializePage({ facebookPageId: null, accessToken: '', whatsappAccessToken: 'wa', instagramAccessToken: null }).instagramDirect).toBe(false);
        expect(serializePage({ facebookPageId: 'fb-1', accessToken: 'tok', instagramAccessToken: 'enc:v1:ig' }).instagramDirect).toBe(false);
    });
});

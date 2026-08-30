import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Canary allowlist active: only aliahdab@gmail.com may connect. Keep the real
// config (redis/db/etc. are read at import by other modules) and override only
// the allowlist.
vi.mock('../../src/config', async () => {
    const actual = await vi.importActual<typeof import('../../src/config')>('../../src/config');
    return { config: { ...actual.config, whatsappAllowlist: ['aliahdab@gmail.com'] } };
});

// db.select().from().where() → resolves the acting user's email.
const mockWhere = vi.fn();
vi.mock('../../src/db', () => ({
    db: { select: () => ({ from: () => ({ where: mockWhere }) }) },
}));
// `pages: {}` satisfies module-load access from the reply pipeline's shared
// column subset (PLAYGROUND_PAGE_COLUMNS reads schema.pages at import time);
// nothing in this suite executes a select against it.
vi.mock('../../src/db/schema', () => ({ users: {}, pages: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPage: vi.fn(),
        getPageByWhatsAppPhoneNumberId: vi.fn().mockResolvedValue(null),
        connectWhatsApp: vi.fn(),
        createWhatsAppOnlyPage: vi.fn(),
    },
    isPageDisconnected: vi.fn(() => false),
}));
vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        exchangeCodeForToken: vi.fn().mockResolvedValue({ token: 'tok' }),
        subscribeAppToWaba: vi.fn(),
        registerPhoneNumber: vi.fn(),
        getPhoneNumberInfo: vi.fn().mockResolvedValue({ displayPhoneNumber: '+966 50 111 2233', verifiedName: 'Noor' }),
    },
    WhatsAppApiError: class extends Error {},
}));
vi.mock('../../src/services/subscriptions', () => ({ subscriptionsService: { canEnablePage: vi.fn(), getUserSubscription: vi.fn() } }));
vi.mock('../../src/services/channelTrial', () => ({ channelTrialService: { evaluate: vi.fn(), record: vi.fn(), channelsForPage: vi.fn().mockReturnValue([]) } }));
vi.mock('../../src/services/facebook', () => ({ facebookService: {} }));
vi.mock('../../src/services/auth', () => ({ authService: { getUserById: vi.fn() } }));
// D-117 put `getWhatsAppUnavailableReason` in front of the connect handler, and it
// reaches the real `ecommerce` service → `ecommerceStores`, which this suite's schema
// mock does not carry. Stub the store lookup, not the availability service, so the
// D-117 gate itself still runs and this suite keeps proving the allowlist order.
vi.mock('../../src/services/ecommerce', () => ({
    hasActiveStoreForBillingSubject: vi.fn(async () => false),
    getActiveStoreForBillingSubject: vi.fn(async () => null),
}));

import { whatsappController } from '../../src/controllers/whatsapp';
import { pagesService } from '../../src/services/pages';
import { subscriptionsService } from '../../src/services/subscriptions';

function buildReply(): FastifyReply {
    return { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() } as unknown as FastifyReply;
}
function buildRequest(): WorkspaceRequest {
    return {
        user: { userId: 'user-1', facebookId: 'fb-1' },
        workspaceId: 'ws-1', workspaceOwnerId: 'user-1', workspaceRole: 'owner',
        params: { id: 'page-1' },
        body: { code: 'c', phoneNumberId: 'phone-1', wabaId: 'waba-1' },
        log: { info: vi.fn(), error: vi.fn() },
    } as unknown as WorkspaceRequest;
}

describe('WhatsApp connect — canary allowlist gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Plan gate runs after the allowlist — default entitled so allowlist behavior is isolated.
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(
            { status: 'active', plan: { slug: 'business', whatsappEnabled: true } } as never,
        );
    });

    it('403 WHATSAPP_NOT_ALLOWLISTED when the acting user is not on the allowlist', async () => {
        mockWhere.mockResolvedValue([{ email: 'someone.else@example.com' }]);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_NOT_ALLOWLISTED' }));
        // Gate runs before any Meta call or DB write
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
    });

    it('proceeds when the acting user IS on the allowlist (case-insensitive)', async () => {
        mockWhere.mockResolvedValue([{ email: 'AliAhdab@gmail.com' }]);
        vi.mocked(pagesService.getPage).mockResolvedValue({ id: 'page-1', workspaceId: 'ws-1', accessToken: 'fb' } as never);
        vi.mocked(pagesService.connectWhatsApp).mockResolvedValue({ id: 'page-1', facebookPageId: 'fb-1', whatsappAccessToken: 'wa' } as never);
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).not.toHaveBeenCalledWith(403);
        expect(pagesService.connectWhatsApp).toHaveBeenCalled();
    });

    it('403 when the user has no email at all (Facebook/phone login) while allowlist is active', async () => {
        mockWhere.mockResolvedValue([{ email: null }]);
        const reply = buildReply();
        await whatsappController.connectNew(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(pagesService.createWhatsAppOnlyPage).not.toHaveBeenCalled();
    });

    it('allowlisted but on a plan without WhatsApp → 403 WHATSAPP_PLAN_REQUIRED (plan gate after allowlist)', async () => {
        mockWhere.mockResolvedValue([{ email: 'aliahdab@gmail.com' }]);
        vi.mocked(subscriptionsService.getUserSubscription).mockResolvedValue(
            { status: 'active', plan: { slug: 'starter', whatsappEnabled: false } } as never,
        );
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(403);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PLAN_REQUIRED' }));
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
    });
});

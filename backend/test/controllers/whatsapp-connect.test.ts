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
    },
}));

vi.mock('../../src/services/channelTrial', () => ({
    channelTrialService: {
        evaluate: vi.fn(),
        record: vi.fn(),
        channelsForPage: vi.fn().mockReturnValue([{ type: 'whatsapp', id: 'phone-1' }]),
    },
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

const basePage = {
    id: 'page-1',
    workspaceId: 'ws-1',
    accessToken: 'fb-token',
    whatsappPhoneNumberId: null as string | null,
    whatsappAccessToken: null as string | null,
};

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
        vi.mocked(whatsappService.exchangeCodeForToken).mockResolvedValue('wa-business-token');
        vi.mocked(whatsappService.subscribeAppToWaba).mockResolvedValue(undefined);
        vi.mocked(whatsappService.registerPhoneNumber).mockResolvedValue(undefined);
        vi.mocked(whatsappService.getPhoneNumberInfo).mockResolvedValue({
            displayPhoneNumber: '+966 55 000 0000',
            verifiedName: 'Test Store',
        });
        vi.mocked(pagesService.connectWhatsApp).mockResolvedValue(connectedPage as never);
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

    it('502s when the code exchange fails', async () => {
        vi.mocked(whatsappService.exchangeCodeForToken).mockRejectedValue(new Error('bad code'));
        const reply = buildReply();
        await whatsappController.connect(buildRequest() as never, reply);

        expect(reply.status).toHaveBeenCalledWith(502);
        expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_CONNECT_FAILED' }));
        expect(pagesService.connectWhatsApp).not.toHaveBeenCalled();
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
        vi.mocked(channelTrialService.evaluate).mockResolvedValue({ blocked: false } as never);
        vi.mocked(channelTrialService.record).mockResolvedValue(undefined as never);
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
        vi.mocked(whatsappService.exchangeCodeForToken).mockResolvedValue('wa-business-token');
        vi.mocked(whatsappService.subscribeAppToWaba).mockResolvedValue(undefined);
        vi.mocked(whatsappService.registerPhoneNumber).mockResolvedValue(undefined);
        vi.mocked(whatsappService.getPhoneNumberInfo).mockResolvedValue({
            displayPhoneNumber: '+966 50 111 2233',
            verifiedName: 'Noor Store',
        });
        vi.mocked(pagesService.createWhatsAppOnlyPage).mockResolvedValue(waOnlyPage as never);
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
            verifiedName: 'Noor Store',
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
});

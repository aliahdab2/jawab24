import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppMessageAdapter } from '../../src/services/reply/adapters/whatsappAdapter';

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByWhatsAppPhoneNumberId: vi.fn(),
    },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        markAsReplied: vi.fn(),
    },
}));

vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        getSenderName: vi.fn(),
        setSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../src/services/whatsapp', () => {
    // WhatsAppApiError must be a REAL class — the adapter branches on `instanceof`
    // to decide whether a failure is a dead token. A plain object here makes every
    // error fall through and the 190 handler dead code.
    class WhatsAppApiError extends Error {
        readonly metaCode?: number;
        readonly transient: boolean;
        constructor(message: string, metaCode?: number, transient = false) {
            super(message);
            this.name = 'WhatsAppApiError';
            this.metaCode = metaCode;
            this.transient = transient;
        }
    }
    return {
        WhatsAppApiError,
        META_TOKEN_EXPIRED: 190,
        whatsappService: {
            sendTextMessage: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../src/services/whatsappTokenHealth', () => ({
    markWhatsAppNeedsReconnect: vi.fn().mockResolvedValue(undefined),
}));

import { pagesService } from '../../src/services/pages';
import { messagesService } from '../../src/services/messages';
import { conversationsService } from '../../src/services/conversations';
import { whatsappService } from '../../src/services/whatsapp';

const mockDbPage = {
    id: 'page-uuid',
    userId: 'user-uuid',
    workspaceId: 'ws-uuid',
    name: 'Test Store',
    accessToken: 'fb-page-token',
    facebookPageId: null,
    autoReplyEnabled: true,
    whatsappPhoneNumberId: 'phone-number-id-123',
    whatsappBusinessAccountId: 'waba-123',
    whatsappDisplayPhoneNumber: '+966 55 000 0000',
    whatsappAutoReplyEnabled: true,
    whatsappAccessToken: 'wa-business-token',
    instagramAccountId: null,
    instagramUsername: null,
    instagramProfilePicUrl: null,
    instagramAutoReplyEnabled: false,
    ecommerceStoreId: null,
    knowledgeBase: null,
    suggestedKnowledgeBase: null,
    kbVersion: 1,
    kbActiveVersion: 1,
    kbUpdatedAt: null,
    businessProfile: {},
    businessProfileUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('WhatsAppMessageAdapter.getPage', () => {
    const adapter = new WhatsAppMessageAdapter();

    beforeEach(() => vi.clearAllMocks());

    it('returns mapped platform page when page exists', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(mockDbPage);

        const page = await adapter.getPage('phone-number-id-123');

        expect(page).not.toBeNull();
        expect(page!.id).toBe('page-uuid');
        expect(page!.platformAccountId).toBe('phone-number-id-123');
        expect(page!.autoReplyEnabled).toBe(true);
    });

    it('carries the WhatsApp business token, NOT the Facebook page token', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(mockDbPage);

        const page = await adapter.getPage('phone-number-id-123');

        expect(page!.accessToken).toBe('wa-business-token');
    });

    it('surfaces an empty token when WhatsApp token is missing (send must fail, not fall back to FB token)', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue({
            ...mockDbPage,
            whatsappAccessToken: null,
        });

        const page = await adapter.getPage('phone-number-id-123');

        expect(page!.accessToken).toBe('');
    });

    it('returns null when page not found', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(null);

        const page = await adapter.getPage('unknown-phone-id');

        expect(page).toBeNull();
    });

    it('uses whatsappAutoReplyEnabled, not the Facebook autoReplyEnabled', async () => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue({
            ...mockDbPage,
            autoReplyEnabled: true,
            whatsappAutoReplyEnabled: false,
        });

        const page = await adapter.getPage('phone-number-id-123');

        expect(page!.autoReplyEnabled).toBe(false);
    });
});

describe('WhatsAppMessageAdapter.fetchSenderName', () => {
    const adapter = new WhatsAppMessageAdapter();

    beforeEach(() => vi.clearAllMocks());

    it('returns cached name from DB when pageId provided', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue('أحمد محمد');

        const name = await adapter.fetchSenderName('+966500000000', 'token', 'page-uuid');

        expect(name).toBe('أحمد محمد');
        expect(conversationsService.getSenderName).toHaveBeenCalledWith('page-uuid', '+966500000000');
    });

    it('returns undefined when no cached name and no profile API', async () => {
        vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);

        const name = await adapter.fetchSenderName('+966500000000', 'token', 'page-uuid');

        expect(name).toBeUndefined();
    });

    it('skips DB lookup when no pageId provided', async () => {
        const name = await adapter.fetchSenderName('+966500000000', 'token');

        expect(name).toBeUndefined();
        expect(conversationsService.getSenderName).not.toHaveBeenCalled();
    });
});

describe('WhatsAppMessageAdapter.sendReply', () => {
    const adapter = new WhatsAppMessageAdapter();

    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'ws-uuid',
        name: 'Test Store',
        accessToken: 'wa-access-token',
        autoReplyEnabled: true,
        platformAccountId: 'phone-number-id-123',
        knowledgeBase: null,
        kbActiveVersion: null,
    };

    beforeEach(() => vi.clearAllMocks());

    it('sends text message via whatsappService', async () => {
        await adapter.sendReply(mockPage, '+966500000000', 'مرحباً!');

        expect(whatsappService.sendTextMessage).toHaveBeenCalledWith(
            'phone-number-id-123',
            '+966500000000',
            'مرحباً!',
            'wa-access-token',
        );
    });

    it('throws when page has no platformAccountId', async () => {
        const pageWithoutPhone = { ...mockPage, platformAccountId: undefined };

        await expect(
            adapter.sendReply(pageWithoutPhone, '+966500000000', 'Hello')
        ).rejects.toThrow('Page has no WhatsApp phone number ID');
    });
});

describe('WhatsAppMessageAdapter.sendAwayMessage', () => {
    const adapter = new WhatsAppMessageAdapter();

    const mockPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'ws-uuid',
        name: 'Test Store',
        accessToken: 'wa-access-token',
        autoReplyEnabled: true,
        platformAccountId: 'phone-number-id-123',
        knowledgeBase: null,
        kbActiveVersion: null,
    };

    beforeEach(() => vi.clearAllMocks());

    it('sends away message via whatsappService', async () => {
        await adapter.sendAwayMessage(mockPage, '+966500000000', 'نحن خارج أوقات العمل');

        expect(whatsappService.sendTextMessage).toHaveBeenCalledWith(
            'phone-number-id-123',
            '+966500000000',
            'نحن خارج أوقات العمل',
            'wa-access-token',
        );
    });

    it('silently ignores send failures (24h window expired)', async () => {
        vi.mocked(whatsappService.sendTextMessage).mockRejectedValue(new Error('Message failed: 24h window'));

        await expect(
            adapter.sendAwayMessage(mockPage, '+966500000000', 'Away')
        ).resolves.toBeUndefined();
    });

    it('skips send when page has no platformAccountId', async () => {
        const pageWithoutPhone = { ...mockPage, platformAccountId: undefined };

        await adapter.sendAwayMessage(pageWithoutPhone, '+966500000000', 'Away');

        expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });
});

describe('WhatsAppMessageAdapter.sendTypingIndicator', () => {
    const adapter = new WhatsAppMessageAdapter();

    it('is a no-op (wamid not available at this stage)', async () => {
        const mockPage = {
            id: 'page-uuid', userId: 'user-uuid', workspaceId: 'ws-uuid',
            name: 'Test', accessToken: 'token', autoReplyEnabled: true,
            platformAccountId: 'phone-id', knowledgeBase: null, kbActiveVersion: null,
        };

        await expect(
            adapter.sendTypingIndicator(mockPage, '+966500000000')
        ).resolves.toBeUndefined();

        expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });
});

describe('WhatsAppMessageAdapter.getInternalMessageId', () => {
    const adapter = new WhatsAppMessageAdapter();

    it('returns wamid as-is (no prefix transformation)', () => {
        const wamid = 'wamid.HBgLMTkxMzExMTExMTEVAgASGBI';
        expect(adapter.getInternalMessageId(wamid)).toBe(wamid);
    });
});

/**
 * The conflict guard.
 *
 * PR #507 (token lifecycle) and PR #510 (wamid) both rewrote sendReply. #507's
 * version wraps the send in a try/catch and returns void; #510's returns the
 * wamid. Review flagged that resolving the conflict by keeping #507's body drops
 * the `return` — every WhatsApp outgoing row silently reverts to a synthetic id,
 * with the whole suite still green, and the damage only surfaces much later as
 * the bot muting itself after each reply it sends under Coexistence.
 *
 * These tests make that resolution impossible to get wrong quietly.
 */
describe('WhatsAppMessageAdapter.sendReply — merge-resolution guard', () => {
    const adapter = new WhatsAppMessageAdapter();
    const page = {
        id: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        name: 'Falafel House',
        accessToken: 'wa-token',
        knowledgeBase: null,
        kbActiveVersion: null,
        autoReplyEnabled: true,
        platformAccountId: 'phone-1',
    };

    beforeEach(() => vi.clearAllMocks());

    it('RETURNS the wamid so the caller can store it', async () => {
        const wamid = 'wamid.HBgLOTY2NTAwMDAwMDAVAgARGBI5QTNDMkYzM0E1QjcyM0Q0RjIA';
        vi.mocked(whatsappService.sendTextMessage).mockResolvedValue(wamid);

        await expect(adapter.sendReply(page, '+966500000000', 'hello')).resolves.toBe(wamid);
    });

    it('returns undefined rather than an empty string when Meta omits the id', async () => {
        // sendTextMessage falls back to '' — that must not reach the NOT NULL
        // platformMessageId column, where it would collide on the unique index.
        vi.mocked(whatsappService.sendTextMessage).mockResolvedValue('');

        await expect(adapter.sendReply(page, '+966500000000', 'hello')).resolves.toBeUndefined();
    });

    it('refuses to send with an empty bearer instead of earning a 190', async () => {
        // safeDecryptToken returns '' on a key misconfiguration. Sending anyway
        // would be read as "this merchant's token expired" and flag every page.
        await expect(
            adapter.sendReply({ ...page, accessToken: '' }, '+966500000000', 'hello'),
        ).rejects.toThrow(/token unavailable/i);
        expect(whatsappService.sendTextMessage).not.toHaveBeenCalled();
    });

    it('still rethrows a send failure after flagging', async () => {
        const boom = new Error('network down');
        vi.mocked(whatsappService.sendTextMessage).mockRejectedValue(boom);

        await expect(adapter.sendReply(page, '+966500000000', 'hello')).rejects.toThrow('network down');
    });
});

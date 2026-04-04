import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppMessageAdapter } from '../../src/services/reply/adapters/whatsappAdapter';

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByWhatsAppPhoneNumberId: vi.fn(),
    },
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        getSenderNameBySenderId: vi.fn(),
        findOrCreateFromWebhook: vi.fn(),
        markAsReplied: vi.fn(),
    },
}));

vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        sendTextMessage: vi.fn().mockResolvedValue(undefined),
    },
}));

import { pagesService } from '../../src/services/pages';
import { messagesService } from '../../src/services/messages';
import { whatsappService } from '../../src/services/whatsapp';

const mockDbPage = {
    id: 'page-uuid',
    userId: 'user-uuid',
    workspaceId: 'ws-uuid',
    name: 'Test Store',
    accessToken: 'wa-access-token',
    facebookPageId: null,
    autoReplyEnabled: true,
    whatsappPhoneNumberId: 'phone-number-id-123',
    whatsappBusinessAccountId: 'waba-123',
    whatsappDisplayPhoneNumber: '+966 55 000 0000',
    whatsappAutoReplyEnabled: true,
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
        expect(page!.accessToken).toBe('wa-access-token');
        expect(page!.platformAccountId).toBe('phone-number-id-123');
        expect(page!.autoReplyEnabled).toBe(true);
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
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue('أحمد محمد');

        const name = await adapter.fetchSenderName('+966500000000', 'token', 'page-uuid');

        expect(name).toBe('أحمد محمد');
        expect(messagesService.getSenderNameBySenderId).toHaveBeenCalledWith('page-uuid', '+966500000000');
    });

    it('returns undefined when no cached name and no profile API', async () => {
        vi.mocked(messagesService.getSenderNameBySenderId).mockResolvedValue(null);

        const name = await adapter.fetchSenderName('+966500000000', 'token', 'page-uuid');

        expect(name).toBeUndefined();
    });

    it('skips DB lookup when no pageId provided', async () => {
        const name = await adapter.fetchSenderName('+966500000000', 'token');

        expect(name).toBeUndefined();
        expect(messagesService.getSenderNameBySenderId).not.toHaveBeenCalled();
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

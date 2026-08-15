import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios for API calls
vi.mock('axios');

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        facebook: { graphApiVersion: 'v18.0' },
    },
}));

// Mock pages service
vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByInstagramId: vi.fn(),
    },
}));

// Mock instagram service
vi.mock('../../src/services/instagram', () => ({
    instagramService: {
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendTypingOff: vi.fn().mockResolvedValue(undefined),
        sendDirectMessage: vi.fn().mockResolvedValue('msg-id-123'),
    },
}));

// Mock messages service (used for markAsReplied / findOrCreateFromWebhook)
vi.mock('../../src/services/messages', () => ({
    messagesService: {
        markAsReplied: vi.fn(),
        findOrCreateFromWebhook: vi.fn(),
    },
}));

// Mock the shared Meta send helpers — product cards must not reach real axios,
// and the endpoint they receive is the assertion that matters for Instagram-direct.
vi.mock('../../src/services/metaMessaging', () => ({
    sendMetaProductCards: vi.fn().mockResolvedValue('card-msg-id'),
    buildMessagePayload: vi.fn((recipientId: string, message: unknown) => ({ recipient: { id: recipientId }, message })),
}));

// Mock conversations service — canonical sender-name store.
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        getSenderName: vi.fn(),
        setSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

const mockedAxios = vi.mocked(axios, true);

import { InstagramMessageAdapter } from '../../src/services/reply/adapters/instagramAdapter';
import { pageLinkedInstagramCredential } from '../../src/services/instagramCredential';
import { pagesService } from '../../src/services/pages';
import { instagramService } from '../../src/services/instagram';
import { sendMetaProductCards } from '../../src/services/metaMessaging';
import { messagesService } from '../../src/services/messages';
import { conversationsService } from '../../src/services/conversations';

describe('InstagramMessageAdapter', () => {
    let adapter: InstagramMessageAdapter;

    const PAGE_ID = 'page-uuid-123';
    const SENDER_ID = 'ig-user-456';
    const ACCESS_TOKEN = 'test-access-token';
    const BASE = 'https://graph.facebook.com/v18.0';

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new InstagramMessageAdapter();
    });

    describe('fetchSenderName', () => {
        it('returns cached name from DB when available', async () => {
            vi.mocked(conversationsService.getSenderName).mockResolvedValue('CachedUser');

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('CachedUser');
            expect(conversationsService.getSenderName).toHaveBeenCalledWith(PAGE_ID, SENDER_ID);
            // Should NOT call the API when DB cache hits
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('returns username from Instagram Graph API on DB cache miss', async () => {
            vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({
                data: { username: 'cool_user', name: 'Cool User' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('cool_user');
            expect(mockedAxios.get).toHaveBeenCalledWith(`${BASE}/${SENDER_ID}`, {
                params: { fields: 'name,username', access_token: ACCESS_TOKEN },
            });
        });

        it('returns name when username is not available from API', async () => {
            vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({
                data: { name: 'Just A Name' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBe('Just A Name');
        });

        it('returns undefined when API call fails', async () => {
            vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
            mockedAxios.get.mockRejectedValue(new Error('Network error'));

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBeUndefined();
        });

        it('skips DB cache lookup when no pageId is provided', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { username: 'no_page_user' },
            });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN);

            expect(name).toBe('no_page_user');
            expect(conversationsService.getSenderName).not.toHaveBeenCalled();
        });

        it('returns undefined when API returns empty data', async () => {
            vi.mocked(conversationsService.getSenderName).mockResolvedValue(null);
            mockedAxios.get.mockResolvedValue({ data: {} });

            const name = await adapter.fetchSenderName(SENDER_ID, ACCESS_TOKEN, PAGE_ID);

            expect(name).toBeUndefined();
        });
    });

    describe('storeIncomingMessage', () => {
        const IG_MESSAGE_ID = 'ig-msg-abc';
        const MESSAGE_TEXT = 'Hello from Instagram';

        it('delegates to messagesService.findOrCreateFromWebhook with platform instagram', async () => {
            vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
                message: { id: 'new-msg-id', platformMessageId: IG_MESSAGE_ID, pageId: PAGE_ID, senderId: SENDER_ID, senderName: 'instagram_user', message: MESSAGE_TEXT, direction: 'incoming', replied: false, replyText: null, replyMethod: null, createdAt: null } as any,
                isNew: true,
            });

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, 'ws-uuid-1', IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'instagram_user',
            );

            expect(result.isNew).toBe(true);
            expect(result.message.id).toBe('new-msg-id');
            expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
                PAGE_ID, 'ws-uuid-1', IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'instagram_user', undefined, 'instagram',
            );
        });

        it('returns existing message when findOrCreateFromWebhook finds one', async () => {
            vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
                message: { id: 'existing-id', platformMessageId: IG_MESSAGE_ID, pageId: PAGE_ID, senderId: SENDER_ID, senderName: 'already_set', message: MESSAGE_TEXT, direction: 'incoming', replied: true, replyText: null, replyMethod: null, createdAt: null, needsAttention: false } as any,
                isNew: false,
            });

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, 'ws-uuid-1', IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'new_name',
            );

            expect(result.isNew).toBe(false);
            expect(result.message.id).toBe('existing-id');
            expect(result.message.replied).toBe(true);
        });
    });

    describe('getInternalMessageId', () => {
        it('returns raw Instagram message ID without prefix', () => {
            expect(adapter.getInternalMessageId('abc123')).toBe('abc123');
        });
    });

    describe('platform', () => {
        it('reports instagram as platform', () => {
            expect(adapter.platform).toBe('instagram');
        });
    });

    describe('typing indicator', () => {
        const mockPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'ws-uuid',
            name: 'Test IG Account',
            accessToken: 'ig-token',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
            platformAccountId: 'ig-account-1',
        };

        it('sendTypingIndicator delegates to instagramService with account id + token', async () => {
            const { instagramService } = await import('../../src/services/instagram');
            await adapter.sendTypingIndicator(mockPage, 'recipient-1');
            expect(instagramService.sendTypingIndicator).toHaveBeenCalledWith('ig-account-1', 'recipient-1', pageLinkedInstagramCredential('ig-token'));
        });

        it('sendTypingOff delegates to instagramService with account id + token', async () => {
            const { instagramService } = await import('../../src/services/instagram');
            await adapter.sendTypingOff(mockPage, 'recipient-1');
            expect(instagramService.sendTypingOff).toHaveBeenCalledWith('ig-account-1', 'recipient-1', pageLinkedInstagramCredential('ig-token'));
        });

        it('sendTypingOff no-ops when platformAccountId is missing', async () => {
            const { instagramService } = await import('../../src/services/instagram');
            vi.mocked(instagramService.sendTypingOff).mockClear();
            await adapter.sendTypingOff({ ...mockPage, platformAccountId: undefined }, 'recipient-1');
            expect(instagramService.sendTypingOff).not.toHaveBeenCalled();
        });
    });
});

describe('InstagramMessageAdapter — Instagram-direct routing', () => {
    const adapter = new InstagramMessageAdapter();

    const directRow = {
        id: 'page-uuid-direct',
        userId: 'u1',
        workspaceId: 'ws1',
        name: '@shop',
        // The '' sentinel: an Instagram Login row has no Facebook page token.
        accessToken: '',
        facebookPageId: null,
        instagramAccessToken: 'ig-direct-token',
        instagramAccountId: 'ig-acct-9',
        instagramAutoReplyEnabled: true,
        knowledgeBase: null,
        kbActiveVersion: null,
        ecommerceStoreId: null,
        businessProfile: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(directRow as never);
    });

    // `accessToken` on a PlatformPage means "the credential THIS platform sends
    // with" — the contract the WhatsApp adapter already follows. Without it every
    // downstream reader (sender-name lookup, product cards, reply image) would be
    // handed the '' sentinel.
    it('getPage puts the Instagram User token on the page and marks the credential direct', async () => {
        const page = await adapter.getPage('ig-acct-9');

        expect(page?.accessToken).toBe('ig-direct-token');
        expect(page?.instagramCredential).toEqual({
            accessToken: 'ig-direct-token',
            baseUrl: 'https://graph.instagram.com/v18.0',
            direct: true,
        });
    });

    // Mutation-checked: sending `page.accessToken` instead of the credential, or
    // resolving the credential as page-linked, fails this.
    it('sendReply issues the DM on the Instagram credential, not the Facebook one', async () => {
        const page = await adapter.getPage('ig-acct-9');
        await adapter.sendReply(page!, 'customer-1', 'أهلاً بك');

        expect(instagramService.sendDirectMessage).toHaveBeenCalledWith(
            'ig-acct-9', 'customer-1', 'أهلاً بك',
            expect.objectContaining({ accessToken: 'ig-direct-token', direct: true }),
        );
    });

    // Product cards ride the shared Meta helper, which defaults to
    // graph.facebook.com/me/messages — the one place an Instagram-direct send could
    // silently leak back onto the Facebook host.
    it('sendProductCards targets /{ig-id}/messages on the Instagram host', async () => {
        const page = await adapter.getPage('ig-acct-9');
        await adapter.sendProductCards!(page!, 'customer-1', [
            { title: 'حقيبة', imageUrl: 'https://cdn/x.jpg', price: '10' } as never,
        ]);

        expect(sendMetaProductCards).toHaveBeenCalledWith(
            'ig-direct-token', 'customer-1', expect.any(Array), undefined,
            'https://graph.instagram.com/v18.0/ig-acct-9/messages',
        );
    });
});

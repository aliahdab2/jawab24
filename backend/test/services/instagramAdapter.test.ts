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

// Mock conversations service — canonical sender-name store.
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        getSenderName: vi.fn(),
        setSenderName: vi.fn().mockResolvedValue(undefined),
    },
}));

const mockedAxios = vi.mocked(axios, true);

import { InstagramMessageAdapter } from '../../src/services/reply/adapters/instagramAdapter';
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
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'instagram_user',
            );

            expect(result.isNew).toBe(true);
            expect(result.message.id).toBe('new-msg-id');
            expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'instagram_user', undefined, 'instagram',
            );
        });

        it('returns existing message when findOrCreateFromWebhook finds one', async () => {
            vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
                message: { id: 'existing-id', platformMessageId: IG_MESSAGE_ID, pageId: PAGE_ID, senderId: SENDER_ID, senderName: 'already_set', message: MESSAGE_TEXT, direction: 'incoming', replied: true, replyText: null, replyMethod: null, createdAt: null, needsAttention: false } as any,
                isNew: false,
            });

            const result = await adapter.storeIncomingMessage(
                PAGE_ID, IG_MESSAGE_ID, SENDER_ID, MESSAGE_TEXT, 'new_name',
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
});

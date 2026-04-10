import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '../types';

// Mock all external dependencies
vi.mock('../services/pages', () => ({
    pagesService: {
        getPageByFacebookId: vi.fn(),
        getPageByInstagramId: vi.fn(),
    },
}));

vi.mock('../services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        getLastIncomingTextFromSender: vi.fn(),
        getSenderNameBySenderId: vi.fn(),
    },
}));

vi.mock('../services/facebook', () => ({
    facebookService: {
        sendPrivateMessage: vi.fn(),
        getPostContent: vi.fn(),
        getSenderProfile: vi.fn(),
    },
}));

vi.mock('../services/instagram', () => ({
    instagramService: {
        sendDirectMessage: vi.fn(),
        getPostContent: vi.fn(),
    },
}));

vi.mock('../services/transcription', () => ({
    transcriptionService: {
        transcribe: vi.fn(),
    },
}));

vi.mock('../lib/redis', () => ({
    redis: {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../lib/replyQueue', () => ({
    enqueueMessage: vi.fn(),
}));

vi.mock('../utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('ar'),
}));

vi.mock('../utils/attachmentLabels', () => ({
    getAttachmentPlaceholder: vi.fn().mockReturnValue('[Image]'),
    getTextOnlyNudge: vi.fn().mockReturnValue('nudge text'),
}));

vi.mock('../utils/instagram', () => ({
    extractPostId: vi.fn(),
    isSharedPostType: vi.fn().mockReturnValue(false),
}));

vi.mock('../services/reply/adapters/facebookAdapter', () => ({
    facebookMessageAdapter: {
        fetchSenderName: vi.fn().mockResolvedValue('Test User'),
    },
}));

vi.mock('../services/reply/adapters/instagramAdapter', () => ({
    instagramMessageAdapter: {
        fetchSenderName: vi.fn().mockResolvedValue('IG User'),
    },
}));

import { handleNonTextMessage } from '../services/reply/nonTextHandler';
import { pagesService } from '../services/pages';
import { messagesService } from '../services/messages';
import { facebookService } from '../services/facebook';
import { facebookMessageAdapter } from '../services/reply/adapters/facebookAdapter';

const mockPage = {
    id: 'page-uuid-1',
    accessToken: 'access-token',
    instagramAccountId: null,
};

const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(mockPage as never);
    vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue(undefined as never);
    vi.mocked(messagesService.getLastIncomingTextFromSender).mockResolvedValue(null);
    vi.mocked(facebookMessageAdapter.fetchSenderName).mockResolvedValue('Test User');
});

describe('handleNonTextMessage — sticker', () => {
    it('stores [Sticker] placeholder with sender name, without sending a nudge', async () => {
        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
            'facebook',
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'msg-1', 'user-1', '[Sticker]', 'Test User', 'sticker',
        );
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('stores [Sticker] even when sender name fetch fails', async () => {
        vi.mocked(facebookMessageAdapter.fetchSenderName).mockRejectedValueOnce(new Error('API error'));

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
            'facebook',
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'msg-1', 'user-1', '[Sticker]', undefined, 'sticker',
        );
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('returns without error when page not found', async () => {
        vi.mocked(pagesService.getPageByFacebookId).mockResolvedValueOnce(null as never);

        await expect(
            handleNonTextMessage(
                'fb-page-id',
                { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
                'facebook',
                mockLogger,
            ),
        ).resolves.toBeUndefined();

        expect(messagesService.findOrCreateFromWebhook).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });
});

describe('handleNonTextMessage — image (sender name)', () => {
    it('stores image placeholder with sender name and sends nudge', async () => {
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(undefined as never);
        vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as never);

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-3', attachmentType: 'image' },
            'facebook',
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'msg-3', 'user-1', '[Image]', 'Test User', 'image',
        );
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    it('still sends nudge even when sender name fetch fails (regression)', async () => {
        vi.mocked(facebookMessageAdapter.fetchSenderName).mockRejectedValueOnce(new Error('API error'));
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(undefined as never);
        vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as never);

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-4', attachmentType: 'image' },
            'facebook',
            mockLogger,
        );

        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });
});

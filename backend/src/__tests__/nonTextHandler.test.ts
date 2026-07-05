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
        markAsResolved: vi.fn(),
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

// Image understanding: control the gate + describe so the branch is testable
// (and so the real service's subscriptions→redis import chain stays out).
const { mockGate, mockDescribeUrl, mockIncrement } = vi.hoisted(() => ({
    mockGate: vi.fn(),
    mockDescribeUrl: vi.fn(),
    mockIncrement: vi.fn(),
}));
vi.mock('../services/imageUnderstanding', () => ({
    checkImageUnderstandingGate: mockGate,
    imageUnderstandingService: { describeFromUrl: mockDescribeUrl, describeFromBuffer: vi.fn() },
    incrementImageUnderstandingCounter: mockIncrement,
}));

import { handleNonTextMessage } from '../services/reply/nonTextHandler';
import { pagesService } from '../services/pages';
import { messagesService } from '../services/messages';
import { facebookService } from '../services/facebook';
import { facebookMessageAdapter } from '../services/reply/adapters/facebookAdapter';
import { enqueueMessage } from '../lib/replyQueue';

const mockPage = {
    id: 'page-uuid-1',
    workspaceId: 'ws-uuid-1',
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
    vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
        message: { id: 'msg-uuid' } as never,
        isNew: true,
    } as never);
    vi.mocked(messagesService.markAsResolved).mockResolvedValue(undefined as never);
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
            'page-uuid-1', 'ws-uuid-1', 'msg-1', 'user-1', '[Sticker]', 'Test User', 'sticker',
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
            'page-uuid-1', 'ws-uuid-1', 'msg-1', 'user-1', '[Sticker]', undefined, 'sticker',
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

    // Regression: a 👍 like-button (delivered as a sticker) used to get flagged as
    // "needs attention" 15–30 min after arrival because the escalation cron's
    // spam-cleanup pass keys off "no alphabetic letter in the message", and the
    // stored placeholder "[Sticker]" contains letters. We now mark the row resolved
    // at store time so escalation skips it.
    it('marks the stored sticker row resolved so escalation does not flag it', async () => {
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
            message: { id: 'sticker-msg-uuid' } as never,
            isNew: true,
        } as never);

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
            'facebook',
            mockLogger,
        );

        expect(messagesService.markAsResolved).toHaveBeenCalledWith('sticker-msg-uuid');
        expect(messagesService.markAsResolved).toHaveBeenCalledTimes(1);
    });

    it('does not re-resolve an already-stored sticker on webhook retry', async () => {
        // isNew=false means the row already exists (Facebook redelivered the webhook).
        // Re-marking resolved is a no-op semantically but would be a wasted DB write
        // and could overwrite a merchant's manual unresolve action.
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
            message: { id: 'sticker-msg-uuid' } as never,
            isNew: false,
        } as never);

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
            'facebook',
            mockLogger,
        );

        expect(messagesService.markAsResolved).not.toHaveBeenCalled();
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
            'page-uuid-1', 'ws-uuid-1', 'msg-3', 'user-1', '[Image]', 'Test User', 'image',
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

describe('handleNonTextMessage — image understanding', () => {
    const pageWithOwner = { ...mockPage, userId: 'page-owner-1' };
    const imageEvent = {
        senderId: 'user-1',
        messageId: 'msg-img',
        attachmentType: 'image',
        attachmentUrl: 'https://cdn.fb/img.jpg',
    };

    beforeEach(() => {
        vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(pageWithOwner as never);
        vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as never);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue(undefined as never);
    });

    it('describes the image, stores the description, enqueues it, and does NOT nudge', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue({ text: 'وصف الصورة' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        // Stored body + enqueued text are the same "[صورة: …]" string (ar default).
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[صورة: وصف الصورة]', 'Test User', 'image',
        );
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '[صورة: وصف الصورة]' }));
        expect(mockIncrement).toHaveBeenCalledWith('page-owner-1');
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('falls back to placeholder + nudge when the description fails', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue(null);

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[Image]', 'Test User', 'image',
        );
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(mockIncrement).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    it('does not call vision (and nudges) when the gate denies', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_reached' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });
});

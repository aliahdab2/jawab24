import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '../types';

// Mock all external dependencies
vi.mock('../services/pages', () => ({
    pagesService: {
        getPageByFacebookId: vi.fn(),
        getPageByInstagramId: vi.fn(),
    },
    // Published-at-stub-time SSE invalidates the workspace stats cache.
    invalidateWorkspaceStatsCache: vi.fn(),
}));

vi.mock('../services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        finalizeEnrichment: vi.fn(),
        setCreatedTime: vi.fn(),
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
        transcribeFromBuffer: vi.fn(),
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

vi.mock('../lib/eventBus', () => ({
    publishSSEEvent: vi.fn(),
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
import { instagramService } from '../services/instagram';
import { transcriptionService } from '../services/transcription';
import { facebookMessageAdapter } from '../services/reply/adapters/facebookAdapter';
import { enqueueMessage } from '../lib/replyQueue';
import { publishSSEEvent } from '../lib/eventBus';
import { isSharedPostType, extractPostId } from '../utils/instagram';

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
    // Default stub: a brand-new 'pending' row (store-then-enrich).
    vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue({
        message: { id: 'msg-uuid', enrichmentStatus: 'pending' } as never,
        isNew: true,
    } as never);
    vi.mocked(messagesService.finalizeEnrichment).mockResolvedValue(true as never);
    vi.mocked(messagesService.markAsResolved).mockResolvedValue(undefined as never);
    vi.mocked(messagesService.getLastIncomingTextFromSender).mockResolvedValue(null);
    vi.mocked(facebookMessageAdapter.fetchSenderName).mockResolvedValue('Test User');
    vi.mocked(isSharedPostType).mockReturnValue(false);
});

describe('handleNonTextMessage — sticker', () => {
    it('stores [Sticker] placeholder with sender name, without sending a nudge', async () => {
        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-1', attachmentType: 'sticker' },
            'facebook',
            mockLogger,
        );

        // Sticker path is unchanged — 7-arg call, no enrichment lifecycle, no SSE.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-1', 'user-1', '[Sticker]', 'Test User', 'sticker',
        );
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        expect(publishSSEEvent).not.toHaveBeenCalled();
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

describe('handleNonTextMessage — non-enrichable (video/file, image w/o url or owner)', () => {
    it('stores a terminal (non-pending) placeholder and sends the nudge', async () => {
        // mockPage has no userId and the event has no attachmentUrl → not enrichable.
        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-3', attachmentType: 'image' },
            'facebook',
            mockLogger,
        );

        // Stub stored with placeholder; 9th arg (enrichmentStatus) is undefined = terminal.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-3', 'user-1', '[Image]', 'Test User', 'image', undefined, undefined,
        );
        expect(messagesService.finalizeEnrichment).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    it('still stores + nudges even when sender name fetch fails (regression)', async () => {
        vi.mocked(facebookMessageAdapter.fetchSenderName).mockRejectedValueOnce(new Error('API error'));

        await handleNonTextMessage(
            'fb-page-id',
            { senderId: 'user-1', messageId: 'msg-4', attachmentType: 'video' },
            'facebook',
            mockLogger,
        );

        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });
});

describe('handleNonTextMessage — image understanding (store-then-enrich)', () => {
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
    });

    it('stores a pending stub FIRST, then finalizes with the description and enqueues it', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue({ text: 'وصف الصورة' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        // 1. Stub stored immediately with the PLACEHOLDER + 'pending' status.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[Image]', 'Test User', 'image', undefined, 'pending',
        );
        // 2. Stored BEFORE the vision call ran (the whole point of store-then-enrich).
        const storeOrder = vi.mocked(messagesService.findOrCreateFromWebhook).mock.invocationCallOrder[0];
        const describeOrder = mockDescribeUrl.mock.invocationCallOrder[0];
        expect(storeOrder).toBeLessThan(describeOrder);
        // 3. Finalized 'done' with the described body (ar default → "[صورة: …]").
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'done', '[صورة: وصف الصورة]');
        // 4. Enqueued with the same enriched text; usage counter bumped; no nudge.
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '[صورة: وصف الصورة]' }));
        expect(mockIncrement).toHaveBeenCalledWith('page-owner-1');
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('publishes message:received at stub time so the inbox shows the image instantly', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue({ text: 'وصف' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(publishSSEEvent).toHaveBeenCalledWith(
            'page-owner-1',
            'message:received',
            expect.objectContaining({
                messageId: 'msg-img',
                message: expect.objectContaining({ attachmentType: 'image', message: '[Image]' }),
            }),
        );
        // And message:updated after the enrichment finalizes.
        expect(publishSSEEvent).toHaveBeenCalledWith(
            'page-owner-1', 'message:updated', expect.objectContaining({ messageId: 'msg-img' }),
        );
    });

    it('finalizes FAILED + nudges (no enqueue) when the description fails', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue(null);

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[Image]', 'Test User', 'image', undefined, 'pending',
        );
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(mockIncrement).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    it('finalizes FAILED + nudges (no vision) when the gate denies', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_reached' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    it('flips the stub FAILED when enrichment throws (no stuck pending row)', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockRejectedValue(new Error('vision boom'));

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
    });

    it('skips re-enrichment on webhook redelivery of an already-finalized row', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
            message: { id: 'msg-uuid', enrichmentStatus: 'done' } as never,
            isNew: false,
        } as never);

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        expect(messagesService.finalizeEnrichment).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(publishSSEEvent).not.toHaveBeenCalled();
    });
});

describe('handleNonTextMessage — audio (store-then-enrich)', () => {
    const pageWithOwner = { ...mockPage, userId: 'page-owner-1' };
    const audioEvent = {
        senderId: 'user-1',
        messageId: 'msg-aud',
        attachmentType: 'audio',
        attachmentUrl: 'https://cdn.fb/voice.mp4',
    };

    beforeEach(() => {
        vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(pageWithOwner as never);
        vi.mocked(facebookService.sendPrivateMessage).mockResolvedValue(undefined as never);
    });

    it('stores pending, finalizes done with the transcript, and enqueues it', async () => {
        vi.mocked(transcriptionService.transcribe).mockResolvedValue({ text: 'مرحبا كم السعر' } as never);

        await handleNonTextMessage('fb-page-id', audioEvent, 'facebook', mockLogger);

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-aud', 'user-1', '[Image]', 'Test User', 'audio', undefined, 'pending',
        );
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'done', 'مرحبا كم السعر');
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'مرحبا كم السعر' }));
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });

    it('finalizes failed + nudges (no enqueue) when transcription fails', async () => {
        vi.mocked(transcriptionService.transcribe).mockResolvedValue(null as never);

        await handleNonTextMessage('fb-page-id', audioEvent, 'facebook', mockLogger);

        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });
});

describe('handleNonTextMessage — shared post (store-then-enrich)', () => {
    const sharedEvent = {
        senderId: 'user-1',
        messageId: 'msg-post',
        attachmentType: 'post',
        attachmentUrl: 'https://fb.com/post/123',
    };

    beforeEach(() => {
        vi.mocked(isSharedPostType).mockReturnValue(true);
        vi.mocked(extractPostId).mockReturnValue('123');
    });

    it('finalizes done with the fetched post content and enqueues it', async () => {
        vi.mocked(facebookService.getPostContent).mockResolvedValue('دورة الإسعافات الأولية' as never);

        await handleNonTextMessage('fb-page-id', sharedEvent, 'facebook', mockLogger);

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-post', 'user-1', '[Image]', 'Test User', 'post', undefined, 'pending',
        );
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith(
            'msg-uuid', 'done', '[Shared post: "دورة الإسعافات الأولية"]',
        );
        expect(enqueueMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: '[Shared post: "دورة الإسعافات الأولية"]' }),
        );
    });

    it('still finalizes done with the generic marker when content fetch is empty', async () => {
        vi.mocked(facebookService.getPostContent).mockResolvedValue(null as never);

        await handleNonTextMessage('fb-page-id', sharedEvent, 'facebook', mockLogger);

        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith(
            'msg-uuid', 'done', '[Customer shared a post]',
        );
        expect(enqueueMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: '[Customer shared a post]' }),
        );
        expect(instagramService.sendDirectMessage).not.toHaveBeenCalled();
    });
});

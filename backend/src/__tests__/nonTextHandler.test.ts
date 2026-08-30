import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '../types';

// Mock all external dependencies
vi.mock('../services/pages', () => ({
    pagesService: {
        getPageByFacebookId: vi.fn(),
        getPageByInstagramId: vi.fn(),
        getPageByWhatsAppPhoneNumberId: vi.fn(),
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

vi.mock('../services/whatsapp', () => ({
    whatsappService: {
        getMediaInfo: mockWaGetMediaInfo,
        downloadMedia: mockWaDownloadMedia,
        sendTextMessage: mockWaSendText,
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

vi.mock('../utils/attachmentLabels', async (importActual) => ({
    getAttachmentPlaceholder: vi.fn().mockReturnValue('[Image]'),
    getTextOnlyNudge: vi.fn().mockReturnValue('nudge text'),
    // Real set — it is data, not I/O, and stubbing it would make the
    // story-mention tests below assert against a fiction.
    NO_INTENT_ATTACHMENT_TYPES: (await importActual<typeof import('../utils/attachmentLabels')>())
        .NO_INTENT_ATTACHMENT_TYPES,
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
const {
    mockGate, mockDescribeUrl, mockDescribeBuffer, mockIncrement, mockNotifyCap,
    mockWaGetMediaInfo, mockWaDownloadMedia, mockWaSendText,
} = vi.hoisted(() => ({
    mockGate: vi.fn(),
    mockDescribeUrl: vi.fn(),
    mockDescribeBuffer: vi.fn(),
    mockIncrement: vi.fn(),
    mockNotifyCap: vi.fn(),
    mockWaGetMediaInfo: vi.fn(),
    mockWaDownloadMedia: vi.fn(),
    mockWaSendText: vi.fn(),
}));
vi.mock('../services/imageUnderstanding', () => ({
    checkImageUnderstandingGate: mockGate,
    imageUnderstandingService: { describeFromUrl: mockDescribeUrl, describeFromBuffer: mockDescribeBuffer },
    incrementImageUnderstandingCounter: mockIncrement,
    notifyImageCapReached: mockNotifyCap,
}));

import { handleNonTextMessage, handleWhatsAppNonTextMessage } from '../services/reply/nonTextHandler';
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

        // Sticker path: no enrichment lifecycle, no SSE — but it DOES carry the channel.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-1', 'user-1', '[Sticker]', 'Test User', 'sticker', 'facebook',
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
            'page-uuid-1', 'ws-uuid-1', 'msg-3', 'user-1', '[Image]', 'Test User', 'image', 'facebook', undefined,
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

describe('handleNonTextMessage — story mentions carry no question', () => {
    // Prod 2026-08-11: a resort's 15 story mentions each got the text-only nudge
    // («يرجى إعادة إرسال استفسارك كرسالة نصية») even though the guest had asked
    // nothing — they had tagged the page in their own Instagram story. 11 of the
    // rows were then flagged sla_no_reply, filling Needs Attention with story tags.
    //
    // Two vacuous-pass traps this block has to avoid, or "no nudge" proves nothing:
    //   1. the shared beforeEach mocks only getPageByFacebookId, so an unmocked IG
    //      lookup early-returns on the missing access token;
    //   2. sendNudge's IG branch is itself gated on page.instagramAccountId, which
    //      is null on the shared mockPage — so no IG nudge could ever fire.
    // The `video` control at the bottom is what proves neither trap is active.
    const igPage = { ...mockPage, instagramAccountId: 'ig-account-1' };

    beforeEach(() => {
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(igPage as never);
    });

    for (const attachmentType of ['story_mention'] as const) {
        it(`stores a ${attachmentType} but sends NO nudge`, async () => {
            vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
                message: { id: 'story-msg-uuid' } as never,
                isNew: true,
            } as never);

            await handleNonTextMessage(
                'ig-page-id',
                { senderId: 'user-1', messageId: 'msg-story', attachmentType },
                'instagram',
                mockLogger,
            );

            expect(instagramService.sendDirectMessage).not.toHaveBeenCalled();
            // storeOutgoingMessage is platform-independent inside sendNudge, so this
            // catches a nudge that went out on any channel.
            expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
            // Still stored, so the merchant inbox and the AI's chat history see it.
            expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalled();
            // ...and resolved, so the SLA sweep does not file it as unanswered.
            expect(messagesService.markAsResolved).toHaveBeenCalledWith('story-msg-uuid');
        });
    }

    it('does not re-resolve a story mention that is already resolved', async () => {
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
            message: { id: 'story-msg-uuid', enrichmentStatus: null, resolved: true } as never,
            isNew: false,
        } as never);

        await handleNonTextMessage(
            'ig-page-id',
            { senderId: 'user-1', messageId: 'msg-story', attachmentType: 'story_mention' },
            'instagram',
            mockLogger,
        );

        expect(messagesService.markAsResolved).not.toHaveBeenCalled();
    });

    it('DOES resolve on redelivery when a crash left the row unresolved', async () => {
        // The row exists but was never resolved — the process died between storing
        // the stub and resolving it. The redelivery is the only remaining chance:
        // if it returns early the row stays unresolved forever and the SLA sweep
        // files it as sla_no_reply, the exact symptom this branch prevents.
        vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValueOnce({
            message: { id: 'story-msg-uuid', enrichmentStatus: null, resolved: false } as never,
            isNew: false,
        } as never);

        await handleNonTextMessage(
            'ig-page-id',
            { senderId: 'user-1', messageId: 'msg-story', attachmentType: 'story_mention' },
            'instagram',
            mockLogger,
        );

        expect(messagesService.markAsResolved).toHaveBeenCalledWith('story-msg-uuid');
        expect(instagramService.sendDirectMessage).not.toHaveBeenCalled();
    });

    // ig_story is a customer REPLYING to the merchant's story — on Instagram that
    // is how buying conversations open. Production shows «كم الواحد؟» / «السعر»
    // arriving right after these rows, so suppressing them would swallow real
    // questions AND hide them from Needs Attention. It stays on the nudge path.
    it('still nudges an ig_story — a story REPLY is not a story mention', async () => {
        await handleNonTextMessage(
            'ig-page-id',
            { senderId: 'user-1', messageId: 'msg-igstory', attachmentType: 'ig_story' },
            'instagram',
            mockLogger,
        );

        expect(instagramService.sendDirectMessage).toHaveBeenCalled();
        expect(messagesService.markAsResolved).not.toHaveBeenCalled();
    });

    it('still nudges a video — the no-intent exemption is not a blanket opt-out', async () => {
        await handleNonTextMessage(
            'ig-page-id',
            { senderId: 'user-1', messageId: 'msg-vid', attachmentType: 'video' },
            'instagram',
            mockLogger,
        );

        expect(instagramService.sendDirectMessage).toHaveBeenCalled();
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
        mockDescribeUrl.mockResolvedValue({ ok: true, text: 'وصف الصورة' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        // 1. Stub stored immediately with the PLACEHOLDER + 'pending' status.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[Image]', 'Test User', 'image', 'facebook', 'pending',
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
        mockDescribeUrl.mockResolvedValue({ ok: true, text: 'وصف' });

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

    it('finalizes FAILED + nudges (no enqueue) when the IMAGE is unusable', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue({ ok: false, reason: 'unusable_image' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'msg-img', 'user-1', '[Image]', 'Test User', 'image', 'facebook', 'pending',
        );
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(mockIncrement).not.toHaveBeenCalled();
        // Oversized / wrong format / malformed — "send it as text" is honest here.
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
    });

    // THE prod regression, 2026-08-11. A guest photographed a bad meal to complain;
    // our 20s vision timeout fired; she was told «حالياً نستطيع الرد على الرسائل
    // النصية والصوتية» 20.684s later — false, since 35 photos were read the day
    // before. Timeout and "not an image" both returned null, so the handler could
    // not tell them apart. Same standing rule as the cap branch below: when WE
    // fail, the customer hears nothing.
    it('stays SILENT to the customer when the failure is OURS (vision timeout)', async () => {
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
        mockDescribeUrl.mockResolvedValue({ ok: false, reason: 'our_failure' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
        // The row still resolves to 'failed', so a parked text job is released and
        // the placeholder stops being 'pending' forever.
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(mockIncrement).not.toHaveBeenCalled();
        // Not the quota path — the merchant gets no cap notification for a timeout.
        expect(mockNotifyCap).not.toHaveBeenCalled();
    });

    it('finalizes FAILED + nudges (no vision) when the workspace has no plan for image reads', async () => {
        // no_subscription is a stable business state, not a failure of ours, so
        // "send it as text" is honest. env_disabled and cap_check_failed are OURS
        // and now stay silent — see actionForGateDenial.
        mockGate.mockResolvedValue({ allowed: false, reason: 'no_subscription' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).toHaveBeenCalled();
        expect(mockNotifyCap).not.toHaveBeenCalled();
    });

    // Regression: a merchant watched the text-only nudge ("we can only reply to
    // text and voice") go to five of his customers after his daily quota ran
    // out, and wrote a rule into his Business Info telling the assistant not to
    // reply to images at all. The customer must never be told — and never be
    // told something false: images WERE read for this page earlier the same day.
    it('stays SILENT to the customer when the daily image cap is reached', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_reached', ownerId: 'page-owner-1', limit: 15 });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        // No nudge, no AI job — the photo simply waits in the merchant's inbox.
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        // Still finalized so a parked text job is never left waiting on it.
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
    });

    /**
     * A suspended merchant's customer must hear NOTHING — not even the nudge.
     *
     * This handler runs at ingestion and consults no subscription of its own;
     * the entitlement gate lives downstream in messageProcessor. So a nudge here
     * would be a NEW outbound message to the customer of a merchant who is not
     * paying, telling them to retype their question as text — after which the
     * reply gate blocks the answer and they hear nothing anyway. It is the one
     * denial where the nudge's own justification ("the fastest route to an
     * answer") is false: no answer is coming by any route.
     *
     * Mutation check: return 'nudge' for subscription_inactive in
     * actionForGateDenial and this fails on sendPrivateMessage.
     */
    it('stays SILENT to the customer when the merchant is no longer subscribed', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'subscription_inactive' });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockDescribeUrl).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        // Not a cap denial — the merchant must not get a "daily limit" notice
        // for what is actually an unpaid subscription.
        expect(mockNotifyCap).not.toHaveBeenCalled();
        // Still finalized so a parked text job is never left waiting on it.
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
    });

    it('tells the MERCHANT (not the customer) which limit was hit', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_reached', ownerId: 'page-owner-1', limit: 15 });

        await handleNonTextMessage('fb-page-id', imageEvent, 'facebook', mockLogger);

        expect(mockNotifyCap).toHaveBeenCalledWith('page-owner-1', 15);
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
            'page-uuid-1', 'ws-uuid-1', 'msg-aud', 'user-1', '[Image]', 'Test User', 'audio', 'facebook', 'pending',
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
            'page-uuid-1', 'ws-uuid-1', 'msg-post', 'user-1', '[Image]', 'Test User', 'post', 'facebook', 'pending',
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

describe('handleWhatsAppNonTextMessage — image failures', () => {
    // This platform had NO tests at all until 2026-08-11, while carrying a copy of
    // the FB/IG image policy. That is exactly how one mirror gets a fix and the
    // other silently does not (§13c). The cap case below was genuinely wrong here
    // long after FB/IG was fixed: every WhatsApp denial nudged, so a merchant whose
    // daily quota ran out had his customers told «we can only read text» — false —
    // and was never notified himself.
    const waPage = {
        ...mockPage,
        userId: 'page-owner-1',
        whatsappPhoneNumberId: 'wa-phone-1',
        // The handler gates on whatsappAccessToken specifically, not accessToken —
        // without it every assertion below would pass vacuously on an early return.
        whatsappAccessToken: 'wa-token',
    };
    const imageEvent = { senderId: 'user-1', messageId: 'wa-msg-1', attachmentType: 'image', mediaId: 'media-1' };

    beforeEach(() => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(waPage as never);
        mockWaGetMediaInfo.mockResolvedValue({ url: 'https://wa/media', mimeType: 'image/jpeg' });
        mockWaDownloadMedia.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
        mockGate.mockResolvedValue({ allowed: true, ownerId: 'page-owner-1' });
    });

    it('stays SILENT when the failure is ours (vision timeout)', async () => {
        mockDescribeBuffer.mockResolvedValue({ ok: false, reason: 'our_failure' });

        await handleWhatsAppNonTextMessage('wa-phone-1', imageEvent, mockLogger);

        expect(mockWaSendText).not.toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
    });

    it('nudges when the IMAGE is unusable', async () => {
        mockDescribeBuffer.mockResolvedValue({ ok: false, reason: 'unusable_image' });

        await handleWhatsAppNonTextMessage('wa-phone-1', imageEvent, mockLogger);

        expect(mockWaSendText).toHaveBeenCalled();
    });

    it('stays SILENT and notifies the MERCHANT when the daily cap is reached', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_reached', ownerId: 'page-owner-1', limit: 15 });

        await handleWhatsAppNonTextMessage('wa-phone-1', imageEvent, mockLogger);

        expect(mockWaSendText).not.toHaveBeenCalled();
        expect(mockNotifyCap).toHaveBeenCalledWith('page-owner-1', 15);
        expect(mockDescribeBuffer).not.toHaveBeenCalled();
    });

    it('stays SILENT when OUR gate check fails (Redis blip), rather than blaming the customer', async () => {
        mockGate.mockResolvedValue({ allowed: false, reason: 'cap_check_failed' });

        await handleWhatsAppNonTextMessage('wa-phone-1', imageEvent, mockLogger);

        expect(mockWaSendText).not.toHaveBeenCalled();
        expect(mockNotifyCap).not.toHaveBeenCalled();
    });

    it('stays SILENT when the WABA media fetch throws — the image was never assessed', async () => {
        mockWaGetMediaInfo.mockRejectedValue(new Error('WABA 500'));

        await handleWhatsAppNonTextMessage('wa-phone-1', imageEvent, mockLogger);

        expect(mockWaSendText).not.toHaveBeenCalled();
        expect(messagesService.finalizeEnrichment).toHaveBeenCalledWith('msg-uuid', 'failed');
    });
});

// The attachment stub used to be stored with NO platform ("preserve legacy default"),
// so `createMessage` labelled every WhatsApp / Instagram attachment 'facebook' — and
// when the attachment was the customer's first message, the conversation too, which
// `findOrCreate` never rewrites. On a WhatsApp-only page that made the dashboard reply
// route to the Facebook sender and fail with PAGE_DISCONNECTED (Z NET, 2026-08-30:
// 43 rows, 7 conversations). The channel now travels with the stub on every path.
describe('attachment stubs carry their channel', () => {
    const waPage = {
        ...mockPage,
        userId: 'page-owner-1',
        whatsappPhoneNumberId: 'wa-phone-1',
        whatsappAccessToken: 'wa-token',
    };

    beforeEach(() => {
        vi.mocked(pagesService.getPageByWhatsAppPhoneNumberId).mockResolvedValue(waPage as never);
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue({ ...mockPage, userId: 'page-owner-1' } as never);
    });

    it('WhatsApp voice note is stored as a whatsapp row (pending, then transcribed)', async () => {
        mockWaGetMediaInfo.mockResolvedValue({ url: 'https://wa/media', mimeType: 'audio/ogg' });
        mockWaDownloadMedia.mockResolvedValue(Buffer.from('OggS'));
        vi.mocked(transcriptionService.transcribeFromBuffer).mockResolvedValue({ text: 'كم سعر الاشتراك' } as never);

        await handleWhatsAppNonTextMessage(
            'wa-phone-1',
            { senderId: '9677000', messageId: 'wa-aud-1', attachmentType: 'audio', mediaId: 'media-aud', senderName: 'أبو أحمد' },
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'wa-aud-1', '9677000', '[Image]', 'أبو أحمد', 'audio', 'whatsapp', 'pending',
        );
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'whatsapp_message', text: 'كم سعر الاشتراك' }));
    });

    it('WhatsApp sticker is stored as a whatsapp row', async () => {
        await handleWhatsAppNonTextMessage(
            'wa-phone-1',
            { senderId: '9677000', messageId: 'wa-stk-1', attachmentType: 'sticker' },
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'wa-stk-1', '9677000', '[Sticker]', undefined, 'sticker', 'whatsapp',
        );
    });

    it('Instagram voice note is stored as an instagram row, not facebook', async () => {
        vi.mocked(transcriptionService.transcribe).mockResolvedValue({ text: 'مرحبا' } as never);

        await handleNonTextMessage(
            'ig-account-id',
            { senderId: 'ig-user-1', messageId: 'ig-aud-1', attachmentType: 'audio', attachmentUrl: 'https://cdn.ig/voice.mp4' },
            'instagram',
            mockLogger,
        );

        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid-1', 'ws-uuid-1', 'ig-aud-1', 'ig-user-1', '[Image]', 'IG User', 'audio', 'instagram', 'pending',
        );
    });
});

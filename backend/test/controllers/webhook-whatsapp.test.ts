import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import fastify from 'fastify';
import webhookRoutes from '../../src/routes/webhook';

function generateSignature(payload: object): string {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'test_app_secret').update(body).digest('hex');
    return `sha256=${sig}`;
}

const {
    mockEnqueueMessage,
    mockGetPageByFacebookId,
    mockGetPageByInstagramId,
    mockGetPageByWhatsAppPhoneNumberId,
    mockFindOrCreateFromWebhook,
    mockMarkAsResolved,
    mockSetCreatedTime,
    mockTranscribeFromBuffer,
    mockWaGetMediaInfo,
    mockWaDownloadMedia,
    mockWaSendTextMessage,
    mockWaMarkAsRead,
} = vi.hoisted(() => ({
    mockEnqueueMessage: vi.fn().mockResolvedValue('mock-job-id'),
    mockGetPageByFacebookId: vi.fn().mockResolvedValue(null),
    mockGetPageByInstagramId: vi.fn().mockResolvedValue(null),
    mockGetPageByWhatsAppPhoneNumberId: vi.fn().mockResolvedValue(null),
    mockFindOrCreateFromWebhook: vi.fn().mockResolvedValue({ message: { id: 'msg-1' }, isNew: true }),
    mockMarkAsResolved: vi.fn().mockResolvedValue(undefined),
    mockSetCreatedTime: vi.fn().mockResolvedValue(undefined),
    mockTranscribeFromBuffer: vi.fn().mockResolvedValue(null),
    mockWaGetMediaInfo: vi.fn().mockResolvedValue({ url: 'https://lookaside.example/media', mimeType: 'audio/ogg; codecs=opus', fileSize: 1024 }),
    mockWaDownloadMedia: vi.fn().mockResolvedValue(Buffer.from('fake-audio')),
    mockWaSendTextMessage: vi.fn().mockResolvedValue('wamid.nudge'),
    mockWaMarkAsRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/replyQueue', () => ({
    enqueueComment: vi.fn().mockResolvedValue('mock-job-id'),
    enqueueMessage: mockEnqueueMessage,
    REPLY_QUEUE_NAME: 'reply-processing-queue',
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn().mockResolvedValue('OK'), quit: vi.fn() },
}));

vi.mock('../../src/config', () => ({
    config: {
        facebook: {
            webhookVerifyToken: 'test_verify_token',
            appSecret: 'test_app_secret',
            graphApiVersion: 'v18.0',
        },
        openai: { apiKey: '' },
        // These are webhook-routing tests, not image-understanding tests — keep
        // vision off so a caption-less image takes the placeholder + nudge path.
        imageUnderstanding: { enabled: false },
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByFacebookId: mockGetPageByFacebookId,
        getPageByInstagramId: mockGetPageByInstagramId,
        getPageByWhatsAppPhoneNumberId: mockGetPageByWhatsAppPhoneNumberId,
    },
    isPageDisconnected: vi.fn().mockReturnValue(false),
    invalidateWorkspaceStatsCache: vi.fn(),
}));

vi.mock('../../src/lib/eventBus', () => ({
    publishSSEEvent: vi.fn(),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: mockFindOrCreateFromWebhook,
        finalizeEnrichment: vi.fn().mockResolvedValue(true),
        storeOutgoingMessage: vi.fn().mockResolvedValue({}),
        getLastIncomingTextFromSender: vi.fn().mockResolvedValue(null),
        getSenderNameBySenderId: vi.fn().mockResolvedValue(null),
        markAsResolved: mockMarkAsResolved,
        setCreatedTime: mockSetCreatedTime,
    },
}));

vi.mock('../../src/services/whatsapp', () => ({
    whatsappService: {
        getMediaInfo: mockWaGetMediaInfo,
        downloadMedia: mockWaDownloadMedia,
        sendTextMessage: mockWaSendTextMessage,
        markAsRead: mockWaMarkAsRead,
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: { sendPrivateMessage: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: { sendDirectMessage: vi.fn().mockResolvedValue('msg-id') },
}));

vi.mock('../../src/services/transcription', () => ({
    transcriptionService: {
        transcribe: vi.fn().mockResolvedValue(null),
        transcribeFromBuffer: mockTranscribeFromBuffer,
    },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildWhatsAppPayload(overrides: {
    phoneNumberId?: string;
    from?: string;
    messageId?: string;
    type?: string;
    text?: string;
    contactName?: string;
    statuses?: object[];
    messages?: object[];
}) {
    const {
        phoneNumberId = 'phone-number-id-123',
        from = '+966500000000',
        messageId = 'wamid.abc123',
        type = 'text',
        text = 'مرحباً',
        contactName,
        statuses,
        messages,
    } = overrides;

    const value: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        metadata: {
            display_phone_number: '+966 55 000 0000',
            phone_number_id: phoneNumberId,
        },
    };

    if (messages !== undefined) {
        value.messages = messages;
    } else if (!statuses) {
        value.messages = [{ from, id: messageId, type, text: type === 'text' ? { body: text } : undefined, timestamp: '1700000000' }];
    }

    if (contactName) {
        value.contacts = [{ profile: { name: contactName }, wa_id: from }];
    }

    if (statuses) {
        value.statuses = statuses;
    }

    return {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-123', changes: [{ field: 'messages', value }] }],
    };
}

async function buildApp() {
    const app = fastify();
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req: any, body: Buffer, done: any) => {
        req.rawBody = body;
        try { done(null, JSON.parse(body.toString())); }
        catch (err) { done(err, undefined); }
    });
    app.register(webhookRoutes);
    await app.ready();
    return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WhatsApp Webhook — routing', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
    });

    it('returns 200 EVENT_RECEIVED for valid whatsapp_business_account webhook', async () => {
        const payload = buildWhatsAppPayload({});
        const response = await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('EVENT_RECEIVED');
    });

    it('enqueues whatsapp_message job for text message', async () => {
        const payload = buildWhatsAppPayload({ from: '+966500000000', messageId: 'wamid.abc', text: 'السلام عليكم' });

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        // Allow async processing
        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'whatsapp_message',
            pageId: 'phone-number-id-123',
            senderId: '+966500000000',
            messageId: 'wamid.abc',
            text: 'السلام عليكم',
        }));
    });

    it('passes sender name from contacts array to the job', async () => {
        const payload = buildWhatsAppPayload({ from: '+966500000000', contactName: 'أحمد محمد' });

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            senderName: 'أحمد محمد',
        }));
    });

    it('passes undefined senderName when contacts array is absent', async () => {
        const payload = buildWhatsAppPayload({ from: '+966500000000' });

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            senderName: undefined,
        }));
    });
});

// Shared across the receipt + media suites: a connected WhatsApp page fixture
// and a signed-webhook POST helper (50ms settle for the async fan-out).
const WA_TEST_PAGE = {
    id: 'page-uuid',
    userId: 'user-uuid',
    workspaceId: 'ws-uuid',
    name: 'Test Store',
    accessToken: 'fb-page-token',
    whatsappPhoneNumberId: 'phone-number-id-123',
    whatsappAccessToken: 'wa-business-token',
    whatsappAutoReplyEnabled: true,
};

async function postWebhook(app: Awaited<ReturnType<typeof buildApp>>, payload: object) {
    await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'x-hub-signature-256': generateSignature(payload) },
        payload,
    });
    await new Promise(r => setTimeout(r, 50));
}

describe('WhatsApp Webhook — read receipts + typing', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(WA_TEST_PAGE);
        mockFindOrCreateFromWebhook.mockResolvedValue({ message: { id: 'msg-1' }, isNew: true });
    });

    const post = (payload: object) => postWebhook(app, payload);

    it('text message: marks read WITH typing the moment it lands (blue ticks + "typing…")', async () => {
        await post(buildWhatsAppPayload({}));

        expect(mockWaMarkAsRead).toHaveBeenCalledWith(
            'phone-number-id-123', 'wamid.abc123', 'wa-business-token', { typing: true },
        );
        expect(mockEnqueueMessage).toHaveBeenCalled();
    });

    it('auto-reply OFF: no receipt (a "typing…" with no reply coming would lie)', async () => {
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue({ ...WA_TEST_PAGE, whatsappAutoReplyEnabled: false });

        await post(buildWhatsAppPayload({}));

        expect(mockWaMarkAsRead).not.toHaveBeenCalled();
        // The receipt gate must not affect routing — the job still enqueues
        // (the worker owns the real auto-reply decision).
        expect(mockEnqueueMessage).toHaveBeenCalled();
    });

    it('unknown phone number (no page): no receipt, message still enqueued', async () => {
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(null);

        await post(buildWhatsAppPayload({}));

        expect(mockWaMarkAsRead).not.toHaveBeenCalled();
        expect(mockEnqueueMessage).toHaveBeenCalled();
    });

    it('sticker: marks read WITHOUT typing (stickers are stored silently — no reply follows)', async () => {
        await post(buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.stk', type: 'sticker', timestamp: '1700000000', sticker: { id: 'media-3', mime_type: 'image/webp' } }],
        }));

        expect(mockWaMarkAsRead).toHaveBeenCalledWith(
            'phone-number-id-123', 'wamid.stk', 'wa-business-token', { typing: false },
        );
    });
});

describe('WhatsApp Webhook — media messages', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(WA_TEST_PAGE);
        mockFindOrCreateFromWebhook.mockResolvedValue({ message: { id: 'msg-1' }, isNew: true });
        mockWaGetMediaInfo.mockResolvedValue({ url: 'https://lookaside.example/media', mimeType: 'audio/ogg; codecs=opus', fileSize: 1024 });
        mockWaDownloadMedia.mockResolvedValue(Buffer.from('fake-audio'));
    });

    const post = (payload: object) => postWebhook(app, payload);

    it('voice note: downloads with the WABA token, transcribes, and enqueues the transcript', async () => {
        mockTranscribeFromBuffer.mockResolvedValue({ text: 'كم سعر الشنطة؟' });
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.voice', type: 'audio', timestamp: '1700000000', audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus', voice: true } }],
        });

        await post(payload);

        expect(mockWaGetMediaInfo).toHaveBeenCalledWith('media-1', 'wa-business-token');
        expect(mockWaDownloadMedia).toHaveBeenCalledWith('https://lookaside.example/media', 'wa-business-token');
        // Codec suffix stripped for Whisper
        expect(mockTranscribeFromBuffer).toHaveBeenCalledWith(
            expect.any(Buffer), 'audio/ogg', expect.any(String), undefined,
            { userId: 'user-uuid', pageId: 'page-uuid' },
        );
        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'whatsapp_message',
            pageId: 'phone-number-id-123',
            messageId: 'wamid.voice',
            text: 'كم سعر الشنطة؟',
        }));
        expect(mockWaSendTextMessage).not.toHaveBeenCalled();
    });

    it('voice note: falls back to nudge when transcription fails', async () => {
        mockTranscribeFromBuffer.mockResolvedValue(null);
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.voice', type: 'audio', timestamp: '1700000000', audio: { id: 'media-1', mime_type: 'audio/ogg' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        // Placeholder stored + nudge sent with the WABA token
        expect(mockFindOrCreateFromWebhook).toHaveBeenCalled();
        expect(mockWaSendTextMessage).toHaveBeenCalledWith(
            'phone-number-id-123', '+966500000000', expect.any(String), 'wa-business-token',
        );
    });

    it('image without caption: stores placeholder and sends text-only nudge', async () => {
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.img', type: 'image', timestamp: '1700000000', image: { id: 'media-2', mime_type: 'image/jpeg' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockFindOrCreateFromWebhook).toHaveBeenCalled();
        expect(mockWaSendTextMessage).toHaveBeenCalledWith(
            'phone-number-id-123', '+966500000000', expect.any(String), 'wa-business-token',
        );
    });

    it('image WITH caption: enqueues the caption as a marked text message', async () => {
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.img', type: 'image', timestamp: '1700000000', image: { id: 'media-2', mime_type: 'image/jpeg', caption: 'عندكم مثل هذي؟' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'whatsapp_message',
            text: '[Image] عندكم مثل هذي؟',
        }));
        expect(mockWaSendTextMessage).not.toHaveBeenCalled();
    });

    it('sticker: stores silently, no nudge, no enqueue', async () => {
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.stk', type: 'sticker', timestamp: '1700000000', sticker: { id: 'media-3', mime_type: 'image/webp' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockWaSendTextMessage).not.toHaveBeenCalled();
        expect(mockFindOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid', 'ws-uuid', 'wamid.stk', '+966500000000', '[Sticker]', undefined, 'sticker',
        );
        expect(mockMarkAsResolved).toHaveBeenCalled();
    });

    it('quick-reply button tap: enqueues the button text', async () => {
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.btn', type: 'button', timestamp: '1700000000', button: { text: 'نعم أريد الطلب' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            text: 'نعم أريد الطلب',
        }));
    });

    it('location message: skipped entirely (no enqueue, no nudge)', async () => {
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.loc', type: 'location', timestamp: '1700000000', location: { latitude: 24.7, longitude: 46.7 } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockWaSendTextMessage).not.toHaveBeenCalled();
    });

    it('media message for a page without a WhatsApp token: does nothing', async () => {
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue({ ...WA_TEST_PAGE, whatsappAccessToken: null });
        const payload = buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: 'wamid.img', type: 'image', timestamp: '1700000000', image: { id: 'media-2' } }],
        });

        await post(payload);

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
        expect(mockWaSendTextMessage).not.toHaveBeenCalled();
        expect(mockFindOrCreateFromWebhook).not.toHaveBeenCalled();
    });
});

describe('WhatsApp Webhook — status callbacks skipped', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
    });

    it('skips delivered status callback', async () => {
        const payload = buildWhatsAppPayload({
            statuses: [{ id: 'wamid.abc', status: 'delivered', timestamp: '1700000000', recipient_id: '+966500000000' }],
        });

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
    });

    it('skips read status callback', async () => {
        const payload = buildWhatsAppPayload({
            statuses: [{ id: 'wamid.abc', status: 'read', timestamp: '1700000000', recipient_id: '+966500000000' }],
        });

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
    });
});

describe('WhatsApp Webhook — field filter', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
    });

    it('ignores changes where field is not "messages"', async () => {
        const payload = {
            object: 'whatsapp_business_account',
            entry: [{
                id: 'waba-123',
                changes: [{ field: 'account_alerts', value: { some: 'alert' } }],
            }],
        };

        await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockEnqueueMessage).not.toHaveBeenCalled();
    });
});

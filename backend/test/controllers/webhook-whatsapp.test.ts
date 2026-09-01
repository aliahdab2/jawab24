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
    mockFindByPlatformMessageId,
    mockStoreOutgoingMessage,
    mockGetUnrepliedFromSender,
    mockMarkOlderMessagesAsReplied,
    mockGetInboundRecency,
    mockGetPagesByWaba,
    mockMarkWhatsAppNeedsReconnect,
    TX_SENTINEL,
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
    mockFindByPlatformMessageId: vi.fn().mockResolvedValue(null),
    mockStoreOutgoingMessage: vi.fn().mockResolvedValue({ id: 'out-1' }),
    mockGetUnrepliedFromSender: vi.fn().mockResolvedValue([]),
    mockMarkOlderMessagesAsReplied: vi.fn().mockResolvedValue(0),
    // Default = a HUMAN-looking echo (a minute after the inbound, inside an active
    // thread) so the pre-existing echo cases keep exercising the manual path.
    mockGetInboundRecency: vi.fn().mockResolvedValue({ lastAt: new Date(Date.now() - 60_000), priorInboundBeforeWindow: true }),
    mockGetPagesByWaba: vi.fn().mockResolvedValue([]),
    mockMarkWhatsAppNeedsReconnect: vi.fn().mockResolvedValue(undefined),
    TX_SENTINEL: { __tx: true },
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
        getPagesByWhatsAppBusinessAccountId: mockGetPagesByWaba,
    },
    isPageDisconnected: vi.fn().mockReturnValue(false),
    invalidateWorkspaceStatsCache: vi.fn(),
}));

// account_update (PARTNER_REMOVED) flags through the same path the token sweep
// uses. Mocked so these stay webhook-ROUTING tests: the flag/notify mechanics
// are whatsappTokenHealth's own concern.
vi.mock('../../src/services/whatsappTokenHealth', () => ({
    markWhatsAppNeedsReconnect: mockMarkWhatsAppNeedsReconnect,
}));

// The echo path writes the manual row and clears the backlog inside ONE
// transaction. The mock hands the callback a sentinel so tests can assert both
// writes received the SAME tx handle rather than the default connection.
vi.mock('../../src/db', () => ({
    db: {
        transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX_SENTINEL)),
    },
}));

vi.mock('../../src/lib/eventBus', () => ({
    publishSSEEvent: vi.fn(),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: mockFindOrCreateFromWebhook,
        finalizeEnrichment: vi.fn().mockResolvedValue(true),
        storeOutgoingMessage: mockStoreOutgoingMessage,
        getLastIncomingTextFromSender: vi.fn().mockResolvedValue(null),
        getSenderNameBySenderId: vi.fn().mockResolvedValue(null),
        markAsResolved: mockMarkAsResolved,
        setCreatedTime: mockSetCreatedTime,
        findByPlatformMessageId: mockFindByPlatformMessageId,
        getUnrepliedFromSender: mockGetUnrepliedFromSender,
        markOlderMessagesAsReplied: mockMarkOlderMessagesAsReplied,
        getInboundRecency: mockGetInboundRecency,
    },
}));

// The echo classifier re-reads the inbound row once after a short delay when it
// is missing. The tests pin the re-read itself (call count + verdict), not the
// length of the delay — that constant is pinned in whatsappEchoClassifier.test.ts.
vi.mock('../../src/services/whatsappEchoClassifier', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/services/whatsappEchoClassifier')>()),
    ECHO_RECENCY_RETRY_MS: 0,
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
    const res = await app.inject({
        method: 'POST',
        url: '/webhook',
        headers: { 'x-hub-signature-256': generateSignature(payload) },
        payload,
    });
    await new Promise(r => setTimeout(r, 50));
    // Returned so tests can assert Meta still gets its 200 — a webhook that
    // errors is retried and duplicates the message. Existing callers ignore it.
    return res;
}

describe('WhatsApp Webhook — read receipts + typing', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(WA_TEST_PAGE);
        mockFindOrCreateFromWebhook.mockResolvedValue({ message: { id: 'msg-1' }, isNew: true });
        // clearAllMocks() resets calls but NOT implementations, so the failure
        // cases below would leak into every later test in the file.
        mockWaMarkAsRead.mockResolvedValue({ delivered: true });
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

    // Non-sticker media DOES get a reply (voice notes are transcribed and
    // answered; other attachments get a text-only nudge), so "typing…" is
    // truthful there. Only the sticker case above may suppress it.
    it.each([
        ['voice note', 'audio', { id: 'media-1', mime_type: 'audio/ogg' }],
        ['image', 'image', { id: 'media-2', mime_type: 'image/jpeg' }],
    ])('%s: marks read WITH typing (a reply follows)', async (_label, type, media) => {
        await post(buildWhatsAppPayload({
            messages: [{ from: '+966500000000', id: `wamid.${type}`, type, timestamp: '1700000000', [type]: media }],
        }));

        expect(mockWaMarkAsRead).toHaveBeenCalledWith(
            'phone-number-id-123', `wamid.${type}`, 'wa-business-token', { typing: true },
        );
    });

    // A receipt is cosmetic: if Meta rejects it, the message must still be
    // enqueued and the request must still succeed. Regression for the founder's
    // 2026-07-27 report — previously a rejected receipt was swallowed with no
    // trace at all, so this path could not be observed in production.
    it('receipt rejected by Meta: never blocks the reply pipeline', async () => {
        mockWaMarkAsRead.mockResolvedValue({ delivered: false, reason: 'Rate limit hit' });

        const res = await post(buildWhatsAppPayload({}));

        expect(res.statusCode).toBe(200);
        expect(mockEnqueueMessage).toHaveBeenCalled();
    });

    it('receipt call itself throwing: still never blocks the reply pipeline', async () => {
        mockWaMarkAsRead.mockRejectedValue(new Error('unexpected'));

        const res = await post(buildWhatsAppPayload({}));

        expect(res.statusCode).toBe(200);
        expect(mockEnqueueMessage).toHaveBeenCalled();
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
        // Codec suffix stripped for Whisper; strictLanguage=true — a DM voice note,
        // so a wrong-script transcript is discarded rather than driving the reply.
        expect(mockTranscribeFromBuffer).toHaveBeenCalledWith(
            expect.any(Buffer), 'audio/ogg', expect.any(String), undefined,
            { userId: 'user-uuid', pageId: 'page-uuid' }, true,
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
            'page-uuid', 'ws-uuid', 'wamid.stk', '+966500000000', '[Sticker]', undefined, 'sticker', 'whatsapp',
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

/**
 * WhatsApp Coexistence — the merchant answers from their own phone.
 *
 * On a coexistence number the merchant keeps the WhatsApp Business app while we
 * also hold the number on Cloud API, so a human and the AI can answer the same
 * customer. Meta reports the human's messages via `smb_message_echoes`; turning
 * each into an `outgoing` + `replyMethod='manual'` row is the WHOLE integration —
 * the already-shipped handoff pause then stands the AI down with no new timing
 * code.
 *
 * Meta documents that echoes exclude Cloud API messages — but they DO include
 * the WhatsApp Business app's own greeting / away message, with no author flag.
 * `classifyEcho` (whatsappEchoClassifier.ts) decides human vs app from the
 * customer's inbound recency; the "app automation" block below covers that.
 * The self-mute test guards the other direction: mistaking one of our own
 * replies for a merchant reply would silence the AI after every message it sends.
 */
function buildEchoPayload(echoes: object[], phoneNumberId = 'phone-number-id-123') {
    return {
        object: 'whatsapp_business_account',
        entry: [{
            id: 'waba-123',
            changes: [{
                field: 'smb_message_echoes',
                value: {
                    messaging_product: 'whatsapp',
                    metadata: { display_phone_number: '+966 55 000 0000', phone_number_id: phoneNumberId },
                    message_echoes: echoes,
                },
            }],
        }],
    };
}

const ECHO = (id = 'wamid.echo1', body = 'أهلاً، بجاوبك حالاً') => ({
    from: '+966550000000', to: '+966500000000', id, timestamp: '1700000100',
    type: 'text', text: { body },
});

describe('WhatsApp Webhook — Coexistence echoes', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(WA_TEST_PAGE);
        mockFindByPlatformMessageId.mockResolvedValue(null);
        mockStoreOutgoingMessage.mockResolvedValue({ id: 'out-1' });
        mockGetUnrepliedFromSender.mockResolvedValue([]);
        mockMarkOlderMessagesAsReplied.mockResolvedValue(0);
        mockGetInboundRecency.mockResolvedValue({ lastAt: new Date(Date.now() - 60_000), priorInboundBeforeWindow: true });
    });

    const post = (payload: object) => postWebhook(app, payload);

    // The echo row must never be the FIRST row for a customer on the wrong
    // channel: without the platform hint storeOutgoingMessage created a
    // `facebook` conversation on a WhatsApp page (2 of the first 5 production
    // echoes, 2026-08-29).
    it('passes the whatsapp platform so a first-contact echo cannot create a facebook conversation', async () => {
        await post(buildEchoPayload([ECHO()]));
        expect(mockStoreOutgoingMessage.mock.calls[0][11]).toBe('whatsapp');
    });

    // Recording the merchant's reply and clearing the customer's backlog are ONE
    // fact ("a human answered this"). Split across two commits, a failure between
    // them leaves the reply stored while the customer's message still reads
    // unanswered — and the AI then answers a question a human already handled.
    it('writes the reply and clears the backlog in a SINGLE transaction', async () => {
        mockGetUnrepliedFromSender.mockResolvedValue([{ id: 'in-1' }]);

        await post(buildEchoPayload([ECHO()]));

        // Both writes must receive the same tx handle, not the default db.
        const storeTx = mockStoreOutgoingMessage.mock.calls[0][5];
        const clearTx = mockMarkOlderMessagesAsReplied.mock.calls[0][6];
        expect(storeTx).toBeDefined();
        expect(clearTx).toBe(storeTx);
    });

    it('stores a merchant phone reply as an outgoing MANUAL row (what pauses the AI)', async () => {
        await post(buildEchoPayload([ECHO()]));

        expect(mockStoreOutgoingMessage).toHaveBeenCalledTimes(1);
        const args = mockStoreOutgoingMessage.mock.calls[0];
        expect(args[0]).toBe('page-uuid');          // pageId
        expect(args[1]).toBe('ws-uuid');            // workspaceId
        expect(args[2]).toBe('+966500000000');      // the CUSTOMER (echo.to), not the business
        expect(args[3]).toBe('أهلاً، بجاوبك حالاً'); // the merchant's text
        expect(args[4]).toBe('manual');             // replyMethod — the pause keys on this
        expect(args[10]).toBe('wamid.echo1');       // platformMessageId = the real wamid
    });

    // The severe failure mode: if our own Cloud API reply were treated as a
    // merchant reply, the AI would mute itself after every message it sends.
    it('SELF-MUTE GUARD: ignores an echo whose wamid is already one of our messages', async () => {
        mockFindByPlatformMessageId.mockResolvedValue({ id: 'our-own-reply', direction: 'outgoing' });

        await post(buildEchoPayload([ECHO('wamid.ours')]));

        expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
        expect(mockMarkOlderMessagesAsReplied).not.toHaveBeenCalled();
    });

    // Meta redelivers on 5xx/timeout. Without the guard an echo inserts twice AND
    // re-extends the pause window each time.
    it('is idempotent: a redelivered echo is stored once', async () => {
        await post(buildEchoPayload([ECHO('wamid.dup')]));
        mockFindByPlatformMessageId.mockResolvedValue({ id: 'already-stored' });
        await post(buildEchoPayload([ECHO('wamid.dup')]));

        expect(mockStoreOutgoingMessage).toHaveBeenCalledTimes(1);
    });

    // storeOutgoingMessage is a pure INSERT and never touches the incoming row, so
    // without this the customer's question sits in "Needs Action" forever even
    // though the merchant answered it.
    it('clears the customer\'s pending backlog once the merchant has answered', async () => {
        mockGetUnrepliedFromSender.mockResolvedValue([{ id: 'in-1' }, { id: 'in-2' }]);

        await post(buildEchoPayload([ECHO()]));

        expect(mockMarkOlderMessagesAsReplied).toHaveBeenCalledTimes(1);
        const args = mockMarkOlderMessagesAsReplied.mock.calls[0];
        expect(args[2]).toEqual(['in-1', 'in-2']);
        expect(args[5]).toBe('manual');
    });

    it('does not call the backlog clear when nothing is pending', async () => {
        await post(buildEchoPayload([ECHO()]));
        expect(mockMarkOlderMessagesAsReplied).not.toHaveBeenCalled();
    });

    it('handles several echoes in one delivery', async () => {
        await post(buildEchoPayload([ECHO('wamid.a', 'first'), ECHO('wamid.b', 'second')]));
        expect(mockStoreOutgoingMessage).toHaveBeenCalledTimes(2);
    });

    // Media echoes carry only a caption, or nothing. The wording is irrelevant to
    // the pause — what matters is that a human answered — so a placeholder is
    // enough to create the row.
    it.each([
        ['image with caption', { type: 'image', image: { caption: 'شوف الصورة' } }, 'شوف الصورة'],
        ['image with no caption', { type: 'image', image: {} }, '[image]'],
        ['document', { type: 'document', document: { filename: 'a.pdf' } }, '[document]'],
    ])('%s echo still creates the manual row', async (_label, extra, expectedText) => {
        await post(buildEchoPayload([{
            from: '+966550000000', to: '+966500000000', id: 'wamid.media',
            timestamp: '1700000100', ...extra,
        }]));

        expect(mockStoreOutgoingMessage).toHaveBeenCalledTimes(1);
        expect(mockStoreOutgoingMessage.mock.calls[0][3]).toBe(expectedText);
    });

    // Echoes never reach the reply worker — where every other path emits its SSE —
    // so without an explicit emit the merchant's own phone reply only shows up on
    // a page refresh, and the Needs-Action count we just cleared stays stale.
    it('notifies the live inbox and invalidates the stats cache', async () => {
        const { publishSSEEvent } = await import('../../src/lib/eventBus');
        const { invalidateWorkspaceStatsCache } = await import('../../src/services/pages');

        await post(buildEchoPayload([ECHO()]));

        expect(publishSSEEvent).toHaveBeenCalledWith('user-uuid', 'message:received',
            expect.objectContaining({
                pageId: 'page-uuid',
                senderId: '+966500000000',
                message: expect.objectContaining({ direction: 'outgoing', replyMethod: 'manual' }),
            }));
        expect(invalidateWorkspaceStatsCache).toHaveBeenCalledWith('ws-uuid');
    });

    it('drops an echo for an unknown phone number without failing the webhook', async () => {
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue(null);

        const res = await post(buildEchoPayload([ECHO()]));

        expect(res.statusCode).toBe(200);
        expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
    });

    // Cross-tenant safety: a page with no workspace cannot be written to without
    // guessing where the conversation belongs.
    it('drops an echo when the page has no workspace', async () => {
        mockGetPageByWhatsAppPhoneNumberId.mockResolvedValue({ ...WA_TEST_PAGE, workspaceId: null });

        await post(buildEchoPayload([ECHO()]));

        expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
    });

    // v1 decision: subscribe (Meta requires it for onboarding to be valid) but
    // persist nothing — 180 days and potentially thousands of messages must not
    // land in the merchant's inbox.
    it.each(['history', 'smb_app_state_sync'])('accepts and DISCARDS the %s sync webhook', async (field) => {
        const res = await post({
            object: 'whatsapp_business_account',
            entry: [{ id: 'waba-123', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '+1', phone_number_id: 'phone-number-id-123' } } }] }],
        });

        expect(res.statusCode).toBe(200);
        expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
        expect(mockEnqueueMessage).not.toHaveBeenCalled();
    });

    // Migrated (non-coexistence) numbers never emit echoes — existing merchants
    // must see zero behaviour change.
    it('a normal customer message is unaffected by the new branches', async () => {
        await post(buildWhatsAppPayload({}));

        expect(mockEnqueueMessage).toHaveBeenCalled();
        expect(mockStoreOutgoingMessage).not.toHaveBeenCalled();
    });

    /**
     * The WhatsApp Business app's own greeting is echoed like a typed reply. Read
     * as a handoff it silenced the AI for the whole pause window in EVERY
     * conversation of the first real coexistence merchant (D-109). The rule:
     * fast (≤10 s after the inbound) + the thread was idle ⇒ the app.
     */
    describe('app automation (greeting / away message) echoes', () => {
        const GREETING = () => ECHO('wamid.greeting', 'شكرا لك على تواصلك مع Z net. من فضلك أخبرنا كيف يمكننا خدمتك.');
        const openerSecondsAgo = () => ({ lastAt: new Date(Date.now() - 4_000), priorInboundBeforeWindow: false });

        it('stores the app greeting as app_auto — the pause keys on manual, so the AI keeps answering', async () => {
            mockGetInboundRecency.mockResolvedValue(openerSecondsAgo());

            await post(buildEchoPayload([GREETING()]));

            expect(mockStoreOutgoingMessage).toHaveBeenCalledTimes(1);
            expect(mockStoreOutgoingMessage.mock.calls[0][4]).toBe('app_auto');
            expect(mockStoreOutgoingMessage.mock.calls[0][10]).toBe('wamid.greeting');
        });

        // A greeting answers nothing. Marking the customer's question "replied"
        // would make the reply worker skip it — silence by another route.
        it('leaves the customer\'s pending backlog untouched for an app_auto echo', async () => {
            mockGetInboundRecency.mockResolvedValue(openerSecondsAgo());
            mockGetUnrepliedFromSender.mockResolvedValue([{ id: 'in-1' }]);

            await post(buildEchoPayload([GREETING()]));

            expect(mockMarkOlderMessagesAsReplied).not.toHaveBeenCalled();
        });

        it('tells the live inbox it was the app, not the merchant', async () => {
            const { publishSSEEvent } = await import('../../src/lib/eventBus');
            mockGetInboundRecency.mockResolvedValue(openerSecondsAgo());

            await post(buildEchoPayload([GREETING()]));

            expect(publishSSEEvent).toHaveBeenCalledWith('user-uuid', 'message:received',
                expect.objectContaining({ message: expect.objectContaining({ replyMethod: 'app_auto' }) }));
        });

        // The failure the classifier must never produce: the merchant is mid-chat
        // on the phone and answers within seconds — that is a human, and the AI
        // must stand down.
        it('a fast reply inside an ACTIVE thread is still a manual handoff', async () => {
            mockGetInboundRecency.mockResolvedValue({ lastAt: new Date(Date.now() - 2_000), priorInboundBeforeWindow: true });
            mockGetUnrepliedFromSender.mockResolvedValue([{ id: 'in-1' }]);

            await post(buildEchoPayload([ECHO()]));

            expect(mockStoreOutgoingMessage.mock.calls[0][4]).toBe('manual');
            expect(mockMarkOlderMessagesAsReplied).toHaveBeenCalledTimes(1);
        });

        it('a slow reply to an opener is a manual handoff', async () => {
            mockGetInboundRecency.mockResolvedValue({ lastAt: new Date(Date.now() - 45_000), priorInboundBeforeWindow: false });

            await post(buildEchoPayload([ECHO()]));

            expect(mockStoreOutgoingMessage.mock.calls[0][4]).toBe('manual');
        });

        // The inbound row is written by the reply worker, so under queue lag the
        // echo can land first. One re-read after a short delay covers that; the
        // row appearing on the second read is the greeting case.
        it('re-reads once when no inbound row exists yet, and classifies on the second read', async () => {
            mockGetInboundRecency
                .mockResolvedValueOnce({ lastAt: null, priorInboundBeforeWindow: false })
                .mockResolvedValueOnce({ lastAt: new Date(Date.now() - 500), priorInboundBeforeWindow: false });

            await post(buildEchoPayload([GREETING()]));

            expect(mockGetInboundRecency).toHaveBeenCalledTimes(2);
            expect(mockStoreOutgoingMessage.mock.calls[0][4]).toBe('app_auto');
        });

        it('with no inbound row even after the re-read, stays on the safe side: manual', async () => {
            mockGetInboundRecency.mockResolvedValue({ lastAt: null, priorInboundBeforeWindow: false });

            await post(buildEchoPayload([ECHO()]));

            expect(mockGetInboundRecency).toHaveBeenCalledTimes(2);
            expect(mockStoreOutgoingMessage.mock.calls[0][4]).toBe('manual');
        });

        // One read is enough when the row is there — no delay on the common path.
        it('does not re-read when the inbound row already exists', async () => {
            mockGetInboundRecency.mockResolvedValue(openerSecondsAgo());

            await post(buildEchoPayload([GREETING()]));

            expect(mockGetInboundRecency).toHaveBeenCalledTimes(1);
        });
    });
});

describe('WhatsApp Webhook — account_update (severed WABA link)', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
    });

    const accountUpdatePayload = (event: string, wabaId = 'waba-123') => ({
        object: 'whatsapp_business_account',
        entry: [{
            id: wabaId,
            changes: [{
                field: 'account_update',
                value: {
                    event,
                    phone_number: '+967 785 575 899',
                    disconnection_info: { reason: 'ACCOUNT_DISCONNECTED', initiated_by: 'USER' },
                },
            }],
        }],
    });

    const post = async (payload: object) => {
        const response = await app.inject({
            method: 'POST',
            url: '/webhook',
            headers: { 'x-hub-signature-256': generateSignature(payload) },
            payload,
        });
        // Processing is fire-and-forget after the 200 — give the async loop a tick.
        await new Promise(r => setTimeout(r, 50));
        return response;
    };

    it('PARTNER_REMOVED flags every page under the WABA for reconnect', async () => {
        // Meta stops delivering message webhooks from the instant the merchant
        // unlinks, while the stored token stays valid — this event is the ONLY
        // push signal we get (Z net went dark for 27h without it, 2026-08-31).
        mockGetPagesByWaba.mockResolvedValueOnce([
            { id: 'page-1', name: 'Z net', userId: 'user-1', whatsappDisplayPhoneNumber: '+967 785 575 899' },
            { id: 'page-2', name: 'Second number', userId: 'user-1', whatsappDisplayPhoneNumber: '+967 700 000 000' },
        ]);

        const response = await post(accountUpdatePayload('PARTNER_REMOVED'));

        expect(response.statusCode).toBe(200);
        expect(mockGetPagesByWaba).toHaveBeenCalledWith('waba-123');
        expect(mockMarkWhatsAppNeedsReconnect).toHaveBeenCalledTimes(2);
        expect(mockMarkWhatsAppNeedsReconnect).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'page-1', whatsappDisplayPhoneNumber: '+967 785 575 899' }),
            'app_uninstalled',
        );
        expect(mockMarkWhatsAppNeedsReconnect).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'page-2' }),
            'app_uninstalled',
        );
    });

    it('any other account_update event is logged but never flags', async () => {
        // Flagging is merchant-visible (banner + push); only the documented
        // disconnect event may trigger it.
        mockGetPagesByWaba.mockResolvedValue([
            { id: 'page-1', name: 'Z net', userId: 'user-1', whatsappDisplayPhoneNumber: '+967 785 575 899' },
        ]);

        for (const event of ['VERIFIED_ACCOUNT', 'DISABLED_UPDATE', 'ACCOUNT_RESTRICTION', 'PARTNER_ADDED']) {
            await post(accountUpdatePayload(event));
        }

        expect(mockMarkWhatsAppNeedsReconnect).not.toHaveBeenCalled();
    });

    it('PARTNER_REMOVED for a WABA we do not know stays a no-op 200', async () => {
        mockGetPagesByWaba.mockResolvedValueOnce([]);

        const response = await post(accountUpdatePayload('PARTNER_REMOVED', 'waba-unknown'));

        expect(response.statusCode).toBe(200);
        expect(mockMarkWhatsAppNeedsReconnect).not.toHaveBeenCalled();
    });

    it('a flagging failure never aborts the rest of the delivery', async () => {
        // Same containment contract as echoes: a later change in the same
        // delivery can be a real customer message and must still be enqueued.
        mockGetPagesByWaba.mockRejectedValueOnce(new Error('db down'));

        const payload = {
            object: 'whatsapp_business_account',
            entry: [{
                id: 'waba-123',
                changes: [
                    { field: 'account_update', value: { event: 'PARTNER_REMOVED' } },
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: { display_phone_number: '+967 785 575 899', phone_number_id: 'phone-number-id-123' },
                            messages: [{ from: '+967700000001', id: 'wamid.after-failure', type: 'text', text: { body: 'مرحبا' }, timestamp: '1700000000' }],
                        },
                    },
                ],
            }],
        };

        const response = await post(payload);

        expect(response.statusCode).toBe(200);
        expect(mockEnqueueMessage).toHaveBeenCalledWith(
            expect.objectContaining({ jobType: 'whatsapp_message', messageId: 'wamid.after-failure' }),
        );
    });
});

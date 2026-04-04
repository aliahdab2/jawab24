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
} = vi.hoisted(() => ({
    mockEnqueueMessage: vi.fn().mockResolvedValue('mock-job-id'),
    mockGetPageByFacebookId: vi.fn().mockResolvedValue(null),
    mockGetPageByInstagramId: vi.fn().mockResolvedValue(null),
    mockGetPageByWhatsAppPhoneNumberId: vi.fn().mockResolvedValue(null),
    mockFindOrCreateFromWebhook: vi.fn().mockResolvedValue({ message: { id: 'msg-1' }, isNew: true }),
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
    },
}));

vi.mock('../../src/services/pages', () => ({
    pagesService: {
        getPageByFacebookId: mockGetPageByFacebookId,
        getPageByInstagramId: mockGetPageByInstagramId,
        getPageByWhatsAppPhoneNumberId: mockGetPageByWhatsAppPhoneNumberId,
    },
    isPageDisconnected: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: mockFindOrCreateFromWebhook,
        storeOutgoingMessage: vi.fn().mockResolvedValue({}),
        getLastIncomingTextFromSender: vi.fn().mockResolvedValue(null),
        getSenderNameBySenderId: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock('../../src/services/facebook', () => ({
    facebookService: { sendPrivateMessage: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/services/instagram', () => ({
    instagramService: { sendDirectMessage: vi.fn().mockResolvedValue('msg-id') },
}));

vi.mock('../../src/services/transcription', () => ({
    transcriptionService: { transcribe: vi.fn().mockResolvedValue(null) },
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

describe('WhatsApp Webhook — non-text messages skipped', () => {
    let app: Awaited<ReturnType<typeof buildApp>>;

    beforeEach(async () => {
        app = await buildApp();
        vi.clearAllMocks();
    });

    it.each(['image', 'audio', 'video', 'document', 'sticker', 'location'])(
        'skips %s message without enqueueing',
        async (type) => {
            const payload = buildWhatsAppPayload({ type });

            await app.inject({
                method: 'POST',
                url: '/webhook',
                headers: { 'x-hub-signature-256': generateSignature(payload) },
                payload,
            });

            await new Promise(r => setTimeout(r, 50));

            expect(mockEnqueueMessage).not.toHaveBeenCalled();
        },
    );
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

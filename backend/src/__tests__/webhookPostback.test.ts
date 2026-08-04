/**
 * Postback → pipeline conversion (controllers/webhook.ts#processPostback).
 *
 * Ice-breaker taps arrive as `postback` webhook events, NOT text messages. If we
 * set ice breakers without handling the postback, tapping one produces SILENCE.
 * These tests pin the conversion: a known `ib:<n>` payload feeds the question
 * text into the SAME processMessage path a typed message uses (store + enqueue),
 * the pre-existing Read-more payload keeps its own flow, and unknown payloads
 * are ignored without side effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildReadMorePayload, buildIceBreakerPayload } from '@jawab24/shared';

vi.mock('../config', () => ({
    config: {
        facebook: { appSecret: 'test-secret', webhookVerifyToken: 'test-verify', graphApiVersion: 'v23.0' },
        logLevel: 'info',
    },
}));
vi.mock('../services/pages', () => ({
    pagesService: { getPageByFacebookId: vi.fn(), getPageByInstagramId: vi.fn() },
    isPageDisconnected: vi.fn(() => false),
    invalidateWorkspaceStatsCache: vi.fn(),
}));
vi.mock('../services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn(),
        setCreatedTime: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../lib/replyQueue', () => ({
    enqueueMessage: vi.fn().mockResolvedValue('job-1'),
    enqueueComment: vi.fn().mockResolvedValue('job-1'),
}));
vi.mock('../lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../services/posts', () => ({ postsService: { getPost: vi.fn() } }));
vi.mock('../services/facebook', () => ({
    facebookService: {
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendPrivateMessage: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../services/reply/typingIndicator', () => ({
    showOnce: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/redisMutex', () => ({ acquireMutex: vi.fn().mockResolvedValue({ release: vi.fn() }) }));
vi.mock('../services/auth', () => ({ authService: {} }));
vi.mock('../services/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('../services/gdprCustomerDeletion', () => ({ purgeCustomerData: vi.fn() }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));
vi.mock('../services/reply/nonTextHandler', () => ({
    handleNonTextMessage: vi.fn(),
    handleWhatsAppNonTextMessage: vi.fn(),
}));
vi.mock('../services/whatsapp', () => ({ whatsappService: {} }));
vi.mock('../lib/redis', () => ({
    redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') },
}));

import { WebhookController } from '../controllers/webhook';
import { messagesService } from '../services/messages';
import { enqueueMessage } from '../lib/replyQueue';
import { postsService } from '../services/posts';
import { facebookService } from '../services/facebook';
import { acquireMutex } from '../lib/redisMutex';

const FB_PAGE_ID = 'fb-page-1';

function makePage(overrides: Record<string, unknown> = {}) {
    return {
        id: 'page-uuid',
        workspaceId: 'ws-uuid',
        facebookPageId: FB_PAGE_ID,
        name: 'Test Page',
        accessToken: 'PAGE_TOKEN',
        autoReplyEnabled: true,
        messengerProfile: {
            config: {
                enabled: true,
                greeting: { ar: 'أهلًا' },
                iceBreakers: ['ما الأسعار؟', 'كيف أطلب؟', 'ما مواعيد العمل؟'],
            },
            lastSyncedAt: null,
            lastError: null,
        },
        ...overrides,
    };
}

type PostbackCaller = {
    processPostback(pageId: string, page: unknown, event: unknown): Promise<void>;
};

function controller(): PostbackCaller {
    return new WebhookController() as unknown as PostbackCaller;
}

beforeEach(() => {
    vi.clearAllMocks();
    (messagesService.findOrCreateFromWebhook as ReturnType<typeof vi.fn>).mockResolvedValue({
        message: { id: 'msg-uuid' },
        isNew: true,
    });
    (acquireMutex as ReturnType<typeof vi.fn>).mockResolvedValue({ release: vi.fn() });
});

describe('ice-breaker postback → message pipeline', () => {
    it('feeds the STORED question into the normal pipeline (store + enqueue), payload index authoritative', async () => {
        const page = makePage();
        await controller().processPostback(FB_PAGE_ID, page, {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { title: 'stale echoed title', payload: buildIceBreakerPayload(1) },
        });

        // Stored config wins over the Meta-echoed title
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid', 'ws-uuid', 'ib_psid-1_1722700000000_1', 'psid-1', 'كيف أطلب؟',
        );
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
            jobType: 'facebook_message',
            pageId: FB_PAGE_ID,
            messageId: 'ib_psid-1_1722700000000_1',
            senderId: 'psid-1',
            text: 'كيف أطلب؟',
        }));
    });

    it('falls back to the postback title when no config is stored', async () => {
        const page = makePage({ messengerProfile: null });
        await controller().processPostback(FB_PAGE_ID, page, {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { title: 'ما الأسعار؟', payload: buildIceBreakerPayload(0) },
        });
        expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'ما الأسعار؟' }));
    });

    it('prefers the real postback mid as the platform message id when Meta provides one', async () => {
        await controller().processPostback(FB_PAGE_ID, makePage(), {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { payload: buildIceBreakerPayload(0), mid: 'm.real-mid' },
        });
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            'page-uuid', 'ws-uuid', 'm.real-mid', 'psid-1', 'ما الأسعار؟',
        );
    });

    it('synthesizes a STABLE id across Meta redeliveries (same event → same id, dedupe downstream)', async () => {
        const event = {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { payload: buildIceBreakerPayload(2) },
        };
        await controller().processPostback(FB_PAGE_ID, makePage(), event);
        await controller().processPostback(FB_PAGE_ID, makePage(), event);
        const ids = (messagesService.findOrCreateFromWebhook as ReturnType<typeof vi.fn>).mock.calls.map(c => c[2]);
        expect(ids[0]).toBe(ids[1]);
    });

    it('ignores a tap whose question cannot be resolved (no config entry, no title)', async () => {
        const page = makePage({ messengerProfile: null });
        await controller().processPostback(FB_PAGE_ID, page, {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { payload: buildIceBreakerPayload(3) },
        });
        expect(messagesService.findOrCreateFromWebhook).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
    });
});

describe('unknown postback payloads', () => {
    it.each([
        ['foreign payload', 'SOME_OTHER_BOT_PAYLOAD'],
        ['out-of-range ice-breaker index', 'ib:9'],
        ['missing payload', undefined],
    ])('safely ignores %s — no store, no enqueue, no DM', async (_label, payload) => {
        await expect(controller().processPostback(FB_PAGE_ID, makePage(), {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { title: 'Some button', payload },
        })).resolves.toBeUndefined();

        expect(messagesService.findOrCreateFromWebhook).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
        expect(facebookService.sendPrivateMessage).not.toHaveBeenCalled();
    });
});

describe('Read-more postback keeps its pre-existing flow', () => {
    it('routes pr_more payloads to the Post Reply delivery, not the message pipeline', async () => {
        (postsService.getPost as ReturnType<typeof vi.fn>).mockResolvedValue({ triggerReply: 'النص الكامل' });

        await controller().processPostback(FB_PAGE_ID, makePage(), {
            sender: { id: 'psid-1' },
            timestamp: 1722700000000,
            postback: { payload: buildReadMorePayload('facebook', 'post-9'), mid: 'm.tap' },
        });

        expect(postsService.getPost).toHaveBeenCalledWith('post-9', 'ws-uuid');
        expect(facebookService.sendPrivateMessage).toHaveBeenCalledWith('PAGE_TOKEN', 'psid-1', 'النص الكامل');
        // Read-more is a delivery receipt, not a question — it must NOT enter the reply pipeline
        expect(messagesService.findOrCreateFromWebhook).not.toHaveBeenCalled();
        expect(enqueueMessage).not.toHaveBeenCalled();
    });
});

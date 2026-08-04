/**
 * Meta ad referral attribution — webhook parsing + wiring.
 *
 * Covers the three documented referral shapes (payloads built from the
 * Messenger Platform webhook reference, verified 2026-08-04):
 *   1. standalone `messaging_referrals` event (entry[].messaging[].referral)
 *   2. postback.referral (Get Started tap from an ad)
 *   3. message.referral (first message from a Click-to-Messenger ad)
 *
 * And the robustness contract: malformed referrals are skipped silently and
 * NEVER break message processing (Rule: webhook must keep flowing).
 *
 * First-touch precedence + lead copy live in the integration suite
 * (test/integration/referralAttribution.test.ts) — they are DB semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/pages', () => ({
    pagesService: {
        getPageByFacebookId: vi.fn(),
        getPageByInstagramId: vi.fn(),
        getPageByWhatsAppPhoneNumberId: vi.fn(),
    },
    isPageDisconnected: vi.fn((page: { accessToken: string } | null) => !!page && page.accessToken === ''),
    invalidateWorkspaceStatsCache: vi.fn(),
}));

vi.mock('../services/messages', () => ({
    messagesService: {
        findOrCreateFromWebhook: vi.fn().mockResolvedValue({ message: { id: 'msg-internal-1' }, isNew: true }),
        setCreatedTime: vi.fn().mockResolvedValue(undefined),
        findByPlatformMessageId: vi.fn(),
        storeOutgoingMessage: vi.fn(),
        getUnrepliedFromSender: vi.fn(),
        markOlderMessagesAsReplied: vi.fn(),
    },
}));

vi.mock('../services/conversations', () => ({
    conversationsService: {
        recordReferral: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('../lib/replyQueue', () => ({
    enqueueMessage: vi.fn().mockResolvedValue('job-1'),
    enqueueComment: vi.fn().mockResolvedValue('job-2'),
}));

vi.mock('../services/reply/typingIndicator', () => ({
    showOnce: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/facebook', () => ({
    facebookService: {
        sendTypingIndicator: vi.fn(),
        sendPrivateMessage: vi.fn(),
    },
}));

vi.mock('../services/posts', () => ({ postsService: { getPost: vi.fn() } }));
vi.mock('../lib/redisMutex', () => ({ acquireMutex: vi.fn().mockResolvedValue(true) }));
vi.mock('../services/auth', () => ({ authService: { deleteUser: vi.fn() } }));
vi.mock('../services/auditLog', () => ({ auditLog: vi.fn() }));
vi.mock('../services/gdprCustomerDeletion', () => ({ purgeCustomerData: vi.fn() }));
vi.mock('../services/reply/nonTextHandler', () => ({
    handleNonTextMessage: vi.fn(),
    handleWhatsAppNonTextMessage: vi.fn(),
}));
vi.mock('../services/whatsapp', () => ({ whatsappService: { markAsRead: vi.fn() } }));
vi.mock('../lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../lib/redis', () => ({ redis: { incr: vi.fn().mockResolvedValue(1) } }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { webhookController } from '../controllers/webhook';
import { conversationsService } from '../services/conversations';
import { pagesService } from '../services/pages';
import { messagesService } from '../services/messages';
import { enqueueMessage } from '../lib/replyQueue';
import { normalizeReferral, extractEventReferral } from '../utils/metaReferral';

// Private-method access: processWebhookAsync is the async entry the controller
// hands its entries to after the fast 200 — driving it directly keeps the test
// off the HTTP/signature layer, which has its own coverage concerns.
const controller = webhookController as unknown as {
    processWebhookAsync(entries: unknown[]): Promise<void>;
    processInstagramWebhookAsync(entries: unknown[]): Promise<void>;
};

const PAGE = {
    id: 'page-uuid-1',
    workspaceId: 'ws-uuid-1',
    userId: 'user-uuid-1',
    name: 'Test Page',
    accessToken: 'token',
    autoReplyEnabled: false,
};

/** Referral object exactly as Meta documents it for ads. */
const AD_REFERRAL = {
    ref: 'summer_sale',
    ad_id: '6045246247433',
    source: 'ADS',
    type: 'OPEN_THREAD',
    ads_context_data: {
        ad_title: 'عرض الصيف — اطلب الآن',
        photo_url: 'https://scontent.example/ad-photo.jpg',
        post_id: '123_456',
    },
};

function fbEntry(messaging: unknown[]): unknown {
    return { id: 'fb-page-123', time: 1720000000000, messaging };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pagesService.getPageByFacebookId).mockResolvedValue(PAGE as never);
    vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(PAGE as never);
    vi.mocked(messagesService.findOrCreateFromWebhook).mockResolvedValue(
        { message: { id: 'msg-internal-1' }, isNew: true } as never,
    );
    vi.mocked(conversationsService.recordReferral).mockResolvedValue(true);
});

describe('normalizeReferral (pure parsing)', () => {
    it('parses the full ads referral object', () => {
        expect(normalizeReferral(AD_REFERRAL)).toEqual({
            source: 'ADS',
            ref: 'summer_sale',
            adId: '6045246247433',
            hasAdContext: true,
        });
    });

    it('parses an m.me shortlink referral (no ad fields)', () => {
        expect(normalizeReferral({ ref: 'flyer_qr', source: 'SHORTLINK', type: 'OPEN_THREAD' })).toEqual({
            source: 'SHORTLINK',
            ref: 'flyer_qr',
            adId: null,
            hasAdContext: false,
        });
    });

    it('tolerates a numeric ad_id (still a valid attribution key)', () => {
        expect(normalizeReferral({ source: 'ADS', ad_id: 6045246247433 })?.adId).toBe('6045246247433');
    });

    it.each([
        ['non-object', 'ADS'],
        ['null', null],
        ['array', [{ source: 'ADS' }]],
        ['empty object', {}],
        ['wrong field types', { source: 123, ref: {}, ad_id: false }],
        ['whitespace-only fields', { source: '  ', ref: '', ad_id: ' ' }],
    ])('returns null for a malformed referral (%s) instead of throwing', (_label, raw) => {
        expect(normalizeReferral(raw)).toBeNull();
    });

    it('handles a malformed ads_context_data without throwing', () => {
        expect(normalizeReferral({ source: 'ADS', ads_context_data: 'garbage' })).toEqual({
            source: 'ADS', ref: null, adId: null, hasAdContext: false,
        });
    });
});

describe('extractEventReferral (three shapes)', () => {
    it('shape 1 — standalone messaging_referrals event', () => {
        expect(extractEventReferral({ referral: AD_REFERRAL })?.adId).toBe('6045246247433');
    });
    it('shape 2 — postback.referral', () => {
        expect(extractEventReferral({ postback: { referral: AD_REFERRAL } })?.adId).toBe('6045246247433');
    });
    it('shape 3 — message.referral', () => {
        expect(extractEventReferral({ message: { referral: AD_REFERRAL } })?.adId).toBe('6045246247433');
    });
    it('returns null when no location carries a referral', () => {
        expect(extractEventReferral({ message: { referral: undefined }, postback: {} })).toBeNull();
    });
});

describe('webhook wiring — Facebook', () => {
    it('shape 1: standalone messaging_referrals event records attribution (thread already exists — no message to process)', async () => {
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-1' },
            recipient: { id: 'fb-page-123' },
            timestamp: 1719990000000,
            referral: AD_REFERRAL,
        }])]);

        expect(conversationsService.recordReferral).toHaveBeenCalledTimes(1);
        expect(conversationsService.recordReferral).toHaveBeenCalledWith(
            PAGE.id, 'psid-1', 'facebook',
            { source: 'ADS', ref: 'summer_sale', adId: '6045246247433', at: new Date(1719990000000) },
        );
        expect(enqueueMessage).not.toHaveBeenCalled();
    });

    it('shape 2: postback.referral (Get Started tap from an ad) records attribution', async () => {
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-2' },
            timestamp: 1719990000001,
            postback: { title: 'Get Started', payload: 'GET_STARTED', referral: AD_REFERRAL },
        }])]);

        expect(conversationsService.recordReferral).toHaveBeenCalledWith(
            PAGE.id, 'psid-2', 'facebook',
            expect.objectContaining({ source: 'ADS', adId: '6045246247433' }),
        );
    });

    it('shape 3: message.referral (first message from a Click-to-Messenger ad) records attribution AND still processes the message', async () => {
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-3' },
            timestamp: 1719990000002,
            message: { mid: 'mid-3', text: 'بكم السعر؟', referral: AD_REFERRAL },
        }])]);

        expect(conversationsService.recordReferral).toHaveBeenCalledWith(
            PAGE.id, 'psid-3', 'facebook',
            expect.objectContaining({ adId: '6045246247433' }),
        );
        // Message processing is untouched: stored + enqueued as always.
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalledWith(
            PAGE.id, PAGE.workspaceId, 'mid-3', 'psid-3', 'بكم السعر؟',
        );
        expect(enqueueMessage).toHaveBeenCalledTimes(1);
    });

    it('a plain message without referral records nothing and processes normally', async () => {
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-4' },
            timestamp: 1719990000003,
            message: { mid: 'mid-4', text: 'مرحبا' },
        }])]);

        expect(conversationsService.recordReferral).not.toHaveBeenCalled();
        expect(enqueueMessage).toHaveBeenCalledTimes(1);
    });

    it('MALFORMED referral is skipped silently — the message still flows', async () => {
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-5' },
            timestamp: 1719990000004,
            message: { mid: 'mid-5', text: 'هل يوجد توصيل؟', referral: { source: 42, ads_context_data: [] } },
        }])]);

        expect(conversationsService.recordReferral).not.toHaveBeenCalled();
        expect(enqueueMessage).toHaveBeenCalledTimes(1);
    });

    it('a recordReferral FAILURE never breaks message processing', async () => {
        vi.mocked(conversationsService.recordReferral).mockRejectedValue(new Error('db down'));

        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-6' },
            timestamp: 1719990000005,
            message: { mid: 'mid-6', text: 'رسالة من إعلان', referral: AD_REFERRAL },
        }])]);

        expect(enqueueMessage).toHaveBeenCalledTimes(1);
        expect(messagesService.findOrCreateFromWebhook).toHaveBeenCalled();
    });

    it('falls back to receipt time when the event carries no usable timestamp', async () => {
        const before = Date.now();
        await controller.processWebhookAsync([fbEntry([{
            sender: { id: 'psid-7' },
            referral: AD_REFERRAL,
        }])]);
        const after = Date.now();

        const call = vi.mocked(conversationsService.recordReferral).mock.calls[0];
        const at = (call[3] as { at: Date }).at;
        expect(at.getTime()).toBeGreaterThanOrEqual(before);
        expect(at.getTime()).toBeLessThanOrEqual(after);
    });
});

describe('webhook wiring — Instagram', () => {
    it('records attribution with platform=instagram for an ig.me / CTD-ad referral', async () => {
        await controller.processInstagramWebhookAsync([{
            id: 'ig-account-1',
            time: 1720000000000,
            messaging: [{
                sender: { id: 'igsid-1' },
                timestamp: 1719990000006,
                message: { mid: 'ig-mid-1', text: 'شحال الثمن؟', referral: { ref: 'story_ad', source: 'ADS', type: 'OPEN_THREAD', ad_id: '999888777' } },
            }],
        }]);

        expect(conversationsService.recordReferral).toHaveBeenCalledWith(
            PAGE.id, 'igsid-1', 'instagram',
            expect.objectContaining({ source: 'ADS', ref: 'story_ad', adId: '999888777' }),
        );
        expect(enqueueMessage).toHaveBeenCalledTimes(1);
    });

    it('an unknown IG account (no page row) skips attribution without crashing', async () => {
        vi.mocked(pagesService.getPageByInstagramId).mockResolvedValue(null as never);

        await controller.processInstagramWebhookAsync([{
            id: 'ig-unknown',
            time: 1720000000000,
            messaging: [{
                sender: { id: 'igsid-2' },
                referral: AD_REFERRAL,
            }],
        }]);

        expect(conversationsService.recordReferral).not.toHaveBeenCalled();
    });
});

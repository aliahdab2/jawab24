import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks so the vi.mock factories can close over them. Mocking
// subscriptions + dailyCap also stops the transitive `lib/redis` import (which
// reads real config at load) from running under the stubbed config.
const {
    mockCreate, mockResolveSub, mockGetTopupBalance, mockCheckCap, mockIncrementCap,
    mockClaimOnce, mockSendTemplateNotification,
} = vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockResolveSub: vi.fn(),
    mockGetTopupBalance: vi.fn(),
    mockCheckCap: vi.fn(),
    mockIncrementCap: vi.fn(),
    mockClaimOnce: vi.fn(),
    mockSendTemplateNotification: vi.fn(),
}));

// notifications is dynamically imported inside notifyImageCapReached (to keep
// that graph out of this module's load); vi.mock still intercepts a dynamic
// import.
vi.mock('../services/notifications', () => ({
    notificationService: { sendTemplateNotification: mockSendTemplateNotification },
}));

vi.mock('../services/openaiClient', () => {
    class MockAPIError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    }
    return {
        makeTrackedOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
        APIError: MockAPIError,
    };
});

vi.mock('../config', () => ({ config: { openai: { apiKey: 'test-key' }, imageUnderstanding: { enabled: true } } }));

vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

vi.mock('../services/subscriptions', () => ({
    subscriptionsService: { resolveWorkspaceSubscription: mockResolveSub, getTopupBalance: mockGetTopupBalance },
}));

vi.mock('../lib/dailyCap', () => ({
    checkDailyCap: mockCheckCap,
    incrementDailyCap: mockIncrementCap,
    dailyCapKey: (prefix: string, id: string) => `${prefix}:${id}:2026-07-05`,
    claimDailyOnce: mockClaimOnce,
}));

import {
    imageUnderstandingService,
    checkImageUnderstandingGate,
    incrementImageUnderstandingCounter,
    notifyImageCapReached,
} from '../services/imageUnderstanding';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { APIError } from '../services/openaiClient';

// APIError is the mock class above; cast to a (status, message) constructor.
const ApiError = APIError as unknown as new (status: number, message: string) => Error;

// Real magic bytes so the reused sniffMimeType() runs for real (not mocked).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = Buffer.from('<!DOCTYPE html><html>expired</html>');

function mockResponse(opts: { ok?: boolean; status?: number; contentLength?: number; body?: Buffer }) {
    const { ok = true, status = 200, contentLength, body = JPEG } = opts;
    return {
        ok,
        status,
        headers: { get: (h: string) => (h === 'content-length' && contentLength !== undefined ? String(contentLength) : null) },
        arrayBuffer: async () => body,
    };
}

function visionReply(content: string) {
    return { choices: [{ message: { content } }] };
}

const CTX = { userId: 'u1', pageId: 'p1' };

beforeEach(() => {
    vi.clearAllMocks();
    config.openai.apiKey = 'test-key';
    (config as unknown as { imageUnderstanding: { enabled: boolean } }).imageUnderstanding.enabled = true;
    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi.fn();
    mockGetTopupBalance.mockResolvedValue(0); // no PAYG bonus by default
});

describe('imageUnderstandingService.describeFromUrl', () => {
    it('returns the vision description on success and calls the model with detail:high', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('صورة إعلان لمنتج Nourva LiftFix'));

        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);

        expect(result).toEqual({ text: 'صورة إعلان لمنتج Nourva LiftFix' });
        const body = mockCreate.mock.calls[0][0];
        expect(body.model).toBe('gpt-4.1-mini');
        const parts = body.messages[0].content;
        expect(parts[1].image_url.detail).toBe('high');
        expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('skips (null) when the API key is missing, without fetching', async () => {
        config.openai.apiKey = '';
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns null (no Sentry) when the download is not ok', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ ok: false, status: 403 }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/expired.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('returns null when content-length exceeds the cap, without calling the model', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 6 * 1024 * 1024 }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/big.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('captures to Sentry and returns null when the download throws', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalled();
    });

    it('returns null (no Sentry) when the bytes are not a supported image (HTML error page)', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: HTML.length, body: HTML }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('returns null and captures a fingerprinted WARNING on an OpenAI 400 (bad image bytes)', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockRejectedValue(new ApiError(400, 'invalid image'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalledWith(
            expect.anything(),
            'Image understanding OpenAI 400',
            expect.objectContaining({
                level: 'warning',
                fingerprint: ['image-understanding-openai-400'],
            }),
        );
    });

    it('captures to Sentry and returns null on a non-400 OpenAI error', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockRejectedValue(new Error('rate limited'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
        expect(captureError).toHaveBeenCalled();
    });

    it('returns null when the model returns an empty description', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('   '));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toBeNull();
    });

    it('caps the stored description length', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('ا'.repeat(2000)));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result?.text.length).toBe(1000);
    });
});

describe('imageUnderstandingService.describeFromBuffer', () => {
    it('describes a PNG buffer and ignores a declared mime with a codec suffix (re-sniffs)', async () => {
        mockCreate.mockResolvedValue(visionReply('لقطة شاشة لمحادثة'));
        const result = await imageUnderstandingService.describeFromBuffer(PNG, 'image/png;codecs=foo', 'ar', CTX);
        expect(result).toEqual({ text: 'لقطة شاشة لمحادثة' });
        const parts = mockCreate.mock.calls[0][0].messages[0].content;
        expect(parts[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    });

    it('returns null for an empty buffer without calling the model', async () => {
        const result = await imageUnderstandingService.describeFromBuffer(Buffer.alloc(0), 'image/png', 'ar', CTX);
        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('skips (null) when the API key is missing', async () => {
        config.openai.apiKey = '';
        const result = await imageUnderstandingService.describeFromBuffer(PNG, 'image/png', 'ar', CTX);
        expect(result).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

describe('checkImageUnderstandingGate', () => {
    const sub = (slug: string) => ({ subscription: { plan: { slug } }, ownerId: 'owner-1' });

    it('denies with env_disabled when the global flag is off, without resolving a subscription', async () => {
        (config as unknown as { imageUnderstanding: { enabled: boolean } }).imageUnderstanding.enabled = false;
        const result = await checkImageUnderstandingGate('u1', 'w1');
        expect(result).toEqual({ allowed: false, reason: 'env_disabled' });
        expect(mockResolveSub).not.toHaveBeenCalled();
    });

    it('denies with no_subscription when neither user nor workspace owner has a plan', async () => {
        mockResolveSub.mockResolvedValue(null);
        const result = await checkImageUnderstandingGate('u1', 'w1');
        expect(result).toEqual({ allowed: false, reason: 'no_subscription' });
    });

    it('allows and returns ownerId when under the daily cap; passes the plan-specific limit', async () => {
        mockResolveSub.mockResolvedValue(sub('business'));
        mockCheckCap.mockResolvedValue({ allowed: true, used: 3, limit: 40 });
        const result = await checkImageUnderstandingGate('u1', 'w1');
        expect(result).toEqual({ allowed: true, ownerId: 'owner-1' });
        expect(mockCheckCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05', 40);
    });

    it('doubles the plan cap when the merchant has an active top-up (PAYG) balance', async () => {
        mockResolveSub.mockResolvedValue(sub('pro'));
        mockGetTopupBalance.mockResolvedValue(500); // has bought extra replies
        mockCheckCap.mockResolvedValue({ allowed: true, used: 10, limit: 150 });
        await checkImageUnderstandingGate('u1', 'w1');
        // Pro base = 75 → doubled to 150 because of the top-up balance.
        expect(mockCheckCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05', 150);
    });

    it('uses the base (non-doubled) cap when the top-up balance is zero', async () => {
        mockResolveSub.mockResolvedValue(sub('pro'));
        mockGetTopupBalance.mockResolvedValue(0);
        mockCheckCap.mockResolvedValue({ allowed: true, used: 10, limit: 75 });
        await checkImageUnderstandingGate('u1', 'w1');
        expect(mockCheckCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05', 75);
    });

    it('uses the default limit for an unknown plan slug', async () => {
        mockResolveSub.mockResolvedValue(sub('mystery-tier'));
        mockCheckCap.mockResolvedValue({ allowed: true, used: 0, limit: 5 });
        await checkImageUnderstandingGate('u1', 'w1');
        expect(mockCheckCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05', 5);
    });

    // The denial carries the owner + limit so the caller can tell the MERCHANT
    // which limit they hit. Without them the cap is invisible: we just stop
    // reading photos and nobody who could act on it ever finds out.
    it('denies with cap_reached, naming the owner and the limit', async () => {
        mockResolveSub.mockResolvedValue(sub('starter'));
        mockCheckCap.mockResolvedValue({ allowed: false, used: 15, limit: 15 });
        const result = await checkImageUnderstandingGate('u1', 'w1');
        expect(result).toEqual({ allowed: false, reason: 'cap_reached', ownerId: 'owner-1', limit: 15 });
    });

    it('gives Starter 15 images a day', async () => {
        mockResolveSub.mockResolvedValue(sub('starter'));
        mockCheckCap.mockResolvedValue({ allowed: true, used: 0, limit: 15 });
        await checkImageUnderstandingGate('u1', 'w1');
        expect(mockCheckCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05', 15);
    });

    it('fails closed (cap_check_failed) + captures when the cap check throws', async () => {
        mockResolveSub.mockResolvedValue(sub('pro'));
        mockCheckCap.mockRejectedValue(new Error('redis down'));
        const result = await checkImageUnderstandingGate('u1', 'w1');
        expect(result).toEqual({ allowed: false, reason: 'cap_check_failed' });
        expect(captureError).toHaveBeenCalled();
    });
});

describe('incrementImageUnderstandingCounter', () => {
    it('increments the owner-keyed daily counter', async () => {
        await incrementImageUnderstandingCounter('owner-1');
        expect(mockIncrementCap).toHaveBeenCalledWith('image_understanding:owner-1:2026-07-05');
    });
});

describe('notifyImageCapReached', () => {
    beforeEach(() => {
        mockClaimOnce.mockReset();
        mockSendTemplateNotification.mockReset();
    });

    it('notifies the owner with the limit they hit', async () => {
        mockClaimOnce.mockResolvedValue(true);

        await notifyImageCapReached('owner-1', 15);

        expect(mockSendTemplateNotification).toHaveBeenCalledWith(
            'owner-1', 'image_limit_reached', { limit: '15' },
        );
    });

    it('claims a per-owner, per-day key so the first hit wins', async () => {
        mockClaimOnce.mockResolvedValue(true);

        await notifyImageCapReached('owner-1', 15);

        expect(mockClaimOnce).toHaveBeenCalledWith('image_cap_notified:owner-1:2026-07-05');
    });

    // A busy page can hit the cap dozens of times in one evening. Without this
    // the merchant gets a notification per photo — the opposite of a signal.
    it('stays quiet on every later cap hit the same day', async () => {
        mockClaimOnce.mockResolvedValue(false);

        await notifyImageCapReached('owner-1', 15);

        expect(mockSendTemplateNotification).not.toHaveBeenCalled();
    });

    // This runs inside the message pipeline: a notification problem must never
    // become a message-handling problem.
    it('swallows a notification failure instead of throwing into the reply pipeline', async () => {
        mockClaimOnce.mockResolvedValue(true);
        mockSendTemplateNotification.mockRejectedValue(new Error('push service down'));

        await expect(notifyImageCapReached('owner-1', 15)).resolves.toBeUndefined();
        expect(captureError).toHaveBeenCalled();
    });
});

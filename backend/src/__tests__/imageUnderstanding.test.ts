import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks so the vi.mock factories can close over them. Mocking
// subscriptions + dailyCap also stops the transitive `lib/redis` import (which
// reads real config at load) from running under the stubbed config.
const {
    mockCreate, mockResolveSub, mockCheckStatus, mockGetTopupBalance, mockCheckCap, mockIncrementCap,
    mockClaimOnce, mockSendTemplateNotification, mockObserve,
} = vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockResolveSub: vi.fn(),
    mockCheckStatus: vi.fn(),
    mockGetTopupBalance: vi.fn(),
    mockCheckCap: vi.fn(),
    mockIncrementCap: vi.fn(),
    mockClaimOnce: vi.fn(),
    mockSendTemplateNotification: vi.fn(),
    mockObserve: vi.fn(),
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
    subscriptionsService: {
        resolveWorkspaceSubscription: mockResolveSub,
        checkSubscriptionStatus: mockCheckStatus,
        getTopupBalance: mockGetTopupBalance,
    },
}));

vi.mock('../lib/dailyCap', () => ({
    checkDailyCap: mockCheckCap,
    incrementDailyCap: mockIncrementCap,
    dailyCapKey: (prefix: string, id: string) => `${prefix}:${id}:2026-07-05`,
    claimDailyOnce: mockClaimOnce,
}));

// Vision latency goes to the shared prom-client histogram. Stubbed because
// `lib/metrics.ts` pulls in collectDefaultMetrics and a live registry, which has
// no place in a unit test — and so the observations can be asserted.
vi.mock('../lib/metrics', () => ({ visionDuration: { startTimer: () => mockObserve } }));

import {
    VISION_TIMEOUT_MS,
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
    mockCheckStatus.mockReturnValue({ allowed: true }); // entitled by default
});

describe('imageUnderstandingService.describeFromUrl', () => {
    it('returns the vision description on success and calls the model with detail:high', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('صورة إعلان لمنتج Nourva LiftFix'));

        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);

        expect(result).toEqual({ ok: true, text: 'صورة إعلان لمنتج Nourva LiftFix' });
        const body = mockCreate.mock.calls[0][0];
        expect(body.model).toBe('gpt-4.1-mini');
        const parts = body.messages[0].content;
        expect(parts[1].image_url.detail).toBe('high');
        expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    // Every failure below asserts WHICH SIDE failed, not merely that it failed.
    // Before 2026-08-11 they all returned `null`, so nonTextHandler could not tell
    // "this file is not an image" from "our 20s vision timeout fired" and sent the
    // same «we can only read text» message to both — false in the second case, and
    // sent to a guest who had just photographed a complaint. The reason IS the fix;
    // asserting only `!result.ok` here would let that conflation come straight back.

    it('blames OUR side when the API key is missing, without fetching', async () => {
        config.openai.apiKey = '';
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        // Silent to the customer, LOUD to us: a keyless deploy drops every image
        // fleet-wide, so it must not also be invisible in Sentry.
        expect(captureError).toHaveBeenCalledWith(
            expect.anything(),
            'Image understanding not configured',
            expect.objectContaining({ fingerprint: ['image-understanding-missing-key'] }),
        );
    });

    it('blames OUR side (no Sentry) when the CDN link is dead — the customer cannot fix that', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ ok: false, status: 403 }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/expired.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('blames the IMAGE when content-length exceeds the cap, without calling the model', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 6 * 1024 * 1024 }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/big.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'unusable_image' });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('blames OUR side and captures to Sentry when the download throws', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(captureError).toHaveBeenCalled();
    });

    it('blames OUR side (no Sentry) when the bytes are an HTML error page — an expired CDN link, not a bad photo', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: HTML.length, body: HTML }));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(captureError).not.toHaveBeenCalled();
    });

    it('blames the IMAGE and captures a fingerprinted WARNING on an OpenAI 400 (bad image bytes)', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockRejectedValue(new ApiError(400, 'invalid image'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'unusable_image' });
        expect(captureError).toHaveBeenCalledWith(
            expect.anything(),
            'Image understanding OpenAI 400',
            expect.objectContaining({
                level: 'warning',
                fingerprint: ['image-understanding-openai-400'],
            }),
        );
    });

    it('blames OUR side and captures to Sentry on a non-400 OpenAI error', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockRejectedValue(new Error('rate limited'));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(captureError).toHaveBeenCalledWith(
            expect.anything(),
            'Image understanding failed',
            { tags: { service: 'image_understanding' } },
        );
    });

    // THE regression test for prod 2026-08-11 (Sentry JAWAB24-BACKEND-1M, 20
    // occurrences in 5 bursts): a guest's photo timed out after 20.684s and she was
    // told we can only read text. The reason must be 'our_failure' so the caller
    // stays silent — 'unusable_image' here would restore the bug exactly.
    //
    // Companion to JAWAB24-BACKEND-1J (the voice-note variant): the OpenAI SDK's
    // abort error carries no distinguishing `name`, so the old check misfiled our
    // own VISION_TIMEOUT_MS as a hard failure. Detection reads the signal we own.
    it('blames OUR side and captures a fingerprinted WARNING when our vision timeout fires', async () => {
        vi.useFakeTimers();
        try {
            (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
            mockCreate.mockImplementation((_params: unknown, opts: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
                }));

            const pending = imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
            // Derived from the real constant: a hardcoded number that merely EQUALS
            // the deadline would stop firing the abort the moment someone re-tunes
            // it, and the test would die as an opaque timeout hang, not a diff.
            await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS + 1);

            expect(await pending).toEqual({ ok: false, reason: 'our_failure' });
            expect(captureError).toHaveBeenCalledWith(
                expect.anything(),
                'Image understanding timeout',
                expect.objectContaining({
                    level: 'warning',
                    fingerprint: ['image-understanding-openai-timeout'],
                }),
            );
            // The TIMEOUT itself must land in the histogram, not just successes.
            // A distribution built from survivors only is what let the old 20s
            // budget sit on the p99 unnoticed for sixteen days.
            //
            expect(mockObserve).toHaveBeenCalledWith({ outcome: 'timeout' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('records a duration bucket and outcome on a successful call', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('وصف'));

        await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);

        expect(mockObserve).toHaveBeenCalledWith({ outcome: 'ok' });
    });

    it('blames OUR side when the model returns an empty description', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('   '));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
    });

    it('caps the stored description length', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse({ contentLength: 1000, body: JPEG }));
        mockCreate.mockResolvedValue(visionReply('ا'.repeat(2000)));
        const result = await imageUnderstandingService.describeFromUrl('https://cdn/img.jpg', 'ar', CTX);
        expect(result.ok && result.text.length).toBe(1000);
    });
});

describe('imageUnderstandingService.describeFromBuffer', () => {
    it('describes a PNG buffer and ignores a declared mime with a codec suffix (re-sniffs)', async () => {
        mockCreate.mockResolvedValue(visionReply('لقطة شاشة لمحادثة'));
        const result = await imageUnderstandingService.describeFromBuffer(PNG, 'image/png;codecs=foo', 'ar', CTX);
        expect(result).toEqual({ ok: true, text: 'لقطة شاشة لمحادثة' });
        const parts = mockCreate.mock.calls[0][0].messages[0].content;
        expect(parts[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    });

    it('blames OUR side for an empty buffer — the download delivered nothing', async () => {
        const result = await imageUnderstandingService.describeFromBuffer(Buffer.alloc(0), 'image/png', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('blames OUR side when the API key is missing', async () => {
        config.openai.apiKey = '';
        const result = await imageUnderstandingService.describeFromBuffer(PNG, 'image/png', 'ar', CTX);
        expect(result).toEqual({ ok: false, reason: 'our_failure' });
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

    /**
     * A subscription ROW existing is not entitlement. This gate used to ask only
     * "is there a plan?" and "is the cap spent?", so a canceled / paused /
     * past-due-beyond-grace / expired-trial merchant kept having their customers'
     * photos read and billed to us.
     *
     * Measured in production 2026-08-19: 288 of 1,527 image_understanding calls
     * (19%, $0.32, 13 merchants) came from merchants this predicate denies, the
     * most recent that same day. Pure waste, not a service leak — the gate runs
     * at ingestion, ahead of messageProcessor's reply gate, so we paid for the
     * vision call and then refused to send the reply it was for.
     *
     * Mutation check: delete the statusCheck block in checkImageUnderstandingGate
     * and this fails while every other case here stays green.
     */
    it('denies with subscription_inactive when the plan no longer entitles anything', async () => {
        mockResolveSub.mockResolvedValue(sub('pro'));
        mockCheckStatus.mockReturnValue({
            allowed: false, reason: 'Subscription is canceled', code: 'subscription_inactive',
        });

        const result = await checkImageUnderstandingGate('u1', 'w1');

        expect(result).toEqual({ allowed: false, reason: 'subscription_inactive' });
        // Denied BEFORE the cap machinery: a blocked merchant costs us neither
        // the Redis round-trip nor the top-up lookup.
        expect(mockCheckCap).not.toHaveBeenCalled();
    });

    /**
     * The predicate must be the SAME one `canAutoReply` uses, or this gate ends
     * up more permissive than the reply it feeds. Top-up is the specific trap:
     * `canAutoReply` never consults it (#749 documents that deliberately), so a
     * blocked merchant holding credits must NOT get image reads back. Top-up
     * still doubles the CAP — a limit on an entitlement, never a grant of one.
     */
    it('does not let a top-up balance revive a blocked merchant', async () => {
        mockResolveSub.mockResolvedValue(sub('pro'));
        mockGetTopupBalance.mockResolvedValue(5000);
        mockCheckStatus.mockReturnValue({ allowed: false, code: 'subscription_inactive' });

        const result = await checkImageUnderstandingGate('u1', 'w1');

        expect(result).toEqual({ allowed: false, reason: 'subscription_inactive' });
        expect(mockCheckCap).not.toHaveBeenCalled();
    });

    /** The entitled path must still reach the cap — the guard denies, never gates everything. */
    it('still applies the daily cap for an entitled merchant', async () => {
        mockResolveSub.mockResolvedValue(sub('business'));
        mockCheckStatus.mockReturnValue({ allowed: true });
        mockCheckCap.mockResolvedValue({ allowed: true, used: 1, limit: 40 });

        const result = await checkImageUnderstandingGate('u1', 'w1');

        expect(result).toEqual({ allowed: true, ownerId: 'owner-1' });
        expect(mockCheckStatus).toHaveBeenCalledWith(expect.objectContaining({ plan: { slug: 'business' } }));
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

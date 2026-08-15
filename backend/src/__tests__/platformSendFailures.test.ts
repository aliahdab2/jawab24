import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIncr, mockExpire, mockDel, mockCaptureError, mockUpdate, mockRecoverToken } = vi.hoisted(() => ({
    mockIncr: vi.fn(),
    mockExpire: vi.fn().mockResolvedValue(1),
    mockDel: vi.fn().mockResolvedValue(1),
    mockCaptureError: vi.fn(),
    mockUpdate: vi.fn(),
    mockRecoverToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/redis', () => ({ redis: { incr: mockIncr, expire: mockExpire, del: mockDel } }));
vi.mock('../services/pageTokenRecovery', () => ({ handlePageTokenFailure: mockRecoverToken }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: mockCaptureError }));
vi.mock('../db', () => ({
    db: {
        update: mockUpdate,
    },
}));

import {
    recordSendFailure,
    recordSendSuccess,
    platformSendFailureKey,
    isPageLevelFailure,
    isChannelLevelFailure,
    PLATFORM_FAILURE_ALERT_THRESHOLD,
} from '../services/pageAutoPause';

const PAGE = 'page-1';
const flush = () => new Promise((r) => setImmediate(r));

describe('per-platform consecutive send-failure streak', () => {
    beforeEach(() => {
        mockIncr.mockReset().mockResolvedValue(1);
        mockExpire.mockClear();
        mockDel.mockClear();
        mockCaptureError.mockClear();
        // Page-level DB path: chainable update().set().where().returning() → no row
        mockUpdate.mockReset().mockReturnValue({
            set: () => ({ where: () => ({ returning: async () => [] }) }),
        });
    });

    it('a channel-level failure increments this platform\'s key with a TTL', async () => {
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockIncr).toHaveBeenCalledWith(platformSendFailureKey(PAGE, 'instagram'));
        expect(mockExpire).toHaveBeenCalledWith(platformSendFailureKey(PAGE, 'instagram'), 7 * 24 * 60 * 60);
    });

    it('thread_owned_elsewhere never touches the page-level pause counter', async () => {
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('per-customer buckets do not count toward the platform streak', async () => {
        await recordSendFailure(PAGE, 'customer_refused', 'instagram');
        await recordSendFailure(PAGE, 'window_expired', 'facebook');
        await flush();
        expect(mockIncr).not.toHaveBeenCalled();
    });

    it('without a platform the streak is untouched (back-compat call sites)', async () => {
        await recordSendFailure(PAGE, 'unknown');
        await flush();
        expect(mockIncr).not.toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalled(); // page-level accounting still runs
    });

    it('alerts at the threshold, stays quiet between marks, and re-alerts at the escalating marks (5, 50, 500)', async () => {
        mockIncr.mockResolvedValueOnce(PLATFORM_FAILURE_ALERT_THRESHOLD - 1);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).not.toHaveBeenCalled();

        mockIncr.mockResolvedValueOnce(PLATFORM_FAILURE_ALERT_THRESHOLD);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).toHaveBeenCalledTimes(1);

        mockIncr.mockResolvedValueOnce(PLATFORM_FAILURE_ALERT_THRESHOLD + 1);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).toHaveBeenCalledTimes(1); // quiet between marks

        // A permanently-dead channel must re-surface: one missed Sentry event
        // would otherwise restore the exact blindness this streak exists to fix.
        mockIncr.mockResolvedValueOnce(50);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).toHaveBeenCalledTimes(2);

        mockIncr.mockResolvedValueOnce(499);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).toHaveBeenCalledTimes(2);

        mockIncr.mockResolvedValueOnce(500);
        await recordSendFailure(PAGE, 'thread_owned_elsewhere', 'instagram');
        await flush();
        expect(mockCaptureError).toHaveBeenCalledTimes(3);
    });

    it('a success resets ONLY its own platform\'s streak — a Facebook success must not hide a dead Instagram (the MES failure mode)', async () => {
        await recordSendSuccess(PAGE, 'facebook');
        await flush();
        expect(mockDel).toHaveBeenCalledWith(platformSendFailureKey(PAGE, 'facebook'));
        expect(mockDel).not.toHaveBeenCalledWith(platformSendFailureKey(PAGE, 'instagram'));
    });

    it('a success without a platform leaves every platform streak alone', async () => {
        await recordSendSuccess(PAGE);
        await flush();
        expect(mockDel).not.toHaveBeenCalled();
    });

    it('thread_owned_elsewhere is channel-level but NEVER page-level — a handover conflict on one platform must not pause the page (MES: IG dead, FB healthy)', () => {
        expect(isChannelLevelFailure('thread_owned_elsewhere')).toBe(true);
        expect(isPageLevelFailure('thread_owned_elsewhere')).toBe(false);
    });

    it('page-level buckets remain channel-level too (superset); per-customer buckets are neither', () => {
        expect(isChannelLevelFailure('our_fault')).toBe(true);
        expect(isChannelLevelFailure('unknown')).toBe(true);
        expect(isChannelLevelFailure(undefined)).toBe(true);
        expect(isChannelLevelFailure('customer_refused')).toBe(false);
        expect(isChannelLevelFailure('window_expired')).toBe(false);
        expect(isChannelLevelFailure('transient')).toBe(false);
    });
});

/**
 * `recordSendFailure` is dispatched with `void` by BOTH reply pipelines
 * (messageProcessor, commentProcessor), so anything that escapes it is an
 * unhandled promise rejection rather than a Sentry event — and the pause counter
 * it exists to keep is silently skipped.
 *
 * Token recovery was bolted on ABOVE this function's own try, outside that
 * boundary. `handlePageTokenFailure` promises never to throw, but "the callee
 * promises" is not an error boundary.
 */
describe('recordSendFailure never escapes its own error boundary', () => {
    beforeEach(() => {
        mockIncr.mockReset().mockResolvedValue(1);
        mockCaptureError.mockClear();
        mockRecoverToken.mockReset().mockResolvedValue(null);
        mockUpdate.mockReset().mockReturnValue({
            set: () => ({ where: () => ({ returning: async () => [] }) }),
        });
    });

    it('does not reject when token recovery throws — it reports and carries on', async () => {
        mockRecoverToken.mockRejectedValue(new Error('/me/accounts exploded'));

        // The assertion IS `.resolves`: a rejection here is the production defect.
        await expect(
            recordSendFailure(PAGE, 'our_fault', 'facebook', { bucket: 'our_fault', code: 190, subcode: 460, rawMessage: 'gone' }),
        ).resolves.toBeUndefined();

        await flush();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('still bumps the pause counter when recovery throws', async () => {
        // The counter is what the ten-failure pause threshold is built on. A
        // recovery that blows up must not cost the page its failure count.
        mockRecoverToken.mockRejectedValue(new Error('/me/accounts exploded'));

        await recordSendFailure(PAGE, 'our_fault', 'facebook', { bucket: 'our_fault', code: 190, rawMessage: 'gone' });
        await flush();

        expect(mockUpdate).toHaveBeenCalled();
    });

    it('leaves WhatsApp\'s separate credential alone — 190 there is a WABA expiry', async () => {
        await recordSendFailure(PAGE, 'our_fault', 'whatsapp', { bucket: 'our_fault', code: 190, rawMessage: 'gone' });
        await flush();

        expect(mockRecoverToken).not.toHaveBeenCalled();
    });
});

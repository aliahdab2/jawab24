import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    captureException: vi.fn(),
    // Spied so the test below can prove the ambient scope is never written to.
    setTag: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import { captureError, tagError } from '../../src/utils/sentryHelpers';

/**
 * Regression for a Sentry TAG LEAK found in production on 2026-07-27.
 *
 * `services/ai.ts` used to call a bare `Sentry.setTag('aiErrorClass', name)`
 * before throwing. That writes to the AMBIENT scope — and the AI path runs in
 * the BullMQ reply worker, not an HTTP request, so there is no per-request
 * isolation scope to contain it. The tag landed on the process-wide scope and
 * then rode along on every unrelated event the process reported afterwards:
 * Sentry JAWAB24-BACKEND-1H shows `aiErrorClass: AiRefusalError` attached to a
 * POST /pages/:id/connect-whatsapp stream error, which has nothing whatsoever
 * to do with the AI pipeline. During an incident that misdirects whoever is on
 * call to the wrong subsystem.
 *
 * The fix is `tagError`: tags travel WITH the error to whatever reports it, so
 * they cannot outlive it or attach to anything else.
 */
describe('tagError + captureError', () => {
    beforeEach(() => vi.clearAllMocks());

    it('carries a tagged error\'s tags through to Sentry', () => {
        const err = tagError(new Error('refused'), { aiErrorClass: 'AiRefusalError' });

        captureError(err, 'AI failed');

        expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.objectContaining({
            tags: { aiErrorClass: 'AiRefusalError' },
        }));
    });

    it('never writes to the ambient Sentry scope — the whole point of the fix', () => {
        const err = tagError(new Error('refused'), { aiErrorClass: 'AiRefusalError' });
        captureError(err, 'AI failed');

        // A bare Sentry.setTag() is exactly what leaked the tag onto unrelated
        // events. Neither tagging nor capturing may reach for it.
        expect(Sentry.setTag).not.toHaveBeenCalled();
    });

    it('leaves an untagged error with no tags rather than an empty object', () => {
        captureError(new Error('plain'), 'fallback');

        const [, opts] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect((opts as { tags?: unknown }).tags).toBeUndefined();
    });

    it('merges carried tags with call-site tags', () => {
        const err = tagError(new Error('refused'), { aiErrorClass: 'AiRefusalError' });

        captureError(err, 'AI failed', { tags: { service: 'reply-worker' } });

        expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.objectContaining({
            tags: { aiErrorClass: 'AiRefusalError', service: 'reply-worker' },
        }));
    });

    // The reporter knows more about the context than the thrower did.
    it('call-site tags win on conflict', () => {
        const err = tagError(new Error('x'), { pipeline: 'guessed' });

        captureError(err, 'failed', { tags: { pipeline: 'comment_reply' } });

        expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.objectContaining({
            tags: { pipeline: 'comment_reply' },
        }));
    });

    it('accumulates tags across repeated calls and returns the same error', () => {
        const original = new Error('x');
        const once = tagError(original, { a: '1' });
        const twice = tagError(once, { b: '2' });

        expect(twice).toBe(original);

        captureError(twice, 'failed');
        expect(Sentry.captureException).toHaveBeenCalledWith(original, expect.objectContaining({
            tags: { a: '1', b: '2' },
        }));
    });

    it('still reports a non-Error throw using the fallback message', () => {
        captureError('just a string', 'fallback message');

        const [err, opts] = vi.mocked(Sentry.captureException).mock.calls[0];
        expect((err as Error).message).toBe('fallback message');
        expect((opts as { extra?: Record<string, unknown> }).extra?.originalError).toBe('just a string');
    });
});

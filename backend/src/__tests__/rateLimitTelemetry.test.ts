/**
 * Regression test for the rate-limit Sentry telemetry (lib/sentry.ts).
 *
 * Incident 2026-07-18: the onExceeded hook captured "Rate limit exceeded: <url>",
 * which matched the 'Rate limit exceeded' entry in ignoreErrors — Sentry silently
 * dropped every one of those events, leaving a production lockout on
 * /auth/facebook/link diagnosable only via server access logs.
 */
import { describe, it, expect } from 'vitest';
import { SENTRY_IGNORE_ERRORS, rateLimitCaptureMessage } from '../lib/sentry';

describe('rate-limit Sentry telemetry', () => {
    it('onExceeded capture message never matches any ignoreErrors pattern', () => {
        // ignoreErrors string entries are SUBSTRING matches against the message
        const message = rateLimitCaptureMessage('/auth/facebook/link');
        for (const pattern of SENTRY_IGNORE_ERRORS) {
            expect(message.includes(pattern), `"${message}" must not contain ignored pattern "${pattern}"`).toBe(false);
        }
    });

    it('capture message includes the limited URL for per-route grouping', () => {
        expect(rateLimitCaptureMessage('/auth/demo')).toContain('/auth/demo');
    });
});

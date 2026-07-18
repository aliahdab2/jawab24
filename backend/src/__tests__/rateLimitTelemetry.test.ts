/**
 * Regression test for the rate-limit Sentry telemetry (lib/sentry.ts).
 *
 * Incident 2026-07-18: the onExceeded hook captured "Rate limit exceeded: <url>",
 * which matched the 'Rate limit exceeded' entry in ignoreErrors — Sentry silently
 * dropped every one of those events, leaving a production lockout on
 * /auth/facebook/link diagnosable only via server access logs.
 */
import { describe, it, expect } from 'vitest';
import { SENTRY_IGNORE_ERRORS, rateLimitCaptureMessage, csrfInvalidCaptureMessage } from '../lib/sentry';

describe('guard-rejection Sentry telemetry', () => {
    // ignoreErrors string entries are SUBSTRING matches against the message
    it.each([
        ['rate-limit onExceeded', rateLimitCaptureMessage('/auth/facebook/link')],
        ['CSRF rejection', csrfInvalidCaptureMessage('/settings')],
    ])('%s capture message never matches any ignoreErrors pattern', (_name, message) => {
        for (const pattern of SENTRY_IGNORE_ERRORS) {
            expect(message.includes(pattern), `"${message}" must not contain ignored pattern "${pattern}"`).toBe(false);
        }
    });

    it('capture messages include the route for per-route grouping', () => {
        expect(rateLimitCaptureMessage('/auth/demo')).toContain('/auth/demo');
        expect(csrfInvalidCaptureMessage('/settings')).toContain('/settings');
    });
});

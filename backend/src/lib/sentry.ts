import * as Sentry from '@sentry/node';

const isProduction = process.env.NODE_ENV === 'production';
const sentryDsn = process.env.SENTRY_DSN;

/**
 * Noisy errors filtered from Sentry. Entries are SUBSTRING matches against the
 * event message — 'Rate limit exceeded' silences the per-request 429 error
 * ("Rate limit exceeded. Please try again later.") that would otherwise flood
 * Sentry once per limited request.
 *
 * Exported (with the message builder below) so a test can guarantee the filter
 * never swallows our intentional telemetry.
 */
export const SENTRY_IGNORE_ERRORS = [
    'Rate limit exceeded',
    'ECONNREFUSED',
    'ETIMEDOUT',
];

/**
 * Message for the deliberate, fingerprint-grouped capture in the rate limiter's
 * onExceeded hook (one Sentry issue per url+ip, not one event per request).
 *
 * MUST NOT contain any SENTRY_IGNORE_ERRORS substring: the original wording
 * ("Rate limit exceeded: <url>") matched the filter above, so the telemetry was
 * silently dropped and a production lockout (2026-07-18, /auth/facebook/link)
 * was only diagnosable via server access logs.
 */
export function rateLimitCaptureMessage(url: string): string {
    return `429 rate-limited: ${url}`;
}

export function initSentry() {
    if (!sentryDsn) {
        if (isProduction) {
             
            console.warn('⚠️ SENTRY_DSN not set - error tracking disabled');
        }
        return;
    }

    Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.GIT_COMMIT || process.env.APP_VERSION || '1.0.0',
        serverName: 'jawab24-backend',

        // Performance monitoring (optional - set to 0 to disable)
        tracesSampleRate: isProduction ? 0.1 : 1.0, // 10% in prod, 100% in dev

        // Filter out noisy errors
        ignoreErrors: SENTRY_IGNORE_ERRORS,

        // Add extra context
        beforeSend(event) {
            // Don't send events in development unless explicitly enabled
            if (!isProduction && !process.env.SENTRY_DEV_ENABLED) {
                return null;
            }
            return event;
        },
    });

    // Tag all events from this service
    Sentry.setTag('service', 'backend');

    // eslint-disable-next-line no-console
    console.log('✅ Sentry initialized for error tracking');
}

export { Sentry };

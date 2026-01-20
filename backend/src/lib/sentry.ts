import * as Sentry from '@sentry/node';

const isProduction = process.env.NODE_ENV === 'production';
const sentryDsn = process.env.SENTRY_DSN;

export function initSentry() {
    if (!sentryDsn) {
        if (isProduction) {
            // eslint-disable-next-line no-console
            console.warn('⚠️ SENTRY_DSN not set - error tracking disabled');
        }
        return;
    }

    Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.APP_VERSION || '1.0.0',

        // Performance monitoring (optional - set to 0 to disable)
        tracesSampleRate: isProduction ? 0.1 : 1.0, // 10% in prod, 100% in dev

        // Filter out noisy errors
        ignoreErrors: [
            'Rate limit exceeded',
            'ECONNREFUSED',
            'ETIMEDOUT',
        ],

        // Add extra context
        beforeSend(event) {
            // Don't send events in development unless explicitly enabled
            if (!isProduction && !process.env.SENTRY_DEV_ENABLED) {
                return null;
            }
            return event;
        },
    });

    // eslint-disable-next-line no-console
    console.log('✅ Sentry initialized for error tracking');
}

export { Sentry };

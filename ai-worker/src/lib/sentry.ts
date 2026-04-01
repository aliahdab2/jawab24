import * as Sentry from '@sentry/node';

const isProduction = process.env.NODE_ENV === 'production';
const sentryDsn = process.env.SENTRY_DSN;

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
        serverName: 'jawab24-ai-worker',

        // Performance monitoring
        tracesSampleRate: isProduction ? 0.1 : 1.0,

        // Filter out transient network errors (rate limits are NOT filtered — we need visibility)
        ignoreErrors: [
            'ECONNREFUSED',
            'ETIMEDOUT',
        ],

        beforeSend(event) {
            if (!isProduction && !process.env.SENTRY_DEV_ENABLED) {
                return null;
            }
            return event;
        },
    });

    // Tag all events from this service
    Sentry.setTag('service', 'ai-worker');

    console.log('✅ Sentry initialized for AI Worker');
}

export { Sentry };

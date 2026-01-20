import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
    dsn: SENTRY_DSN,

    // Only enable in production
    enabled: process.env.NODE_ENV === 'production',

    // Performance monitoring
    tracesSampleRate: 0.1,

    // Filter noisy errors
    ignoreErrors: [
        'ECONNREFUSED',
        'ETIMEDOUT',
    ],
});

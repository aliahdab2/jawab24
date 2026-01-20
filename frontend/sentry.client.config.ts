import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
    dsn: SENTRY_DSN,

    // Only enable in production
    enabled: process.env.NODE_ENV === 'production',

    // Performance monitoring
    tracesSampleRate: 0.1, // 10% of transactions

    // Session replay (optional - can be disabled to save cost)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1, // 10% of errors get replay

    // Filter noisy errors
    ignoreErrors: [
        'ResizeObserver loop',
        'Network request failed',
        'Load failed',
        'ChunkLoadError',
    ],
});

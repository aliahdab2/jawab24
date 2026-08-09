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

    // Filter noisy/expected errors
    ignoreErrors: [
        'ResizeObserver loop',
        'Network request failed',
        'Load failed',
        'ChunkLoadError',
        'Session expired',
        'Event `CustomEvent` (type=unhandledrejection)',
        // React reconciler vs. browser auto-translation (Google Translate etc.) — not an app bug
        /Failed to execute 'insertBefore' on 'Node'/,
        /Failed to execute 'removeChild' on 'Node'/,
        /The node (before|to be removed) (which the new node is to be inserted )?is not a child of this node/,
        // Browser-extension scripts injected into the page (Firefox Reader View,
        // DarkReader, YouTube-quality extensions, etc.) — these run in the
        // visitor's browser, not our code. JAWAB24-FRONTEND-2B..2H + -2G.
        /__firefox__/,
        /DarkReader/,
        // Instagram in-app browser's injected navigation_performance_logger
        // script racing its own WebView bridge teardown on beforeunload.
        // Deliberately scoped to this one bridge method — a bare "Java object
        // is gone" filter could mask a real Capacitor bridge failure of ours.
        // JAWAB24-FRONTEND-2X.
        /Error invoking enableDidUserTypeOnKeyboardLogging/,
    ],

    // Drop errors whose stack frame originates from a browser extension — never
    // our code. Complements ignoreErrors for extension scripts that throw with a
    // generic message but an extension-scheme source URL.
    denyUrls: [
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-(web-)?extension:\/\//i,
        /^webkit-masked-url:\/\//i,
        // Scripts the Facebook/Instagram in-app browsers inject into every page
        // under their own app:// scheme with a host-style name and NO path slash:
        // app://browser_declutter (JAWAB24-FRONTEND-2Y), and
        // app://navigation_performance_logger_android ("… Java object is gone").
        // ⚠️ [^/] is load-bearing — a bare /^app:\/\// would silence the entire
        // frontend: @sentry/nextjs's client NextjsClientStackFrameNormalization
        // rewrites OUR chunk frames' origin to app:// as well, so every
        // first-party frame is app:///_next/… (empty host, THREE slashes), and
        // denyUrls matches the crashing frame's rewritten filename. Only the
        // host-full two-slash form is an injected in-app-browser script.
        /^app:\/\/[^/]/i,
    ],

    beforeSend(event, hint) {
        const original = hint?.originalException as { type?: string; isTrusted?: boolean } | null | undefined;
        if (
            original &&
            typeof original === 'object' &&
            original.type === 'unhandledrejection' &&
            original.isTrusted === false
        ) {
            return null;
        }
        return event;
    },
});

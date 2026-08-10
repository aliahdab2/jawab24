import * as Sentry from '@sentry/nextjs';
import {
    isInAppBrowserInjectedEvent,
    IN_APP_BROWSER_MESSAGE_PATTERNS,
    IN_APP_BROWSER_SCRIPT_URL,
} from '@/lib/sentryEventFilters';

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
        // Instagram's iOS in-app browser injects its logger INLINE, so its
        // frames are minified and carry the page URL — nothing in the stack
        // identifies them, only the message can. See sentryEventFilters.ts.
        ...IN_APP_BROWSER_MESSAGE_PATTERNS,
    ],

    // Drop errors whose stack frame originates from a browser extension — never
    // our code. Complements ignoreErrors for extension scripts that throw with a
    // generic message but an extension-scheme source URL.
    denyUrls: [
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-(web-)?extension:\/\//i,
        /^webkit-masked-url:\/\//i,
        // Scripts the Facebook/Instagram in-app browsers inject under their own
        // app://<name> scheme (app://browser_declutter, JAWAB24-FRONTEND-2Y).
        // Cheap early drop only — denyUrls tests a single frame, so beforeSend
        // below re-checks this same pattern across ALL frames. Shared constant:
        // the [^/] is load-bearing and must not drift. See sentryEventFilters.ts.
        IN_APP_BROWSER_SCRIPT_URL,
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
        // Facebook/Instagram in-app browser injected scripts crashing against
        // their own native bridge. Scans every frame, unlike denyUrls above.
        // JAWAB24-FRONTEND-2V / -2Y.
        if (isInAppBrowserInjectedEvent(event)) {
            return null;
        }
        return event;
    },
});

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

/**
 * Message for the fingerprint-grouped capture when csrfProtection rejects a
 * mutation (middleware/auth.ts). CSRF 403s were previously invisible — the
 * 2026-07-18 demo-login/OTP/logout lockouts were only found via nginx access
 * logs. Same contract as above: must not match SENTRY_IGNORE_ERRORS.
 */
export function csrfInvalidCaptureMessage(route: string): string {
    return `403 CSRF rejected: ${route}`;
}

/**
 * Query parameters that must never reach Sentry.
 *
 * `client_secret` and `access_token` carry the permanent Facebook app secret;
 * `input_token` carries a merchant's decrypted WABA token; `code` is a one-time
 * Embedded Signup auth code. Matching is case-insensitive and substring-based so
 * near-misses (`app_secret`, `refresh_token`) are caught too — over-redacting a
 * URL costs nothing, under-redacting leaks a credential.
 */
const SENSITIVE_QUERY_KEYS = ['secret', 'token', 'password', 'signature', 'code'];

// URL-safe on purpose: URLSearchParams percent-encodes on toString(), so a marker
// like "[redacted]" would surface in Sentry as the unreadable "%5Bredacted%5D".
const REDACTED = 'REDACTED';

/** Rewrite a URL string, replacing the value of any sensitive query param. */
export function redactUrl(raw: string): string {
    // Cheap bail-out: no query string, nothing to redact.
    const q = raw.indexOf('?');
    if (q === -1) return raw;
    const base = raw.slice(0, q);
    const params = new URLSearchParams(raw.slice(q + 1));
    let touched = false;
    for (const key of [...params.keys()]) {
        if (SENSITIVE_QUERY_KEYS.some(s => key.toLowerCase().includes(s))) {
            params.set(key, REDACTED);
            touched = true;
        }
    }
    return touched ? `${base}?${params.toString()}` : raw;
}

/** Redact the URL-ish fields the SDK attaches to breadcrumbs and span attributes. */
function redactSensitiveUrlFields(data: Record<string, unknown>): Record<string, unknown> {
    const out = { ...data };
    for (const field of ['url', 'http.url']) {
        if (typeof out[field] === 'string') out[field] = redactUrl(out[field] as string);
    }
    // `http.query` is the bare query string (leading '?'), not a full URL.
    if (typeof out['http.query'] === 'string') {
        out['http.query'] = redactUrl(`_:${out['http.query'] as string}`).slice(2);
    }
    return out;
}

/**
 * Last line of defence: walk an outbound event and redact any URL that survived
 * the breadcrumb hook — request URLs, span attributes, and span descriptions
 * (the SDK names http spans "GET <url>").
 */
function scrubEventUrls<T extends Sentry.Event>(event: T): T {
    if (event.request?.url) event.request.url = redactUrl(event.request.url);

    for (const crumb of event.breadcrumbs ?? []) {
        if (crumb.data) crumb.data = redactSensitiveUrlFields(crumb.data);
    }

    for (const span of (event as { spans?: Array<{ description?: string; data?: Record<string, unknown> }> }).spans ?? []) {
        if (span.data) span.data = redactSensitiveUrlFields(span.data);
        if (typeof span.description === 'string') span.description = redactUrl(span.description);
    }

    return event;
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

        // Strip credentials out of outgoing-HTTP breadcrumbs before they are stored.
        //
        // The SDK records the RAW query string of every outgoing request:
        // `add-outgoing-request-breadcrumb.js` sets `data['http.query'] = parsedUrl.search`,
        // and `data.url` carries the URL. Several Meta OAuth calls pass credentials as
        // query params (`client_secret` on the Embedded Signup code exchange;
        // `access_token=<app-id>|<app-secret>` and `input_token=<merchant WABA token>`
        // on debug_token), so without this hook the Facebook app secret and live
        // per-merchant tokens are attached to the scope and shipped with the next
        // captured event.
        beforeBreadcrumb(breadcrumb) {
            if (breadcrumb.category === 'http' && breadcrumb.data) {
                breadcrumb.data = redactSensitiveUrlFields(breadcrumb.data);
            }
            return breadcrumb;
        },

        // Add extra context
        beforeSend(event) {
            // Don't send events in development unless explicitly enabled
            if (!isProduction && !process.env.SENTRY_DEV_ENABLED) {
                return null;
            }
            return scrubEventUrls(event);
        },

        // Spans carry the same `http.url` / `http.query` attributes as breadcrumbs,
        // on a separate code path — scrubbing only beforeSend would leave the
        // transaction payload leaking.
        beforeSendTransaction(event) {
            return scrubEventUrls(event);
        },
    });

    // Tag all events from this service
    Sentry.setTag('service', 'backend');

    // eslint-disable-next-line no-console
    console.log('✅ Sentry initialized for error tracking');
}

export { Sentry };

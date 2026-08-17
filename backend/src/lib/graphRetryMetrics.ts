/**
 * Graph retry observability — the sink for `fbAxios`'s retry decisions.
 *
 * Lives outside fbAxios.ts so the HTTP client itself depends on nothing but axios and
 * config (see `setGraphRetryObserver` for why that separation is load-bearing).
 *
 * Counter key shape mirrors aiMetrics: `metrics:graph:{outcome}:{method}:{reason}`.
 *
 * `retry_suppressed` is the counter to watch. It records every ambiguous failure on a
 * non-idempotent Graph write that the old interceptor WOULD have replayed — each one a
 * duplicate public comment or duplicate DM avoided. Read it per method+reason to see
 * which endpoints and which failure shapes actually occur in production; before this
 * existed the answer was unknowable, which is how the 2026-08-17 duplicate-nudge report
 * had to be diagnosed from a screenshot.
 */
import { redis } from './redis';
import { setGraphRetryObserver, type GraphRetryEvent, type GraphRetryObserver } from './fbAxios';
import { redactUrl } from './sentry';
import type { Logger } from '../types';

/** Fire-and-forget, in the style of aiMetrics: diagnostics never delay or fail a call. */
function count(event: GraphRetryEvent): void {
    // try/catch AND .catch(): a client that throws synchronously would otherwise escape
    // into the caller's error path and change the outcome this counter only observes.
    try {
        redis.incr(`metrics:graph:${event.outcome}:${event.method}:${event.reason}`)
            .catch(() => { /* diagnostic only */ });
    } catch { /* diagnostic only */ }
}

/**
 * Build the observer. Exported separately from the installer so a test can drive it with
 * a plain event object — asserting on the metrics key and the log line without spying on
 * a module-level setter or simulating HTTP.
 */
export function graphRetryObserver(logger: Logger): GraphRetryObserver {
    return (rawEvent) => {
        count(rawEvent);

        // Several Meta endpoints take credentials as query params (`client_secret` on the
        // Embedded Signup code exchange, `access_token=<app-id>|<app-secret>` and
        // `input_token` on debug_token). Today's call sites pass those via axios `params`,
        // which never reach `config.url` — but "no call site does X yet" is not a property
        // a log line should depend on. Reuse the same redactor the Sentry hooks use rather
        // than a second copy of the key list.
        const event = rawEvent.url
            ? { ...rawEvent, url: redactUrl(rawEvent.url) }
            : rawEvent;

        if (event.outcome === 'retry_suppressed') {
            // warn, not error: this is the guard working as designed. It is logged at all
            // because the caller's own failure handling is what happens next, and reading
            // that in isolation gives no hint that a replay was deliberately withheld.
            logger.warn('[fbAxios] Ambiguous failure on a non-idempotent request — not replaying', {
                method: event.method, url: event.url, reason: event.reason, status: event.status,
            });
            return;
        }

        logger.warn('[fbAxios] Graph retry', {
            outcome: event.outcome,
            method: event.method,
            url: event.url,
            reason: event.reason,
            proven: event.proven,
            attempt: event.attempt,
            waitMs: event.waitMs,
        });
    };
}

/**
 * Wire logging + counters for every Graph retry decision.
 *
 * ONE call is enough: fbAxios is a module singleton and the reply worker runs in the same
 * process, so both the HTTP request path and the worker report through it.
 */
export function installGraphRetryObserver(logger: Logger): void {
    setGraphRetryObserver(graphRetryObserver(logger));
}

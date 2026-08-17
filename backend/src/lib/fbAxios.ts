/**
 * Facebook Graph API — Axios instance with automatic retry
 *
 * RETRY SAFETY — WHY THIS FILE IS NOT JUST "RETRY ON TRANSIENT ERRORS"
 * --------------------------------------------------------------------
 * RFC 9110 §9.2.2: "a client SHOULD NOT automatically retry a request with a
 * non-idempotent method unless it has some means to know that the request
 * semantics are actually idempotent". POST and PATCH are not idempotent.
 *
 * That rule is load-bearing here because Meta applies NO duplicate protection to
 * `POST /{comment-id}/comments`: replaying it creates a SECOND public comment.
 * This shipped — on 2026-08-17 a merchant's page carried two byte-identical
 * "We sent you a private message 💬" replies under one customer comment. Only a
 * transport-level replay explains it: the nudge text is picked at random from five
 * variations per pipeline run (nudge.ts), so two independent runs match 1 time in
 * 5, while a replayed request is identical every time. The old interceptor retried
 * ANY request — POSTs included — on a 15s socket timeout, ECONNRESET or a 5xx, all
 * of which are AMBIGUOUS: the write may already have been applied.
 *
 * So a failure is retried automatically only when ONE of these holds:
 *
 *   1. It PROVES the request never reached Meta's handler (`proven: true`) —
 *      rate-limit rejections, DNS failure, refused connection. Safe for any method.
 *   2. The method is idempotent per RFC 9110 §9.2.2, so a replay cannot create a
 *      second resource even if the first attempt did land.
 *
 * An ambiguous failure on a POST/PATCH is NOT retried here — it propagates to the caller,
 * whose own layer decides. Those layers differ, and the difference is the point:
 *
 *   • DM / private reply — safe to replay. `classifyDmError` buckets a transport failure
 *     as `transient`, sender.ts rethrows, and BullMQ job-level retry (3 attempts,
 *     exponential backoff) re-runs the pipeline. Meta enforces one private reply per
 *     comment (error 10900 "Activity already replied to"), so a replay cannot duplicate.
 *
 *   • PUBLIC comment post — deliberately AT-MOST-ONCE. Nothing de-duplicates this write:
 *     not Meta, and not us (`comments.replied` is only set AFTER a successful send, so a
 *     job replay of a comment that actually landed would post it twice — the exact defect
 *     above, one layer up). `postPublicReplyResult` therefore swallows the error into a
 *     `publicFailure`, the comment is flagged `send_failed`, and it surfaces in Needs
 *     Attention for the merchant. A flagged comment is recoverable; a duplicate public
 *     reply on a merchant's wall is not, and risks Meta's spam heuristics besides.
 *     10 CONSECUTIVE failures are needed to auto-pause a page (pageAutoPause.PAUSE_THRESHOLD,
 *     counter reset on success), so a single network blip cannot pause anything.
 *
 * The rate of lost public replies this trades for is now measurable rather than assumed:
 * every withheld replay increments `metrics:graph:retry_suppressed:{method}:{reason}`
 * (graphRetryMetrics.ts). If it proves material, the standard remedy is to reconcile
 * before replaying — read the parent comment's replies back and post only if ours is
 * absent, as commentMentionGuard already does for verification — NOT to restore a blind
 * retry here.
 *
 * Max 2 automatic retries per request.
 *
 * Used by facebook.ts, instagram.ts, metaMessaging.ts, whatsapp.ts, sender.ts —
 * anything that calls the Facebook/Instagram Graph API. NOT used for cosmetic
 * calls (typing indicators).
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';

/** Single source of truth for the Facebook/Instagram Graph API base URL. */
export const GRAPH_API_BASE = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

const MAX_RETRIES = 2;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const TRANSIENT_RETRY_WAIT_MS = 2_000;

/**
 * Upper bound on any single automatic wait, `Retry-After` included.
 *
 * A server-supplied `Retry-After: 3600` would otherwise pin a BullMQ reply-worker
 * slot for an hour on a hot path. 60s is already this design's accepted ceiling —
 * it is exactly what a 429 with no usable header has always waited — so clamping
 * to it introduces no wait longer than one that could already occur. Anything
 * beyond belongs to job-level retry, which frees the worker while it waits.
 */
const MAX_RETRY_WAIT_MS = 60_000;

/**
 * Per-request socket timeout. Graph API calls on the reply hot path must not
 * hang indefinitely (axios default is 0 = infinite): a stalled socket to
 * graph.facebook.com would pin a BullMQ reply-worker slot forever. 15s is well
 * above realistic Graph latency; a timeout surfaces as ECONNABORTED — which is
 * AMBIGUOUS, not safe-to-replay: the request was fully sent, and only the
 * response was lost. See the header comment.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Idempotent methods per RFC 9110 §9.2.2. Replaying one cannot create a second
 * resource, so an ambiguous failure may be retried automatically.
 *
 * POST and PATCH are absent deliberately. Anything not on this list — including a
 * request whose method axios did not record — is treated as non-idempotent, so an
 * unknown method fails CLOSED (no automatic replay).
 */
const IDEMPOTENT_METHODS = new Set(['get', 'head', 'put', 'delete', 'options', 'trace']);

interface RetryConfig extends InternalAxiosRequestConfig {
    _retryCount?: number;
}

/** What to do about a failed Graph call. `null` from {@link classifyRetry} = never retry. */
export interface RetryDecision {
    /**
     * Milliseconds to wait before replaying. 0 is a legitimate "replay immediately"
     * (`Retry-After: 0`, or an HTTP-date already in the past) — "do not retry at all"
     * is a null decision, never a zero wait. Conflating the two silently dropped the
     * retry Meta explicitly asked for.
     */
    waitMs: number;
    /**
     * True when the failure PROVES the request never reached Meta's handler, so a
     * replay cannot duplicate anything regardless of method. False = ambiguous:
     * the write may already have been applied.
     */
    proven: boolean;
    /** Short stable label for logs and counters — bounded cardinality, never free text. */
    reason: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** What the interceptor decided, for logging and metrics. */
export interface GraphRetryEvent {
    /**
     * `retried` — replay issued. `retry_suppressed` — an ambiguous failure on a
     * non-idempotent request; NOT replayed (this is the duplicate-comment defect being
     * prevented, so its rate is the most important number here). `exhausted` — retryable
     * but MAX_RETRIES already spent.
     */
    outcome: 'retried' | 'retry_suppressed' | 'exhausted';
    /** Lowercased HTTP method, or 'unknown' when axios recorded none. */
    method: string;
    url?: string;
    reason: string;
    proven: boolean;
    attempt?: number;
    waitMs?: number;
    status?: number;
}

export type GraphRetryObserver = (event: GraphRetryEvent) => void;

let observe: GraphRetryObserver = () => { /* no observer wired */ };

/**
 * Register the sink for retry decisions. Wired once at bootstrap — see
 * `graphRetryMetrics.installGraphRetryObserver`.
 *
 * Injected rather than imported so this module keeps depending on nothing but axios and
 * config. A direct `redis` import here reached into five unrelated test suites (whose
 * partial `config` mocks have no `redis` key) and broke their module graph — a low-level
 * HTTP client has no business owning a Redis connection.
 *
 * Retries used to be entirely silent, which is why the duplicate-comment defect above was
 * invisible in production for as long as it existed: nothing recorded that a POST had ever
 * been replayed. An observer that throws must never change the request outcome, so every
 * call is wrapped.
 */
export function setGraphRetryObserver(observer: GraphRetryObserver): void {
    observe = observer;
}

function emit(event: GraphRetryEvent): void {
    try {
        observe(event);
    } catch { /* diagnostics must never fail a Graph call */ }
}

/**
 * Parse `Retry-After` per RFC 9110 §10.2.3, which permits BOTH delta-seconds and an
 * HTTP-date. Only the numeric form used to be understood; an HTTP-date fell through to
 * `Number(...)` → NaN and silently became the 60s default.
 *
 * Returns null when the header is absent or unparseable, so the caller applies its default.
 */
function parseRetryAfter(header: unknown): number | null {
    if (typeof header !== 'string' && typeof header !== 'number') return null;
    const raw = String(header).trim();
    if (raw === '') return null;

    // delta-seconds: a non-negative integer count of seconds.
    if (/^\d+$/.test(raw)) return Number(raw) * 1000;

    // HTTP-date: absolute instant. A date already in the past means "retry now".
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return null;
    return Math.max(0, at - Date.now());
}

/**
 * Classify a failed Graph call: how long to wait, and whether a replay is provably safe.
 * Returns null when the failure is not retryable at all.
 *
 * Exported for unit testing — the proven/ambiguous split is the whole safety property,
 * so it is tested directly rather than inferred from interceptor behaviour.
 */
export function classifyRetry(error: AxiosError): RetryDecision | null {
    const status = error.response?.status;

    // HTTP 429 — the edge rejected the request before the handler ran, so nothing was
    // applied. Honour Retry-After (clamped), else the default.
    if (status === 429) {
        const parsed = parseRetryAfter(error.response?.headers?.['retry-after']);
        const waitMs = Math.min(parsed ?? DEFAULT_RATE_LIMIT_WAIT_MS, MAX_RETRY_WAIT_MS);
        return { waitMs, proven: true, reason: 'http_429' };
    }

    // Facebook rate limits: code 4 (app level) or 32 (page level). Both are rejections —
    // Meta declines the call rather than performing it — so a replay cannot duplicate.
    const fbError = (error.response?.data as { error?: { code?: number } })?.error;
    if (fbError && (fbError.code === 4 || fbError.code === 32)) {
        return {
            waitMs: DEFAULT_RATE_LIMIT_WAIT_MS,
            proven: true,
            reason: fbError.code === 4 ? 'fb_app_rate_limit' : 'fb_page_rate_limit',
        };
    }

    // 5xx — AMBIGUOUS. A 502/504 from an edge in front of Meta can be returned after the
    // origin already applied the write, so this is not safe to replay on a POST.
    if (status && status >= 500) {
        return { waitMs: TRANSIENT_RETRY_WAIT_MS, proven: false, reason: 'http_5xx' };
    }

    if (!error.response && error.code) {
        // The request provably never reached a handler: DNS never resolved, or the peer
        // refused the connection. Safe to replay on any method.
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return { waitMs: TRANSIENT_RETRY_WAIT_MS, proven: true, reason: error.code.toLowerCase() };
        }
        // AMBIGUOUS network failures — the request may have been fully sent and processed,
        // with only the response lost. ECONNABORTED is how axios surfaces our own
        // REQUEST_TIMEOUT_MS, which is the exact shape that duplicated a public comment.
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT'
            || error.code === 'EPIPE' || error.code === 'ECONNABORTED') {
            return { waitMs: TRANSIENT_RETRY_WAIT_MS, proven: false, reason: error.code.toLowerCase() };
        }
    }

    return null;
}

const instance = axios.create({ timeout: REQUEST_TIMEOUT_MS });

// Guard: when axios is auto-mocked in tests, create() returns undefined
export const fbAxios = instance ?? axios;

if (instance?.interceptors) {
    instance.interceptors.response.use(undefined, async (error: AxiosError) => {
        const cfg = error.config as RetryConfig | undefined;
        if (!cfg) return Promise.reject(error);

        const decision = classifyRetry(error);
        if (!decision) return Promise.reject(error);

        // Unknown method → treated as non-idempotent (fail closed).
        const method = (cfg.method ?? '').toLowerCase();
        const idempotent = IDEMPOTENT_METHODS.has(method);

        // RFC 9110 §9.2.2 — the safety property this interceptor exists to hold.
        // An ambiguous failure on a non-idempotent write is handed to the caller, whose
        // job-level retry owns the de-duplication context (see the header comment).
        const base = {
            method: method || 'unknown',
            url: cfg.url,
            reason: decision.reason,
            proven: decision.proven,
            status: error.response?.status,
        };

        if (!decision.proven && !idempotent) {
            emit({ outcome: 'retry_suppressed', ...base });
            return Promise.reject(error);
        }

        const retryCount = cfg._retryCount ?? 0;
        if (retryCount >= MAX_RETRIES) {
            emit({ outcome: 'exhausted', ...base, attempt: retryCount });
            return Promise.reject(error);
        }

        cfg._retryCount = retryCount + 1;
        emit({ outcome: 'retried', ...base, attempt: cfg._retryCount, waitMs: decision.waitMs });
        await sleep(decision.waitMs);
        return instance(cfg);
    });
}

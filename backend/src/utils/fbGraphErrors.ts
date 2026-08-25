import axios from 'axios';

/**
 * Classification of why a DM send failed. Drives fallback behavior in sender.ts
 * and Instagram comment adapter — see docs/comment-and-message-handling.md.
 *
 * - customer_refused: customer blocked us / account gone. Silent skip, no public post.
 * - window_expired:   outside 24h messaging window. Nudge only (never full reply).
 * - transient:        rate limit, network, 5xx. Retry, never leak full reply.
 * - our_fault:        bad token / missing permission. Page-level integration alert.
 * - thread_owned_elsewhere: another app owns the conversation via Meta's Handover
 *                     Protocol — our sends are rejected while its session lasts.
 *                     Channel-level conflict, NOT page-level: pausing the page
 *                     would kill the healthy channels too (the MES case: IG dead,
 *                     FB fine). Fix is merchant-side (disconnect the other tool).
 * - unknown:          unmatched. Safe default = no public post, log for triage.
 */
export type DmFailureBucket =
    | 'customer_refused'
    | 'window_expired'
    | 'transient'
    | 'our_fault'
    | 'thread_owned_elsewhere'
    | 'unknown';

export type FbPlatform = 'facebook' | 'instagram';

export interface DmFailure {
    bucket: DmFailureBucket;
    code?: number;
    subcode?: number;
    fbMessage?: string;
    rawMessage: string;
    /**
     * True when the failure came from the TRANSPORT (network error, or a 5xx from
     * Graph) rather than from Facebook rejecting the request on its merits.
     *
     * Load-bearing beyond the bucket: Graph answers some 5xx responses with a
     * populated `error.code` — including 190 — and a consumer that reads the code
     * alone cannot tell "your token is revoked" from "Facebook was briefly
     * broken". `pageTokenRecovery` clears the stored token and emails the merchant
     * on that distinction, so a `DmFailure` that cannot carry the flag lets a
     * Graph outage present as every page in the fleet being revoked at once.
     *
     * `bucket` does not cover it: a payload-bearing 5xx is bucketed by its code
     * (`our_fault`, `customer_refused`, …), never `transient`.
     */
    isTransport?: boolean;
}

/**
 * Thrown by facebook.sendPrivateReplyToComment / instagram DM send when the
 * Graph API returns an error. Preserves structured fields so callers can
 * classify without re-parsing the message string.
 */
export class DmSendError extends Error {
    readonly code?: number;
    readonly subcode?: number;
    readonly type?: string;
    readonly isTransport: boolean;

    constructor(
        message: string,
        fields: { code?: number; subcode?: number; type?: string; isTransport?: boolean } = {},
    ) {
        super(message);
        this.name = 'DmSendError';
        this.code = fields.code;
        this.subcode = fields.subcode;
        this.type = fields.type;
        this.isTransport = fields.isTransport ?? false;
    }

    /**
     * Build a DmSendError from an AxiosError raised by a Graph API call.
     * Extracts structured Graph error fields and flags transport-layer failures
     * (network errors or 5xx) so `classifyDmError` can bucket them as transient.
     * `options.verboseDetail` appends "(code=…, subcode=…, type=…)" to the message
     * for log/debug contexts where the raw text carries extra diagnostic value.
     */
    static fromAxios(
        error: import('axios').AxiosError,
        prefix: string,
        options: { verboseDetail?: boolean } = {},
    ): DmSendError {
        const fields = extractFbErrorFields(error, options);
        return new DmSendError(`${prefix}: ${fields.detail}`, {
            code: fields.code,
            subcode: fields.subcode,
            type: fields.type,
            isTransport: fields.isTransport,
        });
    }
}

/**
 * Thrown by non-DM Graph API calls (token exchange, /me/accounts, /debug_token, etc.)
 * when Facebook returns an error. Same shape as DmSendError but used in contexts
 * where the DM-specific bucket classification doesn't apply.
 *
 * Callers (e.g. tokenRefresh) should inspect `code`/`subcode`/`isTransport` directly
 * to decide whether the error indicates a real token revocation vs. a transient blip.
 */
export class FacebookApiError extends Error {
    readonly code?: number;
    readonly subcode?: number;
    readonly type?: string;
    readonly isTransport: boolean;

    constructor(
        message: string,
        fields: { code?: number; subcode?: number; type?: string; isTransport?: boolean } = {},
    ) {
        super(message);
        this.name = 'FacebookApiError';
        this.code = fields.code;
        this.subcode = fields.subcode;
        this.type = fields.type;
        this.isTransport = fields.isTransport ?? false;
    }

    /**
     * Build a FacebookApiError from an AxiosError raised by a Graph API call.
     * Same extraction logic as DmSendError.fromAxios — preserves Graph error
     * code/subcode/type and flags transport-layer failures (network or 5xx).
     */
    static fromAxios(
        error: import('axios').AxiosError,
        prefix: string,
        options: { verboseDetail?: boolean } = {},
    ): FacebookApiError {
        const fields = extractFbErrorFields(error, options);
        return new FacebookApiError(`${prefix}: ${fields.detail}`, {
            code: fields.code,
            subcode: fields.subcode,
            type: fields.type,
            isTransport: fields.isTransport,
        });
    }
}

/**
 * Shared extraction of structured fields from an AxiosError thrown by a Graph API call.
 * Used by both DmSendError.fromAxios and FacebookApiError.fromAxios.
 */
function extractFbErrorFields(
    error: import('axios').AxiosError,
    options: { verboseDetail?: boolean } = {},
): { code?: number; subcode?: number; type?: string; isTransport: boolean; detail: string } {
    const fbError = (error.response?.data as { error?: { message?: string; code?: unknown; error_subcode?: unknown; type?: unknown } } | undefined)?.error;
    const code = typeof fbError?.code === 'number' ? fbError.code : undefined;
    const subcode = typeof fbError?.error_subcode === 'number' ? fbError.error_subcode : undefined;
    const type = typeof fbError?.type === 'string' ? fbError.type : undefined;
    const baseMessage = fbError?.message || error.message;
    const detail = options.verboseDetail && fbError
        ? `${baseMessage} (code=${code ?? 'n/a'}, subcode=${subcode ?? 'n/a'}, type=${type ?? 'n/a'})`
        : baseMessage;
    const isTransport = !error.response || (error.response.status >= 500 && error.response.status < 600);
    return { code, subcode, type, isTransport, detail };
}

/**
 * FB error code/subcode pairs that indicate the user's token is **definitively
 * revoked or invalid** and the page should be marked disconnected.
 *
 * Anything not in this table is treated as transient (retry-worthy) — that's
 * the conservative default that prevents the bulk-clear bug where one transient
 * error could disconnect all of a user's pages.
 *
 * Reference: https://developers.facebook.com/docs/graph-api/guides/error-handling/
 */
const TOKEN_REVOKED_CODES: Record<string, true> = {
    '190|458': true, // Session invalidated (user logged out elsewhere)
    '190|459': true, // User checkpointed (FB security review)
    '190|460': true, // Password changed
    '190|463': true, // Token expired (60-day limit reached)
    '190|467': true, // Invalid OAuth access token
    '200|10':  true, // Permission revoked
};

/**
 * Returns true if the error is a FacebookApiError (or DmSendError) with a
 * code/subcode pair indicating the underlying token is genuinely revoked or
 * permanently invalid. Plain `Error` instances and transient errors return false
 * — callers should retry rather than clear tokens for those.
 */
export function isTokenRevoked(error: unknown): boolean {
    if (!(error instanceof FacebookApiError) && !(error instanceof DmSendError)) {
        return false;
    }
    if (error.isTransport) return false;
    if (error.code === undefined) return false;
    const key = error.subcode !== undefined
        ? `${error.code}|${error.subcode}`
        : `${error.code}`;
    if (TOKEN_REVOKED_CODES[key]) return true;
    // code-only fallback for code 190 (any subcode we haven't enumerated yet
    // is still very likely a token issue — FB only uses 190 for OAuth errors)
    if (error.code === 190) return true;
    return false;
}

// Graph error code/subcode → bucket lookup. Keyed by "platform|code|subcode"
// for exact matches, with "platform|code" as a fallback when subcode is absent.
// Additions should cite Meta's error docs. Unmatched entries fall through to 'unknown'.
const BUCKET_TABLE: Record<string, DmFailureBucket> = {
    // customer_refused — customer blocked, account gone, or messaging restricted
    'facebook|10|2534014':  'customer_refused',  // user has messaging restricted
    'instagram|10|2534014': 'customer_refused',
    'facebook|551':         'customer_refused',  // "This person isn't available right now"
    'facebook|100|2018001': 'customer_refused',  // No matching user found (private-reply-to-comment)
    'instagram|100|2018001':'customer_refused',
    'facebook|100|1893060': 'customer_refused',  // "No matching user for the field user" — privacy-locked / friends-only DM commenter
    'instagram|100|1893060':'customer_refused',
    'facebook|10903|1893062':'customer_refused', // "This user can't reply to this activity" — commenter has restrictions
    'facebook|10903|1893049':'customer_refused', // same family, different subcode variant
    'facebook|10903':        'customer_refused', // catch other 10903 subcodes (fallback)

    // window_expired — outside 24h messaging window
    'facebook|10|2018278':  'window_expired',
    'instagram|10|2018278': 'window_expired',
    'facebook|10|2534022':  'window_expired',  // same error, subcode used by IG messaging ("This message is sent outside of allowed window")
    'instagram|10|2534022': 'window_expired',

    // transient — retry-worthy
    'facebook|613':         'transient',         // rate limited
    'instagram|613':        'transient',
    'facebook|4':           'transient',         // app-level rate limit
    'instagram|4':          'transient',
    'facebook|17':          'transient',         // user request limit
    'facebook|-1|2018012':  'transient',         // "Unexpected internal error" — FB-side glitch, retry

    // our_fault — merchant integration issue
    'facebook|190':         'our_fault',         // access token invalid/expired
    'instagram|190':        'our_fault',
    'facebook|200':         'our_fault',         // permission error (e.g. missing pages_messaging)
    'instagram|200':        'our_fault',
    'facebook|10|2018065':  'our_fault',         // cannot message users not on the page (config)
    'facebook|2500':        'our_fault',         // "An active access token must be used" — token missing/revoked
    'instagram|2500':       'our_fault',

    // thread_owned_elsewhere — Handover Protocol conflict: another app holds the
    // conversation, every send bounces until its ownership session expires or the
    // merchant disconnects the tool. Diagnosed live on MES 2026-08-08: a competing
    // IG-Login app seized each thread at creation (+24h per incoming message) and
    // 100% of IG replies died with this exact pair while Facebook kept working.
    // "(#100) The action is invalid since it's not the thread owner."
    'instagram|100|2534037': 'thread_owned_elsewhere',
    'facebook|100|2534037':  'thread_owned_elsewhere',
};

function lookupBucket(platform: FbPlatform, code: number | undefined, subcode: number | undefined): DmFailureBucket | undefined {
    if (code === undefined) return undefined;
    if (subcode !== undefined) {
        const exact = BUCKET_TABLE[`${platform}|${code}|${subcode}`];
        if (exact) return exact;
    }
    return BUCKET_TABLE[`${platform}|${code}`];
}

function isTransientAxiosStatus(status: number | undefined): boolean {
    return status !== undefined && status >= 500 && status < 600;
}

/**
 * True when the error is a retry-worthy transient FB failure (rate limit, 5xx,
 * -1/2018012 "Unexpected internal error", network blip). Reply pipeline catches
 * (commentProcessor + messageProcessor) use this to decide whether to rethrow
 * for BullMQ retry vs. swallow into success:false.
 *
 * Accepts the platform as a loose string so callers don't have to narrow it —
 * unknown values fall back to 'facebook' (the dominant code path).
 */
export function isTransientFbError(err: unknown, platform: string): boolean {
    const fbPlatform: FbPlatform = platform === 'instagram' ? 'instagram' : 'facebook';
    return classifyDmError(err, fbPlatform).bucket === 'transient';
}

/**
 * Build the `dm_failed` flag_meta payload from a classified DM failure —
 * the single shape both reply pipelines persist (comments AND messages), so
 * a send failure is always diagnosable from the flagged row alone. Undefined
 * fields are omitted, matching the historical comment-path shape byte-for-byte.
 */
export function buildDmFailedFlagMeta(f: DmFailure): import('@jawab24/shared').FlagMeta {
    return {
        dm_failed: {
            bucket: f.bucket,
            ...(f.code !== undefined ? { code: f.code } : {}),
            ...(f.subcode !== undefined ? { subcode: f.subcode } : {}),
            ...(f.fbMessage ? { fbMessage: f.fbMessage } : {}),
        },
    };
}

/**
 * Classify a DM-send error into a behavioral bucket. Accepts DmSendError
 * (preferred, structured), AxiosError (extracts from response.data.error),
 * or anything else (falls through to 'unknown').
 */
export function classifyDmError(err: unknown, platform: FbPlatform): DmFailure {
    // 1. Preferred: structured error from our own wrapper
    if (err instanceof DmSendError) {
        if (err.isTransport) {
            return {
                bucket: 'transient',
                rawMessage: err.message,
            };
        }
        const bucket = lookupBucket(platform, err.code, err.subcode) ?? 'unknown';
        return {
            bucket,
            code: err.code,
            subcode: err.subcode,
            fbMessage: err.message,
            rawMessage: err.message,
            isTransport: false,
        };
    }

    // 2. AxiosError — extract Graph error payload
    if (axios.isAxiosError(err)) {
        const fbError = err.response?.data?.error;
        if (fbError) {
            const code = typeof fbError.code === 'number' ? fbError.code : undefined;
            const subcode = typeof fbError.error_subcode === 'number' ? fbError.error_subcode : undefined;
            const bucket = lookupBucket(platform, code, subcode) ?? 'unknown';
            return {
                bucket,
                code,
                subcode,
                fbMessage: typeof fbError.message === 'string' ? fbError.message : undefined,
                rawMessage: err.message,
                // A 5xx can arrive WITH a Graph payload, code and all. The bucket
                // is chosen from that code, so it cannot carry this: a 500 whose
                // body says 190 buckets as `our_fault`, not `transient`. Consumers
                // that act on the code — pageTokenRecovery clears the token and
                // mails the merchant — need the transport fact separately.
                isTransport: !err.response || isTransientAxiosStatus(err.response.status),
            };
        }
        // No Graph payload: network/timeout/5xx
        if (!err.response || isTransientAxiosStatus(err.response?.status)) {
            return { bucket: 'transient', rawMessage: err.message };
        }
        return { bucket: 'unknown', rawMessage: err.message };
    }

    // 3. Custom errors that self-declare retryability (e.g. WhatsAppApiError from
    //    a 5xx/429/network failure). Keeps the transient decision channel-agnostic
    //    so no `platform === 'whatsapp'` branch has to leak into the reply pipeline
    //    (see DECISIONS D-016). DmSendError/AxiosError are handled above, so FB/IG
    //    errors never reach here — their behavior is unchanged.
    if (err instanceof Error && (err as { transient?: unknown }).transient === true) {
        return { bucket: 'transient', rawMessage: err.message };
    }

    // 3b. Self-declared Meta auth-expiry (code 190) on a non-FB/IG channel — today
    //     that means a WhatsApp business token, which Meta forces to expire every 60
    //     days. Duck-typed on `metaCode` for the same reason as the `transient` check
    //     above: it keeps the decision channel-agnostic instead of leaking a
    //     `platform === 'whatsapp'` branch into the core (DECISIONS D-016).
    //
    //     What this does and does NOT do — an earlier comment here overclaimed:
    //     `pageAutoPause` treats 'our_fault' and 'unknown' identically (both are
    //     PAGE_LEVEL_BUCKETS), so this does NOT save any customer message from the
    //     auto-pause threshold. What actually protects those messages is the adapter
    //     flagging the number on the first 190. This branch's real effect is a
    //     correct, legible bucket for anything that reads the classification.
    //     FB/IG never reach here — their 190 is already mapped in BUCKET_TABLE.
    if (err instanceof Error && (err as { metaCode?: unknown }).metaCode === 190) {
        return { bucket: 'our_fault', code: 190, fbMessage: err.message, rawMessage: err.message };
    }

    // 4. Plain Error or unknown shape
    if (err instanceof Error) {
        return { bucket: 'unknown', rawMessage: err.message };
    }
    return { bucket: 'unknown', rawMessage: String(err) };
}

/**
 * Thrown by aiService.generateReply when AI is unavailable for a permanent
 * (non-transient) reason — e.g. AI_ENABLED=false env config. Even though the
 * cause is permanent, `isTransientAiError` returns true for this error so the
 * row reaches needs_attention via the existing `flagStuckJobOnFinalFailure`
 * mechanism after retries exhaust. The alternative (return success:false on
 * first sight) would leave messages stuck without a flag — invisible to the
 * merchant. The 3 wasted retries when AI is truly disabled are cheap insurance.
 *
 * What the merchant must NEVER see, regardless: a fake templated
 * "Thank you for your message!" reply mid-conversation.
 */
export class AiUnavailableError extends Error {
    constructor(message = 'AI is unavailable') {
        super(message);
        this.name = 'AiUnavailableError';
    }
}

/**
 * Thrown by the e-commerce tool loop when the AI keeps requesting tool calls
 * past the configured round limit without producing a final reply. Treated as
 * transient — a single inference run can get stuck; a retry may succeed.
 */
export class AiToolLoopExhaustedError extends Error {
    readonly rounds: number;
    constructor(rounds: number, message?: string) {
        super(message ?? `E-commerce tool loop exhausted after ${rounds} rounds`);
        this.name = 'AiToolLoopExhaustedError';
        this.rounds = rounds;
    }
}

/**
 * Thrown when ai-worker's OpenAI request times out (APIUserAbortError). Transient
 * because the same input on retry usually succeeds — a network blip, a load spike
 * at OpenAI, or our own `OPENAI_TIMEOUT_MS` being too tight.
 */
export class AiTimeoutError extends Error {
    constructor(timeoutMs?: number, message?: string) {
        super(message ?? `AI request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`);
        this.name = 'AiTimeoutError';
    }
}

/**
 * Thrown when OpenAI's structured-output guard returns a `refusal` field instead
 * of generating content. Non-transient: the same input produces the same refusal
 * on retry. Surface to merchant as needs_attention with the refusal reason so
 * they can fix KB / brand voice / post content that's tripping the policy gate.
 */
export class AiRefusalError extends Error {
    readonly refusalReason: string;
    constructor(refusalReason: string, message?: string) {
        super(message ?? `OpenAI refused to generate a reply: ${refusalReason}`);
        this.name = 'AiRefusalError';
        this.refusalReason = refusalReason;
    }
}

/**
 * Thrown when post-generation validation strips the reply down to <10 chars
 * (bot-words filter at openai.ts:880-892). Non-transient: the filter is
 * deterministic, so the same input produces the same empty result. Surface to
 * merchant as needs_attention so they can review prompt/brand voice/KB.
 */
export class AiEmptyReplyError extends Error {
    constructor(message = 'AI reply was empty after content filtering') {
        super(message);
        this.name = 'AiEmptyReplyError';
    }
}

/**
 * Reconstructed (by name) from the ai-worker's typed 500 when OpenAI returns
 * 429 `insufficient_quota` — the account is out of credit / hit its billing
 * limit. Persistent (won't recover in BullMQ's 2s/4s/8s window) but self-heals
 * the instant billing is topped up. The reply pipeline does NOT flag this as
 * needs_attention; instead the worker PARKS the job (long-delay re-enqueue, see
 * `planAiPark` + replyWorker park-and-retry) so the message auto-replies once
 * credit returns, and ai.ts fires a throttled "top up OpenAI" alert.
 *
 * Classified transient in `isTransientAiError` so the processor rethrows it
 * (rather than swallowing into success:false) — that's what lets it reach the
 * worker's catch where the parking decision is made.
 */
export class AiQuotaExhaustedError extends Error {
    constructor(message = 'OpenAI quota exhausted (insufficient_quota)') {
        super(message);
        this.name = 'AiQuotaExhaustedError';
    }
}

/**
 * True when an error raised from `aiService.generateReply` or the e-commerce
 * tool loop should be rethrown so BullMQ retries the job. Mirrors
 * `isTransientFbError`: reply-pipeline outer catches use this alongside the
 * FB classifier.
 *
 * Genuinely transient (will succeed on retry):
 *  - axios network error (no `error.response`) or 5xx response from the ai-worker
 *  - Node socket-level errors: ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN,
 *    ECONNRESET, EPIPE
 *  - AbortError / timed-out fetch
 *  - CircuitOpenError thrown by the ai-worker circuit breaker
 *  - `AiToolLoopExhaustedError` (one bad run; retry may produce a final reply)
 *
 * Permanent but still classified true here so the row is flagged on retry
 * exhaustion (via `flagStuckJobOnFinalFailure`) instead of being silently
 * swallowed into success:false where the merchant would never see it:
 *  - `AiUnavailableError` (AI_ENABLED=false misdeploy)
 *
 * The 3 wasted retries for permanent errors are negligible compared to the
 * cost of a message disappearing without a needs_attention flag.
 *
 * Returns false for unknown errors so the existing success:false path is
 * preserved — preventing this change from accidentally widening retry scope.
 */
const TRANSIENT_NODE_ERR_CODES = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'EPIPE',
]);

export function isTransientAiError(err: unknown): boolean {
    if (err instanceof AiToolLoopExhaustedError) return true;
    if (err instanceof AiUnavailableError) return true;
    if (err instanceof AiTimeoutError) return true;

    // Quota exhaustion is permanent-until-topped-up, but classified transient
    // here so the processor rethrows it up to the worker's catch — where
    // `planAiPark` re-enqueues it with a long delay instead of flagging. The
    // park budget (replyWorker) bounds how long it retries before giving up.
    if (err instanceof AiQuotaExhaustedError) return true;

    // Non-transient: same input → same refusal / same empty filter result.
    // Retrying wastes API calls AND delays the needs_attention flag the merchant
    // needs to act on the underlying KB / brand-voice / policy issue.
    if (err instanceof AiRefusalError) return false;
    if (err instanceof AiEmptyReplyError) return false;

    // Circuit breaker — checked by name to avoid a circular import on circuitBreaker.ts
    if (err instanceof Error && err.name === 'CircuitOpenError') return true;

    if (axios.isAxiosError(err)) {
        if (!err.response) return true; // network-level failure (no HTTP response)
        if (err.response.status >= 500 && err.response.status < 600) return true;
        return false;
    }

    if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException).code;
        if (typeof code === 'string' && TRANSIENT_NODE_ERR_CODES.has(code)) return true;
        if (err.name === 'AbortError') return true;
        // Intentionally NOT matching on err.message — that would over-classify
        // any error with "timeout" / "network" in its text (including ones
        // raised from non-AI code paths like pagesService) as retry-worthy.
    }

    return false;
}

/**
 * True when an AI error should bypass BullMQ retry and immediately flag the row
 * as needs_attention. Used by commentProcessor / messageProcessor outer catches:
 * refusal / empty-after-filter won't fix themselves on retry, and the merchant
 * needs to see the failure so they can adjust KB / brand voice / post content.
 */
export function needsImmediateAttention(err: unknown): boolean {
    return err instanceof AiRefusalError || err instanceof AiEmptyReplyError;
}


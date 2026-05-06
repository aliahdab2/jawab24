import axios from 'axios';

/**
 * Classification of why a DM send failed. Drives fallback behavior in sender.ts
 * and Instagram comment adapter — see docs/comment-and-message-handling.md.
 *
 * - customer_refused: customer blocked us / account gone. Silent skip, no public post.
 * - window_expired:   outside 24h messaging window. Nudge only (never full reply).
 * - transient:        rate limit, network, 5xx. Retry, never leak full reply.
 * - our_fault:        bad token / missing permission. Page-level integration alert.
 * - unknown:          unmatched. Safe default = no public post, log for triage.
 */
export type DmFailureBucket =
    | 'customer_refused'
    | 'window_expired'
    | 'transient'
    | 'our_fault'
    | 'unknown';

export type FbPlatform = 'facebook' | 'instagram';

export interface DmFailure {
    bucket: DmFailureBucket;
    code?: number;
    subcode?: number;
    fbMessage?: string;
    rawMessage: string;
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
            };
        }
        // No Graph payload: network/timeout/5xx
        if (!err.response || isTransientAxiosStatus(err.response?.status)) {
            return { bucket: 'transient', rawMessage: err.message };
        }
        return { bucket: 'unknown', rawMessage: err.message };
    }

    // 3. Plain Error or unknown shape
    if (err instanceof Error) {
        return { bucket: 'unknown', rawMessage: err.message };
    }
    return { bucket: 'unknown', rawMessage: String(err) };
}

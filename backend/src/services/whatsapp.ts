import axios from 'axios';
import { createHmac } from 'crypto';
import { config } from '../config';

/**
 * Graph base URL, resolved LAZILY.
 *
 * Reading `config` at module load made merely IMPORTING this file (directly or
 * through any service that touches WhatsApp) require a fully-populated config —
 * so an unrelated suite with a partial config mock failed at import time with an
 * opaque "cannot read graphApiVersion". Resolve per call instead: same value,
 * no import-time coupling.
 */
function whatsappApiBase(): string {
    return `https://graph.facebook.com/${config.facebook.graphApiVersion}`;
}

/**
 * Outcome of a read-receipt / typing-indicator call. Cosmetic by design: the
 * call never throws and never blocks a reply, but the result is reported so the
 * caller can log a miss instead of discarding it silently.
 */
export interface ReceiptResult {
    delivered: boolean;
    /** Meta's error message when `delivered` is false. Secret-free. */
    reason?: string;
}

/** WhatsApp Cloud API media metadata (GET /{media-id}) */
export interface WhatsAppMediaInfo {
    url: string;
    mimeType: string;
    fileSize: number;
}

/** Voice notes cap well below this; guards the buffer download. */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Meta error code 190 — "Your access token has expired." The merchant must
 * reconnect; no retry will help.
 *
 * Key on the code, NOT on error_subcode (463/467): Meta treats the subcodes as
 * unreliable and they are absent from the WhatsApp error-code reference entirely.
 */
export const META_TOKEN_EXPIRED = 190;

/** Result of a debug_token inspection — see whatsappService.debugToken. */
export interface WhatsAppTokenDebugInfo {
    isValid: boolean;
    /** undefined when the token never expires (Meta reports expires_at = 0). */
    expiresAt?: Date;
    /** Independent ~90-day data-access clock; can lapse before the token itself. */
    dataAccessExpiresAt?: Date;
    scopes: string[];
    /** WABA ids still covered by whatsapp_business_management on this token. */
    wabaIds: string[];
    errorMessage?: string;
}

/**
 * Per-request socket timeout for Cloud API calls. Without it (axios default is
 * 0 = infinite) a stalled socket to graph.facebook.com would hang a webhook /
 * send worker indefinitely. Matches fbAxios's REQUEST_TIMEOUT_MS.
 */
const WHATSAPP_TIMEOUT_MS = 15_000;

/**
 * Sanitized WhatsApp Cloud API error. Carries only Meta's error code + message
 * — never the axios `config`/`headers`/`request`, which hold the FB app secret
 * (code-exchange `client_secret`) and the WABA bearer token. Throwing this
 * instead of the raw AxiosError makes it impossible to leak those into logs
 * (pino's default `err` serializer walks enumerable props). See callers'
 * `metaCode` reads for the 133005 / 131047 branch logic.
 */
export class WhatsAppApiError extends Error {
    readonly metaCode?: number;
    /**
     * True when the failure is retry-worthy (network/timeout, 429, 5xx) rather
     * than permanent (bad token, 24h window, invalid recipient). The reply
     * pipeline reads this — via `classifyDmError` — to decide whether to rethrow
     * for a BullMQ retry instead of marking the reply `delivery_failed` and
     * counting it toward the defensive page auto-pause.
     */
    readonly transient: boolean;
    constructor(message: string, metaCode?: number, transient = false) {
        super(message);
        this.name = 'WhatsAppApiError';
        this.metaCode = metaCode;
        this.transient = transient;
    }
}

function sanitizeWhatsAppError(error: unknown): WhatsAppApiError {
    const ax = error as {
        response?: { status?: number; data?: { error?: { code?: number; message?: string } } };
        message?: string;
    };
    const meta = ax?.response?.data?.error;
    // Same rule the FB/IG classifier uses (see classifyDmError): no HTTP response
    // (network/timeout) or a 429 / 5xx is transient; a 4xx (bad token, 24h window,
    // invalid recipient) is permanent.
    const status = ax?.response?.status;
    const transient = status === undefined || status === 429 || (status >= 500 && status < 600);
    return new WhatsAppApiError(meta?.message || ax?.message || 'WhatsApp API request failed', meta?.code, transient);
}

/**
 * WhatsApp Cloud API Service
 *
 * Thin wrapper around the Meta WhatsApp Cloud API.
 * Uses the same Graph API version and auth as Facebook/Instagram.
 * Every outbound call routes through `request()` so a failure throws a
 * secret-free WhatsAppApiError rather than the raw (secret-bearing) AxiosError.
 */
class WhatsAppService {
    /** Run an axios call, converting any failure to a secret-free error. */
    private async request<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            throw sanitizeWhatsAppError(error);
        }
    }

    /**
     * Send a text message to a WhatsApp user.
     * @returns The WhatsApp message ID (wamid)
     */
    async sendTextMessage(
        phoneNumberId: string,
        recipientPhone: string,
        text: string,
        accessToken: string,
    ): Promise<string> {
        const res = await this.request(() => axios.post(
            `${whatsappApiBase()}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'text',
                text: { body: text },
            },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
        ));
        return res.data?.messages?.[0]?.id ?? '';
    }

    /**
     * Send a pre-approved template message (HSM).
     *
     * This is the ONLY way to open a conversation the customer did not start:
     * order/cart notifications reach people who may never have messaged the
     * merchant, so there is no 24h customer-service window to send free-form
     * text into. Meta bills these as UTILITY (and free inside an open window).
     *
     * `bodyParams` fill `{{1}}`, `{{2}}`, … in template order. Meta REJECTS an
     * empty string parameter (error 132000-family), so callers must substitute a
     * meaningful filler — never `''` — before calling.
     *
     * @returns The WhatsApp message ID (wamid)
     */
    async sendTemplateMessage(
        phoneNumberId: string,
        recipientPhone: string,
        templateName: string,
        languageCode: string,
        bodyParams: string[],
        accessToken: string,
    ): Promise<string> {
        const res = await this.request(() => axios.post(
            `${whatsappApiBase()}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    ...(bodyParams.length > 0 && {
                        components: [{
                            type: 'body',
                            parameters: bodyParams.map(text => ({ type: 'text', text })),
                        }],
                    }),
                },
            },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
        ));
        return res.data?.messages?.[0]?.id ?? '';
    }

    // ================== Message templates (WABA-scoped) ==================

    /**
     * Submit a message template to the merchant's own WABA for Meta review.
     *
     * Idempotency: Meta rejects a duplicate (name, language) with error 100
     * subcode 2388023 ("template name already exists"). Callers treat that as
     * success — the template is already there, which is the desired end state.
     *
     * @returns Meta's template id, or '' when the name already existed.
     */
    async createMessageTemplate(
        wabaId: string,
        accessToken: string,
        template: {
            name: string;
            language: string;
            /** Body text with `{{1}}`-style placeholders. */
            body: string;
            /** Example values per placeholder — Meta requires them to review the template. */
            bodyExamples: string[];
        },
    ): Promise<string> {
        const res = await this.request(() => axios.post(
            `${whatsappApiBase()}/${wabaId}/message_templates`,
            {
                name: template.name,
                language: template.language,
                category: 'UTILITY',
                components: [{
                    type: 'BODY',
                    text: template.body,
                    ...(template.bodyExamples.length > 0 && {
                        example: { body_text: [template.bodyExamples] },
                    }),
                }],
            },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
        ));
        return res.data?.id ?? '';
    }

    /**
     * Read a template's review status on the merchant's WABA.
     * @returns Meta's status (`APPROVED` / `PENDING` / `REJECTED` / …), or null
     *          when no template with that name+language exists.
     */
    async getMessageTemplateStatus(
        wabaId: string,
        accessToken: string,
        name: string,
        language: string,
    ): Promise<string | null> {
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/${wabaId}/message_templates`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { name, fields: 'name,language,status', limit: 50 },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        const rows = (res.data?.data ?? []) as Array<{ name?: string; language?: string; status?: string }>;
        const match = rows.find(r => r.name === name && r.language === language);
        return match?.status ?? null;
    }

    /**
     * Mark a message as read (blue ticks) and, when a reply will follow, show
     * the typing indicator while it is generated. One Cloud API call does both;
     * WhatsApp clears the indicator when our reply arrives or after 25s —
     * comfortably above the reply-delay + AI-generation window. Meta's guidance:
     * only show typing if you are going to respond, hence the flag.
     */
    async markAsRead(
        phoneNumberId: string,
        messageId: string,
        accessToken: string,
        options: { typing?: boolean } = {},
    ): Promise<ReceiptResult> {
        try {
            await axios.post(
                `${whatsappApiBase()}/${phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId,
                    ...(options.typing ? { typing_indicator: { type: 'text' } } : {}),
                },
                { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
            );
            return { delivered: true };
        } catch (error) {
            // Still swallowed — receipts are cosmetic and must NEVER block a reply.
            // But the outcome is now returned so the caller can log it with request
            // context: a bare `.catch(() => {})` made "the typing indicator doesn't
            // always appear" impossible to diagnose, because a rejected call and a
            // successful one looked identical from outside (founder report
            // 2026-07-27). The reason comes from sanitizeWhatsAppError, which reads
            // only Meta's error code/message — never `config` or the bearer header.
            return { delivered: false, reason: sanitizeWhatsAppError(error).message };
        }
    }

    // ================== Embedded Signup (connect flow) ==================

    /**
     * Exchange the Embedded Signup auth code for a business integration
     * system-user access token.
     *
     * Two grant shapes share this method and differ ONLY in redirect_uri:
     * - popup flow (JS SDK `fb.login`): the code is minted without a redirect —
     *   redirect_uri MUST be omitted or Meta rejects the exchange;
     * - redirect flow (full-page dialog/oauth): the code is bound to the
     *   authorization request's redirect_uri — the exchange MUST repeat it
     *   byte-for-byte.
     */
    async exchangeCodeForToken(code: string, redirectUri?: string): Promise<{ token: string; expiresIn?: number }> {
        // NOTE: `client_secret` travels as a query param because that is the shape
        // Meta documents for this grant — it is not an access token, so it cannot be
        // moved to an Authorization header. The consequence is that the app secret
        // lands in the request URL, and the Sentry SDK records the raw query string
        // of every outgoing request as a breadcrumb (`http.query`) and span
        // attribute (`http.url`). That is scrubbed centrally in `lib/sentry.ts`
        // (`beforeBreadcrumb` / `beforeSend` / `beforeSendTransaction`) rather than
        // here, because the same leak applies to every Graph call that takes a
        // credential in the URL. Do not remove that scrubbing.
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/oauth/access_token`, {
            params: {
                client_id: config.facebook.appId,
                client_secret: config.facebook.appSecret,
                code,
                ...(redirectUri ? { redirect_uri: redirectUri } : {}),
            },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        const token = res.data?.access_token;
        if (!token) throw new WhatsAppApiError('Embedded Signup code exchange returned no access_token');
        // expires_in (seconds) is what tells us this merchant's token has a deadline.
        // Meta forces a 60-day expiry on the WhatsApp Embedded Signup login variation,
        // so this is normally ~5184000. Absent/0 means no expiry — the caller stores
        // NULL rather than inventing a date. Discarding it (the original behaviour)
        // left us unable to warn a merchant before their number went silent.
        const rawExpiresIn = res.data?.expires_in;
        const expiresIn = typeof rawExpiresIn === 'number' && rawExpiresIn > 0 ? rawExpiresIn : undefined;
        return { token, expiresIn };
    }

    /**
     * Inspect a stored business token via Graph's debug_token.
     *
     * Authenticated with the APP access token (`{app-id}|{app-secret}`), never the
     * token under test: an app access token cannot itself expire, so the health
     * checker can't go stale, and we still learn `is_valid: false` for a token that
     * is already dead. Meta's own Embedded Signup docs use debug_token this way.
     *
     * Server-side only — the app secret must never reach a client.
     */
    async debugToken(inputToken: string): Promise<WhatsAppTokenDebugInfo> {
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/debug_token`, {
            params: {
                input_token: inputToken,
                access_token: `${config.facebook.appId}|${config.facebook.appSecret}`,
            },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        const data = res.data?.data;
        // Require a RECOGNISABLE debug_token body before believing anything it says.
        //
        // `data?.data ?? {}` used to silently produce `{}` for any HTTP 200 that was
        // not the expected shape — a Meta partial outage, a WAF/proxy interstitial, an
        // HTML error page, a field rename. `{}` then read as `is_valid: false`, i.e.
        // "this merchant's token is dead", for every page in the sweep, with nothing
        // thrown for the retry logic to catch. Absence of a positive signal is not
        // evidence of a negative one: throw so the caller's transient path retries.
        if (!data || typeof data !== 'object' || typeof data.is_valid !== 'boolean') {
            throw new WhatsAppApiError('debug_token returned an unrecognised body', undefined, true);
        }
        // expires_at === 0 means "never expires" (Meta's documented sentinel for
        // non-expiring tokens). Mapping it to undefined — rather than new Date(0) —
        // is load-bearing: a 1970 date would read as "expired 56 years ago" and make
        // the sweep disconnect every healthy token it saw.
        const expiresAtSec = typeof data.expires_at === 'number' && data.expires_at > 0 ? data.expires_at : undefined;
        const dataAccessExpiresAtSec = typeof data.data_access_expires_at === 'number' && data.data_access_expires_at > 0
            ? data.data_access_expires_at
            : undefined;
        return {
            isValid: data.is_valid === true,
            expiresAt: expiresAtSec ? new Date(expiresAtSec * 1000) : undefined,
            // A SECOND, independent clock (~90 days): a token string can be unexpired
            // while the app's access to the customer's data has lapsed, and either can
            // fire first. Callers must consider both.
            dataAccessExpiresAt: dataAccessExpiresAtSec ? new Date(dataAccessExpiresAtSec * 1000) : undefined,
            scopes: Array.isArray(data.scopes) ? data.scopes.filter((s: unknown): s is string => typeof s === 'string') : [],
            // WABA ids this token still covers, per scope. A shrinking list is how a
            // PARTIAL revocation shows up (customer unshared one WABA) — invisible to
            // an is_valid check on its own.
            wabaIds: Array.isArray(data.granular_scopes)
                ? (data.granular_scopes as Array<{ scope?: string; target_ids?: unknown }>)
                    .filter(g => g?.scope === 'whatsapp_business_management')
                    .flatMap(g => Array.isArray(g.target_ids) ? g.target_ids.filter((t): t is string => typeof t === 'string') : [])
                : [],
            errorMessage: typeof data.error?.message === 'string' ? data.error.message : undefined,
        };
    }

    /**
     * List the phone numbers on a WABA.
     *
     * Exists for the REDIRECT connect flow: a full-page OAuth return carries
     * only a `code` — no `postMessage` session info — so the phone number(s)
     * must be discovered from the token's own assets (debugToken().wabaIds →
     * this call). `platform_type` is the coexistence signal: `SMB_APP` means
     * the number still lives on the merchant's WhatsApp Business app and must
     * NEVER be Cloud-API-registered; `CLOUD_API` means Meta migrated it.
     * `last_onboarded_time` orders candidates when a WABA holds several.
     */
    async listWabaPhoneNumbers(
        wabaId: string,
        accessToken: string,
    ): Promise<Array<{
        id: string;
        displayPhoneNumber: string;
        verifiedName: string;
        platformType?: string;
        lastOnboardedTime?: string;
    }>> {
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/${wabaId}/phone_numbers`, {
            params: { fields: 'id,display_phone_number,verified_name,platform_type,last_onboarded_time' },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        return rows
            .filter((r: { id?: unknown }): r is { id: string } & Record<string, unknown> => typeof r.id === 'string' && r.id.length > 0)
            .map((r: Record<string, unknown>) => ({
                id: r.id as string,
                displayPhoneNumber: typeof r.display_phone_number === 'string' ? r.display_phone_number : '',
                verifiedName: typeof r.verified_name === 'string' ? r.verified_name : '',
                platformType: typeof r.platform_type === 'string' ? r.platform_type : undefined,
                lastOnboardedTime: typeof r.last_onboarded_time === 'string' ? r.last_onboarded_time : undefined,
            }));
    }

    /**
     * Subscribe our app to the merchant's WABA so message webhooks are
     * delivered to our /webhook endpoint.
     */
    async subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
        await this.request(() => axios.post(
            `${whatsappApiBase()}/${wabaId}/subscribed_apps`,
            {},
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
        ));
    }

    /**
     * Register the phone number for Cloud API messaging. Required once after
     * Embedded Signup before the number can send. The two-step-verification
     * PIN is derived deterministically (see derivePin) so re-registration
     * after a disconnect uses the same PIN without storing it.
     */
    async registerPhoneNumber(phoneNumberId: string, accessToken: string): Promise<void> {
        await this.request(() => axios.post(
            `${whatsappApiBase()}/${phoneNumberId}/register`,
            {
                messaging_product: 'whatsapp',
                pin: this.derivePin(phoneNumberId),
            },
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: WHATSAPP_TIMEOUT_MS },
        ));
    }

    /**
     * Deterministic 6-digit two-step-verification PIN per phone number.
     * HMAC(appSecret, phoneNumberId) — reproducible on reconnect, never stored.
     */
    derivePin(phoneNumberId: string): string {
        const digest = createHmac('sha256', config.facebook.appSecret)
            .update(`wa-pin:${phoneNumberId}`)
            .digest();
        return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
    }

    /** Fetch display number + verified business name for a connected phone. */
    async getPhoneNumberInfo(
        phoneNumberId: string,
        accessToken: string,
    ): Promise<{ displayPhoneNumber: string; verifiedName: string }> {
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/${phoneNumberId}`, {
            params: { fields: 'display_phone_number,verified_name' },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        return {
            displayPhoneNumber: res.data?.display_phone_number ?? '',
            verifiedName: res.data?.verified_name ?? '',
        };
    }

    // ================== Media (incoming attachments) ==================

    /**
     * Resolve a webhook media ID to its short-lived CDN URL.
     * WhatsApp media URLs expire after ~5 minutes and require the bearer
     * token to download (unlike FB/IG public CDN URLs).
     */
    async getMediaInfo(mediaId: string, accessToken: string): Promise<WhatsAppMediaInfo> {
        const res = await this.request(() => axios.get(`${whatsappApiBase()}/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        return {
            url: res.data?.url ?? '',
            mimeType: res.data?.mime_type ?? 'application/octet-stream',
            fileSize: Number(res.data?.file_size ?? 0),
        };
    }

    /** Download media content with the bearer token. Returns null if oversized. */
    async downloadMedia(url: string, accessToken: string): Promise<Buffer | null> {
        const res = await this.request(() => axios.get<ArrayBuffer>(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            responseType: 'arraybuffer',
            maxContentLength: MAX_MEDIA_BYTES,
            timeout: WHATSAPP_TIMEOUT_MS,
        }));
        const buf = Buffer.from(res.data);
        if (buf.length === 0 || buf.length > MAX_MEDIA_BYTES) return null;
        return buf;
    }
}

export const whatsappService = new WhatsAppService();

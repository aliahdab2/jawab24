import axios from 'axios';
import { createHmac } from 'crypto';
import { config } from '../config';

const WHATSAPP_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

/** WhatsApp Cloud API media metadata (GET /{media-id}) */
export interface WhatsAppMediaInfo {
    url: string;
    mimeType: string;
    fileSize: number;
}

/** Voice notes cap well below this; guards the buffer download. */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

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
            `${WHATSAPP_API}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'text',
                text: { body: text },
            },
            { headers: { Authorization: `Bearer ${accessToken}` } },
        ));
        return res.data?.messages?.[0]?.id ?? '';
    }

    /**
     * Mark a message as read (shows blue ticks to the sender).
     * Used as the "typing indicator" equivalent for WhatsApp.
     */
    async markAsRead(
        phoneNumberId: string,
        messageId: string,
        accessToken: string,
    ): Promise<void> {
        await axios.post(
            `${WHATSAPP_API}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            },
            { headers: { Authorization: `Bearer ${accessToken}` } },
        ).catch(() => {
            // Fire-and-forget — blue ticks are cosmetic
        });
    }

    // ================== Embedded Signup (connect flow) ==================

    /**
     * Exchange the Embedded Signup auth code for a business integration
     * system-user access token. Unlike the login OAuth flow, ES codes are
     * exchanged without a redirect_uri.
     */
    async exchangeCodeForToken(code: string): Promise<string> {
        const res = await this.request(() => axios.get(`${WHATSAPP_API}/oauth/access_token`, {
            params: {
                client_id: config.facebook.appId,
                client_secret: config.facebook.appSecret,
                code,
            },
        }));
        const token = res.data?.access_token;
        if (!token) throw new WhatsAppApiError('Embedded Signup code exchange returned no access_token');
        return token;
    }

    /**
     * Subscribe our app to the merchant's WABA so message webhooks are
     * delivered to our /webhook endpoint.
     */
    async subscribeAppToWaba(wabaId: string, accessToken: string): Promise<void> {
        await this.request(() => axios.post(
            `${WHATSAPP_API}/${wabaId}/subscribed_apps`,
            {},
            { headers: { Authorization: `Bearer ${accessToken}` } },
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
            `${WHATSAPP_API}/${phoneNumberId}/register`,
            {
                messaging_product: 'whatsapp',
                pin: this.derivePin(phoneNumberId),
            },
            { headers: { Authorization: `Bearer ${accessToken}` } },
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
        const res = await this.request(() => axios.get(`${WHATSAPP_API}/${phoneNumberId}`, {
            params: { fields: 'display_phone_number,verified_name' },
            headers: { Authorization: `Bearer ${accessToken}` },
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
        const res = await this.request(() => axios.get(`${WHATSAPP_API}/${mediaId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
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
            timeout: 15_000,
        }));
        const buf = Buffer.from(res.data);
        if (buf.length === 0 || buf.length > MAX_MEDIA_BYTES) return null;
        return buf;
    }
}

export const whatsappService = new WhatsAppService();

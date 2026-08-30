/**
 * Zid e-commerce service — OAuth, Merchant API, product sync, webhook registration.
 *
 * Contract verified against docs.zid.sa (2026-08-01) — the previous implementation
 * was built on an assumed contract and never round-tripped a real store (D-020).
 * Key facts:
 * - DUAL-HEADER auth on every Merchant API call:
 *     `Authorization: Bearer <authorization token>`  (the token response's `Authorization` field)
 *     `X-Manager-Token: <access token>`              (the token response's `access_token` field)
 *   The store API (`/v1/products/`) additionally requires a `Store-Id` header (the
 *   numeric merchant id); `Role: Manager` is NOT required (verified live 2026-08-22).
 * - OAuth: https://oauth.zid.sa/oauth/{authorize,token}; token lifetime ~1 year.
 * - Endpoints live under https://api.zid.sa — store profile is
 *   /v1/managers/account/profile, orders are /v1/managers/store/orders,
 *   products are /v1/products/ (not under /managers, but still Manager-role).
 * - Webhooks: POST /v1/managers/webhooks {event, target_url, original_id,
 *   username?, password?}; deliveries carry `Authorization: Basic …` (NO HMAC).
 *
 * PROVISIONAL parsers: response/payload field shapes not yet confirmed against a
 * live dev store are read shape-tolerantly and marked with [provisional] — the
 * live-validation phase (docs/integrations/zid.md) finalizes them from captures.
 */
import { z } from 'zod';
import { tracedExternalCall } from '../utils/tracing';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import {
    getStoreById,
    replaceProductsAndRebuildSummary,
    applySyncedStoreInfo,
    setStorePoliciesSummary,
    PRODUCT_SAFETY_CAP,
    type WebhookRegistrationResult,
    type NormalizedProduct,
    type PlatformProductDetail,
} from './ecommerce';
import { stripHtml } from '../utils/htmlUtils';
import { verifyBasicAuthHeader } from '../utils/basicAuthVerify';
import { ecommerceApiGet, EcommerceApiHttpError } from '../utils/httpRetry';
import {
    normalizeHttpUrl,
    normalizePhoneEntries,
    phoneEntryNumber,
    samePhoneNumber,
    type BusinessProfile,
} from '@jawab24/shared';
import { applyStoreFactsToLinkedPages, reportStoreFactDrop } from './storeFactsSync';
import {
    refreshAccessToken as sharedRefreshAccessToken,
    ensureValidToken as sharedEnsureValidToken,
    resolveStoreCredentialPair,
    getStoresNeedingTokenRefresh as sharedGetStoresNeedingTokenRefresh,
    refreshExpiringTokens as sharedRefreshExpiringTokens,
    type TokenRefreshConfig,
} from './ecommerceTokenRefresh';

const PRODUCTS_PAGE_SIZE = 100;
// Derived from the shared product cap (like Salla) — never a silent hard truncation.
const MAX_PRODUCT_PAGES_TO_FETCH = Math.ceil(PRODUCT_SAFETY_CAP / PRODUCTS_PAGE_SIZE);
// lookupOrder asks Zid's `search_term` first; these bound the FALLBACK scan of
// recent orders, which is why they are not a ceiling on findable orders anymore.
const ORDERS_PAGE_SIZE = 100;
const MAX_ORDER_PAGES_TO_SCAN = 3;
/** A number identifies ONE order; the rest of a fuzzy search hit is noise. */
const CODE_LOOKUP_MAX_CANDIDATES = 10;
const ERROR_TEXT_MAX_LENGTH = 200;

/** Fixed username for the Basic-auth pair on webhook subscriptions (password = ZID_WEBHOOK_SECRET). */
export const ZID_WEBHOOK_BASIC_USER = 'jawab24';

const ZID_TOKEN_REFRESH_CONFIG: TokenRefreshConfig = {
    platform: 'zid',
    tokenEndpointUrl: 'https://oauth.zid.sa/oauth/token',
    get clientId() { return config.zid.clientId; },
    get clientSecret() { return config.zid.clientSecret; },
};

/**
 * The credentials every Zid Merchant API call needs.
 * `managerToken` = OAuth `access_token` → sent as `X-Manager-Token`.
 * `authorizationToken` = OAuth `Authorization` field → sent as `Authorization: Bearer`.
 * `storeId` = the Zid numeric store id (`platformData.merchantId`) → sent as `Store-Id`.
 *   REQUIRED by the non-`/managers/` store API (e.g. `GET /v1/products/`): without it that
 *   endpoint returns `401 {"detail":"No such user"}` regardless of the tokens (captured
 *   live 2026-08-22). The `/managers/*` endpoints resolve the store from the token and do
 *   not need it, so it is optional here and only sent when present.
 */
export interface ZidCredentials {
    managerToken: string;
    authorizationToken: string;
    storeId?: string;
}

// --- OAuth ---

export function buildAuthUrl(state: string): string {
    const { clientId, hostName, scopes } = config.zid;
    const redirectUri = `https://${hostName}/zid/auth/callback`;
    return (
        `https://oauth.zid.sa/oauth/authorize` +
        `?client_id=${clientId}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&state=${state}`
    );
}

export interface ZidTokenResponse {
    accessToken: string;
    /** Zid's second credential (`Authorization` field) — required for all API calls. */
    authorizationToken: string;
    refreshToken: string;
    /**
     * Seconds. Live-captured 2026-08-22 on dev store 3195980: Zid grants **3 years**
     * (`token_expires_at` landed on 2029-08-22 for a grant made 2026-08-22), not the
     * "typically 1 year" this comment used to claim. Consequence worth knowing: the
     * shared refresher fires 24h before expiry (`ecommerceTokenRefresh.ts`), so on a
     * real store the refresh path cannot run naturally until 2029 — §F-1 has to force
     * it by shrinking the column, and until someone does, that path is untested.
     */
    expiresIn: number;
}

export async function exchangeCodeForToken(code: string): Promise<ZidTokenResponse> {
    const { clientId, clientSecret, hostName } = config.zid;
    const redirectUri = `https://${hostName}/zid/auth/callback`;

    // application/x-www-form-urlencoded per RFC 6749 (Salla rejected JSON with
    // "POST body can not be empty" — same class of endpoint; confirmed live for
    // the refresh grant via the shared refresher, which already sends form data).
    const response = await tracedExternalCall('zid', 'exchangeCodeForToken', () =>
        fetch('https://oauth.zid.sa/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }).toString(),
        }),
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Zid token exchange failed: ${response.status} ${text}`);
    }

    const data = await response.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        Authorization?: string;
        authorization?: string;
    };

    // The docs name the field `Authorization` — read both casings defensively.
    const authorizationToken = data.Authorization ?? data.authorization;
    if (!authorizationToken) {
        // Without it every Merchant API call 401s later with no obvious cause —
        // fail fast at the exchange with a diagnosable error instead.
        throw new Error('Zid token exchange succeeded but response has no Authorization token field');
    }

    return {
        accessToken: data.access_token,
        authorizationToken,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
    };
}

// --- Webhook Verification (Basic auth — Zid sends NO HMAC signature) ---

/**
 * Verify a webhook delivery's `Authorization` header against the Basic-auth pair
 * our subscriptions were registered with (username jawab24 / password =
 * ZID_WEBHOOK_SECRET). Timing-safe. Fails closed on missing header/secret.
 */
export function verifyWebhookBasicAuth(authorizationHeader: string | undefined): boolean {
    return verifyBasicAuthHeader(authorizationHeader, ZID_WEBHOOK_BASIC_USER, config.zid.webhookSecret);
}

// --- App Market lifecycle deliveries (Partner Dashboard, NOT per-store) ---

/**
 * App-lifecycle (`app.market.application.*`) and subscription
 * (`app.market.subscription.*`) events are configured once in the Zid PARTNER
 * DASHBOARD — they are never registered through /v1/managers/webhooks, so no
 * username/password can be attached to them, and Zid delivers them with NO
 * `Authorization` header at all. Captured live 2026-08-30 (ZID_TEST_PLAN C11):
 * UA `GuzzleHttp/7`, headers host/x-request-id/traceparent only. The Basic
 * gate therefore cannot apply to them; they are verified against Zid's API
 * instead (services/zidLifecycle.ts, D-114). Per-store events keep the gate.
 */
export const ZID_LIFECYCLE_EVENT_PREFIX = 'app.market.';

export function isZidLifecycleEvent(event: string): boolean {
    return event.startsWith(ZID_LIFECYCLE_EVENT_PREFIX);
}

export type ZidTokenProbe = 'valid' | 'revoked' | 'unreachable';

/**
 * Ask Zid whether OUR credential for this store is still alive.
 *
 * Reads the store profile — a `/v1/managers/*` endpoint, which resolves the
 * store from the token and ignores `Store-Id`, so a 401 here means exactly
 * "token revoked". (The store API at `/v1/products/` also 401s on a MISSING
 * `Store-Id`, which would make it useless as a probe — see resolveZidCredentials.)
 * Zid invalidates the store's tokens when the merchant uninstalls, which is what
 * turns an unauthenticated uninstall delivery into proof: the delivery says
 * "uninstalled", the dead token confirms it. 403 is folded into `revoked`
 * because the install flow itself reads this endpoint with the same token, so a
 * valid token is never forbidden here.
 */
export async function probeZidToken(creds: ZidCredentials): Promise<ZidTokenProbe> {
    try {
        await zidApiGet('https://api.zid.sa/v1/managers/account/profile', creds);
        return 'valid';
    } catch (err) {
        if (err instanceof EcommerceApiHttpError && (err.status === 401 || err.status === 403)) {
            return 'revoked';
        }
        return 'unreachable';
    }
}

// --- Webhook Registration ---

// Verified event slugs (docs.zid.sa "Supported Webhook Events", 2026-08-01;
// abandoned_cart.* re-verified 2026-08-25 — created fires after ~10 min of cart
// inactivity, completed when the customer later finishes checkout).
// Deliberately excluded: order.payment_status.update (no consumer yet), customer.*/category.*.
// App lifecycle (app.market.application.install/uninstall) is configured in the
// Zid Partner Dashboard — it is NOT registered through /v1/managers/webhooks,
// so it must not appear in this list (webhookTopicDrift asserts the adapter copy).
export const ZID_WEBHOOK_EVENTS = [
    'product.create',
    'product.update',
    'product.publish',
    'product.delete',
    'order.create',
    'order.status.update',
    'abandoned_cart.created',
    'abandoned_cart.completed',
] as const;

export type ZidWebhookEvent = typeof ZID_WEBHOOK_EVENTS[number];

export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}

export function isOrderEvent(event: string): boolean {
    return event.startsWith('order.');
}

export function isAbandonedCartEvent(event: string): boolean {
    return event.startsWith('abandoned_cart.');
}

/**
 * Subscribe all Zid webhooks for a store via POST /v1/managers/webhooks.
 *
 * Each subscription's target_url embeds routing hints (`e` = event, `sid` = our
 * store UUID) because the delivery envelope is not yet confirmed to carry either
 * — the handler resolves store/event from the query string first, then falls
 * back to body fields [provisional — live captures may simplify this].
 */
export async function registerWebhooks(creds: ZidCredentials, storeId: string): Promise<WebhookRegistrationResult> {
    // Topics subscribed in parallel — see services/salla.ts for rationale.
    const registered: string[] = [];
    const failed: Array<{ topic: string; status?: number; error?: string }> = [];

    const results = await Promise.allSettled(ZID_WEBHOOK_EVENTS.map(event => {
        const targetUrl = `https://${config.zid.hostName}/zid/webhooks?e=${encodeURIComponent(event)}&sid=${encodeURIComponent(storeId)}`;
        return tracedExternalCall('zid', 'registerWebhook', () =>
            fetch('https://api.zid.sa/v1/managers/webhooks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${creds.authorizationToken}`,
                    'X-Manager-Token': creds.managerToken,
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    event,
                    target_url: targetUrl,
                    original_id: config.zid.appId,
                    // Zid authenticates deliveries with this pair (Basic auth) —
                    // there is no signature header to verify instead.
                    username: ZID_WEBHOOK_BASIC_USER,
                    password: config.zid.webhookSecret,
                }),
            }).then(async response => ({ event, response, body: response.ok ? '' : await response.text() })),
        );
    }));

    for (let i = 0; i < results.length; i++) {
        const event = ZID_WEBHOOK_EVENTS[i];
        const result = results[i];
        if (result.status === 'rejected') {
            const err = result.reason;
            failed.push({ topic: event, error: err instanceof Error ? err.message : String(err) });
            captureError(err, `Zid webhook registration error: ${event}`, { tags: { service: 'zid' } });
            continue;
        }
        const { response, body } = result.value;
        if (response.ok) {
            registered.push(event);
        } else if (response.status === 409 || response.status === 422) {
            // Already-exists — treat as success (Salla 422 precedent;
            // Zid's exact duplicate status is unconfirmed, both tolerated).
            registered.push(event);
        } else {
            failed.push({ topic: event, status: response.status, error: body.slice(0, ERROR_TEXT_MAX_LENGTH) });
            captureError(
                new Error(`Zid webhook registration failed: ${event} ${response.status}`),
                `Zid webhook registration failed: ${event}`,
                { tags: { service: 'zid' }, extra: { event, status: response.status, body } }
            );
        }
    }

    return { registered, failed, lastAttempt: new Date().toISOString() };
}

// --- Merchant API helper (dual-header auth) ---

export function zidApiGet<T = unknown>(url: string, creds: ZidCredentials, extraHeaders?: Record<string, string>): Promise<T> {
    return ecommerceApiGet<T>(url, {
        platform: 'zid',
        authHeaderValue: `Bearer ${creds.authorizationToken}`,
        extraHeaders: {
            'X-Manager-Token': creds.managerToken,
            // The store API keys off Store-Id; harmless on /managers/* calls that ignore it.
            ...(creds.storeId ? { 'Store-Id': creds.storeId } : {}),
            ...extraHeaders,
        },
    });
}

// --- Store Info ---

/**
 * Fetch the manager profile and map it to the shared OAuthStoreInfo shape.
 * storeDomain = hostname of the store URL (the unique (platform, storeDomain)
 * key), falling back to the numeric store id; merchantId = String(store.id)
 * (the webhook fallback key). Envelope read shape-tolerantly [provisional].
 */
/**
 * A profile field was dropped because its shape is unreadable. Reported, never
 * thrown: the drop itself is the correct handling (cosmetic fields must not
 * abort an install), but a SILENT drop is how the next envelope drift stays
 * invisible until it breaks something that matters — the exact failure mode of
 * the 2026-08-11 install (a green suite, a broken wire). The storage-layer
 * guard (fitStoreScalars) can't see these: by the time it runs, the boundary
 * has already collapsed the value to `undefined`.
 *
 * Absence is not drift: `null`/`undefined` are how JSON says "no value", and a
 * bare/blank string failing the content rule is emptiness, not a shape change —
 * neither is reported. Only the VALUE's type ships to Sentry, never the value:
 * profile fields carry merchant PII (email).
 */
function reportProfileFieldDrop(field: string, input: unknown): void {
    if (input === undefined || input === null || typeof input === 'string') return;
    captureError(
        new Error(`Zid profile field '${field}' has an unreadable shape — dropped`),
        'Zid profile field drop',
        {
            level: 'warning',
            fingerprint: ['zid-profile-field-drop', field],
            tags: { service: 'zid', action: 'profile-parse' },
            extra: { field, receivedType: Array.isArray(input) ? 'array' : typeof input },
        },
    );
}

/**
 * A descriptive (non-identity) profile field. Any shape we cannot read collapses
 * to `undefined` instead of failing the parse: these fields are cosmetic, and an
 * App Market install must never abort because a display value drifted. The
 * `.catch()` is what makes that structural rather than a promise — without it a
 * single unexpected object fails the whole `parse` and takes the install with it.
 */
const zidOptionalText = (field: string) =>
    z.string().trim().min(1).optional().catch(({ input }) => {
        reportProfileFieldDrop(field, input);
        return undefined;
    });

/**
 * Zid sends `currency` as an OBJECT — `{id, name, code, symbol, country}` —
 * confirmed by the first live App Market install (2026-08-11, store
 * a0xxorvfi5.zid.store). The previous code declared `currency?: string`, so the
 * whole object was passed through to a `varchar(10)` and Postgres `22001`
 * aborted the install. The docs implied a bare string, so both shapes are
 * accepted and normalised to the ISO code.
 */
const zidOptionalCurrencyCode = z.union([
    z.string().trim().min(1),
    z.object({ code: z.string().trim().min(1) }).transform((c) => c.code),
]).optional().catch(({ input }) => {
    // An object without a readable `code` is drift worth knowing about even
    // though objects are now the expected envelope — the field still ends up
    // empty for the merchant.
    reportProfileFieldDrop('currency', input);
    return undefined;
});

/**
 * The store node of `/v1/managers/account/profile`.
 *
 * `id` is the only REQUIRED field: it is the store's identity, it seeds
 * `storeDomain` when no URL is present, and a store we cannot identify is a
 * genuine hard failure (the pre-existing behaviour, preserved). Everything else
 * degrades to `undefined` — validate at the boundary, but never let a decorative
 * field decide whether a merchant can install.
 *
 * `passthrough()` keeps unknown keys rather than stripping them: Zid's envelope
 * is still only partly captured, and a strict schema would turn every future
 * field Zid adds into a silent loss.
 */
const ZidStoreProfileSchema = z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: zidOptionalText('title'),
    name: zidOptionalText('name'),
    email: zidOptionalText('email'),
    currency: zidOptionalCurrencyCode,
    url: zidOptionalText('url'),
    domain: zidOptionalText('domain'),
    // Store facts (D-102). `phone` is documented as a string; `mobile_object`
    // references Zid's StoreMobileObject schema whose live shape is uncaptured,
    // so it stays `unknown` and is read defensively in mapZidStoreFacts.
    phone: zidOptionalText('phone'),
    website: zidOptionalText('website'),
    mobile_object: z.unknown().optional(),
}).passthrough();

type ZidStoreProfile = z.infer<typeof ZidStoreProfileSchema>;

/**
 * Map the Zid store profile to a BusinessProfile fragment (phones + website —
 * the D-102 phase-1 scope; Zid exposes no WhatsApp/hours on the profile).
 * Pure and throw-free: unreadable fields are dropped + reported, never abort
 * the sync.
 */
export function mapZidStoreFacts(store: ZidStoreProfile): BusinessProfile {
    const facts: BusinessProfile = {};

    const candidates: string[] = [];
    if (store.phone) candidates.push(store.phone);

    // mobile_object: accept a bare string, or {country_code?, mobile} where
    // mobile may itself be a string/number. Anything else is reported drift.
    const mo = store.mobile_object;
    if (typeof mo === 'string' && mo.trim() !== '') {
        candidates.push(mo);
    } else if (mo && typeof mo === 'object') {
        const o = mo as { country_code?: unknown; mobile?: unknown };
        const mobile = (typeof o.mobile === 'string' || typeof o.mobile === 'number') ? String(o.mobile).trim() : '';
        if (mobile !== '') {
            const code = typeof o.country_code === 'string' || typeof o.country_code === 'number' ? String(o.country_code).trim() : '';
            const full = mobile.startsWith('+') || code === '' ? mobile : `${code.startsWith('+') ? code : `+${code}`}${mobile}`;
            candidates.push(full);
        } else {
            reportStoreFactDrop('zid', 'mobile_object', mo);
        }
    } else if (mo !== undefined && mo !== null) {
        reportStoreFactDrop('zid', 'mobile_object', mo);
    }

    const phones = normalizePhoneEntries(candidates).filter((entry, i, arr) =>
        arr.findIndex(e => samePhoneNumber(phoneEntryNumber(e), phoneEntryNumber(entry))) === i);
    if (phones.length > 0) facts.phones = phones;

    // Website: the merchant's own site when set (docs: null when the Zid
    // store is their only web presence), else the storefront URL.
    const site = store.website || store.url;
    if (site) {
        const url = normalizeHttpUrl(site);
        if (url) facts.website = url;
    }

    return facts;
}

export async function fetchStoreInfo(creds: ZidCredentials) {
    const data = await zidApiGet<Record<string, unknown>>(
        'https://api.zid.sa/v1/managers/account/profile',
        creds,
    );

    // Docs show the profile under `user`, with the store object nested — but the
    // exact nesting is unconfirmed, so the plausible shapes are still tried in
    // order here rather than encoded in the schema. Resolving the NODE is a
    // lookup; validating its CONTENTS is the schema's job, below.
    const user = (data.user ?? data) as Record<string, unknown>;
    const parsed = ZidStoreProfileSchema.safeParse(user.store ?? data.store);

    if (!parsed.success) {
        throw new Error('Zid profile response has no usable store object — cannot resolve store identity');
    }
    const store = parsed.data;

    const rawUrl = store.url || store.domain || '';
    let storeDomain = store.id;
    if (rawUrl) {
        try {
            storeDomain = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname;
        } catch {
            storeDomain = rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || storeDomain;
        }
    }

    const email = store.email ?? zidOptionalText('user.email').parse(user.email);

    return {
        storeName: store.title || store.name || undefined,
        storeEmail: email,
        storeCurrency: store.currency,
        storeDomain,
        merchantId: store.id,
        /** Mapped store-facts fragment (D-102) — see mapZidStoreFacts. */
        storeFacts: mapZidStoreFacts(store),
        /** Raw facts subset — audit snapshot for platformData.storeFacts. */
        factsRaw: { phone: store.phone, website: store.website, url: store.url, mobile_object: store.mobile_object },
    };
}

// --- Shipping & payment options → policiesSummary (D-116) ---

/**
 * Zid keeps a merchant's return/exchange policy as a dashboard "legal page" that
 * no partner API reads (verified live 2026-08-30: the storefront Pages API serves
 * custom pages only). What IS structured and documented is what the storefront's
 * own «الشحن والدفع» page is generated from — the enabled shipping methods
 * (docs.zid.sa/list-store-delivery-options, scope `shipping.read`) and the
 * enabled payment methods with their fees (docs.zid.sa/list-of-payment-method,
 * scope `account.read`). That is what lands in `policiesSummary`; the return
 * policy stays merchant-authored in Business Info.
 *
 * [provisional] Both parsers read only DOCUMENTED fields and tolerate the rest —
 * the first live capture (docs/testing/zid_live_payloads.jsonl) pins them.
 */
const ZID_DELIVERY_OPTIONS_URL = 'https://api.zid.sa/v1/managers/store/delivery-options?payload_type=simple';
const ZID_PAYMENT_METHODS_URL = 'https://api.zid.sa/v1/managers/store/payment-methods';
/** Per-line cap — the summary competes for the ~200-char policy slot in getEnrichedKnowledgeBase. */
const POLICY_LINE_MAX_CHARS = 300;
const POLICY_MAX_ITEMS = 12;
/**
 * `status` on a delivery option is documented only as "current operational
 * state" — its vocabulary is uncaptured. Unknown values are LISTED (a courier the
 * merchant configured is more likely live than not); only these read as off.
 */
const INACTIVE_STATES = new Set(['inactive', 'disabled', 'deactivated', 'off', 'false', '0']);

export interface ZidStorePolicyFacts {
    /** Enabled shipping method names, in Zid's order, deduped. */
    shipping: string[];
    /** Enabled payment method names, «(رسوم …)» appended when the method carries a fee. */
    payment: string[];
}

/** `enabled` is documented as 1/0 and exemplified as `true` — accept both spellings. */
function zidEnabled(v: unknown): boolean {
    return v === true || v === 1 || v === '1' || v === 'true';
}

/** A fee string Zid renders as zero («0 SAR», «0.00») is no fee. */
function zidFeeIsZero(fees: string): boolean {
    return /^0+([.,]0+)?(\s|$)/.test(fees);
}

/** `delivery_options[].{name,status}` → enabled method names. Pure and throw-free. */
export function mapZidDeliveryOptions(raw: unknown): string[] {
    const list = (raw as { delivery_options?: unknown } | null)?.delivery_options;
    if (!Array.isArray(list)) {
        reportStoreFactDrop('zid', 'delivery_options', raw);
        return [];
    }
    const names: string[] = [];
    for (const item of list) {
        const opt = item as { name?: unknown; status?: unknown };
        const name = localizedText(opt?.name as string | { ar?: string; en?: string } | undefined).trim();
        if (!name) {
            reportStoreFactDrop('zid', 'delivery_options.name', item);
            continue;
        }
        const status = typeof opt.status === 'string' ? opt.status.trim().toLowerCase()
            : opt.status === false ? 'false' : undefined;
        if (status && INACTIVE_STATES.has(status)) continue;
        if (!names.includes(name)) names.push(name);
    }
    return names;
}

/** `payload[].{enabled,name,fees_string}` → enabled method labels. Pure and throw-free. */
export function mapZidPaymentMethods(raw: unknown): string[] {
    const list = (raw as { payload?: unknown } | null)?.payload;
    if (!Array.isArray(list)) {
        reportStoreFactDrop('zid', 'payment_methods', raw);
        return [];
    }
    const labels: string[] = [];
    for (const item of list) {
        const method = item as { enabled?: unknown; name?: unknown; fees_string?: unknown };
        if (!zidEnabled(method?.enabled)) continue;
        const name = localizedText(method?.name as string | { ar?: string; en?: string } | undefined).trim();
        if (!name) {
            reportStoreFactDrop('zid', 'payment_methods.name', item);
            continue;
        }
        const fees = typeof method.fees_string === 'string' ? method.fees_string.trim() : '';
        const label = fees && !zidFeeIsZero(fees) ? `${name} (رسوم ${fees})` : name;
        if (!labels.includes(label)) labels.push(label);
    }
    return labels;
}

function zidPolicyLine(label: string, items: string[]): string {
    const shown = items.slice(0, POLICY_MAX_ITEMS);
    const more = items.length - shown.length;
    const text = `${label}: ${shown.join('، ')}${more > 0 ? ` (+${more})` : ''}`;
    return text.length > POLICY_LINE_MAX_CHARS ? `${text.slice(0, POLICY_LINE_MAX_CHARS - 1)}…` : text;
}

/**
 * Render the facts as the `policiesSummary` text the reply pipeline reads
 * (`[store_policies]`, same slot Shopify's `Shipping:`/`Returns:` lines use).
 * فصحى labels — the AI mirrors the customer's register itself. `null` when the
 * store has neither, which `storeAnswersPolicies` reads as "cannot answer".
 */
export function buildZidPoliciesSummary(facts: ZidStorePolicyFacts): string | null {
    const lines: string[] = [];
    if (facts.shipping.length > 0) lines.push(zidPolicyLine('خيارات الشحن', facts.shipping));
    if (facts.payment.length > 0) lines.push(zidPolicyLine('طرق الدفع', facts.payment));
    return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Sync the store's shipping & payment options into `policiesSummary`.
 * FAIL-SOFT AND WRITE-NOTHING on any fetch failure: a missing scope or a Zid
 * outage must neither abort the product sync it precedes nor erase the text the
 * model is answering from today. Both reads must succeed before anything is
 * written — a half summary (payment without shipping) would read as a policy.
 */
export async function syncPolicies(
    storeId: string,
    creds?: ZidCredentials,
): Promise<{ policiesSummary: string | null | undefined }> {
    const resolved = creds ?? await resolveZidCredentials(storeId);
    if (!resolved) throw new Error('Store not found');

    let delivery: unknown;
    let payment: unknown;
    try {
        [delivery, payment] = await Promise.all([
            zidApiGet<unknown>(ZID_DELIVERY_OPTIONS_URL, resolved),
            zidApiGet<unknown>(ZID_PAYMENT_METHODS_URL, resolved),
        ]);
    } catch (err) {
        captureError(err, 'Zid shipping/payment fetch failed — store policies not synced', {
            level: 'warning',
            tags: { service: 'zid', action: 'sync-policies' },
            extra: { storeId },
        });
        return { policiesSummary: undefined };
    }

    const policiesSummary = buildZidPoliciesSummary({
        shipping: mapZidDeliveryOptions(delivery),
        payment: mapZidPaymentMethods(payment),
    });
    await setStorePoliciesSummary(storeId, policiesSummary);
    return { policiesSummary };
}

// --- Embedded Apps (docs.zid.sa/embedded-apps) ---

/**
 * Register the embedded-app lookup UUID with Zid. When the merchant opens the
 * app inside the Zid Merchant Dashboard, Zid loads our Application URL in an
 * iframe with this UUID as `?token=` — POST /zid/embedded/session
 * (services/embeddedSession.ts) resolves it back to the store (via its SHA-256,
 * stored on ecommerce_stores.embedded_token_hash) and opens a WORKSPACE-SCOPED
 * session with no sign-in prompt. The docs mandate a short UUID
 * rather than the Authorization JWT (URL truncation) and a NEW UUID on every
 * reinstall (the old one goes stale at Zid's side).
 */
export async function registerEmbeddedToken(creds: ZidCredentials, embeddedToken: string): Promise<void> {
    const response = await tracedExternalCall('zid', 'registerEmbeddedToken', () =>
        fetch('https://api.zid.sa/v1/managers/embedded-apps-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${creds.authorizationToken}`,
                'X-Manager-Token': creds.managerToken,
                'Accept': 'application/json',
            },
            body: JSON.stringify({ token: embeddedToken }),
        }),
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Zid embedded-token registration failed: ${response.status} ${text.slice(0, ERROR_TEXT_MAX_LENGTH)}`);
    }
}

/**
 * Revoke the embedded-app token at Zid (uninstall path). Zid invalidates the
 * store's OAuth tokens at uninstall, so this call may legitimately fail —
 * callers treat it as best-effort and clear the local hash regardless.
 */
export async function deleteEmbeddedToken(creds: ZidCredentials): Promise<void> {
    const response = await tracedExternalCall('zid', 'deleteEmbeddedToken', () =>
        fetch('https://api.zid.sa/v1/managers/embedded-apps-token', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${creds.authorizationToken}`,
                'X-Manager-Token': creds.managerToken,
                'Accept': 'application/json',
            },
        }),
    );
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Zid embedded-token deletion failed: ${response.status} ${text.slice(0, ERROR_TEXT_MAX_LENGTH)}`);
    }
}

// --- Products (REST, page-based) ---

/** [provisional] Field shapes pending live captures — read tolerantly. */
interface ZidProduct {
    id: string | number;
    // Zid product names may be multilingual objects ({ar, en}) or plain strings.
    name: string | { ar?: string; en?: string };
    description?: string | { ar?: string; en?: string }; // May be HTML — stripped before storage
    status?: string;
    price?: number;
    sale_price?: number | null;
    currency?: string;
    quantity?: number | null;
    /**
     * Zid's "unlimited stock" flag. When true the product is always orderable and
     * `quantity` comes back `null` — it is NOT out of stock. Live-verified on the
     * dev store (3195980) with "Sony A7S III": `is_infinite: true, quantity: null`.
     */
    is_infinite?: boolean;
    sku?: string | null;
    html_url?: string;
    slug?: string | null;
    handle?: string | null;
    images?: Array<{ url?: string; image?: { full_size?: string } }>;
    categories?: Array<{ name?: string | { ar?: string; en?: string } }>;
    has_options?: boolean;
    has_variants?: boolean;
    options?: Array<{
        name?: string | { ar?: string; en?: string };
        values?: Array<{ name?: string | { ar?: string; en?: string } }>;
    }>;
}

interface ZidProductsResponse {
    // Envelope key unconfirmed — docs suggest a paginated list; tolerate the
    // plausible keys [provisional].
    results?: ZidProduct[];
    store_products?: ZidProduct[];
    products?: ZidProduct[];
    count?: number;
    next?: string | null;
}

/** Prefer Arabic for multilingual fields (Jawab24's market), fall back to English. */
function localizedText(value?: string | { ar?: string; en?: string } | null): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value.ar || value.en || '';
}

function extractProducts(data: ZidProductsResponse): ZidProduct[] {
    return data.results ?? data.store_products ?? data.products ?? [];
}

function mapZidStatus(status?: string): string {
    switch (status) {
        case 'active':
        case 'published': return 'active';
        case 'inactive':
        case 'draft': return 'hidden';
        case 'out_of_stock': return 'out_of_stock';
        default: return status || 'active';
    }
}

function buildZidVariantSummary(options: ZidProduct['options']): string {
    if (!options || options.length === 0) return '';
    return options
        .map(opt => `${localizedText(opt.name)}: ${(opt.values || []).map(v => localizedText(v.name)).join(', ')}`)
        .join(' | ');
}

function productImageUrl(p: ZidProduct): string | null {
    const first = p.images?.[0];
    return first?.url || first?.image?.full_size || null;
}

async function fetchAllProducts(creds: ZidCredentials): Promise<ZidProduct[]> {
    const allProducts: ZidProduct[] = [];
    let page = 1;

    while (page <= MAX_PRODUCT_PAGES_TO_FETCH) {
        const data = await zidApiGet<ZidProductsResponse>(
            `https://api.zid.sa/v1/products/?page_size=${PRODUCTS_PAGE_SIZE}&page=${page}`,
            creds,
        );

        const products = extractProducts(data);
        allProducts.push(...products);

        if (products.length < PRODUCTS_PAGE_SIZE || data.next === null) break;
        page++;
    }

    return allProducts;
}

/** Resolve the decrypted credential pair for an active Zid store, or null. */
export async function resolveZidCredentials(storeId: string): Promise<ZidCredentials | null> {
    const pair = await resolveStoreCredentialPair(storeId, ZID_TOKEN_REFRESH_CONFIG);
    if (!pair) return null;
    if (!pair.authorizationToken) {
        // A Zid store without the second credential predates the dual-token flow
        // (or the exchange failed to persist it) — every API call would 401.
        throw new Error(`Zid store ${storeId} has no Authorization token — merchant must reconnect`);
    }
    // The Zid numeric store id (persisted as platformData.merchantId at install) is the
    // Store-Id header the store API requires. Absent for pre-dual-token rows; the store
    // API then 401s with "No such user" until the merchant reconnects.
    const store = await getStoreById(storeId);
    const merchantId = (store?.platformData as { merchantId?: string } | null)?.merchantId;
    return {
        managerToken: pair.accessToken,
        authorizationToken: pair.authorizationToken,
        storeId: merchantId,
    };
}

export async function syncProducts(storeId: string) {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) throw new Error('Store not found');

    const store = await getStoreById(storeId);
    if (!store) throw new Error('Store not found');

    const products = await fetchAllProducts(creds);
    const currency = store.storeCurrency || 'SAR';

    const mapped = products
        .filter(p => p.status !== 'deleted')
        .map(p => mapZidProduct(p, currency));

    return replaceProductsAndRebuildSummary(storeId, mapped);
}

/**
 * The ONE Zid product → NormalizedProduct mapper: the full sync and the by-id
 * read (`getProductById`) both go through it, so a live answer can never carry
 * a shape the synced row does not (D-092, Rule 10.8).
 */
export function mapZidProduct(p: ZidProduct, storeCurrency: string): NormalizedProduct {
    const price = p.sale_price ?? p.price;
    const priceRange = price !== undefined && price !== null ? `${price} ${p.currency || storeCurrency}` : '';
    const variantSummary = buildZidVariantSummary(p.options);
    const category = localizedText(p.categories?.[0]?.name) || null;
    const description = localizedText(p.description);

    return {
        platformProductId: String(p.id),
        handle: p.slug || p.handle || null,
        title: localizedText(p.name),
        description: description ? stripHtml(description) : null,
        productType: category,
        vendor: null,
        status: mapZidStatus(p.status),
        priceRange,
        currency: p.currency || storeCurrency,
        // Unlimited → null (untracked), never 0. Only `is_infinite` earns the
        // null: a bare missing quantity stays 0 rather than being guessed at.
        totalInventory: p.is_infinite ? null : (p.quantity ?? 0),
        hasVariants: p.has_variants || p.has_options || (p.options?.length ?? 0) > 0,
        variantSummary: variantSummary || null,
        tags: null,
        imageUrl: productImageUrl(p),
    };
}

export async function fullSync(storeId: string) {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) throw new Error('Store not found');

    // platformData is merged, not replaced — a full sync must not wipe
    // webhookStatus/tokenHealth written by other flows.
    const storeInfo = await fetchStoreInfo(creds);
    await applySyncedStoreInfo(storeId, {
        storeName: storeInfo.storeName,
        storeEmail: storeInfo.storeEmail,
        storeCurrency: storeInfo.storeCurrency,
    }, {
        merchantId: storeInfo.merchantId,
        // Raw snapshot of the consumed facts subset — audit trail for D-102.
        storeFacts: { ...storeInfo.factsRaw, fetchedAt: new Date().toISOString() },
    });

    // Store facts → linked pages' business_profile (D-102). MUST run before
    // syncProducts: the product sync's invalidateCachesForStore tail is what
    // retires the semantic cache / re-ingests RAG for these same pages.
    await applyStoreFactsToLinkedPages(storeId, storeInfo.storeFacts);

    // Shipping & payment options → policiesSummary (D-116). Before syncProducts
    // for the same reason: that tail is what indexes the policy text.
    await syncPolicies(storeId, creds);

    return syncProducts(storeId);
}

// --- Periodic Token Refresh ---

/**
 * Refresh tokens for all Zid stores nearing expiry.
 * Called periodically from the integration adapter (every 6h).
 */
export async function refreshExpiringTokens(): Promise<number> {
    return sharedRefreshExpiringTokens(ZID_TOKEN_REFRESH_CONFIG);
}

export async function refreshAccessToken(storeId: string): Promise<void> {
    return sharedRefreshAccessToken(storeId, ZID_TOKEN_REFRESH_CONFIG);
}

export async function ensureValidToken(storeId: string): Promise<void> {
    return sharedEnsureValidToken(storeId, ZID_TOKEN_REFRESH_CONFIG);
}

export async function getStoresNeedingTokenRefresh() {
    return sharedGetStoresNeedingTokenRefresh('zid');
}

// --- Phone normalization ---

/**
 * Normalize a Zid customer mobile to E.164-ish (+9665…).
 *
 * Verified: the orders list returns `customer.mobile` as a FULL international
 * number WITHOUT the leading `+` (e.g. "966591555966") — unlike Salla's split
 * mobile + mobile_code pair, so this stays Zid-local (composeSallaPhone's logic
 * genuinely differs; lift a shared helper only if a third shape appears).
 * Used by the webhook controller AND the order agent tools — single source.
 */
export function normalizeZidPhone(mobile?: string | number | null): string | undefined {
    if (mobile === undefined || mobile === null) return undefined;
    const raw = String(mobile).trim();
    if (!raw) return undefined;
    return raw.startsWith('+') ? raw : `+${raw}`;
}

// --- E-Commerce Agent Tools (read-only order/inventory) ---

import type { OrderInfoFull, ShipmentInfoFull } from '@jawab24/shared';

// --- Zid Order Response Types (orders list — verified fields, tolerant extras) ---

interface ZidOrderProduct {
    name?: string | { ar?: string; en?: string };
    quantity?: number;
    price?: number | string;
    total?: number | string;
}

interface ZidOrder {
    id: number | string;
    /**
     * NOT the customer-facing number — the invoice URL slug, seen only inside
     * `order_url` (`https://<store>.zid.store/o/<code>/inv`). Kept for `findOrderByCode`
     * so a merchant pasting a slug still resolves; never display it.
     */
    code?: string | number;
    /** The number the Zid admin and the customer's invoice page both show; equals `id`. */
    invoice_number?: number | string;
    order_status?: { name?: string; code?: string };
    /** [provisional] Some responses may carry a flat status string instead. */
    status?: string;
    payment_status?: string;
    order_total?: string | number;
    order_total_string?: string;
    currency_code?: string;
    customer?: {
        id?: number | string;
        name?: string;
        email?: string;
        mobile?: string | number;
    };
    created_at?: string;
    products?: ZidOrderProduct[];
    shipping_method_code?: string;
    /**
     * Zid's real shipping shape (captured 2026-08-23 from a live order). Carrier data
     * hangs off `shipping.method`; all of it is null when the merchant self-delivers
     * (`method.code === 'custom'`, «مندوب المتجر»).
     */
    shipping?: {
        method?: {
            code?: string;
            tracking?: { number?: string | null; status?: string | null; url?: string | null };
            waybill_tracking_id?: string | null;
            courier?: { name?: string } | string | null;
        };
        address?: { city?: { name?: string } };
        /** [provisional] flat fallbacks — never observed live, kept for tolerance. */
        tracking_number?: string;
        tracking_url?: string;
        courier?: string;
    };
    /** [provisional] flat fallbacks — never observed live, kept for tolerance. */
    tracking_number?: string;
    tracking_url?: string;
    courier_name?: string;
}

interface ZidOrdersResponse {
    orders?: ZidOrder[];
}

/**
 * The order number to SHOW a customer: `invoice_number` (= `id`). Never `code` —
 * that is the invoice URL slug and the customer has never seen it. Verified
 * 2026-08-23 against a live order: id/invoice_number 72524870, code "mdXMlMYYBt",
 * and the customer's own invoice page renders «الطلبات #72524870».
 */
function zidOrderNumber(order: ZidOrder): string {
    if (order.invoice_number !== undefined && order.invoice_number !== null) {
        return String(order.invoice_number);
    }
    return String(order.id);
}

function zidOrderStatusCode(order: ZidOrder): string {
    return order.order_status?.code || order.status || '';
}

/**
 * Orders Zid's own search returns for a term. `search_term` is documented as a
 * natural-language lookup across customer phone, email, order code AND customer
 * name — so every hit is a CANDIDATE, never a verification.
 */
async function searchOrders(creds: ZidCredentials, term: string, limit: number): Promise<ZidOrder[]> {
    const data = await zidApiGet<ZidOrdersResponse>(
        `https://api.zid.sa/v1/managers/store/orders?search_term=${encodeURIComponent(term)}&per_page=${limit}&payload_type=default`,
        creds,
    );
    return (data.orders || []).slice(0, limit);
}

/**
 * Does this order actually carry the number the customer asked about?
 *
 * The ONLY place an order is matched to a requested number. `search_term` is a
 * fuzzy natural-language lookup — it also matches customer name, phone and
 * email — so a search hit is a candidate that MUST come back through here. The
 * page scan uses the same predicate, which is what keeps the two paths from
 * disagreeing about what "found" means.
 */
function orderMatchesNumber(order: ZidOrder, needle: string): boolean {
    return String(order.code ?? '') === needle
        || String(order.id) === needle
        || String(order.invoice_number ?? '') === needle;
}

/**
 * Find an order by its customer-facing number (code) or internal id.
 *
 * Zid's own `search_term` first, then the recent-pages scan as a fallback.
 *
 * The scan alone was a real defect: at `MAX_ORDER_PAGES_TO_SCAN` × `ORDERS_PAGE_SIZE`
 * it can only see the 300 most recent orders, so a customer asking about an older
 * one was told it does not exist — indistinguishable, to them, from us having lost
 * it. A busy store crosses 300 orders in days. Shopify and Salla both query the
 * platform's own search; this brings Zid in line.
 *
 * The scan is KEPT rather than replaced: `search_term`'s exact indexing behaviour
 * per field is documented but not yet confirmed against a live store, so a store
 * whose code is not indexed still resolves through the old path. A search failure
 * is reported and treated as "no candidates" (same posture as Salla's
 * `listOwnSubscriptions`) — the scan then runs, and if credentials are genuinely
 * broken its own error propagates rather than being masked here.
 */
async function findOrderByCode(creds: ZidCredentials, orderNumber: string): Promise<ZidOrder | null> {
    const needle = orderNumber.trim().replace(/^#/, '');

    try {
        const candidates = await searchOrders(creds, needle, CODE_LOOKUP_MAX_CANDIDATES);
        const hit = candidates.find(o => orderMatchesNumber(o, needle));
        if (hit) return hit;
    } catch (err) {
        captureError(err, 'Zid order search failed — falling back to the recent-orders scan', {
            tags: { service: 'zid' },
        });
    }

    for (let page = 1; page <= MAX_ORDER_PAGES_TO_SCAN; page++) {
        const data = await zidApiGet<ZidOrdersResponse>(
            `https://api.zid.sa/v1/managers/store/orders?page=${page}&per_page=${ORDERS_PAGE_SIZE}&payload_type=default`,
            creds,
        );
        const orders = data.orders || [];
        const match = orders.find(o => orderMatchesNumber(o, needle));
        if (match) return match;
        if (orders.length < ORDERS_PAGE_SIZE) break;
    }

    return null;
}

export async function lookupOrder(storeId: string, orderNumber: string): Promise<OrderInfoFull | null> {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) return null;

    const order = await findOrderByCode(creds, orderNumber);
    if (!order) return null;

    return mapZidOrderToOrderInfo(order);
}

/**
 * Orders matching this phone number (D-101).
 *
 * `search_term` is documented as a natural-language lookup across customer
 * phone, email, order code AND customer name — so a hit is a CANDIDATE, never a
 * verification. The caller re-compares phone and name against the order itself.
 */
export async function findOrdersByPhone(storeId: string, phone: string): Promise<OrderInfoFull[]> {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) return [];
    const orders = await searchOrders(creds, phone, PHONE_LOOKUP_MAX_ORDERS);
    return orders.map(mapZidOrderToOrderInfo);
}

/** A customer has one recent order, not a catalogue of them. */
const PHONE_LOOKUP_MAX_ORDERS = 10;

export async function getShipmentTracking(storeId: string, orderNumber: string): Promise<ShipmentInfoFull | null> {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) return null;

    const order = await findOrderByCode(creds, orderNumber);
    if (!order) return null;

    return {
        orderNumber: zidOrderNumber(order),
        customerFirstName: order.customer?.name?.split(' ')[0] || '',
        customerPhone: normalizeZidPhone(order.customer?.mobile),
        status: mapZidOrderStatus(zidOrderStatusCode(order)),
        // Zid keeps carrier data under `shipping.method`; the flat fields below were
        // guesses no live payload has carried. All null for `custom` self-delivery.
        trackingNumber: zidTracking(order)?.number
            || order.shipping?.method?.waybill_tracking_id
            || order.tracking_number
            || order.shipping?.tracking_number
            || undefined,
        courierName: zidCourierName(order)
            || order.courier_name
            || order.shipping?.courier
            || undefined,
        trackingUrl: zidTracking(order)?.url
            || order.tracking_url
            || order.shipping?.tracking_url
            || undefined,
        // `shipping.method.estimated_delivery_time` is merchant free text
        // ("Custom shipping description"), not a date — never pipe it in as one.
        estimatedDelivery: undefined,
        shippingCity: order.shipping?.address?.city?.name || undefined,
    };
}

/** Zid's carrier tracking block, `null`-normalized to undefined. */
function zidTracking(order: ZidOrder): { number?: string; url?: string } | undefined {
    const t = order.shipping?.method?.tracking;
    if (!t) return undefined;
    return { number: t.number ?? undefined, url: t.url ?? undefined };
}

/** `shipping.method.courier` is an object on some responses and a bare string on others. */
function zidCourierName(order: ZidOrder): string | undefined {
    const c = order.shipping?.method?.courier;
    if (!c) return undefined;
    return typeof c === 'string' ? c : c.name || undefined;
}

/**
 * A Zid product with `is_infinite: true` is always orderable and reports
 * `quantity: null`. Reading the quantity alone marks it out of stock.
 */
function zidAvailable(p: ZidProduct): boolean {
    return p.is_infinite === true || (p.quantity ?? 0) > 0;
}

/**
 * Units in stock, or `undefined` for unlimited — an unlimited product has no
 * meaningful number, and `0` next to `available: true` reads to the AI as
 * out of stock.
 */
function zidQuantity(p: ZidProduct): number | undefined {
    return p.is_infinite === true ? undefined : (p.quantity ?? 0);
}

/**
 * Read ONE product by its Zid id — the platform call the resolver makes only
 * when the local answer is risky (D-092). `?id__in=` is live-verified on the
 * dev store (2026-08-22): it returns the exact row with `is_infinite`
 * preserved. An UNKNOWN id answers HTTP 400, not an empty list, so a 400 here
 * is "no such product", never an API failure. The row is picked by id from the
 * envelope — never `[0]` — because a list endpoint answering with a different
 * product than the one asked for is exactly the defect this replaces.
 *
 * (Zid's documented `?search=` is not used anywhere: live-captured the same
 * day, `search=نظارة` returned all four products — it ignores the term.)
 */
export async function getProductById(storeId: string, platformProductId: string): Promise<PlatformProductDetail | null> {
    const creds = await resolveZidCredentials(storeId);
    if (!creds) return null;

    let data: ZidProductsResponse;
    try {
        data = await zidApiGet<ZidProductsResponse>(
            `https://api.zid.sa/v1/products/?id__in=${encodeURIComponent(platformProductId)}&page_size=1`,
            creds,
        );
    } catch (err) {
        if (err instanceof Error && /HTTP error: 400\b/.test(err.message)) return null;
        throw err;
    }

    const product = extractProducts(data).find(p => String(p.id) === platformProductId);
    if (!product || product.status === 'deleted') return null;

    const store = await getStoreById(storeId);
    const base = mapZidProduct(product, store?.storeCurrency || 'SAR');
    const storeDomain = store?.storeDomain || null;
    const handle = product.slug || product.handle;

    const variants = (product.options || []).flatMap(opt =>
        (opt.values || []).map(v => ({
            name: `${localizedText(opt.name)}: ${localizedText(v.name)}`,
            // Zid reports stock per product, not per option value.
            available: zidAvailable(product),
            quantity: zidQuantity(product),
        }))
    );

    return {
        ...base,
        productUrl: product.html_url || (handle && storeDomain
            ? `https://${storeDomain}/products/${handle}`
            : undefined),
        variants: variants.length > 0 ? variants : undefined,
    };
}

// --- Mapping helpers ---

function mapZidOrderToOrderInfo(order: ZidOrder): OrderInfoFull {
    const currency = order.currency_code || 'SAR';
    return {
        orderNumber: zidOrderNumber(order),
        customerFirstName: order.customer?.name?.split(' ')[0] || '',
        customerPhone: normalizeZidPhone(order.customer?.mobile),
        status: mapZidOrderStatus(zidOrderStatusCode(order)),
        orderDate: order.created_at || '',
        items: (order.products || []).map(item => ({
            name: localizedText(item.name),
            quantity: item.quantity ?? 1,
            price: item.price !== undefined && item.price !== null ? `${item.price} ${currency}` : '',
        })),
        totalAmount: order.order_total_string || String(order.order_total ?? ''),
        currency,
        // Never fabricate a payment state — 'unknown' until Zid's field is confirmed.
        paymentStatus: order.payment_status || 'unknown',
        shippingCity: undefined,
    };
}

/**
 * Map Zid order status codes to the shared vocabulary.
 * Verified codes (orders list filter enum): new, preparing, ready, indelivery,
 * delivered, canceled. Webhook conditions doc also shows camelCase `inDelivery`
 * and `cancelled` — normalized via toLowerCase + both spellings.
 */
export function mapZidOrderStatus(status: string): string {
    const map: Record<string, string> = {
        'new': 'pending',
        'preparing': 'processing',
        'ready': 'processing',
        'indelivery': 'shipped',
        'delivered': 'delivered',
        'canceled': 'cancelled',
        'cancelled': 'cancelled',
        'refunded': 'refunded',
    };
    const normalized = status.toLowerCase();
    return map[normalized] || status;
}

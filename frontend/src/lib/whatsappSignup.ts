/**
 * WhatsApp Embedded Signup launcher.
 *
 * Loads the Facebook JS SDK on demand (the rest of the app uses redirect
 * OAuth, so the SDK is not bundled globally) and runs Meta's Embedded
 * Signup popup. Resolves with the one-time auth code plus the phone/WABA
 * IDs that Meta posts back via the WA_EMBEDDED_SIGNUP message event.
 *
 * Must be called from a direct user gesture (button click) or the browser
 * blocks the popup.
 */

export interface WhatsAppSignupResult {
    code: string;
    phoneNumberId: string;
    wabaId: string;
}

interface FbLoginResponse {
    authResponse?: { code?: string } | null;
    status?: string;
}

interface FacebookSdk {
    init(options: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }): void;
    login(
        callback: (response: FbLoginResponse) => void,
        options: {
            config_id: string;
            response_type: string;
            override_default_response_type: boolean;
            extras: { setup: Record<string, never>; featureType: string; sessionInfoVersion: string };
        },
    ): void;
}

declare global {
    interface Window {
        FB?: FacebookSdk;
        fbAsyncInit?: () => void;
    }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const GRAPH_VERSION = 'v23.0';
/**
 * Abandonment sweep — NOT a completion deadline.
 *
 * `fb.login`'s callback is the authoritative terminal signal: the SDK invokes it
 * when the popup closes, with or without a code. This timer exists only so a
 * promise (and the disabled Connect button behind it) can never hang forever if
 * the SDK never calls back at all.
 *
 * It is deliberately far longer than a real first-time signup. The previous
 * 10-minute value was SHORTER than Meta's own wizard (business info → WABA →
 * phone number → OTP → commerce/verification screens), so it fired on live
 * flows: `cleanup()` then removed the message listener while the popup was
 * still open, the merchant finished, Meta bound the number to this app, and the
 * FINISH event was dropped — leaving Meta connected and us not. Observed in
 * production 2026-07-26 (Sentry JAWAB24-FRONTEND-2R, two occurrences).
 *
 * KNOWN LIMITATION: if this timer ever does fire mid-flow, a late FINISH is
 * still lost — the promise has already rejected and the caller has moved on.
 * Closing that fully needs a late-completion channel (resolve after reject),
 * which is a larger change; the merchant's retry surfaces it as
 * WHATSAPP_NUMBER_TAKEN rather than silently succeeding.
 */
const SIGNUP_ABANDON_MS = 30 * 60 * 1000;

/**
 * True only when a message event came from facebook.com or one of its
 * subdomains over https. A naive `event.origin.endsWith('facebook.com')`
 * also matches attacker-registrable domains like `evil-facebook.com`
 * (`'evil-facebook.com'.endsWith('facebook.com') === true`), so we parse the
 * origin and compare the hostname — the same URL-whitelist pattern used for
 * deep links in `_app.tsx`.
 */
function isFacebookOrigin(origin: string): boolean {
    try {
        const { protocol, hostname } = new URL(origin);
        return protocol === 'https:' && (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'));
    } catch {
        return false;
    }
}

let sdkPromise: Promise<FacebookSdk> | null = null;

/**
 * Warm the Facebook SDK ahead of the merchant's click.
 *
 * `fb.login` opens a popup, so it MUST run inside the browser's transient user
 * activation. Awaiting the SDK download inside the click handler spends that
 * activation on the network round trip and the popup is blocked — which is why
 * this is a preload, not a lazy load. Call it when the connect UI mounts; the
 * click handler then reaches `fb.login` with no network await in between.
 *
 * Safe to call repeatedly — `loadFacebookSdk` caches the in-flight promise, and
 * a failure here is deliberately swallowed: the click path retries and reports.
 */
export function preloadWhatsAppSignup(): void {
    const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
    if (!appId || typeof window === 'undefined') return;
    void loadFacebookSdk(appId).catch(() => {
        // Preload is best-effort; launchWhatsAppSignup() surfaces real errors.
    });
}

function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
        if (window.FB) {
            resolve(window.FB);
            return;
        }

        window.fbAsyncInit = () => {
            if (!window.FB) {
                // Clear the cached promise like the onerror path below does, or this
                // module-level rejected promise is returned to every later click and
                // the merchant can never retry without reloading the page.
                sdkPromise = null;
                reject(new Error('Facebook SDK loaded but FB is undefined'));
                return;
            }
            window.FB.init({ appId, version: GRAPH_VERSION, cookie: false, xfbml: false });
            resolve(window.FB);
        };

        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            sdkPromise = null;
            reject(new Error('Failed to load Facebook SDK'));
        };
        document.head.appendChild(script);
    });

    return sdkPromise;
}

/**
 * Run the Embedded Signup flow. Rejects when the merchant cancels, the popup
 * is blocked, or configuration is missing.
 */
export async function launchWhatsAppSignup(): Promise<WhatsAppSignupResult> {
    const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
    const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;
    if (!appId || !configId) {
        throw new Error('WhatsApp signup is not configured (NEXT_PUBLIC_FB_APP_ID / NEXT_PUBLIC_WHATSAPP_CONFIG_ID)');
    }

    const fb = await loadFacebookSdk(appId);

    return new Promise<WhatsAppSignupResult>((resolve, reject) => {
        let code: string | null = null;
        let sessionInfo: { phoneNumberId: string; wabaId: string } | null = null;
        let settled = false;

        const settle = () => {
            if (settled) return;
            if (code && sessionInfo) {
                settled = true;
                cleanup();
                resolve({ code, ...sessionInfo });
            }
        };

        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        // Meta posts the selected phone_number_id / waba_id from inside the
        // signup wizard via a WA_EMBEDDED_SIGNUP message event.
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookOrigin(event.origin)) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
                if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
                    // Both ids are required. FINISH_ONLY_WABA means the merchant
                    // created the WhatsApp Business Account but did NOT add a
                    // phone number (e.g. the number is still pending Meta's
                    // display-name review). Defaulting these to '' shipped an
                    // empty phoneNumberId to /connect-whatsapp as if it were a
                    // real connection — fail loudly instead.
                    const phoneNumberId = data.data?.phone_number_id;
                    const wabaId = data.data?.waba_id;
                    if (!phoneNumberId || !wabaId) {
                        fail(new Error('WHATSAPP_SIGNUP_NO_NUMBER'));
                        return;
                    }
                    sessionInfo = { phoneNumberId, wabaId };
                    settle();
                } else if (data.event === 'CANCEL') {
                    fail(new Error('WHATSAPP_SIGNUP_CANCELLED'));
                }
            } catch {
                // Non-JSON message events from facebook.com iframes — ignore
            }
        };

        const timeout = window.setTimeout(
            () => fail(new Error('WHATSAPP_SIGNUP_ABANDONED')),
            SIGNUP_ABANDON_MS,
        );

        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            window.clearTimeout(timeout);
        };

        window.addEventListener('message', onMessage);

        // Transient user activation is what lets `fb.login` open its popup. If it
        // has already been spent (a slow await between the click and here, or a
        // programmatic click), the popup is blocked and the SDK never calls back —
        // the merchant would sit on a disabled button until the abandon sweep.
        // Fail immediately instead; the SDK is warm by now, so a second click
        // succeeds. Guarded because navigator.userActivation is unavailable in
        // Safari < 16.4 and jsdom — absent means "cannot tell", so proceed.
        const activation = navigator.userActivation;
        if (activation && !activation.isActive) {
            fail(new Error('WHATSAPP_SIGNUP_POPUP_BLOCKED'));
            return;
        }

        fb.login(
            (response) => {
                if (response.authResponse?.code) {
                    code = response.authResponse.code;
                    settle();
                } else {
                    fail(new Error('WHATSAPP_SIGNUP_CANCELLED'));
                }
            },
            {
                config_id: configId,
                response_type: 'code',
                override_default_response_type: true,
                extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
            },
        );
    });
}

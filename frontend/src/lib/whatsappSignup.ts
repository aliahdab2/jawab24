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
/** How long to wait for the merchant to finish the signup wizard. */
const SIGNUP_TIMEOUT_MS = 10 * 60 * 1000;

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
        if (window.FB) {
            resolve(window.FB);
            return;
        }

        window.fbAsyncInit = () => {
            if (!window.FB) {
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
            if (!event.origin.endsWith('facebook.com')) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
                if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
                    sessionInfo = {
                        phoneNumberId: data.data?.phone_number_id ?? '',
                        wabaId: data.data?.waba_id ?? '',
                    };
                    settle();
                } else if (data.event === 'CANCEL') {
                    fail(new Error('WHATSAPP_SIGNUP_CANCELLED'));
                }
            } catch {
                // Non-JSON message events from facebook.com iframes — ignore
            }
        };

        const timeout = window.setTimeout(
            () => fail(new Error('WHATSAPP_SIGNUP_TIMEOUT')),
            SIGNUP_TIMEOUT_MS,
        );

        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            window.clearTimeout(timeout);
        };

        window.addEventListener('message', onMessage);

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

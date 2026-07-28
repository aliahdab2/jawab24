import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the Embedded Signup launcher — specifically the security-critical
 * postMessage origin check (a spoofed `*facebook.com` origin must be rejected)
 * plus the resolve/cancel settle logic.
 *
 * The module loads the FB SDK from `window.FB` and caches the load promise at
 * module scope, so each test resets modules and re-imports with a fresh
 * `window.FB` mock that captures the `fb.login` callback for manual control.
 */

interface LoginOpts { config_id: string; response_type: string; extras?: { featureType?: string; sessionInfoVersion?: string } }
let loginCallback: ((r: { authResponse?: { code?: string } | null }) => void) | null;
let loginOpts: LoginOpts | null;

function installFbMock() {
    loginCallback = null;
    loginOpts = null;
    (window as unknown as { FB: unknown }).FB = {
        init: vi.fn(),
        login: vi.fn((cb: (r: { authResponse?: { code?: string } | null }) => void, opts: LoginOpts) => {
            loginCallback = cb;
            loginOpts = opts;
        }),
    };
}

async function loadLauncher() {
    vi.resetModules();
    return (await import('../whatsappSignup')).launchWhatsAppSignup;
}

function postMessage(origin: string, data: unknown) {
    window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

const FINISH = (phone: string, waba = 'WABA1') => ({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH',
    data: { phone_number_id: phone, waba_id: waba },
});

describe('launchWhatsAppSignup', () => {
    beforeEach(() => {
        vi.stubEnv('NEXT_PUBLIC_FB_APP_ID', 'app-123');
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', 'cfg-1');
        installFbMock();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        delete (window as unknown as { FB?: unknown }).FB;
    });

    it('rejects when config is missing', async () => {
        vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONFIG_ID', '');
        const launch = await loadLauncher();
        await expect(launch()).rejects.toThrow(/not configured/i);
    });

    it('resolves with code + ids from a genuine facebook.com FINISH message', async () => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'auth-code-1' } });
        postMessage('https://www.facebook.com', FINISH('PN-real'));

        await expect(promise).resolves.toEqual({
            code: 'auth-code-1',
            phoneNumberId: 'PN-real',
            wabaId: 'WABA1',
            coexistence: false,
        });
        expect(loginOpts?.config_id).toBe('cfg-1');
    });

    it('accepts facebook.com subdomains (web.facebook.com)', async () => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        postMessage('https://web.facebook.com', FINISH('PN-sub'));

        await expect(promise).resolves.toMatchObject({ phoneNumberId: 'PN-sub' });
    });

    it('IGNORES spoofed origins that merely end in "facebook.com"', async () => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        // These would all pass a naive `origin.endsWith('facebook.com')` check.
        postMessage('https://evil-facebook.com', FINISH('PN-spoof'));
        postMessage('https://notfacebook.com', FINISH('PN-spoof'));
        postMessage('http://www.facebook.com', FINISH('PN-spoof')); // non-https
        // The genuine message must be the one that settles the promise.
        postMessage('https://www.facebook.com', FINISH('PN-genuine'));

        await expect(promise).resolves.toMatchObject({ phoneNumberId: 'PN-genuine' });
    });

    it('rejects when the merchant cancels via CANCEL message', async () => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        postMessage('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' });

        await expect(promise).rejects.toThrow('WHATSAPP_SIGNUP_CANCELLED');
    });

    it('rejects when fb.login returns no auth code (popup closed)', async () => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: null });

        await expect(promise).rejects.toThrow('WHATSAPP_SIGNUP_CANCELLED');
    });

    // A WABA with no phone number attached (FINISH_ONLY_WABA, or a FINISH whose
    // payload lacks an id — e.g. the number is still pending Meta's display-name
    // review). This used to default the ids to '' and POST an empty
    // phoneNumberId to /connect-whatsapp as though it were a real connection.
    it.each([
        ['FINISH_ONLY_WABA with no phone number', { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_ONLY_WABA', data: { waba_id: 'WABA1' } }],
        ['FINISH missing phone_number_id', { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'WABA1' } }],
        ['FINISH missing waba_id', { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: 'PN-1' } }],
    ])('rejects %s instead of resolving with an empty id', async (_label, payload) => {
        const launch = await loadLauncher();
        const promise = launch();
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        postMessage('https://www.facebook.com', payload);

        await expect(promise).rejects.toThrow('WHATSAPP_SIGNUP_NO_NUMBER');
    });

    // `fb.login` can only open its popup while transient user activation is live.
    // Spending it on a network await (the old lazy SDK load) meant the SDK never
    // called back and the merchant sat on a disabled button for the whole
    // timeout. Fail fast and precisely instead.
    it('rejects immediately when user activation has been spent', async () => {
        Object.defineProperty(navigator, 'userActivation', {
            value: { isActive: false, hasBeenActive: true },
            configurable: true,
        });
        try {
            const launch = await loadLauncher();
            await expect(launch()).rejects.toThrow('WHATSAPP_SIGNUP_POPUP_BLOCKED');
            // fb.login must not even be attempted — the popup would be blocked.
            expect(loginCallback).toBeNull();
        } finally {
            delete (navigator as unknown as { userActivation?: unknown }).userActivation;
        }
    });

    it('proceeds when user activation is live', async () => {
        Object.defineProperty(navigator, 'userActivation', {
            value: { isActive: true, hasBeenActive: true },
            configurable: true,
        });
        try {
            const launch = await loadLauncher();
            const promise = launch();
            await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

            loginCallback!({ authResponse: { code: 'c' } });
            postMessage('https://www.facebook.com', FINISH('PN-ok'));

            await expect(promise).resolves.toMatchObject({ phoneNumberId: 'PN-ok' });
        } finally {
            delete (navigator as unknown as { userActivation?: unknown }).userActivation;
        }
    });

    // ── Coexistence ────────────────────────────────────────────────────────
    // Meta's WhatsApp Business app onboarding lets the merchant KEEP the number
    // on their phone instead of migrating it to the Cloud API. It is selected by
    // extras.featureType and completes with its OWN event; before this existed,
    // such a signup fell through unhandled and the promise hung until the
    // abandon sweep even though Meta had already connected the number.

    it('does NOT request coexistence by default (migration stays the default path)', async () => {
        const launch = await loadLauncher();
        void launch().catch(() => {});
        await vi.waitFor(() => expect(loginOpts).not.toBeNull());

        expect(loginOpts?.extras?.featureType).toBe('');
    });

    it('requests coexistence with the value read from Meta\'s Builder', async () => {
        const launch = await loadLauncher();
        void launch({ coexistence: true }).catch(() => {});
        await vi.waitFor(() => expect(loginOpts).not.toBeNull());

        expect(loginOpts?.extras?.featureType).toBe('whatsapp_business_app_onboarding');
        // v3 is what Meta's docs still show; a silent bump would change the
        // payload shape we parse.
        expect(loginOpts?.extras?.sessionInfoVersion).toBe('3');
    });

    it('resolves coexistence:true on FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', async () => {
        const launch = await loadLauncher();
        const promise = launch({ coexistence: true });
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        postMessage('https://www.facebook.com', {
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
            data: { phone_number_id: 'PN-coex', waba_id: 'WABA9' },
        });

        await expect(promise).resolves.toEqual({
            code: 'c', phoneNumberId: 'PN-coex', wabaId: 'WABA9', coexistence: true,
        });
    });

    // The merchant can request coexistence and still end up migrating from inside
    // the wizard. Reporting the REQUEST rather than the OUTCOME would make the
    // backend skip Cloud-API registration for a number that genuinely needs it.
    it('reports coexistence:false when the wizard finishes on the migration path', async () => {
        const launch = await loadLauncher();
        const promise = launch({ coexistence: true });
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        postMessage('https://www.facebook.com', FINISH('PN-migrated'));

        await expect(promise).resolves.toMatchObject({ coexistence: false });
    });

    it('still rejects a coexistence finish that carries no phone number', async () => {
        const launch = await loadLauncher();
        const promise = launch({ coexistence: true });
        await vi.waitFor(() => expect(loginCallback).toBeTypeOf('function'));

        loginCallback!({ authResponse: { code: 'c' } });
        postMessage('https://www.facebook.com', {
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
            data: { waba_id: 'WABA9' },
        });

        await expect(promise).rejects.toThrow('WHATSAPP_SIGNUP_NO_NUMBER');
    });

    // The preload exists so the click handler never awaits the network before
    // fb.login. It must be safe to call repeatedly and must never throw.
    it('preloadWhatsAppSignup warms the SDK without throwing', async () => {
        vi.resetModules();
        const mod = await import('../whatsappSignup');
        expect(() => {
            mod.preloadWhatsAppSignup();
            mod.preloadWhatsAppSignup();
        }).not.toThrow();
    });
});

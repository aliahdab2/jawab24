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

interface LoginOpts { config_id: string; response_type: string }
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
});

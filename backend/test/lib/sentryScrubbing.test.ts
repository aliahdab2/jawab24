import { describe, it, expect } from 'vitest';
import { redactUrl } from '../../src/lib/sentry';

/**
 * Regression guard for a live credential leak.
 *
 * The Sentry SDK records the RAW query string of every outgoing HTTP request:
 * `add-outgoing-request-breadcrumb.js` sets `data['http.query'] = parsedUrl.search`
 * and `get-outgoing-span-data.js` sets `http.url`. Several Meta OAuth calls carry
 * credentials in the URL — `client_secret` on the Embedded Signup code exchange,
 * and `access_token=<app-id>|<app-secret>` plus `input_token=<merchant WABA token>`
 * on debug_token.
 *
 * With no scrubbing, the permanent Facebook app secret is attached to the scope and
 * shipped with the next captured event. That secret forges app access tokens and
 * reads or modifies every connected WABA, so this is not a "tidy up the logs" test.
 *
 * The existing whatsappError.test.ts asserts secrets cannot escape via the THROWN
 * ERROR — true, and it gave false assurance, because the leak is in the telemetry
 * layer that test never touches.
 */
describe('redactUrl', () => {
    it('redacts the Facebook app secret from the ES code exchange', () => {
        const out = redactUrl(
            'https://graph.facebook.com/v23.0/oauth/access_token?client_id=774211662298446&client_secret=SUPER_SECRET_VALUE&code=AQD123',
        );
        expect(out).not.toContain('SUPER_SECRET_VALUE');
        expect(out).not.toContain('AQD123');
        // The non-sensitive parts stay, or the breadcrumb loses its diagnostic value.
        expect(out).toContain('client_id=774211662298446');
        expect(out).toContain('/oauth/access_token');
    });

    it('redacts BOTH secrets from a debug_token call', () => {
        const out = redactUrl(
            'https://graph.facebook.com/v23.0/debug_token?input_token=EAAmerchantWABAtoken&access_token=774211662298446%7CAPP_SECRET',
        );
        expect(out).not.toContain('EAAmerchantWABAtoken');
        expect(out).not.toContain('APP_SECRET');
        expect(out).toContain('/debug_token');
    });

    it('leaves a URL with no query string untouched', () => {
        const url = 'https://graph.facebook.com/v23.0/12345/messages';
        expect(redactUrl(url)).toBe(url);
    });

    it('leaves a URL with only harmless params untouched', () => {
        const url = 'https://graph.facebook.com/v23.0/me?fields=name%2Cid';
        expect(redactUrl(url)).toBe(url);
    });

    it.each([
        ['client_secret', 'client_secret=x'],
        ['access_token', 'access_token=x'],
        ['input_token', 'input_token=x'],
        ['refresh_token', 'refresh_token=x'],
        ['app_secret', 'app_secret=x'],
        ['code', 'code=x'],
        ['signature', 'signature=x'],
        ['password', 'password=x'],
        // Case-insensitive — Meta is consistent, but a future caller might not be.
        ['ACCESS_TOKEN uppercase', 'ACCESS_TOKEN=x'],
    ])('redacts %s', (_label, pair) => {
        const out = redactUrl(`https://example.com/p?${pair}`);
        expect(out).not.toMatch(/=x(&|$)/);
        expect(out).toContain('REDACTED');
    });

    it('redacts every sensitive param, not just the first', () => {
        const out = redactUrl('https://example.com/p?access_token=A&keep=yes&client_secret=B');
        expect(out).not.toContain('=A');
        expect(out).not.toContain('=B');
        expect(out).toContain('keep=yes');
    });

    it('does not throw on a malformed URL', () => {
        // Breadcrumb data is not guaranteed well-formed; a throwing scrubber would
        // take down the error-reporting path itself.
        expect(() => redactUrl('not a url at all ?x=1')).not.toThrow();
        expect(() => redactUrl('?')).not.toThrow();
    });
});

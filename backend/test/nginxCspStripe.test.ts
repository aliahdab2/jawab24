import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The production CSP must allow every host Stripe.js needs — per directive.
 *
 * Stripe's requirements (docs.stripe.com/security/guide, "Content Security
 * Policy") come in host groups that are NOT interchangeable, and the failure
 * mode of mixing them up is uniquely silent: with js.stripe.com allowed in
 * script-src/frame-src but api.stripe.com missing from connect-src, the card
 * form RENDERS perfectly and the confirm call is refused by the browser.
 * Nothing reaches Stripe, nothing reaches Sentry (the throw used to be
 * swallowed in checkout.tsx), the merchant just presses pay and nothing
 * happens.
 *
 * That exact state shipped in 6d5ce61c (2026-03-26, "complete Stripe CSP per
 * official docs"), which REPLACED api.stripe.com with checkout.stripe.com —
 * the HOSTED checkout host — in connect-src. Every embedded PaymentElement
 * attempt from then until 2026-08-20 died at pay: the 2026-07-25 incident
 * (misattributed to Brave Shields), the owner's own 08-18 test, and a live
 * merchant twice on 08-20. Verified live before the fix: a fetch to
 * api.stripe.com from jawab24.com logged "Refused to connect because it
 * violates the document's Content Security Policy".
 *
 * This test parses the single add_header line in nginx/nginx.conf and pins
 * each required host inside its specific directive — substring matching over
 * the whole header would have passed the broken config, since every host name
 * was present somewhere.
 */

const repoRoot = path.resolve(__dirname, '../..');

function readCspDirectives(): Map<string, string> {
    const source = readFileSync(path.join(repoRoot, 'nginx', 'nginx.conf'), 'utf8');
    const headers = source.match(/add_header Content-Security-Policy "([^"]+)"/g);
    expect(headers, 'exactly one CSP add_header in nginx.conf').toHaveLength(1);
    const value = headers![0].replace(/^add_header Content-Security-Policy "/, '').replace(/"$/, '');
    const directives = new Map<string, string>();
    for (const part of value.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [name, ...hosts] = trimmed.split(/\s+/);
        directives.set(name, hosts.join(' '));
    }
    return directives;
}

// docs.stripe.com/security/guide — "Stripe.js" plus the hosted-checkout hosts
// the fallback path and 3DS redirects use. Each host must be in EACH listed
// directive; presence in a different directive does not count.
const REQUIRED: Array<{ directive: string; host: string; why: string }> = [
    { directive: 'connect-src', host: 'https://api.stripe.com', why: 'confirmPayment()/retrievePaymentIntent() XHR — without it pay silently does nothing' },
    { directive: 'script-src', host: 'https://js.stripe.com', why: 'Stripe.js loader' },
    { directive: 'script-src', host: 'https://*.js.stripe.com', why: 'Stripe.js sharded origins (documented required set)' },
    { directive: 'frame-src', host: 'https://js.stripe.com', why: 'Payment Element iframes (the visible card form)' },
    { directive: 'frame-src', host: 'https://*.js.stripe.com', why: 'Payment Element sharded iframe origins' },
    { directive: 'frame-src', host: 'https://hooks.stripe.com', why: '3D Secure / redirect frames' },
    { directive: 'img-src', host: 'https://*.stripe.com', why: 'card-brand assets' },
    { directive: 'frame-src', host: 'https://checkout.stripe.com', why: 'hosted-checkout fallback' },
    { directive: 'script-src', host: 'https://checkout.stripe.com', why: 'hosted-checkout fallback' },
    { directive: 'connect-src', host: 'https://checkout.stripe.com', why: 'hosted-checkout fallback' },
];

describe('nginx CSP allows the Stripe hosts, per directive', () => {
    const directives = readCspDirectives();

    it.each(REQUIRED)('$directive includes $host ($why)', ({ directive, host }) => {
        const hosts = directives.get(directive);
        expect(hosts, `CSP has a ${directive} directive`).toBeDefined();
        expect(hosts!.split(/\s+/), `${directive} must list ${host}`).toContain(host);
    });
});

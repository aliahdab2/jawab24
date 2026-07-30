import { describe, it, expect } from 'vitest';
import { buildWebUrl, buildWebAuthedUrl } from './webUrl';

describe('buildWebUrl', () => {
  it('produces Arabic URLs with no locale prefix', () => {
    expect(buildWebUrl('/pricing', 'ar')).toBe('https://jawab24.com/pricing');
  });

  it('produces English URLs with /en prefix', () => {
    expect(buildWebUrl('/pricing', 'en')).toBe('https://jawab24.com/en/pricing');
  });

  it('treats undefined locale as Arabic (the default)', () => {
    expect(buildWebUrl('/pricing', undefined)).toBe('https://jawab24.com/pricing');
  });

  it('normalizes a path missing its leading slash', () => {
    expect(buildWebUrl('pricing', 'en')).toBe('https://jawab24.com/en/pricing');
  });

  it('preserves query strings and redirects', () => {
    expect(
      buildWebUrl('/login?redirect=%2Fcheckout%3FplanId%3D1', 'en'),
    ).toBe('https://jawab24.com/en/login?redirect=%2Fcheckout%3FplanId%3D1');
  });
});

describe('buildWebAuthedUrl', () => {
  // The native app's JWT lives in the WebView's localStorage under a different
  // origin, so it cannot travel to the system browser. Every handoff to a
  // signed-in destination MUST go through /login or the merchant lands on a
  // logged-out screen — that is what broke WhatsApp connect on mobile.
  it('routes through /login with the destination as redirect', () => {
    expect(buildWebAuthedUrl('/pages', 'ar'))
      .toBe('https://jawab24.com/login?redirect=%2Fpages');
  });

  it('keeps the locale prefix on the login hop', () => {
    expect(buildWebAuthedUrl('/pages', 'en'))
      .toBe('https://jawab24.com/en/login?redirect=%2Fpages');
  });

  it('encodes a destination that carries its own query string', () => {
    // Unencoded, the destination's `&` would terminate the redirect param and
    // silently drop everything after it.
    expect(buildWebAuthedUrl('/checkout?planId=pro&interval=month', 'en'))
      .toBe('https://jawab24.com/en/login?redirect=%2Fcheckout%3FplanId%3Dpro%26interval%3Dmonth');
  });
});

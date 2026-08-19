/**
 * Regression tests for resolveLoginLanguage — the language a sign-in applies.
 *
 * Both sign-in paths (Facebook callback, phone-OTP login) receive the account's
 * `settings.dashboardLanguage` in their auth response. The phone path used to
 * ignore it and take the login page's locale instead, which left the merchant
 * reading one language while the server column — the only signal a push or
 * email has — said the other, and the Settings toggle showing the column's
 * value on top of the other language\'s UI.
 */
import { describe, it, expect } from 'vitest';
import { resolveLoginLanguage } from '../dashboardLanguage';

describe('resolveLoginLanguage', () => {
  it("adopts the account's stored language over the page locale", () => {
    expect(resolveLoginLanguage('ar', 'en')).toBe('ar');
    expect(resolveLoginLanguage('en', 'ar')).toBe('en');
  });

  it('falls back to the page locale when the account has no stored language', () => {
    expect(resolveLoginLanguage(null, 'en')).toBe('en');
    expect(resolveLoginLanguage(undefined, 'en')).toBe('en');
    expect(resolveLoginLanguage('', 'en')).toBe('en');
  });

  it('falls back to the default locale when neither is usable', () => {
    expect(resolveLoginLanguage(null, null)).toBe('ar');
    expect(resolveLoginLanguage(undefined, undefined)).toBe('ar');
  });

  // The column is a varchar(10) nothing validates on read, and the page locale
  // comes off a URL — a value with no message bundle must never reach the UI.
  it('ignores a stored value that is not a supported locale', () => {
    expect(resolveLoginLanguage('fr', 'en')).toBe('en');
    expect(resolveLoginLanguage('EN', 'ar')).toBe('ar');
    expect(resolveLoginLanguage('ar-SA', 'en')).toBe('en');
  });

  it('ignores an unsupported page locale too', () => {
    expect(resolveLoginLanguage(null, 'fr')).toBe('ar');
  });
});

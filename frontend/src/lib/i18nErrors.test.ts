import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import enErrors from '@/i18n/en/errors.json';
import arErrors from '@/i18n/ar/errors.json';

// tError reads document.documentElement.lang, so we manipulate it per test
function setLang(lang: string) {
  document.documentElement.lang = lang;
}

describe('tError', () => {
  const originalLang = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = originalLang;
  });

  // Re-import fresh each test via dynamic import isn't needed since module state
  // is stable — we just test the exported function directly
  beforeEach(async () => {
    // Ensure module is loaded
    await import('./i18nErrors');
  });

  it('returns English string for known key when lang=en', async () => {
    setLang('en');
    const { tError } = await import('./i18nErrors');
    expect(tError('insufficientRole')).toBe(enErrors.insufficientRole);
  });

  it('returns Arabic string for known key when lang=ar', async () => {
    setLang('ar');
    const { tError } = await import('./i18nErrors');
    expect(tError('insufficientRole')).toBe(arErrors.insufficientRole);
  });

  it('falls back to English for an unknown lang', async () => {
    setLang('fr');
    const { tError } = await import('./i18nErrors');
    expect(tError('insufficientRole')).toBe(enErrors.insufficientRole);
  });

  it('returns the key itself when key does not exist', async () => {
    setLang('en');
    const { tError } = await import('./i18nErrors');
    expect(tError('nonExistentKey_xyz')).toBe('nonExistentKey_xyz');
  });

  it('returns known keys that exist in errors.json', async () => {
    setLang('en');
    const { tError } = await import('./i18nErrors');
    expect(tError('somethingWentWrong')).toBe(enErrors.somethingWentWrong);
    expect(tError('networkError')).toBe(enErrors.networkError);
  });
});

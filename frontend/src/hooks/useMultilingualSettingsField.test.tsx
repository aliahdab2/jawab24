import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMultilingualSettingsField } from './useMultilingualSettingsField';
import { intlState } from '@/__tests__/testUtils/intlState';

// The hook's contract, pinned directly (the settings cards also exercise it
// end-to-end). Locale comes from the global next-intl mock via intlState.

describe('useMultilingualSettingsField', () => {
  it('binds to the page locale, not any stored preference', () => {
    intlState.locale = 'ar';
    const { result } = renderHook(() =>
      useMultilingualSettingsField({ ar: 'عربي', en: 'English', sourceLang: 'manual' }));

    expect(result.current.currentLang).toBe('ar');
    expect(result.current.value).toBe('عربي');
  });

  it('handles an undefined field and a missing variant as empty', () => {
    expect(renderHook(() => useMultilingualSettingsField(undefined)).result.current.value).toBe('');
    expect(renderHook(() => useMultilingualSettingsField({ ar: 'عربي' })).result.current.value).toBe('');
  });

  it.each([
    { sourceLang: 'ar', locale: 'en', expected: true },   // other language authored → this one is machine output
    { sourceLang: 'en', locale: 'en', expected: false },  // viewing the authored language
    { sourceLang: 'manual', locale: 'en', expected: false }, // hand-written everywhere
    { sourceLang: undefined, locale: 'en', expected: false }, // no metadata
  ])('isAutoTranslated: sourceLang=$sourceLang viewed in $locale → $expected', ({ sourceLang, locale, expected }) => {
    intlState.locale = locale;
    const multi: Record<string, string> = { ar: 'عربي', en: 'English' };
    if (sourceLang) multi.sourceLang = sourceLang;

    const { result } = renderHook(() => useMultilingualSettingsField(multi));
    expect(result.current.isAutoTranslated).toBe(expected);
  });

  it('withValue writes the current-language variant, marks it the source, and preserves every other language', () => {
    intlState.locale = 'ar';
    const { result } = renderHook(() =>
      useMultilingualSettingsField({ ar: 'قديم', en: 'English', fr: 'Français', sourceLang: 'en' }));

    expect(result.current.withValue('جديد')).toEqual({
      ar: 'جديد',
      en: 'English',
      fr: 'Français',
      sourceLang: 'ar',
    });
  });

  it('withValue works from an undefined field', () => {
    const { result } = renderHook(() => useMultilingualSettingsField(undefined));
    expect(result.current.withValue('hello')).toEqual({ en: 'hello', sourceLang: 'en' });
  });

  it('hasAnyContent ignores the sourceLang metadata key and whitespace-only variants', () => {
    expect(renderHook(() => useMultilingualSettingsField({ sourceLang: 'ar' })).result.current.hasAnyContent).toBe(false);
    expect(renderHook(() => useMultilingualSettingsField({ ar: '   ' })).result.current.hasAnyContent).toBe(false);
    expect(renderHook(() => useMultilingualSettingsField({ ar: 'نص' })).result.current.hasAnyContent).toBe(true);
    expect(renderHook(() => useMultilingualSettingsField(undefined)).result.current.hasAnyContent).toBe(false);
  });
});

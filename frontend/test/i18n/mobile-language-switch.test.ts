import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { loadAllNamespaces } from '@/i18n/getMessages';

// ── Mock isNativePlatform ─────────────────────────────────────────────────
let mockIsNative = false;
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNative,
}));

// ── Mock store ────────────────────────────────────────────────────────────
const mockSetLanguage = vi.fn();

vi.mock('@/lib/store', () => ({
  useUIStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ language: 'ar', _hasHydrated: true }),
    { getState: () => ({ setLanguage: mockSetLanguage, language: 'ar' }) },
  ),
}));

// ── Mock next/router ──────────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    query: {},
    pathname: '/dashboard',
    asPath: '/dashboard',
    locale: undefined,
  }),
}));

// ── Mock next-intl ────────────────────────────────────────────────────────
vi.mock('next-intl', () => ({
  useLocale: () => '',
  useTranslations: () => (key: string) => key,
}));

describe('mobile language switching', () => {
  const originalDir = document.documentElement.dir;
  const originalLang = document.documentElement.lang;

  beforeEach(() => {
    mockIsNative = true;
    mockPush.mockClear();
    mockSetLanguage.mockClear();
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });

  afterEach(() => {
    document.documentElement.dir = originalDir;
    document.documentElement.lang = originalLang;
  });

  describe('useLanguage hook — native platform', () => {
    it('should NOT call router.push on mobile', async () => {
      const { useLanguage } = await import('@/i18n/hooks');
      const { result } = renderHook(() => useLanguage());

      act(() => result.current.setLanguage('en'));

      expect(mockSetLanguage).toHaveBeenCalledWith('en');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should update document.dir and document.lang on mobile', async () => {
      const { useLanguage } = await import('@/i18n/hooks');
      const { result } = renderHook(() => useLanguage());

      act(() => result.current.setLanguage('en'));
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe('en');

      act(() => result.current.setLanguage('ar'));
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
    });

    it('should call router.push on web (non-native)', async () => {
      mockIsNative = false;
      const { useLanguage } = await import('@/i18n/hooks');
      const { result } = renderHook(() => useLanguage());

      act(() => result.current.setLanguage('en'));
      expect(mockPush).toHaveBeenCalledWith('/dashboard', '/dashboard', { locale: 'en' });
    });
  });

  describe('useMobileMessages hook', () => {
    it('should return translated messages on native platform', async () => {
      mockIsNative = true;
      const { useMobileMessages } = await import('@/hooks/useMobileMessages');
      const { result } = renderHook(() => useMobileMessages('ar'));

      expect(result.current).not.toBeNull();
      expect(result.current!.common).toBeDefined();
      expect(result.current!.dashboard).toBeDefined();
    });

    it('should return null on web (non-native)', async () => {
      mockIsNative = false;
      const { useMobileMessages } = await import('@/hooks/useMobileMessages');
      const { result } = renderHook(() => useMobileMessages('ar'));

      expect(result.current).toBeNull();
    });

    it('should switch messages when locale changes on native', async () => {
      mockIsNative = true;
      const { useMobileMessages } = await import('@/hooks/useMobileMessages');
      const { result, rerender } = renderHook(
        ({ locale }) => useMobileMessages(locale),
        { initialProps: { locale: 'ar' } },
      );

      const arSave = (result.current!.common as Record<string, string>).save;

      rerender({ locale: 'en' });

      const enSave = (result.current!.common as Record<string, string>).save;
      expect(arSave).not.toBe(enSave);
      expect(enSave).toBe('Save');
    });
  });

  describe('loadAllNamespaces', () => {
    it('should return messages for Arabic locale', () => {
      const msgs = loadAllNamespaces('ar');
      expect(msgs).toBeDefined();
      expect(msgs.common).toBeDefined();
      expect(msgs.dashboard).toBeDefined();
      expect(msgs.settings).toBeDefined();
      expect(msgs.nav).toBeDefined();
    });

    it('should return messages for English locale', () => {
      const msgs = loadAllNamespaces('en');
      expect(msgs).toBeDefined();
      expect(msgs.common).toBeDefined();
      expect(msgs.dashboard).toBeDefined();
    });

    it('should return different messages for different locales', () => {
      const arMsgs = loadAllNamespaces('ar');
      const enMsgs = loadAllNamespaces('en');

      const arSave = (arMsgs.common as Record<string, string>).save;
      const enSave = (enMsgs.common as Record<string, string>).save;
      expect(arSave).not.toBe(enSave);
    });

    it('should include all namespaces', () => {
      const msgs = loadAllNamespaces('en');
      const namespaces = Object.keys(msgs);

      expect(namespaces).toContain('common');
      expect(namespaces).toContain('nav');
      expect(namespaces).toContain('errors');
      expect(namespaces).toContain('meta');
      expect(namespaces).toContain('dashboard');
      expect(namespaces).toContain('settings');
      expect(namespaces).toContain('comments');
      expect(namespaces).toContain('messages');
      expect(namespaces).toContain('landing');
      expect(namespaces.length).toBeGreaterThanOrEqual(30);
    });

    it('should return empty objects for unknown locale', () => {
      const msgs = loadAllNamespaces('fr');
      expect(msgs.common).toEqual({});
    });
  });
});

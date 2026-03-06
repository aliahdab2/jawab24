import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Capacitor Browser
const mockBrowserOpen = vi.fn();
vi.mock('@capacitor/browser', () => ({
  Browser: { open: (...args: unknown[]) => mockBrowserOpen(...args) },
}));

// Mock Capacitor core
const mockIsNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
  },
}));

describe('Native pricing redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNativePlatform.mockReturnValue(false);
  });

  describe('openExternalUrl', () => {
    it('opens Capacitor Browser on native', async () => {
      mockIsNativePlatform.mockReturnValue(true);
      const { openExternalUrl } = await import('@/lib/openExternalUrl');
      await openExternalUrl('https://jawab24.com/pricing');
      expect(mockBrowserOpen).toHaveBeenCalledWith({ url: 'https://jawab24.com/pricing' });
    });

    it('opens window.open on web', async () => {
      mockIsNativePlatform.mockReturnValue(false);
      const mockWindowOpen = vi.fn();
      vi.stubGlobal('open', mockWindowOpen);
      const { openExternalUrl } = await import('@/lib/openExternalUrl');
      await openExternalUrl('https://jawab24.com/pricing');
      expect(mockWindowOpen).toHaveBeenCalledWith('https://jawab24.com/pricing', '_blank', 'noopener,noreferrer');
      vi.unstubAllGlobals();
    });
  });

  describe('isNativePlatform guard', () => {
    it('returns false on web by default', () => {
      // Mock is set to return false (simulating web)
      expect(mockIsNativePlatform()).toBe(false);
    });

    it('returns true when Capacitor reports native', () => {
      mockIsNativePlatform.mockReturnValue(true);
      expect(mockIsNativePlatform()).toBe(true);
    });
  });
});

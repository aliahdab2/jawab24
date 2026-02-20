import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock @capacitor/core before importing the module
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

// Mock @capacitor/browser
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

import { openExternalUrl } from '@/lib/openExternalUrl';
import { Capacitor } from '@capacitor/core';

describe('openExternalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should open URL in new tab on web platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openExternalUrl('https://example.com');

    expect(windowOpen).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('should use Capacitor Browser on native platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { Browser } = await import('@capacitor/browser');

    await openExternalUrl('https://example.com');

    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://example.com' });
  });
});

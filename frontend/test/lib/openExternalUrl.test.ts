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

vi.mock('@capacitor/app-launcher', () => ({
  AppLauncher: {
    openUrl: vi.fn(),
  },
}));

import { openExternalUrl, openInSystemBrowser } from '@/lib/openExternalUrl';
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

/**
 * Regression: Android, 2026-07-29. The WhatsApp connect handoff used
 * `openExternalUrl`, which opens a Custom Tab — no popups, no `window.opener` —
 * so `fb.login`'s Embedded Signup popup never opened and the merchant hit a
 * silent dead end after the path question. The distinction these tests defend is
 * "real browser app" vs "in-app browser"; collapsing the two reintroduces it.
 */
describe('openInSystemBrowser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('launches the real browser app on native — NOT the in-app Custom Tab', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const { Browser } = await import('@capacitor/browser');

    await openInSystemBrowser('https://jawab24.com/login');

    expect(AppLauncher.openUrl).toHaveBeenCalledWith({ url: 'https://jawab24.com/login' });
    // The whole point: a Custom Tab cannot host Embedded Signup.
    expect(Browser.open).not.toHaveBeenCalled();
  });

  it('falls back to the in-app browser when no external handler can be launched', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const { Browser } = await import('@capacitor/browser');
    vi.mocked(AppLauncher.openUrl).mockRejectedValueOnce(new Error('no activity found'));

    await openInSystemBrowser('https://jawab24.com/login');

    // Degrade rather than dead-end — the merchant still reaches the page.
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://jawab24.com/login' });
  });

  it('opens a new tab on web, where popups already work', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { AppLauncher } = await import('@capacitor/app-launcher');

    await openInSystemBrowser('https://jawab24.com/login');

    expect(windowOpen).toHaveBeenCalledWith(
      'https://jawab24.com/login',
      '_blank',
      'noopener,noreferrer'
    );
    expect(AppLauncher.openUrl).not.toHaveBeenCalled();
  });
});

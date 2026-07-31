import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock @capacitor/core before importing the module
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'android'),
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

vi.mock('@/lib/sentryHelpers', () => ({
  captureError: vi.fn(),
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
    vi.mocked(AppLauncher.openUrl).mockResolvedValueOnce({ completed: true });

    await openInSystemBrowser('https://jawab24.com/login');

    expect(AppLauncher.openUrl).toHaveBeenCalledWith({ url: 'https://jawab24.com/login' });
    // The whole point: a Custom Tab cannot host Embedded Signup. And the URL
    // must ride CLEAN — the launchDegraded marker belongs to fallbacks only.
    expect(Browser.open).not.toHaveBeenCalled();
  });

  it('falls back to the in-app browser when no external handler can be launched — WITH the marker', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const { Browser } = await import('@capacitor/browser');
    vi.mocked(AppLauncher.openUrl).mockRejectedValueOnce(new Error('no activity found'));

    await openInSystemBrowser('https://jawab24.com/login?redirect=%2Fpages');

    // Degrade rather than dead-end — the merchant still reaches the page, and
    // the URL carries launchDegraded=1 so server logs can tell this Custom Tab
    // apart from real Chrome (identical UA + cookies otherwise). Existing
    // query params must survive the stamping.
    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://jawab24.com/login?redirect=%2Fpages&launchDegraded=1',
    });
  });

  it('falls back when the launch fails via { completed: false } — Android never rejects — WITH the marker', async () => {
    // Regression: AppLauncherPlugin.java wraps startActivity in its own
    // try/catch and RESOLVES { completed: false } on failure. A catch-only
    // fallback is dead code for that path: the merchant tapped Connect and
    // nothing opened, silently (Android, 2026-07-30).
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const { Browser } = await import('@capacitor/browser');
    vi.mocked(AppLauncher.openUrl).mockResolvedValueOnce({ completed: false });

    await openInSystemBrowser('https://jawab24.com/login');

    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://jawab24.com/login?launchDegraded=1' });
  });

  it('REPORTS the degradation — a Custom Tab is indistinguishable from a real browser in logs', async () => {
    // 2026-07-31: a missing <queries> https declaration made every launch
    // resolve { completed: false } on Android 11+, so the app fell back to the
    // Custom Tab — which carries the same cookies AND the same user-agent.
    // Server logs showed a healthy handoff while Embedded Signup died. The
    // fallback must never be silent again.
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const { AppLauncher } = await import('@capacitor/app-launcher');
    const { captureError } = await import('@/lib/sentryHelpers');
    vi.mocked(AppLauncher.openUrl).mockResolvedValueOnce({ completed: false });

    await openInSystemBrowser('https://jawab24.com/login');
    await vi.waitFor(() => expect(captureError).toHaveBeenCalled());

    expect(vi.mocked(captureError).mock.calls[0][1]).toContain('degraded');
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

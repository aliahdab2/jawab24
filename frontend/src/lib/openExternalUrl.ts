import { Capacitor } from '@capacitor/core';

/**
 * Opens a URL externally.
 * - On native (iOS/Android): uses Capacitor Browser in-app browser
 * - On web: opens in a new tab
 */
/** New tab, `noopener` for the usual reverse-tabnabbing reason. Web only. */
function openWebTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Android Custom Tab / iOS SFSafariViewController — stays inside the app. */
async function openInAppBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    openWebTab(url);
    return;
  }
  await openInAppBrowser(url);
}

/**
 * Opens a URL in the device's REAL browser app (Chrome/Safari), leaving Jawab24.
 *
 * Deliberately separate from `openExternalUrl`, which uses an IN-APP browser
 * (Android Custom Tab). The in-app browser is the right default — it keeps the
 * merchant in the app — so reach for this only when the destination needs
 * something a Custom Tab cannot provide.
 *
 * The motivating case is WhatsApp Embedded Signup. `fb.login` opens a popup and
 * Meta posts the phone/WABA ids back to `window.opener`; a Custom Tab supports
 * neither popups nor an opener, so the wizard silently never appeared and the
 * merchant was left staring at the path question with nothing after it (Android,
 * reported 2026-07-29). The Capacitor WebView can't host it either — multiple
 * windows are disabled there — which is why the handoff exists at all. It just
 * has to land somewhere that can actually run the flow.
 *
 * Safe against bouncing straight back into the app: the only `autoVerify` App
 * Link is `https://jawab24.com` scoped to `pathPrefix="/auth/app-sync"`
 * (AndroidManifest.xml), so `/login` and `/pages` are not claimed by us and the
 * intent resolves to a browser. Widening that filter to the whole host would
 * break this — the intent would re-enter the WebView and dead-end again.
 *
 * Falls back to the in-app browser when no external handler can be launched, so a
 * device without a usable default browser degrades instead of dead-ending.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    openWebTab(url);
    return;
  }
  try {
    const { AppLauncher } = await import('@capacitor/app-launcher');
    await AppLauncher.openUrl({ url });
  } catch {
    // Degrade rather than dead-end: a Custom Tab still shows the page, even if
    // Embedded Signup cannot complete in it.
    await openInAppBrowser(url);
  }
}

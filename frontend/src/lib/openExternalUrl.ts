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

/**
 * Stamp a fallback URL so the DEGRADATION itself is server-visible. A Custom
 * Tab sends Chrome's user-agent and shares Chrome's cookies, so nginx/backend
 * logs cannot distinguish it from the real browser — that ambiguity hid the
 * v2.0.14–15 dead-tap for two release cycles. The Sentry report below can be
 * lost too (the app is backgrounded immediately after, before the event
 * flushes), so the marker in the URL is the one signal that cannot vanish:
 * a request line containing launchDegraded=1 IS a Custom Tab, full stop.
 */
function markDegraded(url: string): string {
  try {
    const marked = new URL(url);
    marked.searchParams.set('launchDegraded', '1');
    return marked.toString();
  } catch {
    return url; // relative/invalid input — launch it untouched rather than break it
  }
}

/**
 * A real-browser launch fell back to the in-app browser. Worth reporting on its
 * own: flows that ask for the system browser need it (Embedded Signup dies in a
 * Custom Tab), and the degradation is invisible from the outside — the Custom
 * Tab carries the same cookies AND the same user-agent, so it looks like a win
 * in every log we keep.
 */
function reportDegradedLaunch(cause: unknown): void {
  void import('@/lib/sentryHelpers').then(({ captureError }) => {
    captureError(cause instanceof Error ? cause : new Error(String(cause)),
      'System-browser launch degraded to in-app browser',
      { tags: { area: 'open-external-url', platform: Capacitor.getPlatform() } });
  }).catch(() => { /* reporting must never break the launch */ });
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
    // The Android plugin NEVER rejects on a launch failure: startActivity is
    // wrapped in its own try/catch and the call resolves { completed: false }
    // (AppLauncherPlugin.java, canLaunchIntent). A catch-only fallback is dead
    // code for that path — the merchant tapped Connect and nothing opened, with
    // no signal anywhere. Check the result explicitly.
    const { completed } = await AppLauncher.openUrl({ url });
    if (completed) return;
    // completed:false means no VISIBLE activity handles the URL. On Android 11+
    // that is almost always a missing <queries> declaration rather than a device
    // without a browser — it cost a whole debug cycle on 2026-07-31, because the
    // Custom Tab we fall back to sends Chrome's user-agent and server logs
    // therefore look identical to a successful launch. Report it: from the
    // outside, the two are indistinguishable.
    reportDegradedLaunch('AppLauncher reported completed:false');
  } catch (error) {
    // Plugin missing/rejected (e.g. old binary without app-launcher) — fall
    // through to the Custom Tab, but never silently.
    reportDegradedLaunch(error);
  }
  // Degrade rather than dead-end: a Custom Tab still shows the page, even if
  // Embedded Signup cannot complete in it. The marker makes the degradation
  // visible in server logs, where the surfaces are otherwise identical.
  await openInAppBrowser(markDegraded(url));
}

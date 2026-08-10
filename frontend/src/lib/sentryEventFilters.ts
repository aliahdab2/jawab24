import type { Event as SentryEvent, StackFrame } from '@sentry/nextjs';

/**
 * Drops crash reports produced by the JavaScript that the Facebook and Instagram
 * in-app browsers inject into every page they render.
 *
 * Meta's injected bundles (`browser_declutter`, `navigation_performance_logger`)
 * talk to the host app over a native bridge — `window.webkit.messageHandlers` on
 * iOS, a `@JavascriptInterface` Java object on Android — and throw when that
 * bridge is torn down mid-navigation, which is exactly when they run
 * (`pagehide` / `beforeunload`). None of it is our code and none of it affects
 * the merchant; it only reaches Sentry because the SDK's global `onerror` and
 * `addEventListener` instrumentation sees every throw on the page.
 *
 * Sentry's built-in `denyUrls` cannot express this, for two independent reasons
 * that each let a real issue through:
 *
 *  1. `denyUrls` tests exactly ONE frame. `_getEventFilterUrl` walks the frame
 *     array from the end and returns the first usable filename, and frames are
 *     stored oldest-first (`stripSentryFramesAndReverse`) — so it tests the
 *     INNERMOST frame. When Sentry's own `addEventListener` wrapper is that
 *     frame, the URL under test is our `_app` chunk and the three Meta frames
 *     beneath it are never considered. (JAWAB24-FRONTEND-2V.)
 *  2. The iOS injection is INLINE in the document, so its frames carry the page
 *     URL. `@sentry/nextjs` rewrites those to `app:///en/login` — byte-for-byte
 *     the shape of a genuine first-party frame. No URL rule can separate them.
 *     (JAWAB24-FRONTEND-2Z / -30.)
 *
 * So we scan every frame, and fall back to the bridge API name when the frames
 * themselves are anonymous.
 */

/**
 * Filenames of the form `app://<name>` — a host, and NO path slash.
 *
 * The `[^/]` is load-bearing. `@sentry/nextjs`'s client-side
 * `NextjsClientStackFrameNormalization` rewrites our own chunk origins to
 * `app://` too, so every first-party frame is `app:///_next/…` — empty host,
 * THREE slashes. A bare `/^app:\/\//` would discard the entire frontend's
 * errors. Only the two-slash host form is an injected in-app-browser script.
 */
export const IN_APP_BROWSER_SCRIPT_URL = /^app:\/\/[^/]/i;

/**
 * Functions inside Meta's injected logger that push data over the native
 * bridge. Verified absent from our source — we have no native-bridge sender of
 * our own with any of these names, and Capacitor's bridge calls are not
 * routed through them.
 *
 * This is the signal that survives inline injection, where every filename is
 * the document URL and therefore useless.
 */
const INJECTED_BRIDGE_FUNCTIONS = new Set([
  'sendDataToNative',
  'sendPageHideMessage',
  'sendBeforeUnloadMessage',
]);

/**
 * Message patterns for injected-script crashes whose STACK carries no usable
 * signal at all — Instagram's iOS logger is injected inline and minified, so
 * every frame is `app:///en/login` with a one-letter function name.
 *
 * Fed to `Sentry.init({ ignoreErrors })`, which matches on the message. Kept
 * here so the rule is unit-testable: sentry.client.config.ts runs
 * `Sentry.init` on import and so cannot be imported by a test.
 */
export const IN_APP_BROWSER_MESSAGE_PATTERNS: RegExp[] = [
  // `window.webkit.messageHandlers` is the WKWebView native bridge. Our web
  // code never references it (zero hits in frontend/src); only a script that
  // expects to be inside a native host app reads it. JAWAB24-FRONTEND-2Z.
  /evaluating 'window\.webkit\.messageHandlers'/,
];

function isInjectedFrame(frame: StackFrame): boolean {
  if (frame.filename && IN_APP_BROWSER_SCRIPT_URL.test(frame.filename)) return true;
  return Boolean(frame.function && INJECTED_BRIDGE_FUNCTIONS.has(frame.function));
}

/**
 * True when any frame of any exception in the event came from a Meta in-app
 * browser's injected script.
 *
 * Deliberately "any frame", not "the top frame": the throw originates in the
 * injected script but frequently surfaces through one of our own frames,
 * because Sentry wraps the `addEventListener` callback that invoked it.
 */
export function isInAppBrowserInjectedEvent(event: SentryEvent): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;

  return values.some((value) => value.stacktrace?.frames?.some(isInjectedFrame) ?? false);
}

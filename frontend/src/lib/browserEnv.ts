/**
 * Is this page running in a phone/tablet BROWSER (not the Capacitor app)?
 *
 * Exists for one product decision: Meta's WhatsApp Embedded Signup runs in a
 * `fb.login` popup, and mobile browsers open/render that popup unreliably
 * (observed live: mobile Chrome, Android 16, popup never painted — 2026-07-30).
 * Desktop browsers are the deterministic path, which is also the industry
 * standard among WhatsApp providers. Callers use this to show desktop guidance
 * before attempting a flow that is likely to dead-end on a phone.
 *
 * Prefers the structured UA-Client-Hints signal where available (Chromium),
 * falling back to a UA sniff. iPadOS masquerades as macOS in its UA, so touch
 * capability on "Mac" is treated as mobile — the popup limitation applies there
 * too.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof uaData?.mobile === 'boolean') return uaData.mobile;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Mac UA; real Macs have no multi-touch.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

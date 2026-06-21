import type { KeyboardInfo, KeyboardPlugin } from '@capacitor/keyboard';

/**
 * Single source of truth for keyboard CSS tracking (`--keyboard-height` + the
 * `keyboard-open` class). Modal backdrops anchor to `bottom: var(--keyboard-height)`
 * and `max-height: calc(100vh - var(--keyboard-height))` to sit above the keyboard.
 *
 * The crux — when the keyboard opens, a WebView either RESIZES (the OS shrinks it:
 * `window.innerHeight` drops by the keyboard height, so `100vh` ALREADY excludes the
 * keyboard) or OVERLAYS (the keyboard is drawn over a full-size WebView: `innerHeight`
 * stays put and `100vh` still includes the keyboard). `--keyboard-height` must be the
 * keyboard's overlap with the CURRENT layout viewport: 0 on a resize device, the
 * keyboard height on an overlay device. Get it wrong either way and modals float above
 * the keyboard or hide behind it.
 *
 * We compute it from THREE signals, in priority order (see `apply()`):
 *   1. `viewportKeyboardHeight()` = `innerHeight - visualViewport.height - offsetTop`
 *      — the real bottom occlusion in CSS px, pan-aware. When > 0 it is authoritative
 *      (overlay device whose viewport reports the inset; also tracks the animation).
 *   2. When the viewport reports ~0 but the keyboard IS up: `nativeHeight - shrank`,
 *      where `shrank` = how much `innerHeight` dropped from a keyboard-closed baseline.
 *      Resize device → shrank == keyboard height → 0. Overlay device (incl. iOS
 *      KeyboardResize.None, older WebViews that don't surface the IME inset, and iOS at
 *      `keyboardWillShow` time before the viewport has shrunk) → shrank == 0 → the full
 *      native height. This is why we must NOT blindly trust a viewport that reads 0.
 *      This fallback is gated on `nativeUp` — and `nativeUp` is dropped at the START of
 *      the hide animation (keyboardWillHide), so it never pins the stale height through a
 *      dismiss (see the dismiss trap below). `viewportTrackedInset` is a secondary guard
 *      for OEMs where willHide is unreliable: once the viewport has proven it surfaces the
 *      inset this session, its decay to ~0 is honoured as the keyboard leaving rather than
 *      flipping back to the native height.
 *   3. Keyboard closed → 0.
 *
 * The dismiss trap (June 2026 — gap + shake when retracting the keyboard): the ROOT cause
 * is a late signal. Capacitor fires `keyboardDidHide` only at the END of the slide-down
 * (Android `WindowInsetsAnimationCompat.onEnd`), so if that is the only hide listener,
 * `nativeUp` stays true through the entire retract and the native-height fallback pins
 * --keyboard-height at the full keyboard height the whole time — the modal hangs in the
 * lifted position (the gap) and only drops when the animation ends (the shake). It looked
 * "fixed on the first dismiss" with the viewport-tracking guard alone, but on later cycles
 * the WebView's visualViewport went silent (no intermediate frames), so the guard had
 * nothing to track and the bug returned every subsequent dismiss. The fix: listen to
 * `keyboardWillHide`, which fires at the START of the animation (`onStart`), and drop
 * nativeUp there — so the fallback releases the height the instant the keyboard begins
 * leaving, regardless of whether the viewport reports the in-between frames.
 *
 * `keyboard-open` (collapses the modal's safe-area padding) is tracked SEPARATELY from
 * the height: a resize device reports height 0 while the keyboard is genuinely open, so
 * the class follows the native show/hide events (or a real viewport inset), not height.
 *
 * `baseline` (keyboard-closed `innerHeight`) is captured at setup and refreshed only on
 * hide — never mid-open — so a resize transition can't corrupt it.
 *
 * capacitor.config.ts sets KeyboardResize.None on both platforms (iOS WKWebView must
 * never be resized; setResizeMode is a no-op on Android), so the WebView's own resize
 * behavior is whatever the OS does for an adjustNothing, edge-to-edge window — which is
 * exactly why we handle BOTH resize and overlay rather than assuming one.
 *
 * Returns cleanup functions to remove all listeners.
 */

// A real on-screen keyboard never occupies more than ~60% of the viewport. Clamping
// here is a backstop against an absurd reading; the resize/overlay logic is the fix.
const MAX_KEYBOARD_FRACTION = 0.6;

// Below this, an inset is the system nav bar / gesture area, not a keyboard.
const MIN_KEYBOARD_PX = 50;

/**
 * Keyboard height measured from the visual viewport, in CSS pixels: how much shorter
 * the visible area is than the layout viewport. 0 when the viewport is unavailable or
 * reports no bottom occlusion (which includes resize-mode devices, by design).
 */
export function viewportKeyboardHeight(): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/** The one place that mutates keyboard CSS. Clamps the height; sets the class. */
function writeKeyboardCss(px: number, open: boolean): void {
  const max = window.innerHeight * MAX_KEYBOARD_FRACTION;
  const height = Math.min(Math.max(0, px), max);
  const de = document.documentElement;
  de.style.setProperty('--keyboard-height', `${height}px`);
  de.classList.toggle('keyboard-open', open);
}

export async function setupKeyboard(
  Keyboard: Pick<KeyboardPlugin, 'addListener'>,
  isAndroid: boolean
): Promise<Array<() => void>> {
  const cleanup: Array<() => void> = [];

  // Native keyboard state, so 'keyboard-open' is correct even on resize devices
  // (where the compensation height is 0 while the keyboard is up).
  let nativeUp = false;
  let nativeHeight = 0;
  // Has the visual viewport reported a real inset during THIS keyboard session? Once it
  // has, the viewport is a proven tracker on this device, so we trust its decay back to
  // ~0 (the dismiss animation) instead of falling back to the stale native height — the
  // fix for the gap + shake on keyboard retract. Reset on hide.
  let viewportTrackedInset = false;
  // True between keyboardWillHide (dismiss animation START) and keyboardDidHide (END).
  // While collapsing we pin --keyboard-height to 0 and IGNORE the per-frame visualViewport
  // readings — their pan/offsetTop jitter is what made the modal shake on retract. The
  // keyboard is leaving regardless of what individual frames report, so committing to 0 is
  // correct; the always-on CSS transition (globals.css) eases the move. This only engages
  // when keyboardWillHide fires; where it doesn't, apply() keeps tracking the viewport and
  // the same transition damps the jitter.
  let collapsing = false;
  // innerHeight with the keyboard CLOSED. Resize-mode WebViews shrink innerHeight when
  // the keyboard opens; comparing against this tells us how much of the keyboard the
  // layout viewport has ALREADY excluded, so we don't subtract it again.
  let baseline = typeof window !== 'undefined' ? window.innerHeight : 0;

  const apply = () => {
    // Dismiss in progress: collapse to 0 in one eased step, deaf to viewport jitter.
    if (collapsing) {
      writeKeyboardCss(0, false);
      return;
    }
    const vvPx = viewportKeyboardHeight();
    const shrank = typeof window !== 'undefined' ? Math.max(0, baseline - window.innerHeight) : 0;
    if (vvPx > MIN_KEYBOARD_PX) viewportTrackedInset = true;
    // Overlap of the keyboard with the CURRENT layout viewport (= what 100vh and
    // fixed-position use). Trust the viewport when it reports an inset. Otherwise, if the
    // keyboard is up AND the viewport has never surfaced the inset this session, it's the
    // native height minus whatever the WebView already shrank (0 on resize, full height on
    // silent-overlay / iOS-willShow). But if the viewport HAS been tracking it, a reading
    // of ~0 means the keyboard is leaving (dismiss animation) → 0, not the stale native
    // height — otherwise the modal jumps back up for a frame as the keyboard retracts.
    const px = vvPx > MIN_KEYBOARD_PX
      ? vvPx
      : (nativeUp && !viewportTrackedInset ? Math.max(0, nativeHeight - shrank) : 0);
    const open = nativeUp || vvPx > MIN_KEYBOARD_PX;
    writeKeyboardCss(px, open);
  };

  // PRIMARY: track the visual viewport (resize fires on show/hide + animation;
  // scroll fires on an OS pan).
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    cleanup.push(() => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    });
  }

  // Native lifecycle: authoritative for "is the keyboard up" and the height source when
  // the viewport doesn't surface the inset. SHOW uses the settled height (Android
  // keyboardDidShow = post-animation; iOS keyboardWillShow = pre-resize, which is why we
  // fall back to the native height there). HIDE is split into START and END:
  const onShow = (info: KeyboardInfo) => {
    // A new open cancels any in-flight dismiss collapse so the height tracks the keyboard.
    collapsing = false;
    nativeUp = true;
    nativeHeight = info.keyboardHeight;
    apply();
  };

  // Hide animation START — Capacitor fires keyboardWillHide at onStart of the IME inset
  // animation (BOTH platforms: Android via WindowInsetsAnimationCompat.onStart, iOS via
  // keyboardWillHide), i.e. the instant the keyboard BEGINS sliding away. Dropping
  // nativeUp here is the fix for the gap + shake on dismiss: it stops the native-height
  // fallback from pinning --keyboard-height at the stale keyboard height through the whole
  // slide-down. The old code only listened to didHide (animation END), so nativeUp stayed
  // true for the entire retract — the modal hung in the lifted position (the gap), and on
  // a cycle where visualViewport went silent it snapped down only at the very end (the
  // shake). Resetting the per-session flag here keeps the next open honest on iOS (no
  // didHide listener there). NOT the place to refresh `baseline` — see onHideEnd.
  const onHideStart = () => {
    nativeUp = false;
    nativeHeight = 0;
    viewportTrackedInset = false;
    // Commit to 0 and stop reacting to per-frame viewport jitter for the rest of the
    // dismiss (the CSS transition on --keyboard-height eases the move). This is the clean
    // path WHEN keyboardWillHide fires; the always-on transition covers devices where it
    // doesn't (there, apply() keeps tracking the viewport, just damped).
    collapsing = true;
    // iOS has no didHide listener and its innerHeight is stable (KeyboardResize.None),
    // so refresh the closed baseline here — matching the pre-split iOS behaviour. Android
    // must defer this to onHideEnd: a resize WebView only restores innerHeight at the END
    // of the animation, so reading it now would capture the shrunk value.
    if (!isAndroid && typeof window !== 'undefined') baseline = window.innerHeight;
    apply();
  };

  // Hide animation END — Android keyboardDidHide (onEnd). The ONLY safe place to refresh
  // the keyboard-closed baseline: a resize-mode WebView restores innerHeight only when the
  // animation completes, so reading it at onHideStart would capture the shrunk value and
  // corrupt the next cycle's `shrank`. iOS keeps innerHeight constant (KeyboardResize.None)
  // so its baseline never drifts and it needs no didHide listener.
  const onHideEnd = () => {
    nativeUp = false;
    nativeHeight = 0;
    viewportTrackedInset = false;
    collapsing = false;
    if (typeof window !== 'undefined') baseline = window.innerHeight;
    apply();
  };

  const showListener = isAndroid
    ? await Keyboard.addListener('keyboardDidShow', onShow)
    : await Keyboard.addListener('keyboardWillShow', onShow);
  const hideStartListener = await Keyboard.addListener('keyboardWillHide', onHideStart);
  cleanup.push(() => showListener.remove());
  cleanup.push(() => hideStartListener.remove());
  if (isAndroid) {
    const hideEndListener = await Keyboard.addListener('keyboardDidHide', onHideEnd);
    cleanup.push(() => hideEndListener.remove());
  }

  return cleanup;
}

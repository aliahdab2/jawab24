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
 *   3. Keyboard closed → 0.
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
  // innerHeight with the keyboard CLOSED. Resize-mode WebViews shrink innerHeight when
  // the keyboard opens; comparing against this tells us how much of the keyboard the
  // layout viewport has ALREADY excluded, so we don't subtract it again.
  let baseline = typeof window !== 'undefined' ? window.innerHeight : 0;

  const apply = () => {
    const vvPx = viewportKeyboardHeight();
    const shrank = typeof window !== 'undefined' ? Math.max(0, baseline - window.innerHeight) : 0;
    // Overlap of the keyboard with the CURRENT layout viewport (= what 100vh and
    // fixed-position use). Trust the viewport when it reports an inset; otherwise, if
    // the keyboard is up, it's the native height minus whatever the WebView already
    // shrank (0 on resize, full height on overlay / iOS-willShow).
    const px = vvPx > MIN_KEYBOARD_PX
      ? vvPx
      : (nativeUp ? Math.max(0, nativeHeight - shrank) : 0);
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

  // Native lifecycle: authoritative for "is the keyboard up", the height source when
  // the viewport doesn't surface the inset, and what refreshes the closed baseline.
  // Android = keyboardDidShow/Hide (post-animation); iOS = keyboardWillShow/Hide
  // (pre-animation — fires before the viewport shrinks, which is why we fall back to
  // the native height there).
  const onShow = (info: KeyboardInfo) => {
    nativeUp = true;
    nativeHeight = info.keyboardHeight;
    apply();
  };
  const onHide = () => {
    nativeUp = false;
    nativeHeight = 0;
    if (typeof window !== 'undefined') baseline = window.innerHeight;
    apply();
  };

  const showListener = isAndroid
    ? await Keyboard.addListener('keyboardDidShow', onShow)
    : await Keyboard.addListener('keyboardWillShow', onShow);
  const hideListener = isAndroid
    ? await Keyboard.addListener('keyboardDidHide', onHide)
    : await Keyboard.addListener('keyboardWillHide', onHide);
  cleanup.push(() => showListener.remove());
  cleanup.push(() => hideListener.remove());

  return cleanup;
}

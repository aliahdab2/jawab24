import type { KeyboardPlugin } from '@capacitor/keyboard';

/**
 * Sets up keyboard CSS class / variable tracking.
 *
 * capacitor.config.ts sets KeyboardResize.None globally (required for iOS).
 * No runtime resize mode change is made for Android — setResizeMode is a
 * confirmed no-op on Android (the native method body is `call.unimplemented()`).
 *
 * Android (adjustNothing — windowSoftInputMode in AndroidManifest.xml):
 *   - The OS never pans or resizes the WebView. The keyboard overlaps the viewport.
 *   - keyboardDidShow fires (via WindowInsetsAnimationCompat regardless of soft-input mode)
 *     and sets --keyboard-height. Modal backdrops use bottom: var(--keyboard-height)
 *     to lift content above the keyboard.
 *   - keyboardDidHide clears --keyboard-height to 0.
 *   - keyboard-open class collapses pb-safe-modal safe-area padding while keyboard is up.
 *
 *   Why adjustNothing and not adjustResize/adjustPan:
 *   - adjustResize is deprecated on API 30+ for edge-to-edge apps (ignored by OS).
 *   - When adjustResize is ignored, the OS may fall back to adjustPan, which pans the
 *     entire WebView upward. Combined with our paddingBottom compensation this
 *     double-compensates: the input appears far above the keyboard.
 *   - adjustNothing prevents any OS intervention. We own all compensation via CSS.
 *
 * iOS (KeyboardResize.None — from config, no setResizeMode call here):
 *   - WKWebView must never be resized (distorts layout permanently).
 *   - keyboardWillShow/WillHide set --keyboard-height and keyboard-open.
 *   - Modal backdrops use bottom: var(--keyboard-height) to lift above keyboard.
 *   - keyboard-open collapses pb-safe-modal to 0.
 *
 * Returns cleanup functions to remove all event listeners.
 */
function setKeyboardHeight(px: number): void {
  document.documentElement.style.setProperty('--keyboard-height', `${px}px`);
}

function setKeyboardOpen(open: boolean): void {
  document.documentElement.classList.toggle('keyboard-open', open);
}

export async function setupKeyboard(
  Keyboard: Pick<KeyboardPlugin, 'addListener'>,
  isAndroid: boolean
): Promise<Array<() => void>> {
  const cleanup: Array<() => void> = [];

  if (isAndroid) {
    // adjustNothing: OS never pans/resizes, so window.innerHeight stays constant.
    // keyboardDidShow always has the correct keyboard height from WindowInsetsAnimationCompat.
    const kbShowListener = await Keyboard.addListener('keyboardDidShow', (info) => {
      setKeyboardHeight(info.keyboardHeight);
      setKeyboardOpen(true);
    });
    const kbHideListener = await Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardOpen(false);
    });
    cleanup.push(() => kbShowListener.remove());
    cleanup.push(() => kbHideListener.remove());
    return cleanup;
  }

  // iOS: KeyboardResize.None is already set by capacitor.config.ts.
  // keyboardWillShow fires before the animation completes, shifting layout smoothly.
  const kbShowListener = await Keyboard.addListener('keyboardWillShow', (info) => {
    setKeyboardHeight(info.keyboardHeight);
    setKeyboardOpen(true);
  });
  const kbHideListener = await Keyboard.addListener('keyboardWillHide', () => {
    setKeyboardHeight(0);
    setKeyboardOpen(false);
  });
  cleanup.push(() => kbShowListener.remove());
  cleanup.push(() => kbHideListener.remove());

  return cleanup;
}

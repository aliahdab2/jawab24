import type { KeyboardPlugin, KeyboardResizeOptions } from '@capacitor/keyboard';

/**
 * Sets up keyboard resize mode and CSS class / variable tracking.
 *
 * capacitor.config.ts sets KeyboardResize.None globally (required for iOS).
 * Android overrides to Body at runtime here so the WebView resizes naturally
 * with the keyboard (adjustResize). This makes keyboardDidShow/DidHide fire
 * reliably — they do NOT fire correctly with adjustNothing on many devices
 * because Android's getWindowVisibleDisplayFrame returns the same value before
 * and after the keyboard appears when the window isn't being adjusted.
 *
 * Android (KeyboardResize.Body / adjustResize):
 *   - Viewport shrinks when keyboard appears — no --keyboard-height needed.
 *   - keyboardDidShow/DidHide toggle the `keyboard-open` class on <html>.
 *   - CSS: .is-native.keyboard-open .pb-safe-modal { padding-bottom: 0 }
 *     eliminates the safe-area gap in modal footers.
 *
 * iOS (KeyboardResize.None — from config, no setResizeMode call here):
 *   - WKWebView must never be resized (distorts layout permanently).
 *   - keyboardWillShow/WillHide set --keyboard-height and keyboard-open.
 *   - Modal backdrops use paddingBottom: var(--keyboard-height) to lift above keyboard.
 *   - keyboard-open collapses pb-safe-modal to 0.
 *
 * Returns cleanup functions to remove all event listeners.
 */
export async function setupKeyboard(
  Keyboard: Pick<KeyboardPlugin, 'setResizeMode' | 'addListener'>,
  isAndroid: boolean
): Promise<Array<() => void>> {
  const cleanup: Array<() => void> = [];

  if (isAndroid) {
    // Override capacitor.config.ts 'none' → 'body' (adjustResize).
    // With adjustResize, keyboardDidShow fires reliably and carries the
    // correct keyboard height; the viewport shrinks so we don't use
    // --keyboard-height for the backdrop (it would double-compensate).
    //
    // Wrapped in try-catch so a failure (e.g. API 30+ ignoring the mode
    // change for edge-to-edge apps) does NOT abort listener registration.
    // Listeners work correctly regardless of the active resize mode.
    try {
      await Keyboard.setResizeMode({ mode: 'body' as KeyboardResizeOptions['mode'] });
    } catch {
      // Ignore — listener registration continues below.
    }

    const kbShowListener = await Keyboard.addListener('keyboardDidShow', () => {
      document.documentElement.classList.add('keyboard-open');
    });
    const kbHideListener = await Keyboard.addListener('keyboardDidHide', () => {
      document.documentElement.classList.remove('keyboard-open');
    });
    cleanup.push(() => kbShowListener.remove());
    cleanup.push(() => kbHideListener.remove());
    return cleanup;
  }

  // iOS: KeyboardResize.None is already set by capacitor.config.ts.
  // keyboardWillShow fires before the animation completes, shifting layout smoothly.
  const kbShowListener = await Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
    document.documentElement.classList.add('keyboard-open');
  });
  const kbHideListener = await Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px');
    document.documentElement.classList.remove('keyboard-open');
  });
  cleanup.push(() => kbShowListener.remove());
  cleanup.push(() => kbHideListener.remove());

  return cleanup;
}

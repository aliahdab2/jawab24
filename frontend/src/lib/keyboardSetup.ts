import type { KeyboardPlugin, KeyboardResizeOptions } from '@capacitor/keyboard';

/**
 * Sets up keyboard resize mode and CSS variable / class tracking.
 *
 * Both platforms use KeyboardResize.None so the WebView is never resized.
 * Instead, keyboardDidShow (Android) / keyboardWillShow (iOS) fires with the
 * keyboard height, which is written to --keyboard-height on <html>. Modal
 * backdrops use `paddingBottom: var(--keyboard-height)` to lift themselves
 * above the keyboard, and the `keyboard-open` class on <html> lets CSS collapse
 * the safe-area padding inside modal footers.
 *
 * Why None for Android (not Body):
 * With KeyboardResize.Body the viewport shrinks, so window.innerHeight and
 * visualViewport.height decrease equally → --keyboard-height stays 0 → the
 * backdrop cannot push the modal up. The keyboard-open class alone reduces
 * pb-safe-modal padding but leaves a visible gap.
 * With KeyboardResize.None the viewport stays fixed, the Capacitor event gives
 * us the exact height, and --keyboard-height drives the backdrop position.
 *
 * Returns cleanup functions to remove all event listeners.
 */
export async function setupKeyboard(
  Keyboard: Pick<KeyboardPlugin, 'setResizeMode' | 'addListener'>,
  isAndroid: boolean
): Promise<Array<() => void>> {
  const cleanup: Array<() => void> = [];

  if (isAndroid) {
    // Keep the WebView full-height; keyboard overlays on top.
    await Keyboard.setResizeMode({ mode: 'none' as KeyboardResizeOptions['mode'] });

    const kbShowListener = await Keyboard.addListener('keyboardDidShow', (info) => {
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      document.documentElement.classList.add('keyboard-open');
    });
    const kbHideListener = await Keyboard.addListener('keyboardDidHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      document.documentElement.classList.remove('keyboard-open');
    });
    cleanup.push(() => kbShowListener.remove());
    cleanup.push(() => kbHideListener.remove());
    return cleanup;
  }

  // iOS: WKWebView must never be resized. keyboardWillShow fires before the
  // animation completes so the layout shifts smoothly with the keyboard.
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

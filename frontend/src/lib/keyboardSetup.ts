/**
 * Sets up keyboard resize mode and --keyboard-height CSS variable tracking.
 *
 * Android: KeyboardResize.Body — the WebView viewport shrinks naturally when the
 * keyboard appears (adjustResize). Fixed modal backdrops fit the shrunken viewport
 * automatically; no CSS variable is needed (and setting it would double-compensate).
 *
 * iOS: KeyboardResize.None — WKWebView must never be resized (it distorts the layout).
 * Instead, keyboardWillShow fires with the keyboard height and we set --keyboard-height
 * so modal backdrops can push their content above the keyboard via paddingBottom.
 *
 * Returns cleanup functions to remove the keyboard event listeners.
 */
export async function setupKeyboard(
  Keyboard: {
    setResizeMode: (opts: { mode: string }) => Promise<void>;
    addListener: (event: string, handler: (info: { keyboardHeight: number }) => void) => Promise<{ remove: () => void }>;
  },
  KeyboardResizeBody: string,
  isAndroid: boolean
): Promise<Array<() => void>> {
  const cleanup: Array<() => void> = [];

  if (isAndroid) {
    // Viewport resizes with the keyboard — no CSS variable tracking needed.
    await Keyboard.setResizeMode({ mode: KeyboardResizeBody });
    return cleanup;
  }

  // iOS: viewport stays fixed; track keyboard height via CSS variable.
  const kbShowListener = await Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
  });
  const kbHideListener = await Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px');
  });
  cleanup.push(() => kbShowListener.remove());
  cleanup.push(() => kbHideListener.remove());

  return cleanup;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardResize } from '@capacitor/keyboard';
import { setupKeyboard } from '../keyboardSetup';

const RESIZE_BODY = KeyboardResize.Body;

function makeKeyboardMock() {
  return {
    setResizeMode: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  };
}

describe('setupKeyboard', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
  });

  // ── Android ────────────────────────────────────────────────────────────────

  it('Android: calls setResizeMode(Body) and returns no listeners', async () => {
    const kb = makeKeyboardMock();
    const cleanup = await setupKeyboard(kb, RESIZE_BODY, true);

    expect(kb.setResizeMode).toHaveBeenCalledWith({ mode: RESIZE_BODY });
    // No keyboard-height variable tracking needed — viewport resizes naturally
    expect(kb.addListener).not.toHaveBeenCalled();
    expect(cleanup).toHaveLength(0);
  });

  it('Android: does NOT set --keyboard-height CSS variable', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, RESIZE_BODY, true);

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('');
  });

  // ── iOS ────────────────────────────────────────────────────────────────────

  it('iOS: does NOT call setResizeMode', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, RESIZE_BODY, false);

    expect(kb.setResizeMode).not.toHaveBeenCalled();
  });

  it('iOS: registers keyboardWillShow and keyboardWillHide listeners', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, RESIZE_BODY, false);

    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
  });

  it('iOS: returns two cleanup functions', async () => {
    const kb = makeKeyboardMock();
    const cleanup = await setupKeyboard(kb, RESIZE_BODY, false);

    expect(cleanup).toHaveLength(2);
    cleanup.forEach(fn => expect(typeof fn).toBe('function'));
  });

  it('iOS: keyboardWillShow handler sets --keyboard-height', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, RESIZE_BODY, false);

    // Grab the handler that was registered for keyboardWillShow
    const showCall = kb.addListener.mock.calls.find(([event]) => event === 'keyboardWillShow');
    const showHandler = showCall![1];
    showHandler({ keyboardHeight: 320 });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('320px');
  });

  it('iOS: keyboardWillHide handler clears --keyboard-height', async () => {
    document.documentElement.style.setProperty('--keyboard-height', '320px');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, RESIZE_BODY, false);

    const hideCall = kb.addListener.mock.calls.find(([event]) => event === 'keyboardWillHide');
    const hideHandler = hideCall![1];
    hideHandler({ keyboardHeight: 0 });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('iOS: cleanup functions call remove() on each listener', async () => {
    const removeShow = vi.fn();
    const removeHide = vi.fn();
    let callIndex = 0;
    const kb = {
      setResizeMode: vi.fn(),
      addListener: vi.fn().mockImplementation(() =>
        Promise.resolve({ remove: callIndex++ === 0 ? removeShow : removeHide })
      ),
    };

    const cleanup = await setupKeyboard(kb, RESIZE_BODY, false);
    cleanup.forEach(fn => fn());

    expect(removeShow).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
  });
});

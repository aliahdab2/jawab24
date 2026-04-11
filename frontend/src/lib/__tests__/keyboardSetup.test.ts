import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupKeyboard } from '../keyboardSetup';

function makeKeyboardMock() {
  return {
    setResizeMode: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  };
}

describe('setupKeyboard', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
    document.documentElement.classList.remove('keyboard-open');
  });

  // ── Android ────────────────────────────────────────────────────────────────
  // Android uses KeyboardResize.Body (adjustResize): viewport shrinks with the
  // keyboard so --keyboard-height stays 0; keyboard-open class handles the CSS.

  it('Android: calls setResizeMode("body") to enable adjustResize', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    expect(kb.setResizeMode).toHaveBeenCalledWith({ mode: 'body' });
  });

  it('Android: does NOT call setResizeMode("none") — that breaks keyboard events', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    expect(kb.setResizeMode).not.toHaveBeenCalledWith({ mode: 'none' });
  });

  it('Android: registers keyboardDidShow and keyboardDidHide listeners', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    expect(kb.addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    expect(kb.addListener).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));
  });

  it('Android: does NOT register keyboardWillShow/WillHide (iOS-only events)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const events = kb.addListener.mock.calls.map(([event]: [string]) => event);
    expect(events).not.toContain('keyboardWillShow');
    expect(events).not.toContain('keyboardWillHide');
  });

  it('Android: keyboardDidShow adds keyboard-open class', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const showCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardDidShow');
    showCall![1]({});

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  it('Android: keyboardDidShow does NOT set --keyboard-height (viewport shrinks instead)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const showCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardDidShow');
    showCall![1]({ keyboardHeight: 300 });

    // With adjustResize the backdrop doesn't need --keyboard-height.
    // Setting it would double-compensate (viewport already shrank).
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('');
  });

  it('Android: keyboardDidHide removes keyboard-open class', async () => {
    document.documentElement.classList.add('keyboard-open');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const hideCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardDidHide');
    hideCall![1]({});

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('Android: returns two cleanup functions', async () => {
    const kb = makeKeyboardMock();
    const cleanup = await setupKeyboard(kb, true);

    expect(cleanup).toHaveLength(2);
    cleanup.forEach(fn => expect(typeof fn).toBe('function'));
  });

  it('Android: setResizeMode failure does NOT prevent listener registration', async () => {
    const removeShow = vi.fn();
    const removeHide = vi.fn();
    let callIndex = 0;
    const kb = {
      setResizeMode: vi.fn().mockRejectedValue(new Error('adjustResize ignored by OS')),
      addListener: vi.fn().mockImplementation(() =>
        Promise.resolve({ remove: callIndex++ === 0 ? removeShow : removeHide })
      ),
    };

    // Must not throw, and must still return two working cleanup functions.
    const cleanup = await setupKeyboard(kb, true);
    expect(cleanup).toHaveLength(2);
    cleanup.forEach(fn => fn());
    expect(removeShow).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
  });

  it('Android: cleanup functions call remove() on each listener', async () => {
    const removeShow = vi.fn();
    const removeHide = vi.fn();
    let callIndex = 0;
    const kb = {
      setResizeMode: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockImplementation(() =>
        Promise.resolve({ remove: callIndex++ === 0 ? removeShow : removeHide })
      ),
    };

    const cleanup = await setupKeyboard(kb, true);
    cleanup.forEach(fn => fn());

    expect(removeShow).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
  });

  // ── iOS ────────────────────────────────────────────────────────────────────
  // iOS uses KeyboardResize.None (from capacitor.config.ts, not set at runtime).
  // --keyboard-height drives the fixed backdrop; keyboard-open collapses pb-safe-modal.

  it('iOS: does NOT call setResizeMode (config already sets None)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    expect(kb.setResizeMode).not.toHaveBeenCalled();
  });

  it('iOS: registers keyboardWillShow and keyboardWillHide listeners', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
  });

  it('iOS: does NOT register keyboardDidShow/DidHide (Android-only events)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const events = kb.addListener.mock.calls.map(([event]: [string]) => event);
    expect(events).not.toContain('keyboardDidShow');
    expect(events).not.toContain('keyboardDidHide');
  });

  it('iOS: keyboardWillShow sets --keyboard-height', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const showCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardWillShow');
    showCall![1]({ keyboardHeight: 320 });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('320px');
  });

  it('iOS: keyboardWillShow adds keyboard-open class', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const showCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardWillShow');
    showCall![1]({ keyboardHeight: 320 });

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  it('iOS: keyboardWillHide sets --keyboard-height to 0px', async () => {
    document.documentElement.style.setProperty('--keyboard-height', '320px');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const hideCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardWillHide');
    hideCall![1]({});

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('iOS: keyboardWillHide removes keyboard-open class', async () => {
    document.documentElement.classList.add('keyboard-open');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const hideCall = kb.addListener.mock.calls.find(([event]: [string]) => event === 'keyboardWillHide');
    hideCall![1]({});

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('iOS: returns two cleanup functions', async () => {
    const kb = makeKeyboardMock();
    const cleanup = await setupKeyboard(kb, false);

    expect(cleanup).toHaveLength(2);
    cleanup.forEach(fn => expect(typeof fn).toBe('function'));
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

    const cleanup = await setupKeyboard(kb, false);
    cleanup.forEach(fn => fn());

    expect(removeShow).toHaveBeenCalled();
    expect(removeHide).toHaveBeenCalled();
  });
});

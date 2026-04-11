import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupKeyboard } from '../keyboardSetup';

function makeKeyboardMock() {
  return {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  };
}

describe('setupKeyboard', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
    document.documentElement.classList.remove('keyboard-open');
  });

  // ── Android ────────────────────────────────────────────────────────────────
  // adjustNothing: OS never pans/resizes. keyboardDidShow sets --keyboard-height from
  // info.keyboardHeight (WindowInsetsAnimationCompat fires regardless of soft-input mode).
  // Modal backdrops use paddingBottom: var(--keyboard-height) to lift above keyboard.

  it('Android: registers keyboardDidShow and keyboardDidHide listeners', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    expect(kb.addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    expect(kb.addListener).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));
  });

  it('Android: does NOT register keyboardWillShow/WillHide (iOS-only events)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const events = kb.addListener.mock.calls.map((args: unknown[]) => args[0]);
    expect(events).not.toContain('keyboardWillShow');
    expect(events).not.toContain('keyboardWillHide');
  });

  it('Android: keyboardDidShow adds keyboard-open class', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const showCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardDidShow');
    (showCall![1] as (info: { keyboardHeight: number }) => void)({ keyboardHeight: 300 });

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  it('Android: keyboardDidShow sets --keyboard-height from info.keyboardHeight', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const showCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardDidShow');
    (showCall![1] as (info: { keyboardHeight: number }) => void)({ keyboardHeight: 300 });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px');
  });

  it('Android: keyboardDidHide removes keyboard-open class', async () => {
    document.documentElement.classList.add('keyboard-open');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const hideCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardDidHide');
    (hideCall![1] as () => void)();

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
  });

  it('Android: keyboardDidHide clears --keyboard-height to 0px', async () => {
    document.documentElement.style.setProperty('--keyboard-height', '300px');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    const hideCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardDidHide');
    (hideCall![1] as () => void)();

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('Android: returns two cleanup functions', async () => {
    const kb = makeKeyboardMock();
    const cleanup = await setupKeyboard(kb, true);

    expect(cleanup).toHaveLength(2);
    cleanup.forEach(fn => expect(typeof fn).toBe('function'));
  });

  it('Android: cleanup functions call remove() on each listener', async () => {
    const removeShow = vi.fn();
    const removeHide = vi.fn();
    let callIndex = 0;
    const kb = {
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

  it('iOS: registers keyboardWillShow and keyboardWillHide listeners', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
    expect(kb.addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
  });

  it('iOS: does NOT register keyboardDidShow/DidHide (Android-only events)', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const events = kb.addListener.mock.calls.map((args: unknown[]) => args[0]);
    expect(events).not.toContain('keyboardDidShow');
    expect(events).not.toContain('keyboardDidHide');
  });

  it('iOS: keyboardWillShow sets --keyboard-height', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const showCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardWillShow');
    (showCall![1] as (info: { keyboardHeight: number }) => void)({ keyboardHeight: 320 });

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('320px');
  });

  it('iOS: keyboardWillShow adds keyboard-open class', async () => {
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const showCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardWillShow');
    (showCall![1] as (info: { keyboardHeight: number }) => void)({ keyboardHeight: 320 });

    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  it('iOS: keyboardWillHide sets --keyboard-height to 0px', async () => {
    document.documentElement.style.setProperty('--keyboard-height', '320px');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const hideCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardWillHide');
    (hideCall![1] as () => void)();

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('iOS: keyboardWillHide removes keyboard-open class', async () => {
    document.documentElement.classList.add('keyboard-open');
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    const hideCall = kb.addListener.mock.calls.find((args: unknown[]) => args[0] === 'keyboardWillHide');
    (hideCall![1] as () => void)();

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

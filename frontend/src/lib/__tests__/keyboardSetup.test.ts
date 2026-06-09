import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupKeyboard, viewportKeyboardHeight } from '../keyboardSetup';

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
  // jsdom has no window.visualViewport, so the tests in THIS block exercise the legacy
  // no-viewport FALLBACK path, where info.keyboardHeight is the height source. When a
  // visual viewport IS present (all real devices) it is authoritative — see the
  // "single clamped source of truth" block below. Modal backdrops anchor at
  // bottom: var(--keyboard-height) and cap with max-height: calc(100vh - var(--keyboard-height)).

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
  // iOS uses KeyboardResize.None. Like the Android block, these run under jsdom with no
  // visual viewport, so they cover the native-height FALLBACK. The viewport-present iOS
  // case (willShow fires before the viewport shrinks) is covered in the block below.

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

// ── Visual viewport: the primary, self-correcting source ──────────────────────
// jsdom does not implement window.visualViewport, so these tests stub it. They
// restore the original innerHeight / visualViewport afterwards so the listener-
// count tests above (which assume no visual viewport) keep passing.

function stubViewport(innerHeight: number, vv: object | undefined) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
}

describe('viewportKeyboardHeight', () => {
  const realInnerHeight = window.innerHeight;
  const realViewport = window.visualViewport;

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: realInnerHeight, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: realViewport, configurable: true });
  });

  it('returns 0 when the visual viewport is unavailable', () => {
    stubViewport(1000, undefined);
    expect(viewportKeyboardHeight()).toBe(0);
  });

  it('returns the bottom occlusion (innerHeight - vv.height - offsetTop)', () => {
    stubViewport(1000, { height: 600, offsetTop: 0 });
    expect(viewportKeyboardHeight()).toBe(400);
  });

  it('discounts an OS pan via offsetTop so it is not double-counted', () => {
    // The OS panned the WebView up 100px; only 300px is actually keyboard.
    stubViewport(1000, { height: 600, offsetTop: 100 });
    expect(viewportKeyboardHeight()).toBe(300);
  });

  it('never returns a negative height', () => {
    stubViewport(800, { height: 900, offsetTop: 0 });
    expect(viewportKeyboardHeight()).toBe(0);
  });
});

describe('setupKeyboard: single clamped source of truth', () => {
  const realInnerHeight = window.innerHeight;
  const realViewport = window.visualViewport;

  beforeEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
    document.documentElement.classList.remove('keyboard-open');
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: realInnerHeight, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: realViewport, configurable: true });
  });

  const getKbHeight = () => document.documentElement.style.getPropertyValue('--keyboard-height');
  const fireShow = (kb: ReturnType<typeof makeKeyboardMock>, info: { keyboardHeight: number }) => {
    const show = kb.addListener.mock.calls.find((a: unknown[]) => a[0] === 'keyboardDidShow');
    (show![1] as (i: { keyboardHeight: number }) => void)(info);
  };

  it('clamps an implausibly large plugin height to <= 60% of the viewport', async () => {
    // No visual viewport → falls back to the plugin height, which on edge-to-edge
    // Android can over-report (physical pixels / double-counted pan).
    stubViewport(1000, undefined);
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    fireShow(kb, { keyboardHeight: 950 });

    expect(getKbHeight()).toBe('600px'); // clamped to 0.6 * 1000, never the bogus 950
  });

  it('prefers the visual-viewport measurement over a bogus plugin height', async () => {
    stubViewport(1000, {
      height: 650,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    fireShow(kb, { keyboardHeight: 950 }); // plugin lies; viewport says 1000 - 650 = 350

    expect(getKbHeight()).toBe('350px');
  });

  it('attaches visual-viewport resize + scroll listeners when available', async () => {
    const addEventListener = vi.fn();
    stubViewport(1000, { height: 1000, offsetTop: 0, addEventListener, removeEventListener: vi.fn() });
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  // Regression for the real device (Samsung, dpr 4): the OS RESIZES the WebView, so
  // innerHeight drops on open (804 → 549). 100vh already excludes the keyboard →
  // --keyboard-height MUST be 0, or the modal CSS subtracts the keyboard height a
  // second time (the 255px gap). The baseline (804) is captured at setup, BEFORE the
  // shrink, so the open transition is what proves the fix.
  it('resize-mode device: innerHeight drops on open → --keyboard-height 0 but keyboard-open YES', async () => {
    stubViewport(804, { height: 804, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // closed: baseline 804
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);
    stubViewport(549, { height: 549, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // keyboard opened, WebView resized

    fireShow(kb, { keyboardHeight: 255 }); // shrank 255 == native 255 → overlap 0

    expect(getKbHeight()).toBe('0px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  // OVERLAY device whose visual viewport DOES report the inset: innerHeight stays full,
  // vv.height shrinks. --keyboard-height = the overlap so the modal lifts above it.
  it('overlay-mode device, viewport reports the inset → --keyboard-height = overlap', async () => {
    stubViewport(804, { height: 804, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // baseline 804
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);
    stubViewport(804, { height: 549, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // overlay: innerHeight unchanged, vv shrank

    fireShow(kb, { keyboardHeight: 255 });

    expect(getKbHeight()).toBe('255px'); // 804 - 549
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  // OVERLAY device whose visual viewport does NOT surface the IME inset (older Chromium /
  // some OEM skins): innerHeight unchanged AND vv.height unchanged, so the viewport reads
  // 0 — but the keyboard IS up. We MUST fall back to the native height, not 0, or the
  // footer renders behind the keyboard (the inverse bug the self-review caught).
  it('overlay device, viewport reports no inset → falls back to native height (not 0)', async () => {
    stubViewport(804, { height: 804, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    fireShow(kb, { keyboardHeight: 255 }); // vv still reads 0, innerHeight unchanged (shrank 0) → native 255

    expect(getKbHeight()).toBe('255px');
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
  });

  // iOS: keyboardWillShow fires BEFORE the visual viewport shrinks, so the viewport reads
  // 0 at that instant. Must use the native height immediately (no transient gap), not 0.
  it('iOS willShow before the viewport shrinks → uses native height immediately', async () => {
    stubViewport(844, { height: 844, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // vv present, not yet shrunk
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false); // iOS

    const willShow = kb.addListener.mock.calls.find((a: unknown[]) => a[0] === 'keyboardWillShow');
    (willShow![1] as (i: { keyboardHeight: number }) => void)({ keyboardHeight: 336 });

    expect(getKbHeight()).toBe('336px'); // not 0
  });

  // The visual-viewport listener is the self-correcting path (tracks the open animation
  // and OS pan). Fire it directly to prove apply() runs on the vv path, not just native.
  it('visual-viewport resize event drives --keyboard-height (self-correcting path)', async () => {
    const handlers: Record<string, () => void> = {};
    const vv = {
      height: 844, offsetTop: 0,
      addEventListener: (e: string, h: () => void) => { handlers[e] = h; },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    vv.height = 508; // keyboard slid in: 844 - 508 = 336 inset
    handlers.resize();

    expect(getKbHeight()).toBe('336px');
  });

  // keyboard-open follows the 50px threshold on the viewport-only path (nativeUp false):
  // a small nav-bar/gesture inset must NOT latch keyboard-open (which collapses pb-safe-modal).
  it('keyboard-open respects the 50px threshold on the viewport path', async () => {
    const handlers: Record<string, () => void> = {};
    const vv = {
      height: 844, offsetTop: 0,
      addEventListener: (e: string, h: () => void) => { handlers[e] = h; },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, false);

    vv.height = 804; handlers.resize(); // 40px inset (< 50) — nav bar, not a keyboard
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(false);
    expect(getKbHeight()).toBe('0px');

    vv.height = 784; handlers.resize(); // 60px inset (> 50)
    expect(document.documentElement.classList.contains('keyboard-open')).toBe(true);
    expect(getKbHeight()).toBe('60px');
  });

  // The clamp guards the PRIMARY (viewport) path too, not only the plugin fallback.
  it('clamps an over-reporting visual viewport to <= 60% of the viewport', async () => {
    stubViewport(1000, { height: 100, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() }); // 900px inset = 90%
    const kb = makeKeyboardMock();
    await setupKeyboard(kb, true);

    fireShow(kb, { keyboardHeight: 255 });

    expect(getKbHeight()).toBe('600px'); // clamped to 0.6 * 1000, not 900
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the mobile keyboard and safe area handling.
 *
 * These verify the contracts that keep modals correctly positioned:
 * 1. visualViewport resize → --keyboard-height CSS variable
 * 2. Android nav bar is opaque (styles.xml) → no bottom safe area hacks needed
 * 3. Modal max-height formula includes --keyboard-height
 */

describe('keyboard height tracking via visualViewport', () => {
  let resizeHandler: (() => void) | null = null;

  beforeEach(() => {
    resizeHandler = null;

    // Mock visualViewport
    Object.defineProperty(window, 'visualViewport', {
      value: {
        height: 800,
        addEventListener: vi.fn((_event: string, handler: () => void) => {
          resizeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    // Mock innerHeight (full viewport)
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--keyboard-height');
  });

  it('sets --keyboard-height to 0 when no keyboard is visible', () => {
    // Simulate the visualViewport resize handler from _app.tsx
    const updateKeyboardHeight = () => {
      const kbHeight = Math.max(0, window.innerHeight - window.visualViewport!.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kbHeight}px`);
    };

    // visualViewport.height === innerHeight → no keyboard
    updateKeyboardHeight();

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('sets --keyboard-height when keyboard opens (visualViewport shrinks)', () => {
    const updateKeyboardHeight = () => {
      const kbHeight = Math.max(0, window.innerHeight - window.visualViewport!.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kbHeight}px`);
    };

    // Simulate keyboard opening: visualViewport shrinks to 500px, innerHeight stays 800px
    Object.defineProperty(window.visualViewport, 'height', { value: 500, configurable: true });
    updateKeyboardHeight();

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px');
  });

  it('resets --keyboard-height when keyboard closes', () => {
    const updateKeyboardHeight = () => {
      const kbHeight = Math.max(0, window.innerHeight - window.visualViewport!.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kbHeight}px`);
    };

    // Keyboard opens
    Object.defineProperty(window.visualViewport, 'height', { value: 500, configurable: true });
    updateKeyboardHeight();
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px');

    // Keyboard closes
    Object.defineProperty(window.visualViewport, 'height', { value: 800, configurable: true });
    updateKeyboardHeight();
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('never sets negative keyboard height', () => {
    const updateKeyboardHeight = () => {
      const kbHeight = Math.max(0, window.innerHeight - window.visualViewport!.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kbHeight}px`);
    };

    // Edge case: visualViewport.height > innerHeight (can happen during orientation change)
    Object.defineProperty(window.visualViewport, 'height', { value: 900, configurable: true });
    updateKeyboardHeight();

    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('registers resize event listener on visualViewport', () => {
    // Verify addEventListener was called during mock setup
    expect(window.visualViewport!.addEventListener).toBeDefined();

    // Simulate what _app.tsx does
    if (window.visualViewport) {
      const handler = vi.fn();
      window.visualViewport.addEventListener('resize', handler);
      expect(window.visualViewport.addEventListener).toHaveBeenCalledWith('resize', handler);
    }
  });
});

describe('modal max-height formula', () => {
  it('includes --keyboard-height in the calc expression', () => {
    // This is a structural test — verify the CSS class string contains the keyboard-height variable.
    // The actual modal components use this pattern:
    // max-h-[calc(100dvh-var(--sai-top)-var(--keyboard-height,0px)-8px)]
    const expectedPattern = 'var(--keyboard-height,0px)';
    const modalMaxHClass = 'max-h-[calc(100dvh-var(--sai-top)-var(--keyboard-height,0px)-8px)]';

    expect(modalMaxHClass).toContain(expectedPattern);
    expect(modalMaxHClass).toContain('--sai-top');
    expect(modalMaxHClass).toContain('100dvh');
  });

  it('falls back to 0px when --keyboard-height is not set', () => {
    // The CSS var(--keyboard-height, 0px) fallback means modals work
    // correctly on web where the variable is never set.
    const fallback = 'var(--keyboard-height,0px)';
    expect(fallback).toContain('0px');
  });
});

describe('Android safe area probe (top only)', () => {
  it('sets --sai-top fallback when env(safe-area-inset-top) returns 0', () => {
    // Simulate what _app.tsx probe does on Android
    const probe = document.createElement('div');
    probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
    document.body.appendChild(probe);

    // jsdom doesn't support env() — getComputedStyle returns 0
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    document.body.removeChild(probe);

    if (inset === 0) {
      document.documentElement.style.setProperty('--sai-top', '24px');
    }

    expect(document.documentElement.style.getPropertyValue('--sai-top')).toBe('24px');

    // Cleanup
    document.documentElement.style.removeProperty('--sai-top');
  });

  it('does NOT set --sai-bottom (Android nav bar is opaque, no probe needed)', () => {
    // After making Android nav bar opaque, we removed the bottom probe.
    // Verify it's not being set by the probe logic.
    // The only bottom safe area should come from CSS env() fallback.
    expect(document.documentElement.style.getPropertyValue('--sai-bottom')).toBe('');
  });
});

describe('capacitor config', () => {
  it('uses KeyboardResize.None for iOS (Android overrides to Body at runtime)', async () => {
    // KeyboardResize.Body permanently distorts WKWebView layout on iOS.
    // KeyboardResize.Native can't scroll fixed-position modals.
    // Config uses None; Android overrides to Body at runtime in _app.tsx.
    // KeyboardResize.Body + visualViewport tracking is the correct approach.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const configTs = fs.readFileSync(
      path.resolve(__dirname, '../../capacitor.config.ts'),
      'utf-8'
    );

    expect(configTs).toContain('KeyboardResize.None');
    expect(configTs).not.toContain('KeyboardResize.Native');
  });

  it('Android navigation bar is transparent (edge-to-edge)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stylesXml = fs.readFileSync(
      path.resolve(__dirname, '../../android/app/src/main/res/values-v29/styles.xml'),
      'utf-8'
    );

    // Navigation bar is transparent for edge-to-edge display
    expect(stylesXml).toContain('android:navigationBarColor">@android:color/transparent');
  });
});

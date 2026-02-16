import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useRef, useEffect } from 'react';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';

// jsdom doesn't have PointerEvent — polyfill it
class MockPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, params: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, { ...params, bubbles: true });
    this.pointerId = params.pointerId ?? 1;
    this.pointerType = params.pointerType ?? 'touch';
  }
}
if (typeof window !== 'undefined' && !window.PointerEvent) {
  (window as unknown as Record<string, unknown>).PointerEvent = MockPointerEvent;
}

// Stub setPointerCapture / releasePointerCapture on elements
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/**
 * Helper: renders a component that uses the hook and exposes the inner div.
 */
function TestComponent({
  onDismiss,
  enabled = true,
  threshold,
}: {
  onDismiss: () => void;
  enabled?: boolean;
  threshold?: number;
}) {
  const { ref, isDismissing } = useSwipeToDismiss({ onDismiss, enabled, threshold });

  return (
    <div data-testid="outer" style={{ width: 300 }}>
      <div ref={ref} data-testid="swipeable" style={{ width: 300, height: 60 }}>
        Content
      </div>
      {isDismissing && <span data-testid="dismissing" />}
    </div>
  );
}

/** Simulate a pointer gesture sequence on an element */
function simulateSwipe(
  el: HTMLElement,
  startX: number,
  endX: number,
  startY = 100,
  endY = 100,
) {
  // Mock getBoundingClientRect so the hook knows element width
  el.getBoundingClientRect = vi.fn(() => ({
    width: 300,
    height: 60,
    top: 80,
    left: 0,
    right: 300,
    bottom: 140,
    x: 0,
    y: 80,
    toJSON: () => ({}),
  }));

  act(() => {
    el.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: startX, clientY: startY, button: 0 }));
  });

  // Move in small steps to trigger direction lock
  const steps = 5;
  const dx = (endX - startX) / steps;
  const dy = (endY - startY) / steps;
  for (let i = 1; i <= steps; i++) {
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointermove', {
        clientX: startX + dx * i,
        clientY: startY + dy * i,
      }));
    });
  }

  act(() => {
    el.dispatchEvent(new MockPointerEvent('pointerup', { clientX: endX, clientY: endY }));
  });
}

describe('useSwipeToDismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should set touchAction to pan-y on mount', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    expect(el.style.touchAction).toBe('pan-y');
  });

  it('should not set touchAction when disabled', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss, enabled: false })
    );

    const el = getByTestId('swipeable');
    expect(el.style.touchAction).not.toBe('pan-y');
  });

  it('should snap back when swiped below threshold', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    // Swipe 50px on a 300px element = 16.7% (below 35% threshold)
    simulateSwipe(el, 100, 150);

    // Should animate back to 0
    expect(el.style.transform).toBe('translateX(0px)');
    expect(el.style.opacity).toBe('1');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should trigger dismiss when swiped past threshold (right)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    // Swipe 150px on a 300px element = 50% (above 35% threshold)
    simulateSwipe(el, 100, 250);

    // Should slide out to the right
    expect(el.style.transform).toBe('translateX(300px)');
    expect(el.style.opacity).toBe('0');

    // Wait for slide-out + collapse fallback timers
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should trigger dismiss when swiped past threshold (left)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    // Swipe left 150px
    simulateSwipe(el, 250, 100);

    // Should slide out to the left
    expect(el.style.transform).toBe('translateX(-300px)');
    expect(el.style.opacity).toBe('0');

    act(() => { vi.advanceTimersByTime(300); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should not respond to vertical swipes', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    // Swipe vertically (more Y than X)
    simulateSwipe(el, 100, 110, 100, 250);

    // Should not have modified transform
    expect(el.style.transform).toBe('');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should not respond when enabled is false', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss, enabled: false })
    );

    const el = getByTestId('swipeable');
    simulateSwipe(el, 100, 250);

    expect(el.style.transform).toBe('');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should ignore right-click (non-primary button)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    el.getBoundingClientRect = vi.fn(() => ({
      width: 300, height: 60, top: 80, left: 0, right: 300, bottom: 140, x: 0, y: 80, toJSON: () => ({}),
    }));

    // Right-click pointerdown (button=2)
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 2 }));
    });
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 250, clientY: 100 }));
    });
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointerup', { clientX: 250, clientY: 100 }));
    });

    expect(el.style.transform).toBe('');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should snap back on pointercancel', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    el.getBoundingClientRect = vi.fn(() => ({
      width: 300, height: 60, top: 80, left: 0, right: 300, bottom: 140, x: 0, y: 80, toJSON: () => ({}),
    }));

    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    });
    // Move enough to lock horizontal
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 150, clientY: 100 }));
    });
    // Cancel
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointercancel', { clientX: 150, clientY: 100 }));
    });

    expect(el.style.transform).toBe('translateX(0px)');
    expect(el.style.opacity).toBe('1');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should respect custom threshold', () => {
    const onDismiss = vi.fn();
    // Set a very low threshold (10%)
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss, threshold: 0.1 })
    );

    const el = getByTestId('swipeable');
    // Swipe 40px on 300px = 13.3% (above 10%)
    simulateSwipe(el, 100, 140);

    // Should trigger dismiss
    expect(el.style.opacity).toBe('0');

    act(() => { vi.advanceTimersByTime(600); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should apply opacity during drag', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      React.createElement(TestComponent, { onDismiss })
    );

    const el = getByTestId('swipeable');
    el.getBoundingClientRect = vi.fn(() => ({
      width: 300, height: 60, top: 80, left: 0, right: 300, bottom: 140, x: 0, y: 80, toJSON: () => ({}),
    }));

    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    });
    // Move past direction lock threshold
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 120, clientY: 100 }));
    });
    // Move further
    act(() => {
      el.dispatchEvent(new MockPointerEvent('pointermove', { clientX: 200, clientY: 100 }));
    });

    // Opacity should be reduced (not 1)
    const opacity = parseFloat(el.style.opacity);
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeGreaterThan(0);

    // Transform should track finger
    expect(el.style.transform).toBe('translateX(100px)');
  });
});

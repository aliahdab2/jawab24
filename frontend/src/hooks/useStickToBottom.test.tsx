import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useStickToBottom } from './useStickToBottom';

/**
 * A scroll container with a real-looking box: 1000px of content in a 400px
 * viewport. jsdom has no layout, so the geometry is declared, and `scrollTo`
 * (which jsdom does not implement on elements) just moves `scrollTop`.
 */
function makeThread() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true, writable: true });
  el.scrollTop = 600;
  el.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    el.scrollTop = top ?? 0;
  }) as unknown as typeof el.scrollTo;
  return el;
}

let resize: (() => void) | null = null;

beforeEach(() => {
  // Capture the observer callback so a test can fire "the container resized".
  class ResizeObserverStub {
    constructor(cb: ResizeObserverCallback) {
      resize = () => cb([], this as unknown as ResizeObserver);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
});

function shrinkBy(el: HTMLElement, px: number) {
  Object.defineProperty(el, 'clientHeight', { value: el.clientHeight - px, configurable: true });
  act(() => resize?.());
}

describe('useStickToBottom', () => {
  it('re-pins to the bottom when the container shrinks under a reader who was at the bottom', () => {
    const el = makeThread();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    renderHook(() => useStickToBottom(ref));

    // Keyboard opens: the thread loses 300px. By measurement alone the reader
    // is now 300px from the bottom — the hook must remember they WERE there.
    shrinkBy(el, 300);

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'instant' });
    expect(el.scrollTop).toBe(1000);
  });

  it('leaves a reader who scrolled up where they are', () => {
    const el = makeThread();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    renderHook(() => useStickToBottom(ref));

    el.scrollTop = 100;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    shrinkBy(el, 300);

    expect(el.scrollTo).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(100);
  });

  it('sticks again once scrollToBottom() has been called', () => {
    const el = makeThread();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const { result } = renderHook(() => useStickToBottom(ref));

    el.scrollTop = 100;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    act(() => result.current.scrollToBottom());
    shrinkBy(el, 300);

    expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'instant' });
  });

  it('isNearBottom measures the current position', () => {
    const el = makeThread();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const { result } = renderHook(() => useStickToBottom(ref));

    expect(result.current.isNearBottom()).toBe(true);
    el.scrollTop = 0;
    expect(result.current.isNearBottom()).toBe(false);
  });
});

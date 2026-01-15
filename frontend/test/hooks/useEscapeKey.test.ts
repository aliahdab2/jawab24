import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEscapeKey } from '@/hooks/useEscapeKey';

describe('useEscapeKey', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call callback when ESC key is pressed', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    // Simulate ESC key press
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(event);

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('should not call callback when other keys are pressed', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    // Simulate Enter key press
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    window.dispatchEvent(event);

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('should not call callback when disabled', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape, false));

    // Simulate ESC key press
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(event);

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('should add event listener on mount', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should remove event listener on unmount', () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEscape));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('should not add listener when disabled', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape, false));

    // Should not have added keydown listener for our hook
    // (There may be other listeners, so we check the call wasn't made for keydown with our function)
    const keydownCalls = addEventListenerSpy.mock.calls.filter(
      call => call[0] === 'keydown'
    );
    expect(keydownCalls.length).toBe(0);
  });

  it('should re-attach listener when enabled changes', () => {
    const onEscape = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useEscapeKey(onEscape, enabled),
      { initialProps: { enabled: false } }
    );

    // Initially disabled - no listener
    expect(addEventListenerSpy).not.toHaveBeenCalled();

    // Enable
    rerender({ enabled: true });
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

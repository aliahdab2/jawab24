import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useLandscape } from '@/hooks/useLandscape';

describe('useLandscape', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;
  let addEventListenerMock: ReturnType<typeof vi.fn>;
  let removeEventListenerMock: ReturnType<typeof vi.fn>;
  let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;

  beforeEach(() => {
    addEventListenerMock = vi.fn((event, handler) => {
      if (event === 'change') {
        changeHandler = handler;
      }
    });
    removeEventListenerMock = vi.fn();

    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('landscape') ? false : true,
      media: query,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    }));

    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    changeHandler = null;
  });

  it('should return false initially (portrait)', () => {
    const { result } = renderHook(() => useLandscape());
    expect(result.current).toBe(false);
  });

  it('should return true when initially in landscape', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: true,
      media: '(orientation: landscape)',
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    }));

    const { result } = renderHook(() => useLandscape());
    expect(result.current).toBe(true);
  });

  it('should add change event listener', () => {
    renderHook(() => useLandscape());
    expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('should remove event listener on unmount', () => {
    const { unmount } = renderHook(() => useLandscape());
    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('should update when orientation changes', () => {
    const { result } = renderHook(() => useLandscape());

    expect(result.current).toBe(false);

    // Simulate orientation change to landscape
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(result.current).toBe(true);

    // Simulate orientation change back to portrait
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: false } as MediaQueryListEvent);
      }
    });

    expect(result.current).toBe(false);
  });
});

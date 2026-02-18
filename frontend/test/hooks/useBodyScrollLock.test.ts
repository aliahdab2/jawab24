import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

describe('useBodyScrollLock', () => {
  let originalOverflow: string;
  let originalPaddingRight: string;

  beforeEach(() => {
    originalOverflow = document.body.style.overflow;
    originalPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    document.body.classList.remove('modal-open');
  });

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
    document.body.style.paddingRight = originalPaddingRight;
    document.body.classList.remove('modal-open');
  });

  it('should lock body scroll when enabled', () => {
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(true);
  });

  it('should not lock body scroll when disabled', () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe('');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('should restore original overflow on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = renderHook(() => useBodyScrollLock(true));

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('should update when locked prop changes', () => {
    const { rerender } = renderHook(
      ({ locked }) => useBodyScrollLock(locked),
      { initialProps: { locked: false } }
    );

    expect(document.body.style.overflow).toBe('');

    rerender({ locked: true });
    expect(document.body.style.overflow).toBe('hidden');

    rerender({ locked: false });
    // After unlocking, overflow should be restored
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('should keep lock active when one of nested locks unmounts', () => {
    const hook1 = renderHook(() => useBodyScrollLock(true));
    const hook2 = renderHook(() => useBodyScrollLock(true));

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(true);

    hook1.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(true);

    hook2.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('should restore existing inline body styles after nested unlock', () => {
    document.body.style.overflow = 'auto';
    document.body.style.paddingRight = '7px';

    const hook1 = renderHook(() => useBodyScrollLock(true));
    const hook2 = renderHook(() => useBodyScrollLock(true));

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(true);

    hook2.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('modal-open')).toBe(true);

    hook1.unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.paddingRight).toBe('7px');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });
});

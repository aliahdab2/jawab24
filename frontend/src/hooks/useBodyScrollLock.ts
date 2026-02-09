import { useLayoutEffect, useEffect } from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Custom hook to lock body scroll when a modal/overlay is open
 * Prevents background scrolling on iOS/Android
 * Compensates for scrollbar width to prevent layout shift
 *
 * @param locked - Whether scroll should be locked
 *
 * @example
 * // Lock scroll when modal is open
 * useBodyScrollLock(isModalOpen);
 *
 * // Always lock (e.g., full-screen wizard)
 * useBodyScrollLock(true);
 */
export function useBodyScrollLock(locked: boolean): void {
  useIsomorphicLayoutEffect(() => {
    if (locked) {
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }

      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
      };
    }
  }, [locked]);
}

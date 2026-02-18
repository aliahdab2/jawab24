import { useLayoutEffect, useEffect } from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

let activeLocks = 0;
let originalOverflow: string | null = null;
let originalPaddingRight: string | null = null;
let hadModalOpenClass = false;

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
    if (!locked) return;

    if (activeLocks === 0) {
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      originalOverflow = document.body.style.overflow;
      originalPaddingRight = document.body.style.paddingRight;
      hadModalOpenClass = document.body.classList.contains('modal-open');

      document.body.style.overflow = 'hidden';
      if (scrollBarWidth > 0) {
        document.body.style.paddingRight = `${scrollBarWidth}px`;
      }
      document.body.classList.add('modal-open');
    }

    activeLocks += 1;

    return () => {
      if (activeLocks === 0) return;

      activeLocks -= 1;
      if (activeLocks > 0) return;

      document.body.style.overflow = originalOverflow ?? '';
      document.body.style.paddingRight = originalPaddingRight ?? '';

      if (!hadModalOpenClass) {
        document.body.classList.remove('modal-open');
      }

      originalOverflow = null;
      originalPaddingRight = null;
      hadModalOpenClass = false;
    };
  }, [locked]);
}

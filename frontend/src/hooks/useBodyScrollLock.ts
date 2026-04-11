import { useLayoutEffect, useEffect } from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

let activeLocks = 0;
let savedScrollY = 0;
let originalOverflow = '';
let originalPaddingRight = '';
let hadModalOpenClass = false;

/**
 * Locks body scroll when a modal/overlay is open.
 *
 * Compensates for scrollbar width to prevent layout shift on desktop.
 * Saves and restores scroll position so the page doesn't jump on close.
 *
 * @param locked - Whether scroll should be locked
 */
export function useBodyScrollLock(locked: boolean): void {
  useIsomorphicLayoutEffect(() => {
    if (!locked) return;

    if (activeLocks === 0) {
      savedScrollY = window.scrollY;
      hadModalOpenClass = document.body.classList.contains('modal-open');

      originalOverflow = document.body.style.overflow;
      originalPaddingRight = document.body.style.paddingRight;

      // Compensate for scrollbar disappearing so the page doesn't jump.
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
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

      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;

      if (!hadModalOpenClass) {
        document.body.classList.remove('modal-open');
      }

      // Restore scroll position without triggering a visible jump.
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });

      savedScrollY = 0;
      originalOverflow = '';
      originalPaddingRight = '';
      hadModalOpenClass = false;
    };
  }, [locked]);
}

import { useLayoutEffect, useEffect } from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

let activeLocks = 0;
let savedScrollY = 0;
let originalOverflow = '';
let originalPosition = '';
let originalTop = '';
let originalWidth = '';
let originalPaddingRight = '';
let hadModalOpenClass = false;

/**
 * Locks body scroll when a modal/overlay is open.
 *
 * Uses position:fixed on the body — required for mobile WebViews where
 * overflow:hidden alone does not prevent background scroll (Capacitor Android/iOS).
 * Saves and restores scroll position so the page doesn't jump on close.
 * Compensates for scrollbar width on desktop to prevent layout shift.
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
      originalPosition = document.body.style.position;
      originalTop = document.body.style.top;
      originalWidth = document.body.style.width;
      originalPaddingRight = document.body.style.paddingRight;

      // position:fixed prevents background scroll in mobile WebViews.
      // top:-scrollY keeps the visual position stable (body snaps to 0 otherwise).
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = '100%';
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
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.paddingRight = originalPaddingRight;

      if (!hadModalOpenClass) {
        document.body.classList.remove('modal-open');
      }

      // Restore scroll position — must happen after position:fixed is removed.
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });

      savedScrollY = 0;
      originalOverflow = '';
      originalPosition = '';
      originalTop = '';
      originalWidth = '';
      originalPaddingRight = '';
      hadModalOpenClass = false;
    };
  }, [locked]);
}

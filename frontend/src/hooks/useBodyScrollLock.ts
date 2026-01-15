import { useEffect } from 'react';

/**
 * Custom hook to lock body scroll when a modal/overlay is open
 * Prevents background scrolling on iOS/Android
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
  useEffect(() => {
    if (locked) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [locked]);
}

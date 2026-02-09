import { useState, useLayoutEffect, useEffect } from 'react';

// Avoid useLayoutEffect SSR warning in Next.js
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Custom hook to detect landscape orientation
 * Uses matchMedia for efficient, event-driven updates
 * Uses useLayoutEffect to set value before browser paint (prevents layout flash)
 *
 * @returns boolean - true if device is in landscape orientation
 *
 * @example
 * const isLandscape = useLandscape();
 * return <div className={isLandscape ? 'flex-row' : 'flex-col'}>...</div>;
 */
export function useLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}

import { useState, useEffect } from 'react';

/**
 * Custom hook to detect landscape orientation
 * Uses matchMedia for efficient, event-driven updates
 * 
 * @returns boolean - true if device is in landscape orientation
 * 
 * @example
 * const isLandscape = useLandscape();
 * return <div className={isLandscape ? 'flex-row' : 'flex-col'}>...</div>;
 */
export function useLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}

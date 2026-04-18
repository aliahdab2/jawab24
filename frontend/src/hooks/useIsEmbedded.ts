import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const STORAGE_KEY = 'jawab24_embedded';

/**
 * Detects whether the current tab is running in "embedded" mode —
 * i.e. opened from the native app (via Capacitor Browser) with
 * `?embedded=1` on the initial URL.
 *
 * Persists to sessionStorage so navigating internally through the
 * funnel (pricing → login → checkout → success) keeps the chrome
 * hidden even when individual Next.js Links don't carry the flag.
 * Cleared automatically when the tab closes.
 *
 * SSR-safe: returns `false` during server render and hydrates to the
 * real value on the client.
 */
export function useIsEmbedded(): boolean {
  const router = useRouter();
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fromUrl = router.query.embedded === '1';
    if (fromUrl) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Storage can be unavailable (Safari private mode, quota). The URL
        // flag alone still works for the current page render.
      }
      setIsEmbedded(true);
      return;
    }

    try {
      setIsEmbedded(window.sessionStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setIsEmbedded(false);
    }
  }, [router.query.embedded]);

  return isEmbedded;
}

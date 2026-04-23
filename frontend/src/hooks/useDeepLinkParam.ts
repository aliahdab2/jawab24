import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

/**
 * Captures a deep-link query param (e.g. ?messageId=abc or ?commentId=xyz),
 * strips it from the URL after reading, and returns the captured value.
 *
 * The strip uses `window.history.replaceState` rather than `router.replace` so
 * it does not trigger a re-render. The caller's onOpen handler typically does
 * its own `router.replace` to swap in a canonical param (?conversation=, ?comment=)
 * — letting that be the only Next-level URL change avoids a visible flicker
 * between the two navigations.
 *
 * Re-fires when the param changes to a new value, so tapping a second
 * notification while the page is already mounted still triggers the
 * downstream fetch/open instead of being ignored.
 *
 * Returns null until router is ready, then either the captured string or null.
 */
export function useDeepLinkParam(paramName: string): string | null {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(null);
  const lastConsumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query[paramName];
    const captured = typeof raw === 'string' ? raw : null;
    if (!captured || captured === lastConsumedRef.current) return;

    lastConsumedRef.current = captured;
    setValue(captured);

    const params = new URLSearchParams(window.location.search);
    params.delete(paramName);
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [router.isReady, router.query, paramName]);

  return value;
}

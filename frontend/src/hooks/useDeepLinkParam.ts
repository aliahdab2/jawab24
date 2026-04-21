import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

/**
 * Captures a one-shot deep-link query param (e.g. ?messageId=abc or ?commentId=xyz),
 * strips it from the URL on first read, and returns the captured value exactly once.
 *
 * Downstream effects can depend on the returned value and run their fetch/open logic
 * without worrying about re-firing when other query params change.
 *
 * Returns null until router is ready, then either the captured string or null.
 */
export function useDeepLinkParam(paramName: string): string | null {
  const router = useRouter();
  const [value, setValue] = useState<string | null>(null);
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!router.isReady || consumedRef.current) return;
    const raw = router.query[paramName];
    const captured = typeof raw === 'string' ? raw : null;
    if (!captured) return;

    consumedRef.current = true;
    setValue(captured);

    const params = new URLSearchParams(window.location.search);
    params.delete(paramName);
    router.replace(
      { pathname: router.pathname, query: Object.fromEntries(params) },
      undefined,
      { shallow: true },
    );
  }, [router.isReady, router.query, paramName, router]);

  return value;
}

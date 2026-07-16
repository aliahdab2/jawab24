import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

/**
 * Fire `onTrigger` exactly once when this page is opened with `?<param>=true`
 * (a deep-link, e.g. from the dashboard checklist or the Settings Auto-Reply
 * board), once `ready` is true, then strip the param from the URL. One helper
 * keeps the ref-guard + readiness + URL-cleanup from being copy-pasted per
 * deep-link. Used by /pages (?openKb, ?openTestReply) and /comments
 * (?openPostReply).
 */
export function useOpenOnQueryParam(param: string, ready: boolean, onTrigger: () => void) {
  const router = useRouter();
  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current || !router.isReady || !ready) return;
    if (router.query[param] !== 'true') return;
    handledRef.current = true;
    onTrigger();
    // Clean up the URL without triggering a re-render.
    router.replace(router.pathname, undefined, { shallow: true });
  }, [router, param, ready, onTrigger]);
}

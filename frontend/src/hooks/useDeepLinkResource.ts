import { useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { captureError } from '@/lib/sentryHelpers';
import { useDeepLinkParam } from './useDeepLinkParam';

export interface UseDeepLinkResourceOptions<T> {
  /** Fetch the resource by its id. Return null when the server reports the resource is absent (empty/soft-deleted). */
  fetch: (id: string) => Promise<T | null>;
  /** Open / display the fetched resource. */
  onOpen: (item: T) => void;
  /** Pre-translated message shown when the resource is gone (404 or null). */
  notFoundMessage: string;
  /** Sentry tags describing the page + action for unexpected failures. */
  errorTag: { page: string; action: string };
}

/**
 * One-shot deep-link handler: captures a `?<paramName>=<id>` query param, fetches the
 * resource directly, and opens it. Handles loading toast, 404 → not-found info toast,
 * and unexpected errors → Sentry + generic error toast.
 *
 * Bypasses list-based lookup so notifications always open their target regardless
 * of pagination or active filters.
 *
 * Callers should memoize `fetch` and `onOpen` with useCallback to avoid re-firing the effect.
 */
export function useDeepLinkResource<T>(
  paramName: string,
  opts: UseDeepLinkResourceOptions<T>,
): void {
  const tc = useTranslations('common');
  const deepLinkId = useDeepLinkParam(paramName);
  const { fetch, onOpen, notFoundMessage, errorTag } = opts;

  useEffect(() => {
    if (!deepLinkId) return;
    const targetId = deepLinkId;

    (async () => {
      const loadingToastId = toast.loading(tc('loading'));
      try {
        const resource = await fetch(targetId);
        toast.dismiss(loadingToastId);
        if (!resource) {
          toast.info(notFoundMessage);
          return;
        }
        onOpen(resource);
      } catch (err) {
        toast.dismiss(loadingToastId);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          toast.info(notFoundMessage);
        } else {
          captureError(err, `Failed to open deep-linked resource (${errorTag.page})`, { tags: errorTag });
          toast.error(tc('error'));
        }
      }
    })();
  }, [deepLinkId, fetch, onOpen, notFoundMessage, errorTag, tc]);
}

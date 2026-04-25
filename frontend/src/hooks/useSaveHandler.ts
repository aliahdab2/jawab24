import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { captureError } from '@/lib/sentryHelpers';

interface UseSaveHandlerOptions {
  /** Sentry/captureError context tag, e.g. 'PostTriggerModal.handleSave' */
  context: string;
  /** Toast message on success (already translated) */
  successMessage?: string;
  /** Called after a successful save, before any close/refresh callback */
  onSuccess?: () => void | Promise<void>;
  /**
   * Toast message on failure. Defaults to common.error.
   * Pass a translated string; raw error details are sent to Sentry, never shown.
   */
  errorMessage?: string;
}

/**
 * Wraps an async save/clear/delete operation with the standard
 * setSaving → await → toast → captureError → finally pattern. Returns a stable
 * handler and a `saving` flag for disabling buttons.
 *
 * @example
 * const { handle, saving } = useSaveHandler({
 *   context: 'PostTriggerModal.save',
 *   successMessage: t('postTriggerSaved'),
 *   onSuccess: () => { onSaved(); onClose(); },
 * });
 * await handle(() => postsApi.updateTrigger(postId, source, kw, reply));
 */
export function useSaveHandler({
  context,
  successMessage,
  onSuccess,
  errorMessage,
}: UseSaveHandlerOptions) {
  const tc = useTranslations('common');
  const [saving, setSaving] = useState(false);

  const handle = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      setSaving(true);
      try {
        const result = await operation();
        if (successMessage) toast.success(successMessage);
        if (onSuccess) await onSuccess();
        return result;
      } catch (err) {
        captureError(err, context);
        toast.error(errorMessage ?? tc('error'));
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [context, successMessage, onSuccess, errorMessage, tc]
  );

  return { handle, saving };
}

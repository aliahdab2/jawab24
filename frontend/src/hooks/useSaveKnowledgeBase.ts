import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ApiError } from '@/lib/api-utils';
import { captureError } from '@/lib/sentryHelpers';
import type { KbWarnings } from '@/components/knowledge-base/types';

interface UseSaveKnowledgeBaseResult {
  /** Persist KB text for a page. Resolves to kbWarnings on success, or undefined on failure / no warnings. */
  saveKnowledgeBase: (pageId: string, text: string) => Promise<KbWarnings | undefined>;
  saving: boolean;
  saved: boolean;
  /** Clear the transient "saved" checkmark (e.g. when opening a different page's editor). */
  resetSaved: () => void;
}

/**
 * Shared save handler for the Business Info / Knowledge Base editor — used by the
 * /pages screen and the in-conversation InlineKbEditorModal. Centralizes the
 * PUT /pages/:id call, kbWarnings handling, saving/saved state, and error toasts
 * so the logic lives in exactly one place.
 *
 * @param onSuccess Invoked inside the success path (after the PUT resolves) so the
 *   caller can update its own local copy of the page (setPages / setPage).
 */
export function useSaveKnowledgeBase(
  onSuccess?: (pageId: string, text: string) => void,
): UseSaveKnowledgeBaseResult {
  const t = useTranslations('pages');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveKnowledgeBase = async (pageId: string, text: string): Promise<KbWarnings | undefined> => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await api.put<{ kbWarnings?: KbWarnings }>(
        `/pages/${pageId}`,
        { knowledgeBase: text },
      );
      onSuccess?.(pageId, text);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      return response.data.kbWarnings;
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.response?.status === 403 && apiError.response?.data?.code === 'WORKSPACE_ACCESS_DENIED') {
        toast.error(t('saveFailedAccessRevoked'));
      } else {
        captureError(error, 'Failed to save knowledge base', { tags: { action: 'save-kb' } });
        toast.error(t('saveFailed'));
      }
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  // Stable identity so callers can safely list it in effect dependency arrays.
  const resetSaved = useCallback(() => setSaved(false), []);

  return { saveKnowledgeBase, saving, saved, resetSaved };
}

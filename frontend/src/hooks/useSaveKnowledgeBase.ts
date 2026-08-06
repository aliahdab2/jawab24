import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { addErrorBreadcrumb, captureError } from '@/lib/sentryHelpers';
import { authorizationOutcome } from '@/utils/authorizationOutcome';
import type { KbWarnings, SaveKbOutcome } from '@/components/knowledge-base/types';

interface UseSaveKnowledgeBaseResult {
  /**
   * Persist KB text for a page. Resolves `{ ok: true, kbWarnings? }` on
   * success and `{ ok: false }` on failure (after toasting) — discriminated so
   * callers that continue past the save (the catalog CTA) can stop on failure.
   */
  saveKnowledgeBase: (pageId: string, text: string) => Promise<SaveKbOutcome>;
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

  const saveKnowledgeBase = async (pageId: string, text: string): Promise<SaveKbOutcome> => {
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
      return { ok: true, kbWarnings: response.data.kbWarnings };
    } catch (error) {
      // Both 403 codes are AUTHORIZATION OUTCOMES, not defects: the member was
      // removed from the workspace, or never had the admin role `PUT /pages/:id`
      // requires. They get a specific message and — deliberately — no
      // captureError, which previously filed every one of them as a Sentry bug.
      // Classification is shared (`authorizationOutcome`) because the fact-list
      // and single-fact saves must reach the same verdict; only the COPY is
      // per-surface, so this one can name Business Info.
      const outcome = authorizationOutcome(error);
      if (outcome) {
        // Not an error, but not nothing either: a refusal here means a UI that
        // offered a write it could not complete. Suppressing the Sentry event
        // without leaving a trail would make the next such mismatch invisible —
        // which is exactly how this bug survived. A breadcrumb keeps the signal
        // attached to whatever the session does report, at zero noise.
        addErrorBreadcrumb('authorization', 'Business Info save refused', {
          code: outcome,
          pageId,
        });
        toast.error(outcome === 'WORKSPACE_ACCESS_DENIED'
          ? t('saveFailedAccessRevoked')
          : t('saveFailedInsufficientRole'));
      } else {
        captureError(error, 'Failed to save knowledge base', { tags: { action: 'save-kb' } });
        toast.error(t('saveFailed'));
      }
      return { ok: false };
    } finally {
      setSaving(false);
    }
  };

  // Stable identity so callers can safely list it in effect dependency arrays.
  const resetSaved = useCallback(() => setSaved(false), []);

  return { saveKnowledgeBase, saving, saved, resetSaved };
}

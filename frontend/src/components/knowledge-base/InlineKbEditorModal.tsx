import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PageDetail } from '@jawab24/shared';
import { pagesApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { useSaveKnowledgeBase } from '@/hooks/useSaveKnowledgeBase';

// Heavy editor — loaded only when the merchant actually opens it, keeping it out
// of the inbox initial bundle (same pattern as the /pages screen).
const KnowledgeBaseModal = dynamic(
  () => import('./KnowledgeBaseModal').then(m => ({ default: m.KnowledgeBaseModal })),
  { ssr: false },
);

interface InlineKbEditorModalProps {
  /** The conversation's page whose Business Info / KB should be edited. */
  pageId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Opens the Business Info / Knowledge Base editor in place — layered over a
 * conversation or comment detail modal — for a specific page, instead of
 * navigating away to /pages.
 *
 * The inbox only carries a pageId in context, so this loads the full page (with
 * its KB text) on open, then renders KnowledgeBaseModal. Saving is delegated to
 * the shared useSaveKnowledgeBase hook (same logic as the /pages screen). Both
 * this loading overlay and KnowledgeBaseModal portal to document.body, so they
 * stack above the host modal (which also portals to body).
 */
export function InlineKbEditorModal({ pageId, open, onClose }: InlineKbEditorModalProps) {
  const t = useTranslations('pages');
  const [page, setPage] = useState<PageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // No onSuccess: deliberately do NOT mutate `page` after save. KnowledgeBaseModal
  // re-initializes its editor state whenever its `page` prop changes, so updating
  // it here would reset the view right after the merchant saves. The editor
  // re-loads fresh on the next open instead (matching the /pages screen).
  const { saveKnowledgeBase, saving, saved } = useSaveKnowledgeBase();

  // Load the page (with its KB text) once when the editor opens for a given page.
  // Keyed only on [open, pageId] on purpose: re-running on onClose/t identity
  // would refetch — resetting the editor and dropping in-progress edits — on
  // every host re-render (the inbox query has staleTime: 0). Both are only used
  // in the error path below, where a slightly stale reference is harmless.
  useEffect(() => {
    if (!open || !pageId) return;
    let cancelled = false;
    setLoading(true);
    setPage(null);
    pagesApi.getById(pageId)
      .then((res) => { if (!cancelled) setPage(res.data as PageDetail); })
      .catch((error) => {
        if (cancelled) return;
        captureError(error, 'Failed to load page for inline KB editor', {
          tags: { component: 'InlineKbEditorModal' },
          extra: { pageId },
        });
        toast.error(t('loadFailed'));
        onClose();
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  if (!open) return null;

  // Brief loading overlay while the page (and the lazy KB chunk) load, so the
  // CTA gives immediate feedback instead of appearing to do nothing.
  if (loading || !page) {
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div
        className="modal-overlay fixed top-0 start-0 end-0 bottom-0 bg-black/50 flex items-center justify-center z-50"
        aria-busy="true"
        role="status"
      >
        <Loader2 className="w-8 h-8 text-white animate-spin" aria-hidden="true" />
      </div>,
      document.body,
    );
  }

  return (
    <KnowledgeBaseModal
      page={page}
      onClose={onClose}
      saving={saving}
      saved={saved}
      onSave={(text) => saveKnowledgeBase(pageId, text)}
    />
  );
}

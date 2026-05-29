import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Plus } from 'lucide-react';
import { FlagTag } from './FlagTag';
import { isKbRelatedFlag, type FlagMetaShape } from '@/utils/flagReason';

interface NeedsAttentionBannerProps {
  flagReason: string | null | undefined;
  flagMeta?: FlagMetaShape | null;
  /**
   * Opens the Business Info / KB editor in place for this conversation's page.
   * When omitted, the KB CTA is hidden (e.g. when the host has no page context).
   */
  onAddToKb?: () => void;
}

/**
 * Shared "Needs attention" footer banner for comment and message detail modals.
 * Renders the flag reason (angry_customer, price_not_in_kb, low_confidence, etc.)
 * and, when the flag is KB-related, a CTA that opens the Business Info editor
 * in place over the conversation (the host owns the editor; see InlineKbEditorModal).
 */
export function NeedsAttentionBanner({ flagReason, flagMeta, onAddToKb }: NeedsAttentionBannerProps) {
  const t = useTranslations('comments');
  const isKbFlag = isKbRelatedFlag(flagReason);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg status-warning border text-xs font-medium">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t('needsAttention')}</span>
      <FlagTag flagReason={flagReason} flagMeta={flagMeta} />
      {isKbFlag && onAddToKb && (
        <button
          type="button"
          onClick={onAddToKb}
          className="inline-flex items-center gap-1 ms-auto px-2 py-0.5 rounded-full border text-[10px] font-semibold status-warning hover:opacity-80 transition-opacity"
        >
          <Plus className="w-2.5 h-2.5" aria-hidden="true" />
          <span>{t('addToBusinessInfo')}</span>
        </button>
      )}
    </div>
  );
}

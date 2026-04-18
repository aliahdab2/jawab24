import React from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { FlagTag } from './FlagTag';
import { isKbRelatedFlag } from '@/utils/flagReason';

interface NeedsAttentionBannerProps {
  flagReason: string | null | undefined;
  /** Fires when the user clicks the "Add to Business Info" link — typically closes the surrounding modal. */
  onKbLinkClick?: () => void;
}

/**
 * Shared "Needs attention" footer banner for comment and message detail modals.
 * Renders the flag reason (angry_customer, price_not_in_kb, low_confidence, etc.)
 * and a deep-link CTA when the flag is KB-related.
 */
export function NeedsAttentionBanner({ flagReason, onKbLinkClick }: NeedsAttentionBannerProps) {
  const t = useTranslations('comments');
  const locale = useLocale();
  const isKbFlag = isKbRelatedFlag(flagReason);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg status-warning border text-xs font-medium">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t('needsAttention')}</span>
      <FlagTag flagReason={flagReason} />
      {isKbFlag && (
        <Link
          href={`/${locale}/pages?openKb=true`}
          onClick={onKbLinkClick}
          className="inline-flex items-center gap-1 ms-auto px-2 py-0.5 rounded-full border text-[10px] font-semibold status-warning hover:opacity-80 transition-opacity"
        >
          <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
          <span>{t('addToBusinessInfo')}</span>
        </Link>
      )}
    </div>
  );
}

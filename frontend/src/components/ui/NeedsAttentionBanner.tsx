import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { FlagTag } from './FlagTag';
import { isKbRelatedFlag, type FlagMetaShape } from '@/utils/flagReason';
import { KB_DEEP_LINK } from '@/lib/routes';

interface NeedsAttentionBannerProps {
  flagReason: string | null | undefined;
  flagMeta?: FlagMetaShape | null;
}

/**
 * Shared "Needs attention" footer banner for comment and message detail modals.
 * Renders the flag reason (angry_customer, price_not_in_kb, low_confidence, etc.)
 * and a deep-link CTA when the flag is KB-related.
 */
export function NeedsAttentionBanner({ flagReason, flagMeta }: NeedsAttentionBannerProps) {
  const t = useTranslations('comments');
  const isKbFlag = isKbRelatedFlag(flagReason);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg status-warning border text-xs font-medium">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span>{t('needsAttention')}</span>
      <FlagTag flagReason={flagReason} flagMeta={flagMeta} />
      {isKbFlag && (
        <Link
          // No onClick to close the parent modal: the host page's close
          // handler (closeConversation in /messages, onClose in /comments)
          // fires router.back()/replace(), which races with Link's
          // router.push and silently swallows the navigation. The route
          // change to /pages unmounts the host page (and its modal) on
          // its own — no manual close needed.
          href={KB_DEEP_LINK}
          className="inline-flex items-center gap-1 ms-auto px-2 py-0.5 rounded-full border text-[10px] font-semibold status-warning hover:opacity-80 transition-opacity"
        >
          <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
          <span>{t('addToBusinessInfo')}</span>
        </Link>
      )}
    </div>
  );
}

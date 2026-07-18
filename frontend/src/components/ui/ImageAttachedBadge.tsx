import React from 'react';
import clsx from 'clsx';
import { Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Quiet informational badge shown on an OUTGOING reply that was delivered with an
 * image attached (Post Reply image card). Rendered from `flagMeta.reply_image` in
 * both the comment thread (CommentDetailModal) and the message thread
 * (MessageDetailModal) — single source so the two surfaces can't drift. Deliberately
 * NOT an alarm: it never implies needs-attention (mirrors the reply_shortened badge).
 */
export const ImageAttachedBadge = React.memo(function ImageAttachedBadge({ className }: { className?: string }) {
  const t = useTranslations('messages');
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border status-info text-[10px] normal-case tracking-normal font-medium',
        className,
      )}
    >
      <ImageIcon className="w-3 h-3" aria-hidden="true" />
      {t('imageAttached')}
    </span>
  );
});

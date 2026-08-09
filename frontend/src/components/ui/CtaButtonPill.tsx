import React from 'react';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';

/**
 * Messenger-style rendering of the Post Reply CTA link button that was delivered
 * with an outgoing reply. Rendered from `flagMeta.reply_cta` inside the outgoing
 * bubble in both the comment thread (CommentDetailModal) and the message thread
 * (MessageDetailModal) — single source so the two surfaces can't drift (mirrors
 * ImageAttachedBadge). The label is the merchant's own button text; tapping opens
 * the real destination so the merchant can verify what the customer received.
 * Styled for the brand-600 outgoing bubble (white-on-brand), theme-independent.
 */
export const CtaButtonPill = React.memo(function CtaButtonPill({ label, url, className }: {
  label: string;
  url: string;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      dir="auto"
      title={url}
      className={clsx(
        'mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-xl',
        'bg-white/15 hover:bg-white/25 transition-colors',
        'text-sm font-semibold text-white text-center',
        className,
      )}
    >
      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </a>
  );
});

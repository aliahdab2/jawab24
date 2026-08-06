import React from 'react';
import { useTranslations } from 'next-intl';

interface ViewOnlyBannerProps {
  /** Extra spacing/layout classes for the host's slot (defaults to `mb-3`). */
  className?: string;
}

/**
 * "Only admins can make changes" — the one banner every read-only surface uses.
 *
 * Settings, Business Info, and the /business sections all answer the same
 * question ("why can't I change this?"), so they must answer it in the same
 * words and the same box. It was copy-pasted into the second surface and would
 * have been copy-pasted into the next four; one component means a reword lands
 * everywhere at once.
 */
export function ViewOnlyBanner({ className = 'mb-3' }: ViewOnlyBannerProps) {
  const tc = useTranslations('common');

  return (
    <div className={`p-3 rounded-xl alert-info border text-sm text-center ${className}`}>
      {tc('viewOnlyHint')}
    </div>
  );
}

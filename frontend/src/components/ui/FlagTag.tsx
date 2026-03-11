/**
 * FlagTag — displays a translated flag reason badge on message/comment cards.
 *
 * Isolated component: all flag display logic lives here.
 * Cards just pass `flagReason` and get a styled tag back.
 */
import React from 'react';
import clsx from 'clsx';
import { Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getPrimaryFlag, getFlagTagStyle } from '@/utils/flagReason';

interface FlagTagProps {
  flagReason: string | null | undefined;
  className?: string;
}

export const FlagTag = React.memo(function FlagTag({ flagReason, className }: FlagTagProps) {
  const tf = useTranslations('flagReason');
  const primaryFlag = getPrimaryFlag(flagReason);

  if (!primaryFlag) return null;

  const { cssClass, urgent } = getFlagTagStyle(primaryFlag);

  // Translate the flag key; fall back to raw key if no translation
  const translated = tf(primaryFlag);
  const label = translated === primaryFlag ? primaryFlag.replace(/_/g, ' ') : translated;

  return (
    <div
      className={clsx(
        'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold',
        cssClass,
        urgent && 'animate-pulse-soft',
        className,
      )}
    >
      <Tag className="w-2.5 h-2.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
});

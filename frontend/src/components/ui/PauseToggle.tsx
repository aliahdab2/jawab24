import React from 'react';
import clsx from 'clsx';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface PauseToggleProps {
  paused: boolean;
  remainingMinutes?: number | null;
  loading: boolean;
  onToggle: () => void;
}

/**
 * Pause/Resume Smart Reply toggle with scope hint and remaining time.
 * Used in both Comment and Message detail modals.
 */
export const PauseToggle: React.FC<PauseToggleProps> = ({
  paused,
  remainingMinutes,
  loading,
  onToggle,
}) => {
  const t = useTranslations('messages');

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          disabled={loading}
          aria-label={paused ? t('resumeSmartReply') : t('pauseSmartReply')}
          className={clsx(
            'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50',
            paused
              ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30'
              : 'text-muted-foreground hover:bg-muted dark:hover:bg-white/5'
          )}
        >
          {paused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
          <span>{paused ? t('resumeSmartReply') : t('pauseSmartReply')}</span>
        </button>
        {paused && remainingMinutes != null && (
          <span className="text-[10px] font-medium text-violet-500">
            {t('smartReplyPausedRemaining', { minutes: remainingMinutes })}
          </span>
        )}
      </div>
      <span className="text-[10px] text-subtle ps-2">{t('pauseScope')}</span>
    </div>
  );
};

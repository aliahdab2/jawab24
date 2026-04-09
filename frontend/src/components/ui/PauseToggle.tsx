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
export function PauseToggle({
  paused,
  remainingMinutes,
  loading,
  onToggle,
}: PauseToggleProps) {
  const t = useTranslations('messages');

  return (
    <div className="flex items-center gap-2 flex-wrap">
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
        {paused ? <PlayCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <PauseCircle className="w-3.5 h-3.5 flex-shrink-0" />}
        <span>{paused ? t('resumeSmartReply') : t('pauseSmartReply')}</span>
        <span className="text-[10px] font-normal text-muted-foreground">{t('pauseScope')}</span>
      </button>
      {paused && remainingMinutes != null && (
        <span className="text-[10px] font-medium text-violet-500">
          {t('smartReplyPausedRemaining', { minutes: remainingMinutes })}
        </span>
      )}
    </div>
  );
}

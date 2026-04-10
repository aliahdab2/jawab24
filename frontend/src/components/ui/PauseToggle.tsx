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
    <div className="flex flex-col items-start gap-0.5">
      <button
        onClick={onToggle}
        disabled={loading}
        aria-label={paused ? t('resumeSmartReply') : t('pauseSmartReply')}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50',
          paused
            ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30'
            : 'text-muted-foreground hover:bg-muted dark:hover:bg-white/5'
        )}
      >
        {paused
          ? <PlayCircle className="w-4 h-4 flex-shrink-0" />
          : <PauseCircle className="w-4 h-4 flex-shrink-0" />
        }
        <span>{paused ? t('resumeSmartReply') : t('pauseSmartReply')}</span>
      </button>
      {/* Scope label — below the button, not crammed inside it */}
      <span className="text-[10px] ps-3 text-muted-foreground leading-none">
        {paused && remainingMinutes != null
          ? t('smartReplyPausedRemaining', { minutes: remainingMinutes })
          : t('pauseScope')
        }
      </span>
    </div>
  );
}

import clsx from 'clsx';
import { PauseCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface PauseBannerProps {
  paused: boolean;
  remainingMinutes?: number | null;
  totalMinutes?: number | null;
  onResumeNow: () => void;
  isResuming: boolean;
}

/** Map a pause duration in minutes to the localized label used on the Settings page. */
function useDurationLabel(totalMinutes: number | null | undefined): string | null {
  const tSettings = useTranslations('settings');
  if (!totalMinutes) return null;
  if (totalMinutes === 15) return tSettings('duration15min');
  if (totalMinutes === 30) return tSettings('duration30min');
  if (totalMinutes === 60) return tSettings('duration1hr');
  if (totalMinutes === 120) return tSettings('duration2hr');
  if (totalMinutes === 1440) return tSettings('duration24hr');
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours >= 24 && mins === 0) return `${Math.floor(hours / 24)}d`;
  if (hours > 0 && mins === 0) return `${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Visible banner shown in conversation detail views when Smart Reply is paused
 * for the current customer. Surfaces the pause state + countdown + one-tap resume.
 */
export function PauseBanner({
  paused,
  remainingMinutes,
  totalMinutes,
  onResumeNow,
  isResuming,
}: PauseBannerProps) {
  const t = useTranslations('messages');
  const durationLabel = useDurationLabel(totalMinutes);

  if (!paused) return null;

  const bodyText = durationLabel
    ? t('pauseBannerBodyWithDuration', { duration: durationLabel })
    : t('pauseBannerBody');

  return (
    <div
      role="status"
      className={clsx(
        'flex items-center gap-3 px-4 py-2.5 sm:px-6',
        'bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/50'
      )}
    >
      <PauseCircle
        className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm font-semibold text-amber-900 dark:text-amber-200 leading-snug">
          {bodyText}
        </p>
        {remainingMinutes != null && (
          <p className="text-[11px] text-amber-700/80 dark:text-amber-300/70 leading-snug">
            {t('smartReplyPausedRemaining', { minutes: remainingMinutes })}
          </p>
        )}
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onResumeNow}
        disabled={isResuming}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
      >
        {isResuming && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
        {t('pauseBannerResumeNow')}
      </button>
    </div>
  );
}

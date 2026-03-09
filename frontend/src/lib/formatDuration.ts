/**
 * Format a duration in seconds to a human-readable short string.
 *
 * Pass `useTranslations('time')` as `t` — uses keys: dShort, hShort, mShort, sShort
 *
 * Examples (EN): "5s", "2m 30s", "1h 15m", "2d 3h"
 * Examples (AR): "5ث", "2د 30ث", "1س 15د", "2ي 3س"
 */
export function formatDuration(
  totalSeconds: number,
  t: (key: string) => string,
): string {
  if (totalSeconds < 0 || !Number.isFinite(totalSeconds)) return '—';

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);

  if (days > 0) return `${days}${t('dShort')} ${hours}${t('hShort')}`;
  if (hours > 0) return `${hours}${t('hShort')} ${minutes}${t('mShort')}`;
  if (minutes > 0) return `${minutes}${t('mShort')} ${seconds}${t('sShort')}`;
  return `${seconds}${t('sShort')}`;
}

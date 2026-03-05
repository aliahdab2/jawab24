import clsx from 'clsx';
import { Sparkles, CheckCircle, Gauge, Timer } from 'lucide-react';
import { Card } from '@/components/ui';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDuration } from '@/lib/formatDuration';

interface CommandCenterProps {
  smartReplies: number;
  repliedToday: number;
  replyRate: string;
  avgSpeedSeconds: number | null;
  hasError?: boolean;
  onRetry?: () => void;
}

interface MetricCell {
  labelKey: TranslationKey;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  borderColor: string;
  iconBg: string;
  iconColor: string;
}

export function CommandCenter({
  smartReplies,
  repliedToday,
  replyRate,
  avgSpeedSeconds,
  hasError,
  onRetry,
}: CommandCenterProps) {
  const { t } = useTranslation();

  const speedDisplay = avgSpeedSeconds != null
    ? formatDuration(avgSpeedSeconds, t)
    : '—';

  const metrics: MetricCell[] = [
    {
      labelKey: 'dashboard.aiReplies' as TranslationKey,
      value: smartReplies.toLocaleString(),
      icon: Sparkles,
      borderColor: 'border-s-brand-500',
      iconBg: 'icon-bg-brand-light',
      iconColor: '',
    },
    {
      labelKey: 'dashboard.commandCenter.repliedToday' as TranslationKey,
      value: repliedToday.toLocaleString(),
      icon: CheckCircle,
      borderColor: 'border-s-emerald-500',
      iconBg: 'icon-bg-emerald-light',
      iconColor: '',
    },
    {
      labelKey: 'dashboard.commandCenter.replyRate' as TranslationKey,
      value: `${replyRate}%`,
      icon: Gauge,
      borderColor: 'border-s-amber-500',
      iconBg: 'icon-bg-amber-light',
      iconColor: '',
    },
    {
      labelKey: 'dashboard.commandCenter.avgSpeed' as TranslationKey,
      value: speedDisplay,
      icon: Timer,
      borderColor: 'border-s-violet-500',
      iconBg: 'icon-bg-violet-light',
      iconColor: '',
    },
  ];

  if (hasError) {
    return (
      <Card className="mb-8 border-none shadow-sm bg-card" padding="none">
        <div className="flex items-center justify-center gap-2 py-6 text-surface-500">
          <span className="text-sm">{t('dashboard.sectionLoadError')}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-semibold text-brand-600 hover:text-brand-700 underline"
            >
              {t('errors.tryAgain')}
            </button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="mb-8 border-none shadow-2xl shadow-surface-200/50 bg-card overflow-hidden animate-slide-up"
      padding="none"
      role="region"
      aria-label={t('dashboard.overview')}
    >
      {/* Period Label */}
      <div className="px-4 py-2.5 sm:px-5 border-b border-theme-border">
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-surface-400">
          {t('dashboard.last30Days' as TranslationKey)}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4">
        {metrics.map((metric, i) => {
          const Icon = metric.icon;
          return (
            <div
              key={i}
              className={clsx(
                'border-s-4 px-4 py-4 sm:px-5 sm:py-5 transition-colors',
                metric.borderColor,
                // Dividers: bottom border on mobile top row, right border on desktop
                i < 2 && 'border-b border-b-theme-border md:border-b-0',
                i < 3 && 'md:border-e md:border-e-theme-border',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-2xl sm:text-3xl font-bold leading-none tracking-tight text-foreground">
                    {metric.value}
                  </p>
                  <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1.5">
                    {t(metric.labelKey)}
                  </p>
                </div>
                <div className={clsx(
                  'w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex-shrink-0 flex items-center justify-center',
                  metric.iconBg
                )}>
                  <Icon className={clsx('w-4 h-4 sm:w-5 sm:h-5', metric.iconColor)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </Card>
  );
}

import clsx from 'clsx';
import { Sparkles, CheckCircle, Gauge, Timer, Info } from 'lucide-react';
import { Card } from '@/components/ui';
import { Badge } from '@/components/ui/Badge';
import { useTranslations } from 'next-intl';
import { formatDuration } from '@/lib/formatDuration';

interface CommandCenterProps {
  smartReplies: number;
  repliedToday: number;
  replyRate: string;
  avgSpeedSeconds: number | null;
  hasError?: boolean;
  onRetry?: () => void;
  quota?: {
    percentUsed: number;
    limit: number | null;
  };
}

interface MetricCell {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  borderColor: string;
  iconBg: string;
  iconColor: string;
  badge?: React.ReactNode;
  /** Optional explanatory text shown via an info-icon hover/focus tooltip
   *  next to the label. Used to disambiguate this metric from the plan-usage
   *  banner so users (and their customers) can tell which one is which. */
  tooltip?: string;
}

export function CommandCenter({
  smartReplies,
  repliedToday,
  replyRate,
  avgSpeedSeconds,
  hasError,
  onRetry,
  quota,
}: CommandCenterProps) {
  const tDash = useTranslations('dashboard');
  const tErrors = useTranslations('errors');
  const tTime = useTranslations('time');

  const speedDisplay = avgSpeedSeconds != null
    ? formatDuration(avgSpeedSeconds, tTime)
    : '—';

  // Determine quota severity for the Smart Replies metric
  const quotaPercent = quota?.limit ? quota.percentUsed : 0;
  const isOverLimit = quotaPercent >= 100;
  const isWarning = quotaPercent > 75 && !isOverLimit;

  // Build quota badge for Smart Replies cell
  let quotaBadge: React.ReactNode = null;
  if (quota?.limit && quotaPercent > 75) {
    quotaBadge = (
      <Badge
        variant={isOverLimit ? 'error' : 'warning'}
        size="sm"
        className="mt-1"
      >
        {isOverLimit
          ? tDash('commandCenter.quotaExceeded')
          : tDash('commandCenter.quotaWarning', { percent: Math.round(quotaPercent) })}
      </Badge>
    );
  }

  const metrics: MetricCell[] = [
    {
      label: tDash('aiReplies'),
      value: smartReplies.toLocaleString(),
      icon: Sparkles,
      borderColor: isOverLimit ? 'border-s-red-500' : isWarning ? 'border-s-amber-500' : 'border-s-brand-500',
      iconBg: isOverLimit ? 'icon-bg-red-light' : isWarning ? 'icon-bg-amber-light' : 'icon-bg-brand-light',
      iconColor: '',
      badge: quotaBadge,
      tooltip: tDash('commandCenter.smartRepliesTooltip'),
    },
    {
      label: tDash('commandCenter.repliedToday'),
      value: repliedToday.toLocaleString(),
      icon: CheckCircle,
      borderColor: 'border-s-emerald-500',
      iconBg: 'icon-bg-emerald-light',
      iconColor: '',
    },
    {
      label: tDash('commandCenter.replyRate'),
      value: `${replyRate}%`,
      icon: Gauge,
      borderColor: 'border-s-amber-500',
      iconBg: 'icon-bg-amber-light',
      iconColor: '',
    },
    {
      label: tDash('commandCenter.avgSpeed'),
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
          <span className="text-sm">{tDash('sectionLoadError')}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm font-semibold text-brand-600 hover:text-brand-700 underline"
            >
              {tErrors('tryAgain')}
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
      aria-label={tDash('overview')}
    >
      {/* Period Label */}
      <div className="px-4 py-2.5 sm:px-5 border-b border-theme-border">
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-700">
          {tDash('last30Days')}
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
                  <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground dark:text-surface-700 mt-1.5 inline-flex items-center gap-1">
                      {metric.label}
                      {metric.tooltip && (
                        <span className="relative group inline-flex">
                          <Info className="w-3 h-3 text-icon-muted cursor-help" aria-label={metric.tooltip} />
                          <span className="absolute bottom-full start-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal text-white bg-surface-800 dark:bg-surface-200 dark:text-surface-900 rounded-md shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none w-48 text-center z-10 leading-snug">
                            {metric.tooltip}
                          </span>
                        </span>
                      )}
                  </p>
                  {metric.badge}
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

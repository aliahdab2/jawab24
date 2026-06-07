import clsx from 'clsx';
import { Sparkles, CheckCircle, Gauge, Timer } from 'lucide-react';
import { Card, InfoPopover, Sparkline } from '@/components/ui';
import { Badge } from '@/components/ui/Badge';
import { useTranslations, useLocale } from 'next-intl';
import { formatDuration } from '@/lib/formatDuration';
import { formatQuotaResetDate } from '@/lib/formatDate';

interface CommandCenterProps {
  smartReplies: number;
  repliedToday: number;
  commentsRepliedToday?: number;
  messagesRepliedToday?: number;
  replyRate: string;
  avgSpeedSeconds: number | null;
  hasError?: boolean;
  onRetry?: () => void;
  quota?: {
    used: number;
    percentUsed: number;
    limit: number | null;
    /** Non-expiring top-up balance. When the plan quota is maxed but this is
     *  > 0, Smart Replies keep sending from it — so the badge reads "on top-up"
     *  rather than the alarming red "over limit". */
    topupBalance?: number;
  };
  /** ISO string — end of current billing period; shown as "resets {date}" under the
   *  primary tile so merchants understand the quota is per-period, not all-time. */
  quotaResetsAt?: string;
  /** Daily Smart-Reply volume (oldest → newest) for the inline sparkline on the
   *  primary tile. Omitted/short series simply renders no trend line. */
  smartRepliesTrend?: number[];
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
  /** Small text under the label — used for "Resets {date}" on the plan-usage
   *  tile, or "Last 30 days" when no quota exists. */
  subtext?: string;
  /** When set (0-100), renders a slim progress bar under the value. Used on the
   *  plan-usage tile so merchants can glance at "how full am I." */
  progressPercent?: number;
  /** Tailwind class for the progress-bar fill — pre-resolved by the caller so
   *  the severity thresholds (red/amber/brand) live in one place. */
  progressBarClass?: string;
  /** Optional inline trend line drawn next to the value (primary tile only). */
  sparkline?: number[];
  /** Tailwind text-* colour for the sparkline stroke. */
  sparklineClass?: string;
}

export function CommandCenter({
  smartReplies,
  repliedToday,
  commentsRepliedToday,
  messagesRepliedToday,
  replyRate,
  avgSpeedSeconds,
  hasError,
  onRetry,
  quota,
  quotaResetsAt,
  smartRepliesTrend,
}: CommandCenterProps) {
  const tDash = useTranslations('dashboard');
  const tErrors = useTranslations('errors');
  const tTime = useTranslations('time');
  const locale = useLocale();

  const speedDisplay = avgSpeedSeconds != null
    ? formatDuration(avgSpeedSeconds, tTime)
    : '—';

  // Reply rate is already a 0–100 percentage, so it gets a literal progress bar.
  const replyRatePercent = Math.max(0, Math.min(100, parseFloat(replyRate) || 0));

  // Determine quota severity for the Smart Replies metric
  const quotaPercent = quota?.limit ? quota.percentUsed : 0;
  const isOverLimit = quotaPercent >= 100;
  // Past the plan wall but covered by top-up balance — Smart Replies still send,
  // so treat it as a calm "on top-up" state, not a red "over limit" error.
  const onTopup = isOverLimit && (quota?.topupBalance ?? 0) > 0;
  const showOverLimit = isOverLimit && !onTopup;
  const isWarning = quotaPercent > 75 && !isOverLimit;

  // Primary tile shows plan usage when the merchant has a quota — that's the
  // actionable number (am I about to hit my limit?). When the plan is unlimited
  // we fall back to last-30-days activity since there's no quota to show.
  const hasQuota = quota?.limit != null && quota.limit > 0;
  const quotaUsed = quota?.used ?? 0;
  const resetDate = formatQuotaResetDate(quotaResetsAt, locale);

  // The "used" count is the actionable number — show it as the headline. The
  // limit is context, so it lives in the subtext as "of {limit}". This avoids
  // the layout problem from "used / limit" on one line where Arabic's "ألف" is
  // much wider than "K" and overflows the card on mobile.
  const primaryValue = hasQuota
    ? quotaUsed.toLocaleString(locale)
    : smartReplies.toLocaleString(locale);

  const primaryLabel = tDash('aiReplies');
  const planUsageDetail = hasQuota && quota?.limit != null
    ? `${quotaUsed.toLocaleString(locale)} / ${quota.limit.toLocaleString(locale)}`
    : null;
  const primaryTooltip = hasQuota && resetDate && planUsageDetail
    ? `${planUsageDetail} · ${tDash('commandCenter.resetsOn', { date: resetDate })}`
    : hasQuota
      ? planUsageDetail ?? tDash('commandCenter.planUsageTooltip')
      : tDash('commandCenter.smartRepliesTooltip');
  const primarySubtext = hasQuota && quota?.limit != null
    ? tDash('commandCenter.planUsageOf', { limit: quota.limit.toLocaleString(locale) })
    : !hasQuota
      ? tDash('last30Days')
      : null;

  // Quota badge: only when approaching / over limit. On-top-up takes precedence
  // over over-limit (replies are still flowing), which takes precedence over warning.
  let quotaBadge: React.ReactNode = null;
  if (hasQuota && quotaPercent > 75) {
    quotaBadge = (
      <Badge
        variant={onTopup ? 'info' : showOverLimit ? 'error' : 'warning'}
        size="sm"
        className="mt-1"
      >
        {onTopup
          ? tDash('commandCenter.onTopup')
          : showOverLimit
            ? tDash('commandCenter.quotaExceeded')
            : tDash('commandCenter.quotaWarning', { percent: Math.round(quotaPercent) })}
      </Badge>
    );
  }

  const metrics: MetricCell[] = [
    {
      label: primaryLabel,
      value: primaryValue,
      icon: Sparkles,
      borderColor: showOverLimit ? 'border-s-red-500' : isWarning ? 'border-s-amber-500' : 'border-s-brand-500',
      iconBg: showOverLimit ? 'icon-bg-red-light' : isWarning ? 'icon-bg-amber-light' : 'icon-bg-brand-light',
      iconColor: '',
      badge: quotaBadge,
      tooltip: primaryTooltip,
      subtext: primarySubtext ?? undefined,
      progressPercent: hasQuota ? Math.min(100, quotaPercent) : undefined,
      progressBarClass: showOverLimit ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-brand-500',
      sparkline: smartRepliesTrend,
      sparklineClass: showOverLimit ? 'text-red-500/60' : isWarning ? 'text-amber-500/60' : 'text-brand-500/60',
    },
    {
      label: tDash('commandCenter.repliedToday'),
      value: repliedToday.toLocaleString(),
      icon: CheckCircle,
      borderColor: 'border-s-emerald-500',
      iconBg: 'icon-bg-emerald-light',
      iconColor: '',
      tooltip: (commentsRepliedToday !== undefined && messagesRepliedToday !== undefined)
        ? tDash('commandCenter.repliedTodayTooltip', {
            comments: commentsRepliedToday,
            messages: messagesRepliedToday,
          })
        : undefined,
    },
    {
      label: tDash('commandCenter.replyRate'),
      value: `${replyRate}%`,
      icon: Gauge,
      borderColor: 'border-s-amber-500',
      iconBg: 'icon-bg-amber-light',
      iconColor: '',
      tooltip: tDash('commandCenter.replyRateTooltip'),
      progressPercent: replyRatePercent,
      progressBarClass: 'bg-amber-500',
    },
    {
      label: tDash('commandCenter.avgSpeed'),
      value: speedDisplay,
      icon: Timer,
      borderColor: 'border-s-violet-500',
      iconBg: 'icon-bg-violet-light',
      iconColor: '',
      tooltip: tDash('commandCenter.avgSpeedTooltip'),
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
      {/* Metrics Grid — tiles span different time windows (plan period vs
          today vs last 30 days) so no global period banner; each tile
          carries its own time anchor via subtext or tooltip. */}
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
              <div className="flex items-start justify-between gap-2 flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-end gap-2">
                    <p className="text-lg sm:text-2xl md:text-3xl font-bold leading-none tracking-tight text-foreground tabular-nums whitespace-nowrap">
                      {metric.value}
                    </p>
                    {metric.sparkline && (
                      <Sparkline
                        data={metric.sparkline}
                        className={clsx('mb-0.5 shrink-0', metric.sparklineClass)}
                      />
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground dark:text-surface-700 mt-1.5 inline-flex items-center gap-1">
                      {metric.label}
                      {metric.tooltip && (
                        <InfoPopover label={metric.label} panelWidth="sm">
                          <span className="block normal-case tracking-normal font-normal leading-snug">
                            {metric.tooltip}
                          </span>
                        </InfoPopover>
                      )}
                  </p>
                  {metric.subtext && (
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1 normal-case tracking-normal font-normal">
                      {metric.subtext}
                    </p>
                  )}
                  {metric.badge}
                </div>
                <div className={clsx(
                  'w-7 h-7 sm:w-10 sm:h-10 rounded-xl flex-shrink-0 flex items-center justify-center',
                  metric.iconBg
                )}>
                  <Icon className={clsx('w-3.5 h-3.5 sm:w-5 sm:h-5', metric.iconColor)} />
                </div>
              </div>
              {metric.progressPercent !== undefined && (
                <div
                  className="mt-3 h-1 rounded-full bg-surface-100 dark:bg-surface-800 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(metric.progressPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={metric.label}
                >
                  <div
                    className={clsx('h-full transition-[width] duration-500', metric.progressBarClass)}
                    style={{ width: `${Math.max(2, metric.progressPercent)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

    </Card>
  );
}

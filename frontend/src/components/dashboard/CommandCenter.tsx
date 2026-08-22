import clsx from 'clsx';
import { Sparkles, CheckCircle, Gauge, Timer } from 'lucide-react';
import { Card, InfoPopover, Sparkline } from '@/components/ui';
import { Badge } from '@/components/ui/Badge';
import { useTranslations, useLocale } from 'next-intl';
import { formatDuration } from '@/lib/formatDuration';
import { formatQuotaResetDate } from '@/lib/formatDate';
import { resolveAiQuotaStatus } from '@jawab24/shared';

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
    /** Non-expiring top-up balance. When > 0 it's surfaced on the tile so
     *  merchants can see their reserve at any usage level — as a pill beside
     *  the usage under the plan limit, or folded into the quota badge
     *  ("{n} top-up left") once the plan is maxed and replies run from it. */
    topupBalance?: number;
  };
  /** ISO string — end of current billing period; shown as "resets {date}" under the
   *  primary tile so merchants understand the quota is per-period, not all-time. */
  quotaResetsAt?: string;
  /** Daily Smart-Reply volume (oldest → newest) for the inline sparkline on the
   *  primary tile. Omitted/short series simply renders no trend line. */
  smartRepliesTrend?: number[];
  /** Today's replies split by method (summed comments + messages). Feeds the
   *  breakdown line on the "Replied Today" tile — rule-based Post Replies are
   *  excluded from the AI-only primary tile, so without this line that automation
   *  works invisibly. The line renders only when post replies fired today;
   *  smart-only merchants keep the plain tile. Omit while either stats endpoint
   *  is loading/failed so a partial sum never renders. */
  repliedTodayByMethod?: { smart: number; postReply: number };
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
  /** Optional small pill rendered inline beside the subtext (e.g. top-up reserve). */
  subtextBadge?: React.ReactNode;
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
  repliedTodayByMethod,
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
  // so treat it as a calm "on top-up" state, not a red "over limit" error. The
  // balance has to be a real runway, though: `nearWall` (shared plan+top-up
  // policy) keeps a nearly-drained balance red instead of calling it covered.
  const quotaStatus = resolveAiQuotaStatus({
    used: quota?.used ?? 0,
    limit: quota?.limit ?? null,
    topupBalance: quota?.topupBalance ?? 0,
  });
  const onTopup = quotaStatus.state === 'on_topup' && !quotaStatus.nearWall;
  const showOverLimit = isOverLimit && !onTopup;
  const isWarning = quotaPercent > 75 && !isOverLimit;

  // Primary tile shows plan usage when the merchant has a quota — that's the
  // actionable number (am I about to hit my limit?). When the plan is unlimited
  // we fall back to last-30-days activity since there's no quota to show.
  const hasQuota = quota?.limit != null && quota.limit > 0;
  const quotaUsed = quota?.used ?? 0;
  // withTime, always. The period boundary is an exact instant — for manual plans
  // it is UTC midnight — and a bare calendar date reads as "all of that day",
  // putting the merchant's understanding of their cut-off a full day late. Adding
  // the time is also timezone-honest: rendered in the viewer's own zone, a
  // 00:00 UTC boundary correctly shows as 03:00 for a merchant in UTC+3.
  const resetDate = formatQuotaResetDate(quotaResetsAt, locale, { withTime: true });

  // Top-up is a separate, non-expiring bucket consumed only after the monthly
  // plan quota runs out. It was previously invisible until the merchant blew
  // past the plan limit, so a banked balance looked lost. Surface it whenever
  // there's a balance: a pill beside the subtext under the limit, or the quota
  // badge ("{n} top-up left") once on top-up.
  const topupBalance = quota?.topupBalance ?? 0;
  const hasTopup = topupBalance > 0;
  const topupFormatted = topupBalance.toLocaleString(locale);

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
  // Build the plan-usage tooltip from parts — one fact per line (no separator
  // dots, which read as a confusing run-on). The reset date appears only when
  // present. The top-up reserve is intentionally NOT repeated here — the
  // always-visible pill (under limit) / badge (on top-up) already shows it.
  let primaryTooltip: string;
  if (hasQuota) {
    const parts = [planUsageDetail];
    if (resetDate) parts.push(tDash('commandCenter.resetsOn', { date: resetDate }));
    primaryTooltip = parts.filter(Boolean).join('\n') || tDash('commandCenter.planUsageTooltip');
  } else {
    primaryTooltip = tDash('commandCenter.smartRepliesTooltip');
  }
  // Subtext shows the plan context ("of 4,500"); the banked top-up reserve rides
  // alongside it as a small pill (primaryTopupBadge), not a second line.
  const primarySubtext = hasQuota && quota?.limit != null
    ? tDash('commandCenter.planUsageOf', { limit: quota.limit.toLocaleString(locale) })
    : !hasQuota
      ? tDash('last30Days')
      : null;
  // The pill previews the banked reserve *before* the plan wall. Once over the
  // limit the quota badge already reads "On top-up", so showing the pill too
  // would duplicate the same fact on one tile — hide it in that state.
  const primaryTopupBadge = hasQuota && hasTopup && !isOverLimit ? (
    <Badge variant="brand" size="xs" className="uppercase">
      {tDash('commandCenter.topupAvailable', { balance: topupFormatted })}
    </Badge>
  ) : null;

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
          ? tDash('commandCenter.onTopupLeft', { balance: topupFormatted })
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
      subtextBadge: primaryTopupBadge ?? undefined,
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
      // Two parallel breakdowns of the same total, one per line and identically
      // structured ("<view> — <label>: <n> + <label>: <n>") so the numbers always
      // sit after the label in both: line 1 splits by channel (comments vs DMs),
      // line 2 by type (Smart vs Post Reply). The type line appears only when Post
      // Reply fired today — but both its numbers always show, so a merchant reading
      // "Smart: 0 + Post Reply: 12" gets the full story (Post Reply intercepts
      // before the AI, so a 0 there is often healthy, not a fault).
      tooltip: (commentsRepliedToday !== undefined && messagesRepliedToday !== undefined)
        ? (repliedTodayByMethod && repliedTodayByMethod.postReply > 0
            ? tDash('commandCenter.repliedTodayTooltip', {
                comments: commentsRepliedToday,
                messages: messagesRepliedToday,
              }) + '\n' + tDash('commandCenter.repliedTodayBreakdownLine', {
                smart: repliedTodayByMethod.smart,
                post: repliedTodayByMethod.postReply,
              })
            : tDash('commandCenter.repliedTodayTooltip', {
                comments: commentsRepliedToday,
                messages: messagesRepliedToday,
              }))
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
                          <span className="block normal-case tracking-normal font-normal leading-snug whitespace-pre-line">
                            {metric.tooltip}
                          </span>
                        </InfoPopover>
                      )}
                  </p>
                  {(metric.subtext || metric.subtextBadge) && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {metric.subtext && (
                        <span className="text-[10px] sm:text-[11px] text-muted-foreground normal-case tracking-normal font-normal">
                          {metric.subtext}
                        </span>
                      )}
                      {metric.subtextBadge}
                    </div>
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
                  className="mt-3 h-1 rounded-full bg-surface-100 dark:bg-surface-300 overflow-hidden"
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

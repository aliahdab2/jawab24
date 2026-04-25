import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, ConfirmationModal, Modal } from '@/components/ui';
import { analyticsApi, adminApi } from '@/lib/api';
import type { AiUsageReport, AnalyticsOverview, SystemHealthReport, CacheStats } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import clsx from 'clsx';
import {
  DollarSign,
  Zap,
  Database,
  Clock,
  BarChart3,
  Activity,
  Server,
  Cpu,
  RefreshCw,
  Globe,
  Trash2,
  Mail,
  Play,
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub }: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="icon-bg-brand p-2 rounded-lg">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function BreakdownTable({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      <div className="space-y-1.5">
        {entries.map(([key, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-24 truncate">{key || '—'}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <span className="text-xs font-medium text-foreground w-10 text-end">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function translateDigestStatus(status: string, t: ReturnType<typeof useTranslations<'admin'>>): string {
  switch (status) {
    case 'sent': return t('observability.leadDigestStatusSent');
    case 'failed': return t('observability.leadDigestStatusFailed');
    case 'skipped_no_email': return t('observability.leadDigestStatusSkippedNoEmail');
    case 'skipped_no_subscription': return t('observability.leadDigestStatusSkippedNoSubscription');
    case 'skipped_abandoned': return t('observability.leadDigestStatusSkippedAbandoned');
    default: return status;
  }
}

function ServiceBadge({ status }: { status: string }) {
  const isUp = status === 'up' || status === 'closed';
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      isUp ? 'status-success' : 'status-warning',
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', isUp ? 'bg-green-500' : 'bg-amber-500')} />
      {status}
    </span>
  );
}

export default function AdminObservabilityPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [previewEmailId, setPreviewEmailId] = useState<string | null>(null);

  const { data: health, isLoading: healthLoading, isFetching: healthFetching } = useQuery<SystemHealthReport>({
    queryKey: ['admin', 'system-health'],
    queryFn: async () => {
      const res = await analyticsApi.getSystemHealth();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load system health', { tags: { page: 'observability' } }) },
  });

  const { data: aiUsage, isLoading: aiLoading } = useQuery<AiUsageReport>({
    queryKey: ['admin', 'ai-usage', days],
    queryFn: async () => {
      const res = await analyticsApi.getAiUsage(days);
      return res.data;
    },
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load AI usage', { tags: { page: 'observability' } }) },
  });

  const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
    queryKey: ['admin', 'overview', days],
    queryFn: async () => {
      const res = await analyticsApi.getOverview(days);
      return res.data;
    },
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load overview', { tags: { page: 'observability' } }) },
  });

  const isLoading = aiLoading || overviewLoading;

  const { data: cacheStats, refetch: refetchCache } = useQuery<CacheStats>({
    queryKey: ['admin', 'cache-stats'],
    queryFn: async () => {
      const res = await analyticsApi.getCacheStats();
      return res.data;
    },
    staleTime: 30_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load cache stats', { tags: { page: 'observability' } }) },
  });

  const { data: leadDigest, refetch: refetchLeadDigest, isLoading: leadDigestLoading } = useQuery({
    queryKey: ['admin', 'lead-digest', 'history'],
    queryFn: () => adminApi.getLeadDigestHistory({ limit: 50 }),
    staleTime: 30_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load lead digest history', { tags: { page: 'observability' } }) },
  });

  const { data: emailPreview, isLoading: emailPreviewLoading } = useQuery({
    queryKey: ['admin', 'email', previewEmailId],
    queryFn: () => adminApi.getEmailById(previewEmailId as string),
    enabled: !!previewEmailId,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load email body', { tags: { page: 'observability' } }) },
  });

  const { mutate: runLeadDigest, isPending: runningLeadDigest } = useMutation({
    mutationFn: () => adminApi.runLeadDigest(),
    onSuccess: (result) => {
      refetchLeadDigest();
      toast.success(t('observability.leadDigestRunDone', { sent: result.sent, skipped: result.skipped, errors: result.errors }));
    },
    onError: (err) => {
      captureError(err, 'Failed to run lead digest', { tags: { page: 'observability' } });
      toast.error(t('observability.leadDigestRunError'));
    },
  });

  const { mutate: clearCache, isPending: clearingCache } = useMutation({
    mutationFn: () => analyticsApi.clearCache(),
    onSuccess: () => {
      refetchCache();
      toast.success(t('observability.cacheCleared'));
    },
    onError: (err) => {
      captureError(err, 'Failed to clear cache', { tags: { page: 'observability' } });
      toast.error(t('observability.cacheClearError'));
    },
  });

  const formatCost = (usd: number) => `$${usd.toFixed(4)}`;
  const formatPct = (n: number) => `${Math.round(n)}%`;
  const formatUptime = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const cacheHitRate = aiUsage?.totals
    ? aiUsage.totals.calls > 0
      ? (aiUsage.totals.cacheHits / aiUsage.totals.calls) * 100
      : 0
    : 0;

  return (
    <AdminLayout title={t('observability.title')}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header + period selector */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">{t('observability.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('observability.subtitle')}</p>
          </div>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  days === d
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`observability.days${d}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">{t('observability.loading')}</div>
        ) : (
          <>
            {/* AI Cost Section */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('observability.aiCost')}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  icon={DollarSign}
                  label={t('observability.totalCost')}
                  value={aiUsage ? formatCost(aiUsage.totals.costUsd) : '—'}
                />
                <StatCard
                  icon={Zap}
                  label={t('observability.llmCalls')}
                  value={aiUsage?.totals.llmCalls.toLocaleString() ?? '—'}
                />
                <StatCard
                  icon={Database}
                  label={t('observability.cacheHits')}
                  value={aiUsage?.totals.cacheHits.toLocaleString() ?? '—'}
                  sub={aiUsage ? formatPct(cacheHitRate) : undefined}
                />
                <StatCard
                  icon={Activity}
                  label={t('observability.totalCalls')}
                  value={aiUsage?.totals.calls.toLocaleString() ?? '—'}
                />
              </div>

              {/* Cost by model */}
              {aiUsage && Object.keys(aiUsage.byModel).length > 0 && (
                <Card className="mt-3 p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3">{t('observability.costByModel')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border">
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.model')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.calls')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.cacheHits')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.tokensIn')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.tokensOut')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.cost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(aiUsage.byModel).map(([model, stats]) => (
                          <tr key={model} className="border-b border-theme-border last:border-0">
                            <td className="py-2 font-mono text-xs text-foreground">{model}</td>
                            <td className="py-2 text-end text-foreground">{stats.calls.toLocaleString()}</td>
                            <td className="py-2 text-end text-foreground">{stats.cacheHits.toLocaleString()}</td>
                            <td className="py-2 text-end text-muted-foreground">{stats.tokensIn.toLocaleString()}</td>
                            <td className="py-2 text-end text-muted-foreground">{stats.tokensOut.toLocaleString()}</td>
                            <td className="py-2 text-end font-medium text-foreground">{formatCost(stats.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Daily cost chart (simple bar representation) */}
              {aiUsage && aiUsage.byDay.length > 0 && (
                <Card className="mt-3 p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3">{t('observability.costByDay')}</h3>
                  <div className="flex items-end gap-0.5 h-24">
                    {(() => {
                      const maxCost = Math.max(...aiUsage.byDay.map(d => d.costUsd), 0.0001);
                      return aiUsage.byDay.map((day) => (
                        <div
                          key={day.date}
                          className="flex-1 bg-brand-500 dark:bg-brand-400 rounded-t transition-all hover:bg-brand-600 dark:hover:bg-brand-300 min-w-[2px]"
                          style={{ height: `${Math.max((day.costUsd / maxCost) * 100, 2)}%` }}
                          title={`${day.date}: ${formatCost(day.costUsd)} (${day.calls} ${t('observability.calls').toLowerCase()})`}
                        />
                      ));
                    })()}
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                    <span>{aiUsage.byDay[0]?.date}</span>
                    <span>{aiUsage.byDay[aiUsage.byDay.length - 1]?.date}</span>
                  </div>
                </Card>
              )}
            </section>

            {/* Reply Pipeline Section */}
            {overview && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('observability.replyPipeline')}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    icon={BarChart3}
                    label={t('observability.totalReplies')}
                    value={(overview.totals.comments + overview.totals.messages).toLocaleString()}
                  />
                  <StatCard
                    icon={Zap}
                    label={t('observability.replyRate')}
                    value={`${overview.totals.replyRate}%`}
                  />
                  <StatCard
                    icon={Clock}
                    label={t('observability.avgResponseTime')}
                    value={overview.responseTime.avgSeconds != null ? `${overview.responseTime.avgSeconds}${t('observability.seconds')}` : '—'}
                    sub={overview.responseTime.p50Seconds != null ? `P50: ${overview.responseTime.p50Seconds}${t('observability.seconds')}` : undefined}
                  />
                  <StatCard
                    icon={Activity}
                    label={t('observability.flagged')}
                    value={overview.totals.flagged.toLocaleString()}
                  />
                </div>

                <div className="grid md:grid-cols-3 gap-3 mt-3">
                  <Card className="p-4">
                    <BreakdownTable title={t('observability.byMethod')} data={overview.byMethod} />
                  </Card>
                  <Card className="p-4">
                    <BreakdownTable title={t('observability.byIntent')} data={overview.byIntent} />
                  </Card>
                  <Card className="p-4">
                    <BreakdownTable title={t('observability.byPlatform')} data={overview.byPlatform} />
                  </Card>
                </div>
              </section>
            )}

            {/* Cache Management Section */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('observability.cacheManagement')}
                </h2>
                <button
                  onClick={() => setConfirmClearCache(true)}
                  disabled={clearingCache}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  aria-label={t('observability.clearAiCache')}
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {clearingCache ? t('observability.clearingCache') : t('observability.clearAiCache')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">{t('observability.exactCache')}</p>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground">{t('observability.cacheEntries')}</p>
                      <p className="text-lg font-bold text-foreground">{cacheStats?.exactCache.totalEntries.toLocaleString() ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('observability.cacheTotalHits')}</p>
                      <p className="text-lg font-bold text-foreground">{cacheStats?.exactCache.totalHits.toLocaleString() ?? '—'}</p>
                    </div>
                  </div>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">{t('observability.semanticCache')}</p>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground">{t('observability.cacheEntries')}</p>
                      <p className="text-lg font-bold text-foreground">{cacheStats?.semanticCache.totalEntries.toLocaleString() ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t('observability.cacheTotalHits')}</p>
                      <p className="text-lg font-bold text-foreground">{cacheStats?.semanticCache.totalHits.toLocaleString() ?? '—'}</p>
                    </div>
                  </div>
                </Card>
              </div>
            </section>

            {/* Lead Digest Section */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  {t('observability.leadDigest')}
                </h2>
                <button
                  onClick={() => runLeadDigest()}
                  disabled={runningLeadDigest}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground border border-theme-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Play className={clsx('w-3 h-3', runningLeadDigest && 'animate-pulse')} aria-hidden="true" />
                  {runningLeadDigest ? t('observability.leadDigestRunning') : t('observability.leadDigestRunNow')}
                </button>
              </div>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground mb-3">{t('observability.leadDigestSubtitle')}</p>
                {leadDigestLoading ? (
                  <div className="text-sm text-muted-foreground py-4">{t('observability.loading')}</div>
                ) : !leadDigest || leadDigest.rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">{t('observability.leadDigestEmpty')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border">
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColDate')}</th>
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColUser')}</th>
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColStatus')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColCount')}</th>
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColLang')}</th>
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColResend')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.leadDigestColView')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leadDigest.rows.map((row) => (
                          <tr key={row.id} className="border-b border-theme-border last:border-0">
                            <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(row.createdAt).toLocaleString()}
                            </td>
                            <td className="py-1.5 text-xs text-foreground">{row.userEmail ?? row.userId}</td>
                            <td className="py-1.5">
                              <span className={clsx(
                                'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
                                row.status === 'sent' ? 'status-success'
                                  : row.status === 'failed' ? 'status-error'
                                  : 'status-warning',
                              )}>
                                {translateDigestStatus(row.status, t)}
                              </span>
                              {row.errorMessage && (
                                <p className="text-xs text-destructive mt-0.5 truncate max-w-xs" title={row.errorMessage}>
                                  {row.errorMessage}
                                </p>
                              )}
                            </td>
                            <td className="py-1.5 text-end font-medium text-foreground">{row.leadCount}</td>
                            <td className="py-1.5 text-xs text-foreground">{row.lang ?? '—'}</td>
                            <td className="py-1.5 text-xs">
                              {row.resendEmailId ? (
                                <a
                                  href={`https://resend.com/emails/${row.resendEmailId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-600 dark:text-brand-400 hover:underline font-mono"
                                >
                                  {row.resendEmailId.slice(0, 8)}…
                                </a>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-1.5 text-xs text-end">
                              {row.emailSendId ? (
                                <button
                                  onClick={() => setPreviewEmailId(row.emailSendId)}
                                  className="text-brand-600 dark:text-brand-400 hover:underline"
                                >
                                  {t('observability.leadDigestViewEmail')}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </section>

            {/* System Health Section */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('observability.systemHealth')}
                </h2>
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'system-health'] })}
                  disabled={healthFetching}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label={t('observability.refreshHealth')}
                >
                  <RefreshCw className={clsx('w-3 h-3', healthFetching && 'animate-spin')} aria-hidden="true" />
                  {t('observability.refreshHealth')}
                </button>
              </div>

              {healthLoading ? (
                <div className="text-sm text-muted-foreground py-4">{t('observability.loading')}</div>
              ) : health ? (
                <div className="space-y-3">
                  {/* Service Status */}
                  <Card className="p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">{t('observability.serviceStatus')}</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex items-center gap-3">
                        <Database className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('observability.database')}</p>
                          <ServiceBadge status={health.services.database.status} />
                          {health.services.database.latencyMs >= 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5">{health.services.database.latencyMs}ms</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Server className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('observability.redis')}</p>
                          <ServiceBadge status={health.services.redis.status} />
                          {health.services.redis.latencyMs >= 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5">{health.services.redis.latencyMs}ms</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Zap className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('observability.aiWorkerCircuit')}</p>
                          <ServiceBadge status={health.services.aiWorker.circuit} />
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Process Metrics */}
                  <Card className="p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">{t('observability.processMetrics')}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard icon={Cpu} label={t('observability.memoryRss')} value={`${health.process.memoryRssMb} MB`} />
                      <StatCard icon={Cpu} label={t('observability.heapUsed')} value={`${health.process.heapUsedMb} MB`} sub={`/ ${health.process.heapTotalMb} MB`} />
                      <StatCard icon={Clock} label="Uptime" value={formatUptime(health.process.uptimeSeconds)} />
                    </div>
                  </Card>

                  {/* External API Latency */}
                  {health.externalApis.length > 0 && (
                    <Card className="p-4">
                      <h3 className="text-sm font-semibold text-foreground mb-3">
                        <Globe className="w-4 h-4 inline me-1 text-icon-muted" aria-hidden="true" />
                        {t('observability.externalApis')}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-theme-border">
                              <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.service')}</th>
                              <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.method')}</th>
                              <th className="text-start pb-2 text-muted-foreground font-medium">{t('observability.status')}</th>
                              <th className="text-end pb-2 text-muted-foreground font-medium">P50</th>
                              <th className="text-end pb-2 text-muted-foreground font-medium">P95</th>
                              <th className="text-end pb-2 text-muted-foreground font-medium">P99</th>
                              <th className="text-end pb-2 text-muted-foreground font-medium">{t('observability.count')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {health.externalApis.map((api, i) => (
                              <tr key={i} className="border-b border-theme-border last:border-0">
                                <td className="py-1.5 font-mono text-xs text-foreground">{api.service}</td>
                                <td className="py-1.5 text-xs text-foreground">{api.method}</td>
                                <td className="py-1.5">
                                  <ServiceBadge status={api.status === 'success' ? 'up' : 'down'} />
                                </td>
                                <td className="py-1.5 text-end font-mono text-xs text-foreground">{api.p50Ms}ms</td>
                                <td className="py-1.5 text-end font-mono text-xs text-foreground">{api.p95Ms}ms</td>
                                <td className="py-1.5 text-end font-mono text-xs text-foreground">{api.p99Ms}ms</td>
                                <td className="py-1.5 text-end text-foreground">{api.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </div>
              ) : null}
            </section>

            {!aiUsage && !overview && !health && (
              <div className="text-center py-12 text-muted-foreground">
                {t('observability.noData')}
              </div>
            )}
          </>
        )}
      </div>
      <Modal
        isOpen={!!previewEmailId}
        onClose={() => setPreviewEmailId(null)}
        title={emailPreview?.subject || t('observability.leadDigestModalTitle')}
        size="xl"
        mobilePresentation="fullscreen"
      >
        {emailPreviewLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {t('observability.leadDigestModalLoading')}
          </div>
        ) : emailPreview?.htmlBody ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                <span className="font-semibold">{t('observability.leadDigestColUser')}: </span>
                {emailPreview.toEmail}
              </div>
              <div>
                <span className="font-semibold">{t('observability.leadDigestColDate')}: </span>
                {new Date(emailPreview.createdAt).toLocaleString()}
              </div>
            </div>
            <iframe
              title={t('observability.leadDigestModalTitle')}
              srcDoc={emailPreview.htmlBody}
              sandbox=""
              className="w-full h-[60vh] border border-theme-border rounded-lg bg-white"
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {t('observability.leadDigestModalNoBody')}
          </div>
        )}
      </Modal>
      <ConfirmationModal
        isOpen={confirmClearCache}
        onClose={() => setConfirmClearCache(false)}
        onConfirm={() => { setConfirmClearCache(false); clearCache(); }}
        title={t('observability.clearAiCache')}
        message={t('observability.clearCacheConfirm')}
        confirmText={t('observability.clearAiCache')}
        cancelText={tc('cancel')}
        variant="danger"
      />
    </AdminLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminObservability]);

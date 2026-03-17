import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card } from '@/components/ui';
import { analyticsApi } from '@/lib/api';
import type { AiUsageReport, AnalyticsOverview } from '@/lib/api';
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

export default function AdminObservabilityPage() {
  const t = useTranslations('admin');
  const [days, setDays] = useState(30);

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

  const formatCost = (usd: number) => `$${usd.toFixed(4)}`;
  const formatPct = (n: number) => `${Math.round(n)}%`;

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

            {!aiUsage && !overview && (
              <div className="text-center py-12 text-muted-foreground">
                {t('observability.noData')}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminObservability]);

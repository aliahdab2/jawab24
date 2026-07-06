import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { DollarSign, Zap, Database, PiggyBank, Receipt, Scale, Fuel } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Card, Button } from '@/components/ui';
import { StatCard } from '@/components/admin/StatCard';
import { AiCreditRunwayBanner } from '@/components/admin/AiCreditRunwayBanner';
import {
  adminApi,
  AI_COST_PERIODS,
  type AdminGlobalAiCostReport,
  type AdminAiBillingReport,
  type AdminAiReconciliation,
  type AdminAiRunway,
  type AdminUserAiCostPeriod,
} from '@/lib/api';
import { useAiPipelineLabel } from '@/hooks';
import { formatCostUsd } from '@/utils/pricing';
import { captureError } from '@/lib/sentryHelpers';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';

// Pipelines that flow through the internal reply cache (mirrors backend
// REPLY_PIPELINES, plus admin playground traffic). Every other pipeline can
// never produce a cache hit, so its hit-rate cell shows "—" instead of a
// misleading 0%.
const CACHE_CAPABLE_PIPELINES = new Set(['comment_reply', 'dm_reply', 'playground']);

export default function AdminAiCostPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const pipelineLabel = useAiPipelineLabel();
  const [period, setPeriod] = useState<AdminUserAiCostPeriod>('30d');
  const [balanceInput, setBalanceInput] = useState('');
  const [dateInput, setDateInput] = useState('');

  const consumption = useQuery<AdminGlobalAiCostReport>({
    queryKey: ['admin', 'ai-cost', 'consumption', period],
    queryFn: () => adminApi.getGlobalAiCost(period),
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load AI consumption', { tags: { page: 'admin-ai-cost' } }) },
  });
  const billing = useQuery<AdminAiBillingReport>({
    queryKey: ['admin', 'ai-cost', 'billing', period],
    queryFn: () => adminApi.getAiBilling(period),
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load AI billing', { tags: { page: 'admin-ai-cost' } }) },
  });
  const reconciliation = useQuery<AdminAiReconciliation>({
    queryKey: ['admin', 'ai-cost', 'reconciliation', period],
    queryFn: () => adminApi.getAiReconciliation(period),
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load AI reconciliation', { tags: { page: 'admin-ai-cost' } }) },
  });
  const runway = useQuery<AdminAiRunway>({
    queryKey: ['admin', 'ai-cost', 'runway'],
    queryFn: () => adminApi.getAiRunway(),
    staleTime: 60_000,
    retry: false,
    meta: { onError: (err: unknown) => captureError(err, 'Failed to load AI runway', { tags: { page: 'admin-ai-cost' } }) },
  });

  const saveBalance = useMutation({
    mutationFn: () => adminApi.setAiCreditBalance({
      balanceUsd: Number(balanceInput),
      anchoredAt: dateInput,
      note: undefined,
    }),
    onSuccess: () => {
      toast.success(t('aiCost.balanceSaved'));
      setBalanceInput('');
      setDateInput('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-cost', 'runway'] });
    },
    onError: (err: unknown) => {
      toast.error(t('aiCost.balanceError'));
      captureError(err, 'Failed to set AI credit balance', { tags: { page: 'admin-ai-cost' } });
    },
  });
  const balanceValid = balanceInput !== '' && Number(balanceInput) >= 0 && dateInput !== '';

  // On-demand OpenAI cost sync (server-side; the admin key stays in backend env).
  const syncCosts = useMutation({
    mutationFn: () => adminApi.syncAiCosts(),
    onSuccess: (res) => {
      if (!res.configured) {
        toast.error(t('aiCost.syncNotConfigured'));
        return;
      }
      toast.success(t('aiCost.syncDone', { count: res.synced }));
      // Refresh every ai-cost query (billing, reconciliation, runway, consumption).
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-cost'] });
    },
    onError: (err: unknown) => {
      toast.error(t('aiCost.syncError'));
      captureError(err, 'Failed to sync OpenAI costs', { tags: { page: 'admin-ai-cost' } });
    },
  });

  const totals = consumption.data?.totals;
  // Reply-scoped rate: hits over comment_reply + dm_reply only. The blended
  // all-pipeline rate (internalCacheHitRate) counts embeddings/translation/…
  // that can never hit, which made a healthy cache read as ~12%.
  const cacheRatePct = totals && totals.replyCalls > 0 ? Math.round(totals.replyCacheHitRate * 100) : 0;
  const apiKeyLabel = (label: string) => t(`aiCost.apiKey_${label}` as Parameters<typeof t>[0]);

  return (
    <AdminLayout title={t('aiCost.title')}>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header + period selector */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">{t('aiCost.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('aiCost.subtitle')}</p>
          </div>
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {AI_COST_PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={clsx(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  period === p
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`customer.period_${p}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        {/* Early-warning banner — only renders at warning/critical severity. */}
        {runway.data && <AiCreditRunwayBanner runway={runway.data} />}

        {/* ── Credit runway + balance anchor ─────────────────────────── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Fuel className="w-4 h-4" aria-hidden="true" /> {t('aiCost.runwaySectionTitle')}
          </h2>
          {runway.data?.spendSpike?.spike && (
            <div className="mb-3 rounded-md border border-s-4 bg-amber-50 text-amber-900 border-amber-200 border-s-amber-500 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/60 px-3 py-2 text-xs">
              {t('aiCost.spikeNotice', {
                day: runway.data.spendSpike.day ?? '—',
                dayUsd: formatCostUsd(runway.data.spendSpike.dayUsd, 2),
                baseline: formatCostUsd(runway.data.spendSpike.baselineDailyUsd, 2),
                ratio: runway.data.spendSpike.ratio === null ? '—' : `${runway.data.spendSpike.ratio}×`,
              })}
            </div>
          )}
          {runway.data?.configured ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
              <div><p className="text-xs text-muted-foreground">{t('aiCost.runwayRemaining')}</p><p className="font-bold text-foreground">{formatCostUsd(runway.data.remainingUsd ?? 0, 2)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.runwayDaysLabel')}</p><p className="font-bold text-foreground">{runway.data.runwayDays === null ? '—' : t('aiCost.runwayDaysValue', { days: runway.data.runwayDays })}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.runwayDailyRate')}</p><p className="font-bold text-foreground">{formatCostUsd(runway.data.rollingDailyRateUsd, 2)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.runwayAnchorLabel')}</p><p className="font-bold text-foreground">{runway.data.anchoredAt ?? '—'}</p></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-3">{t('aiCost.runwayNotConfigured')}</p>
          )}

          {/* Balance anchor form — OpenAI exposes no balance API, so the admin enters it. */}
          <div className="flex flex-wrap items-end gap-3 border-t border-theme-border pt-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('aiCost.balanceAmountLabel')}</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal" dir="ltr"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                className="w-32 px-3 py-1.5 text-sm rounded-md border border-theme-border bg-background text-foreground"
                placeholder="0.00"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('aiCost.balanceDateLabel')}</span>
              <input
                type="date" dir="ltr"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="px-3 py-1.5 text-sm rounded-md border border-theme-border bg-background text-foreground"
              />
            </label>
            <Button
              onClick={() => saveBalance.mutate()}
              disabled={!balanceValid || saveBalance.isPending}
              size="sm"
            >
              {saveBalance.isPending ? tc('saving') : t('aiCost.balanceSave')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t('aiCost.autoRechargeHint')}</p>
        </Card>

        {/* ── What OpenAI bills us (authoritative) ───────────────────── */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Receipt className="w-4 h-4" aria-hidden="true" /> {t('aiCost.billingTitle')}
            </h2>
            <Button variant="secondary" size="sm" onClick={() => syncCosts.mutate()} disabled={syncCosts.isPending}>
              {syncCosts.isPending ? t('aiCost.syncing') : t('aiCost.syncNow')}
            </Button>
          </div>
          {billing.isLoading ? (
            <div className="text-sm text-muted-foreground py-4">{t('customer.loading')}</div>
          ) : !billing.data || billing.data.empty ? (
            <Card className="p-4"><p className="text-sm text-muted-foreground">{t('aiCost.billingEmpty')}</p></Card>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard icon={Receipt} label={t('aiCost.billingTotal')} value={formatCostUsd(billing.data.totalUsd, 2)} />
                {billing.data.byApiKey.map((k) => (
                  <StatCard key={k.apiKeyId || 'none'} icon={DollarSign} label={apiKeyLabel(k.label)} value={formatCostUsd(k.costUsd, 2)} />
                ))}
              </div>
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="text-start pb-2 text-muted-foreground font-medium">{t('aiCost.colModel')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.data.byModel.map((m) => (
                        <tr key={m.model} className="border-b border-theme-border last:border-0">
                          <td className="py-2 text-foreground" dir="ltr">{m.model || '—'}</td>
                          <td className="py-2 text-end font-medium text-foreground">{formatCostUsd(m.costUsd, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </section>

        {/* ── Reconciliation: OpenAI prod-key vs our estimate ────────── */}
        {reconciliation.data && !billing.data?.empty && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Scale className="w-4 h-4" aria-hidden="true" /> {t('aiCost.reconcTitle')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">{t('aiCost.reconcOpenaiProd')}</p><p className="font-bold text-foreground">{formatCostUsd(reconciliation.data.openaiProdUsd, 2)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.reconcOurEstimate')}</p><p className="font-bold text-foreground">{formatCostUsd(reconciliation.data.ourEstimateUsd, 2)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.reconcDelta')}</p><p className="font-bold text-foreground">{reconciliation.data.deltaPct === null ? '—' : `${reconciliation.data.deltaPct}%`}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('aiCost.reconcOpenaiOrg')}</p><p className="font-bold text-foreground">{formatCostUsd(reconciliation.data.openaiOrgUsd, 2)}</p></div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">{t('aiCost.reconcNote')}</p>
          </Card>
        )}

        {/* ── Our consumption + caching (from ai_usage_log) ──────────── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Database className="w-4 h-4" aria-hidden="true" /> {t('aiCost.consumptionTitle')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('aiCost.estimateNote')}</p>

          {consumption.isLoading ? (
            <div className="text-sm text-muted-foreground py-4">{t('customer.loading')}</div>
          ) : !totals || totals.calls === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('aiCost.empty')}</p>
          ) : (
            <div className={clsx('space-y-4', consumption.isFetching && 'opacity-60')}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard icon={DollarSign} label={t('aiCost.cardTotalSpend')} value={formatCostUsd(totals.costUsd, 2)} />
                <StatCard icon={Zap} label={t('aiCost.cardBilledCalls')} value={totals.billedCalls.toLocaleString()} sub={t('aiCost.cardBilledCallsSub', { calls: totals.calls.toLocaleString() })} />
                <StatCard icon={Database} label={t('aiCost.cardCacheHitRate')} value={`${cacheRatePct}%`} sub={t('aiCost.cardCacheHitRateSub', { hits: totals.replyCacheHits.toLocaleString(), calls: totals.replyCalls.toLocaleString() })} />
                <StatCard icon={PiggyBank} label={t('aiCost.cardCacheSavings')} value={formatCostUsd(totals.promptCacheSavingsUsd, 2)} />
              </div>

              <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">{t('aiCost.secByFeature')}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="text-start pb-2 text-muted-foreground font-medium">{t('aiCost.colFeature')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colBilled')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCached')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colHitRate')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumption.data!.byPipeline.map((row) => (
                        <tr key={row.pipeline} className="border-b border-theme-border last:border-0">
                          <td className="py-2 text-foreground">{pipelineLabel(row.pipeline)}</td>
                          <td className="py-2 text-end text-foreground">{row.billedCalls.toLocaleString()}</td>
                          <td className="py-2 text-end text-foreground">{row.cacheHits.toLocaleString()}</td>
                          <td className="py-2 text-end text-foreground">
                            {CACHE_CAPABLE_PIPELINES.has(row.pipeline) && row.calls > 0
                              ? `${Math.round((row.cacheHits / row.calls) * 100)}%`
                              : '—'}
                          </td>
                          <td className="py-2 text-end font-medium text-foreground">{formatCostUsd(row.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <h3 className="text-lg font-semibold text-foreground mb-4">{t('aiCost.secByModel')}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-border">
                        <th className="text-start pb-2 text-muted-foreground font-medium">{t('aiCost.colModel')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colBilled')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCached')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCacheSavings')}</th>
                        <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumption.data!.byModel.map((row) => (
                        <tr key={row.model} className="border-b border-theme-border last:border-0">
                          <td className="py-2 text-foreground" dir="ltr">{row.model}</td>
                          <td className="py-2 text-end text-foreground">{row.billedCalls.toLocaleString()}</td>
                          <td className="py-2 text-end text-foreground">{row.cacheHits.toLocaleString()}</td>
                          <td className="py-2 text-end text-foreground">{formatCostUsd(row.promptCacheSavingsUsd)}</td>
                          <td className="py-2 text-end font-medium text-foreground">{formatCostUsd(row.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Cost by intent — surfaces which intents drive cost (informs cheaper-model routing). */}
              {consumption.data!.byIntent.length > 0 && (
                <Card>
                  <h3 className="text-lg font-semibold text-foreground mb-4">{t('aiCost.secByIntent')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-border">
                          <th className="text-start pb-2 text-muted-foreground font-medium">{t('aiCost.colIntent')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colBilled')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCached')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colAvgPerCall')}</th>
                          <th className="text-end pb-2 text-muted-foreground font-medium">{t('aiCost.colCost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consumption.data!.byIntent.map((row) => (
                          <tr key={row.intent} className="border-b border-theme-border last:border-0">
                            <td className="py-2 text-foreground">{row.intent}</td>
                            <td className="py-2 text-end text-foreground">{(row.calls - row.cacheHits).toLocaleString()}</td>
                            <td className="py-2 text-end text-foreground">{row.cacheHits.toLocaleString()}</td>
                            <td className="py-2 text-end text-muted-foreground">{formatCostUsd(row.avgCostPerCallUsd)}</td>
                            <td className="py-2 text-end font-medium text-foreground">{formatCostUsd(row.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Daily spend trend (simple bars) — spot spikes at a glance. */}
              {consumption.data!.byDay.length > 0 && (
                <Card>
                  <h3 className="text-lg font-semibold text-foreground mb-4">{t('aiCost.secByDay')}</h3>
                  <div className="flex items-end gap-0.5 h-24">
                    {(() => {
                      const maxCost = Math.max(...consumption.data!.byDay.map(d => d.costUsd), 0.0001);
                      return consumption.data!.byDay.map((day) => (
                        <div
                          key={day.date}
                          className="flex-1 bg-brand-500 dark:bg-brand-400 rounded-t transition-all hover:bg-brand-600 dark:hover:bg-brand-300 min-w-[2px]"
                          style={{ height: `${Math.max((day.costUsd / maxCost) * 100, 2)}%` }}
                          title={`${day.date}: ${formatCostUsd(day.costUsd)}`}
                        />
                      ));
                    })()}
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                    <span dir="ltr">{consumption.data!.byDay[0]?.date}</span>
                    <span dir="ltr">{consumption.data!.byDay[consumption.data!.byDay.length - 1]?.date}</span>
                  </div>
                </Card>
              )}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.adminAiCost]);

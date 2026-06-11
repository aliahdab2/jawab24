import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Card, Button } from '@/components/ui';
import { adminApi, type AdminUserAiCostReport, type AdminUserAiCostPeriod } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { AiModelOptions } from '@/components/admin/AiModelOptions';
import { type CustomerDetail, type IntlLocale, FIELD_CLASS } from './types';

const AI_COST_PERIODS: readonly AdminUserAiCostPeriod[] = ['7d', '30d', '90d', 'this_month', 'last_month'];

interface Props {
    customer: CustomerDetail;
    userId: string;
    intlLocale: IntlLocale;
    /** Re-fetch the customer in the parent after the model override changes. */
    onUpdated: () => void;
}

export function AiTab({ customer, userId, intlLocale, onUpdated }: Props) {
    const t = useTranslations('admin');
    const tc = useTranslations('common');

    // '' represents "use default" (settings.ai_model = NULL).
    const [selectedAiModel, setSelectedAiModel] = useState<string>(customer.aiModel ?? '');
    const [aiModelSaving, setAiModelSaving] = useState(false);

    // AI Cost by Page state — driven by an in-card period selector. Fetched separately
    // from the user-detail call so changing the period doesn't refetch profile/pages/sub.
    const [aiCostPeriod, setAiCostPeriod] = useState<AdminUserAiCostPeriod>('30d');
    const [aiCost, setAiCost] = useState<AdminUserAiCostReport | null>(null);
    const [aiCostLoading, setAiCostLoading] = useState(false);

    // Keep the select in sync if the customer is re-fetched (e.g. after a save).
    useEffect(() => {
        setSelectedAiModel(customer.aiModel ?? '');
    }, [customer.aiModel]);

    // Load (and reload on period change) the AI cost by page report
    useEffect(() => {
        let cancelled = false;
        setAiCostLoading(true);
        adminApi
            .getUserAiCost(userId, aiCostPeriod)
            .then((data) => {
                if (!cancelled) setAiCost(data);
            })
            .catch((err) => {
                captureError(err, 'Failed to load admin user AI cost', { tags: { page: 'admin-customer-detail' } });
            })
            .finally(() => {
                if (!cancelled) setAiCostLoading(false);
            });
        return () => { cancelled = true; };
    }, [userId, aiCostPeriod]);

    // Show 4 decimals to make sub-cent costs readable (typical reply costs $0.0015).
    const formatCost = (usd: number) => `$${usd.toFixed(4)}`;
    const formatRange = (startIso: string, endIso: string) => {
        const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        return `${new Date(startIso).toLocaleDateString(intlLocale, opts)} – ${new Date(endIso).toLocaleDateString(intlLocale, { ...opts, year: 'numeric' })}`;
    };

    const handleSaveAiModel = async () => {
        const currentValue = customer.aiModel ?? '';
        if (selectedAiModel === currentValue) return;

        // Confirm only when switching TO a non-default model — that's the
        // direction with potential quality impact. Clearing the override back
        // to default is always safe.
        if (selectedAiModel && selectedAiModel !== DEFAULT_AI_MODEL) {
            if (!confirm(t('customer.aiModelConfirm', { model: selectedAiModel }))) return;
        }

        setAiModelSaving(true);
        try {
            const response = await adminApi.setUserAiModel(userId, selectedAiModel || null);
            if (response.success) {
                toast.success(t('customer.aiModelSaved'));
                onUpdated();
            } else {
                toast.error(response.error || t('customer.aiModelSaveError'));
            }
        } catch (err) {
            toast.error(t('customer.aiModelSaveError'));
            captureError(err, 'Failed to set AI model', { tags: { page: 'admin-customer-detail', action: 'setAiModel' } });
        } finally {
            setAiModelSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* AI Model Override Card */}
            <Card>
                <h2 className="text-lg font-semibold text-foreground mb-4">
                    {t('customer.aiModel')}
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                    {t('customer.aiModelHint')}
                </p>
                <select
                    value={selectedAiModel}
                    onChange={(e) => setSelectedAiModel(e.target.value)}
                    disabled={aiModelSaving}
                    aria-label={t('customer.aiModel')}
                    className={FIELD_CLASS}
                >
                    <option value="">{t('customer.aiModelUseDefault', { model: DEFAULT_AI_MODEL })}</option>
                    <AiModelOptions defaultLabelSuffix={`(${t('customer.aiModelDefaultSuffix')})`} />
                </select>
                <div className="mt-4">
                    <Button
                        onClick={handleSaveAiModel}
                        disabled={aiModelSaving || selectedAiModel === (customer.aiModel ?? '')}
                        className="w-full"
                    >
                        {aiModelSaving ? tc('saving') : t('customer.aiModelSave')}
                    </Button>
                </div>
            </Card>

            {/* AI Cost by Page — period-scoped breakdown of OpenAI spend per Facebook/Instagram page */}
            <Card>
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                    <h2 className="text-lg font-semibold text-foreground">
                        {t('customer.aiCostByPage')}
                    </h2>
                    <div className="flex gap-1 bg-muted rounded-lg p-1">
                        {AI_COST_PERIODS.map((p) => (
                            <button
                                key={p}
                                onClick={() => setAiCostPeriod(p)}
                                aria-pressed={aiCostPeriod === p}
                                className={clsx(
                                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                                    aiCostPeriod === p
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {t(`customer.period_${p}` as Parameters<typeof t>[0])}
                            </button>
                        ))}
                    </div>
                </div>
                {aiCost && (
                    <p className="text-xs text-muted-foreground mb-3">
                        {formatRange(aiCost.rangeStart, aiCost.rangeEnd)}
                    </p>
                )}
                {aiCost && (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.aiCostTotalCalls')}</p>
                            <p className="text-lg font-bold text-foreground">{aiCost.totals.calls.toLocaleString()}</p>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.aiCostCacheHitRate')}</p>
                            <p className="text-lg font-bold text-foreground">
                                {aiCost.totals.calls > 0
                                    ? `${Math.round((aiCost.totals.cacheHits / aiCost.totals.calls) * 100)}%`
                                    : '—'}
                            </p>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                            <p className="text-xs text-muted-foreground">{t('customer.aiCostTotalCost')}</p>
                            <p className="text-lg font-bold text-foreground">{formatCost(aiCost.totals.costUsd)}</p>
                        </div>
                    </div>
                )}
                <div className={clsx('overflow-x-auto', aiCostLoading && 'opacity-50')}>
                    {!aiCost && aiCostLoading ? (
                        <p className="text-sm text-muted-foreground py-4">{t('customer.loading')}</p>
                    ) : aiCost && aiCost.byPage.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-theme-border">
                                    <th className="text-start pb-2 text-muted-foreground font-medium">{t('customer.aiCostColPage')}</th>
                                    <th className="text-end pb-2 text-muted-foreground font-medium">{t('customer.aiCostColCalls')}</th>
                                    <th className="text-end pb-2 text-muted-foreground font-medium">{t('customer.aiCostColCacheHits')}</th>
                                    <th className="text-end pb-2 text-muted-foreground font-medium">{t('customer.aiCostColCost')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {aiCost.byPage.map((row) => (
                                    <tr key={row.pageId ?? '__none__'} className="border-b border-theme-border last:border-0">
                                        <td className="py-2 text-foreground">{row.pageName ?? '—'}</td>
                                        <td className="py-2 text-end text-foreground">{row.calls.toLocaleString()}</td>
                                        <td className="py-2 text-end text-foreground">{row.cacheHits.toLocaleString()}</td>
                                        <td className="py-2 text-end font-medium text-foreground">{formatCost(row.costUsd)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="text-sm text-muted-foreground py-4">{t('customer.aiCostEmpty')}</p>
                    )}
                </div>
            </Card>
        </div>
    );
}

import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { formatCostUsd } from '@/utils/pricing';
import type { AdminAiRunway } from '@/lib/api';

/**
 * Admin-only banner warning that OpenAI credit is running low BEFORE the wallet
 * hits zero (the 2026-06-28 outage had no early warning). Hidden when severity is
 * 'ok'. Not dismissible at any severity — the operator must act. Mirrors the
 * severity palette of AiUsageWarningBanner (rose=critical, amber=warning).
 */
export function AiCreditRunwayBanner({ runway }: { runway: AdminAiRunway }) {
    const t = useTranslations('admin');
    if (runway.severity === 'ok') return null;

    const critical = runway.severity === 'critical';
    const palette = critical
        ? 'bg-rose-50 text-rose-900 border-rose-200 border-s-rose-500 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-700/60'
        : 'bg-amber-50 text-amber-900 border-amber-200 border-s-amber-500 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/60';
    const iconBg = critical
        ? 'bg-rose-200/50 text-rose-600 dark:bg-rose-800/40 dark:text-rose-400'
        : 'bg-amber-200/50 text-amber-700 dark:bg-amber-800/40 dark:text-amber-400';

    const title = runway.currentlyParking
        ? t('aiCost.runwayParkingTitle')
        : critical ? t('aiCost.runwayCriticalTitle') : t('aiCost.runwayWarningTitle');

    return (
        <Card className={clsx('overflow-hidden border border-s-4', palette)} padding="none" data-severity={runway.severity}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                    <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base leading-tight">{title}</p>
                    <p className="text-xs sm:text-sm opacity-80 mt-1">
                        {t('aiCost.runwayBannerDetail', {
                            remaining: formatCostUsd(runway.remainingUsd ?? 0, 2),
                            days: runway.runwayDays === null ? '—' : String(runway.runwayDays),
                            rate: formatCostUsd(runway.rollingDailyRateUsd, 2),
                        })}
                    </p>
                </div>
            </div>
        </Card>
    );
}

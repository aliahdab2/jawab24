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
        ? 'alert-critical'
        : 'alert-warning-banner';
    const iconBg = critical
        ? 'icon-bg-critical'
        : 'icon-bg-warning-banner';

    const title = runway.currentlyParking
        ? t('aiCost.runwayParkingTitle')
        : critical ? t('aiCost.runwayCriticalTitle') : t('aiCost.runwayWarningTitle');

    // Detail line varies by state so we never print "about — days at $0.00/day":
    //  - parking: action-focused (credit is out; remaining/runway aren't meaningful)
    //  - no burn rate yet (runwayDays null — billing snapshots haven't synced): remaining only
    //  - full: remaining + runway days + daily rate
    const detail = runway.currentlyParking
        ? t('aiCost.runwayBannerParking')
        : runway.runwayDays === null
            ? t('aiCost.runwayBannerDetailNoRate', { remaining: formatCostUsd(runway.remainingUsd ?? 0, 2) })
            : t('aiCost.runwayBannerDetail', {
                remaining: formatCostUsd(runway.remainingUsd ?? 0, 2),
                days: String(runway.runwayDays),
                rate: formatCostUsd(runway.rollingDailyRateUsd, 2),
            });

    return (
        <Card className={clsx('overflow-hidden border border-s-4', palette)} padding="none" data-severity={runway.severity}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                    <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base leading-tight">{title}</p>
                    <p className="text-xs sm:text-sm opacity-80 mt-1">{detail}</p>
                </div>
            </div>
        </Card>
    );
}

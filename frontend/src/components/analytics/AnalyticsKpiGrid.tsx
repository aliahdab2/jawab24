import { useTranslations } from 'next-intl';
import { ShoppingCart, MessageSquare, Sparkles } from 'lucide-react';
import { KpiCard } from './KpiCard';
import { isKnownNotificationType } from './notificationTypes';
import type { EcommerceAnalyticsOverview } from '@/lib/api';

function formatMoney(amount: number, currency: string | null): string {
    const value = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return currency ? `${value} ${currency}` : value;
}

/**
 * Top-of-page KPI grid: revenue recovered, carts recovered, AI replies, total replies.
 * The "abandoned cart" subtitle uses the i18n `byType.abandoned_cart` label so it
 * stays in sync with the breakdown chart below.
 */
export function AnalyticsKpiGrid({ overview }: { overview: EcommerceAnalyticsOverview }) {
    const t = useTranslations('ecommerceAnalytics');
    const { recovery, replies } = overview;
    const cartLabel = isKnownNotificationType('abandoned_cart')
        ? t('byType.abandoned_cart').toLowerCase()
        : 'abandoned cart';

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
                label={t('kpis.revenueRecovered')}
                value={formatMoney(recovery.revenueRecovered, recovery.currency)}
                subValue={t('summary.cartsRecovered', { count: recovery.cartsRecovered })}
                icon={<ShoppingCart className="w-5 h-5" aria-hidden="true" />}
                caveat={t('attributionCaveat')}
            />
            <KpiCard
                label={t('kpis.cartsRecovered')}
                value={recovery.cartsRecovered.toLocaleString()}
                subValue={`${recovery.abandonedCartsNotified.toLocaleString()} ${cartLabel}`}
                icon={<ShoppingCart className="w-5 h-5" aria-hidden="true" />}
            />
            <KpiCard
                label={t('kpis.aiReplies')}
                value={replies.aiReplies.toLocaleString()}
                icon={<Sparkles className="w-5 h-5" aria-hidden="true" />}
            />
            <KpiCard
                label={t('kpis.totalReplies')}
                value={replies.totalReplies.toLocaleString()}
                icon={<MessageSquare className="w-5 h-5" aria-hidden="true" />}
            />
        </div>
    );
}

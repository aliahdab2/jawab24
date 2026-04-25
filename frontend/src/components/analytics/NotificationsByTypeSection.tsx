import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { HorizontalBar } from './HorizontalBar';
import { isKnownNotificationType } from './notificationTypes';
import type { EcommerceAnalyticsOverview } from '@/lib/api';

/**
 * Card showing the count of each notification type sent (cart, order, review, …).
 * Unknown notification types — typically future ones the backend introduces
 * before the i18n catalog catches up — fall back to the raw string label.
 */
export function NotificationsByTypeSection({
    byType,
}: {
    byType: EcommerceAnalyticsOverview['notifications']['byType'];
}) {
    const t = useTranslations('ecommerceAnalytics');

    const entries = useMemo(
        () =>
            Object.entries(byType)
                .filter(([, count]) => count > 0)
                .sort((a, b) => b[1] - a[1]),
        [byType],
    );

    if (entries.length === 0) {
        return (
            <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-5">
                <h2 className="font-bold text-lg mb-2 text-start">{t('byType.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('empty.body')}</p>
            </Card>
        );
    }

    const max = Math.max(...entries.map(([, c]) => c));

    return (
        <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-5 landscape:p-4">
            <h2 className="font-bold text-lg mb-4 text-start">{t('byType.title')}</h2>
            <div className="space-y-3">
                {entries.map(([type, count]) => {
                    const label = isKnownNotificationType(type) ? t(`byType.${type}`) : type;
                    return <HorizontalBar key={type} label={label} value={count} max={max} />;
                })}
            </div>
        </Card>
    );
}

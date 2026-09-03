import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { HorizontalBar } from './HorizontalBar';
import type { EcommerceAnalyticsOverview } from '@/lib/api';

/**
 * Card showing the notification delivery funnel (delivered / failed / pending).
 * Reads channel keys from `funnel.byChannel` and surfaces them as a hint when
 * more than one channel is in play (today: WhatsApp only — D-123; future: + DM).
 */
export function NotificationFunnelSection({
    funnel,
}: {
    funnel: EcommerceAnalyticsOverview['notifications']['funnel'];
}) {
    const t = useTranslations('ecommerceAnalytics');
    const total = funnel.total;
    const max = Math.max(total.delivered, total.failed, total.pending, 1);
    const channels = Object.keys(funnel.byChannel);
    const showChannelHint = channels.length > 1;

    return (
        <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-5 landscape:p-4">
            <h2 className="font-bold text-lg mb-4 text-start">{t('funnel.title')}</h2>
            <div className="space-y-3">
                <HorizontalBar
                    label={t('funnel.delivered')}
                    value={total.delivered}
                    max={max}
                    variant="success"
                    hint={showChannelHint ? channels.join(' · ') : undefined}
                />
                <HorizontalBar label={t('funnel.failed')} value={total.failed} max={max} variant="danger" />
                <HorizontalBar label={t('funnel.pending')} value={total.pending} max={max} variant="muted" />
            </div>
        </Card>
    );
}

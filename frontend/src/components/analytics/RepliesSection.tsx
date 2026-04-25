import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui';
import { HorizontalBar } from './HorizontalBar';
import type { EcommerceAnalyticsOverview } from '@/lib/api';

/**
 * Card showing reply activity broken down by method (AI vs Post Reply vs manual).
 * Drives the merchant's understanding of how much work the bot is doing
 * vs. their team — a key retention signal.
 */
export function RepliesSection({ replies }: { replies: EcommerceAnalyticsOverview['replies'] }) {
    const t = useTranslations('ecommerceAnalytics');
    const max = Math.max(replies.aiReplies, replies.postReplies, replies.manualReplies, 1);

    return (
        <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-5 landscape:p-4">
            <h2 className="font-bold text-lg mb-4 text-start">{t('replies.title')}</h2>
            <div className="space-y-3">
                <HorizontalBar label={t('replies.ai')} value={replies.aiReplies} max={max} variant="brand" />
                <HorizontalBar label={t('replies.postReply')} value={replies.postReplies} max={max} />
                <HorizontalBar label={t('replies.manual')} value={replies.manualReplies} max={max} variant="muted" />
            </div>
        </Card>
    );
}

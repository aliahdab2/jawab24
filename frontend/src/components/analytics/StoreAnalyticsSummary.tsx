import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ShoppingCart, Sparkles, ArrowRight } from 'lucide-react';

import { ecommerceAnalyticsApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';

/**
 * Compact 30-day analytics summary for the integrations page's `ConnectedStoreCard`.
 * Single network call, gracefully hides itself when the store has no data yet.
 *
 * The full dashboard lives at `/ecommerce-analytics`. This widget is the entry
 * point — clicking the link opens the full page with the same store selected.
 */
export function StoreAnalyticsSummary({ storeId }: { storeId: string }) {
    const t = useTranslations('ecommerceAnalytics');

    const { data, isError, isLoading } = useQuery({
        queryKey: ['ecommerce-analytics', storeId, '30d'],
        queryFn: async () => {
            const res = await ecommerceAnalyticsApi.getOverview(storeId, '30d');
            return res.data;
        },
        staleTime: 60_000,
        retry: false,
        meta: {
            onError: (err: unknown) =>
                captureError(err, 'Failed to load store analytics summary', {
                    tags: { component: 'StoreAnalyticsSummary' },
                }),
        },
    });

    // Hide while the first request is in flight — flashing numbers would be noisy.
    if (isLoading) return null;

    // On error, render a single "View analytics" link instead of vanishing.
    // The full page surfaces the actual error message; we just keep a path forward
    // so the merchant doesn't lose discoverability of the dashboard.
    if (isError) {
        return (
            <div className="flex items-center justify-end mt-3">
                <Link
                    href="/ecommerce-analytics"
                    className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                >
                    {t('summary.viewDetails')}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
            </div>
        );
    }

    const recovery = data?.recovery;
    const aiReplies = data?.replies.aiReplies ?? 0;
    const cartsRecovered = recovery?.cartsRecovered ?? 0;

    // Render only when there is something useful to show — empty stores stay quiet.
    if (cartsRecovered === 0 && aiReplies === 0) return null;

    const summaryLabel = recovery && cartsRecovered > 0
        ? recovery.revenueRecovered > 0
            ? t('summary.withRevenue', {
                count: cartsRecovered,
                amount: `${recovery.revenueRecovered.toLocaleString()}${recovery.currency ? ` ${recovery.currency}` : ''}`,
            })
            : t('summary.cartsRecovered', { count: cartsRecovered })
        : null;

    return (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-muted/40 mt-3">
            <div className="flex items-center gap-4 min-w-0 text-sm">
                {summaryLabel ? (
                    <span className="flex items-center gap-1.5 text-foreground/90 truncate">
                        <ShoppingCart className="w-4 h-4 text-icon-muted shrink-0" aria-hidden="true" />
                        <span className="truncate">{summaryLabel}</span>
                    </span>
                ) : null}
                {aiReplies > 0 ? (
                    <span className="flex items-center gap-1.5 text-foreground/90 shrink-0">
                        <Sparkles className="w-4 h-4 text-icon-muted" aria-hidden="true" />
                        <span className="tabular-nums">{aiReplies.toLocaleString()}</span>
                        <span className="text-muted-foreground">{t('replies.ai')}</span>
                    </span>
                ) : null}
            </div>
            <Link
                href="/ecommerce-analytics"
                className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 shrink-0"
            >
                {t('summary.viewDetails')}
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
        </div>
    );
}

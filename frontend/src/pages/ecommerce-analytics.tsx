import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, PageHeader, PageSkeleton, Button } from '@/components/ui';
import {
    AnalyticsKpiGrid,
    NotificationFunnelSection,
    NotificationsByTypeSection,
    RangeToggle,
    RepliesSection,
} from '@/components/analytics';
import {
    ecommerceAnalyticsApi,
    type EcommerceAnalyticsRange,
    type EcommerceAnalyticsOverview,
} from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useConnectedStore } from '@/hooks';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';

const RANGES: ReadonlyArray<EcommerceAnalyticsRange> = ['30d', '90d'];

const NoStoreState: React.FC<{ t: ReturnType<typeof useTranslations> }> = ({ t }) => (
    <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-8 text-center">
        <h2 className="font-bold text-lg mb-2">{t('noStore.title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('noStore.body')}</p>
        <Link href="/integrations">
            <Button variant="primary" size="md">
                {t('summary.viewDetails')}
                <ArrowRight className="w-4 h-4 ms-2" aria-hidden="true" />
            </Button>
        </Link>
    </Card>
);

const ErrorState: React.FC<{ message: string; onRetry: () => void; retryLabel: string }> = ({
    message,
    onRetry,
    retryLabel,
}) => (
    <Card className="border-none shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-status-danger mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-muted-foreground mb-4">{message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
        </Button>
    </Card>
);

const EMPTY_OVERVIEW: EcommerceAnalyticsOverview = {
    storeId: '',
    period: { from: '', to: '', range: '30d' },
    notifications: {
        funnel: { total: { sent: 0, delivered: 0, failed: 0, pending: 0 }, byChannel: {} },
        byType: {},
    },
    recovery: { abandonedCartsNotified: 0, cartsRecovered: 0, revenueRecovered: 0, currency: null },
    replies: { totalReplies: 0, aiReplies: 0, postReplies: 0, manualReplies: 0 },
};

const EcommerceAnalyticsPage: NextPageWithLayout = () => {
    const t = useTranslations('ecommerceAnalytics');
    const tErrors = useTranslations('errors');
    const { isAuthenticated } = useAuthStore();
    const { store, loading: loadingStore } = useConnectedStore(isAuthenticated);
    const [range, setRange] = useState<EcommerceAnalyticsRange>('30d');

    const storeId = store?.id;
    const overviewQuery = useQuery({
        queryKey: ['ecommerce-analytics', storeId, range],
        queryFn: async () => {
            if (!storeId) throw new Error('No store');
            const res = await ecommerceAnalyticsApi.getOverview(storeId, range);
            return res.data;
        },
        enabled: Boolean(storeId),
        staleTime: 60_000,
        retry: false,
        meta: {
            onError: (err: unknown) =>
                captureError(err, 'Failed to load ecommerce analytics', { tags: { page: 'ecommerce-analytics' } }),
        },
    });

    if (loadingStore) {
        return <PageSkeleton />;
    }

    if (!store) {
        return (
            <>
                <PageHeader title={t('title')} description={t('subtitle')} />
                <NoStoreState t={t} />
            </>
        );
    }

    const overview = overviewQuery.data ?? EMPTY_OVERVIEW;

    return (
        <>
            <PageHeader title={t('title')} description={t('subtitle')} />

            <div className="flex justify-end mb-4">
                <RangeToggle
                    options={RANGES.map((r) => ({ value: r, label: t(`ranges.${r}`) }))}
                    value={range}
                    onChange={setRange}
                    ariaLabel={t('title')}
                />
            </div>

            {overviewQuery.isError ? (
                <ErrorState
                    message={t('error')}
                    onRetry={() => overviewQuery.refetch()}
                    retryLabel={tErrors('tryAgain')}
                />
            ) : (
                <div className="space-y-6">
                    <AnalyticsKpiGrid overview={overview} />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <NotificationFunnelSection funnel={overview.notifications.funnel} />
                        <NotificationsByTypeSection byType={overview.notifications.byType} />
                    </div>

                    <RepliesSection replies={overview.replies} />
                </div>
            )}
        </>
    );
};

EcommerceAnalyticsPage.getLayout = (page: ReactElement) => (
    <DashboardLayout title="E-commerce Analytics">{page}</DashboardLayout>
);

export default EcommerceAnalyticsPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.ecommerceAnalytics]);

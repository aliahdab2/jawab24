import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, PageSkeleton } from '@/components/ui';
import { CatalogList } from '@/components/catalog/CatalogList';
import { useLanguage } from '@/i18n/hooks';
import { isRTLLocale } from '@/utils/locale';
import { catalogApi, pagesApi, type CatalogStatusFilter } from '@/lib/api';

function CatalogPage() {
    const router = useRouter();
    const { language } = useLanguage();
    const t = useTranslations('catalog');
    const tPages = useTranslations('pages');
    const isRTL = isRTLLocale(language);
    const pageId = typeof router.query.pageId === 'string' ? router.query.pageId : '';
    const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('active');

    // Fetch the parent page so we can show its name in the header.
    const pageQuery = useQuery({
        queryKey: ['page', pageId],
        queryFn: () => pagesApi.getById(pageId).then(r => r.data),
        enabled: !!pageId,
    });

    const catalogQuery = useQuery({
        queryKey: ['catalog', pageId, statusFilter],
        queryFn: () => catalogApi.list(pageId, { status: statusFilter }).then(r => r.data.data),
        enabled: !!pageId,
    });

    if (!pageId || pageQuery.isLoading) return <PageSkeleton />;
    if (pageQuery.isError) return <div className="p-6 text-error">{tPages('loadError')}</div>;

    const pageName = pageQuery.data?.name ?? '';
    const BackIcon = isRTL ? ArrowRight : ArrowLeft;

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
            <Link
                href="/pages"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
                <BackIcon className="w-4 h-4" aria-hidden="true" />
                {t('back')}
            </Link>

            <PageHeader
                title={`${t('title')} — ${pageName}`}
                description={t('description')}
                action={
                    <Button disabled aria-label={t('addItem')}>
                        <Plus className="w-4 h-4 me-1.5" aria-hidden="true" />
                        {t('addItem')}
                    </Button>
                }
            />

            {catalogQuery.isLoading ? (
                <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>
            ) : catalogQuery.isError ? (
                <div className="py-12 text-center text-error">{t('loadError')}</div>
            ) : (
                <CatalogList
                    items={catalogQuery.data ?? []}
                    statusFilter={statusFilter}
                    onStatusChange={setStatusFilter}
                />
            )}
        </div>
    );
}

CatalogPage.getLayout = (page: ReactElement) => (
    <DashboardLayout title="Catalog">{page}</DashboardLayout>
);

export default CatalogPage;

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.pagesCatalog]);

export async function getStaticPaths() {
    return { paths: [], fallback: 'blocking' };
}

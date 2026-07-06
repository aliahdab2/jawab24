import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, Select, Skeleton } from '@/components/ui';
import { CatalogManager } from '@/components/catalog/CatalogManager';
import { pagesApi } from '@/lib/api';
import { usePageFilter } from '@/hooks/usePageFilter';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import type { Page } from '@jawab24/shared';

function CatalogPageInner() {
  const t = useTranslations('catalog');
  const router = useRouter();

  const { data: pagesData, isLoading } = useQuery<Page[]>({
    queryKey: ['pages'],
    queryFn: () => pagesApi.getAll().then((r) => r.data),
  });
  const pages = useMemo(() => pagesData ?? [], [pagesData]);

  // Catalog applies to any connected page (not only auto-reply-enabled ones).
  const { pageId, updatePageId, validPages, syncFromUrl } = usePageFilter(pages, {
    storageKey: 'catalogPageId',
    validateAgainst: 'all',
  });

  useEffect(() => {
    if (!router.isReady) return;
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.page, syncFromUrl]);

  // Default to the first page once loaded.
  useEffect(() => {
    if (!pageId && validPages.length > 0) updatePageId(validPages[0].id);
  }, [validPages, pageId, updatePageId]);

  const selectedPageId = pageId && validPages.some((p) => p.id === pageId) ? pageId : '';

  return (
    <>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageSubtitle')}
        beside={
          validPages.length > 1 ? (
            <div className="min-w-[9rem] max-w-[14rem]">
              <Select
                value={selectedPageId}
                onChange={updatePageId}
                options={validPages.map((p) => ({ value: p.id, label: p.name }))}
                aria-label={t('selectPage')}
                placeholder={t('selectPage')}
                compact
              />
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-2 mt-4" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : validPages.length === 0 ? (
        <EmptyState icon={Tag} title={t('selectPage')} />
      ) : !selectedPageId ? (
        <EmptyState icon={Tag} title={t('selectPage')} />
      ) : (
        <div className="mt-4">
          <CatalogManager pageId={selectedPageId} />
        </div>
      )}
    </>
  );
}

export default function CatalogPage() {
  return (
    <DashboardLayout title="Products & Services">
      <CatalogPageInner />
    </DashboardLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.catalog]);

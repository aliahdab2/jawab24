import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, Select, Skeleton } from '@/components/ui';
import { CatalogManager } from '@/components/catalog/CatalogManager';
import { pagesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isCatalogVisible } from '@/lib/featureFlags';
import { consumeCatalogImportDraft } from '@/lib/catalogImportDraft';
import { usePageFilter } from '@/hooks/usePageFilter';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import type { Page } from '@jawab24/shared';

function CatalogPageInner() {
  const t = useTranslations('catalog');
  const router = useRouter();
  const { isAuthenticated, user, _hasHydrated } = useAuthStore();
  const canSee = isCatalogVisible(user);

  // Founder-only canary (mirrors the Stores page guard): deep links fail
  // closed — anyone outside the allowlist is bounced to the dashboard. Wait
  // for store hydration so we don't bounce the founder on first paint.
  useEffect(() => {
    if (!_hasHydrated) return;
    if (isAuthenticated && !canSee) {
      router.replace('/dashboard');
    }
  }, [_hasHydrated, isAuthenticated, canSee, router]);

  const { data: pagesData, isLoading } = useQuery<Page[]>({
    queryKey: ['pages'],
    queryFn: () => pagesApi.getAll().then((r) => r.data),
    enabled: canSee,
  });
  // Store-linked pages are excluded: their catalog comes from the store sync,
  // and the API rejects manual writes there (409 PAGE_HAS_STORE) because a
  // catalog write would orphan the page's RAG chunks. Not gated on auto-reply.
  const pages = useMemo(
    () => (pagesData ?? []).filter((p) => !p.ecommerceStoreId),
    [pagesData],
  );

  const { pageId, updatePageId, validPages, syncFromUrl } = usePageFilter(pages, {
    storageKey: 'catalogPageId',
    validateAgainst: 'all',
  });

  useEffect(() => {
    if (!router.isReady) return;
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.page, syncFromUrl]);

  // ?import=1 (Business Info price-list warning CTA): open the import sheet,
  // prefilled from the sessionStorage draft the CTA wrote (a 16k paste doesn't
  // fit in a query param). Consumed once + URL cleaned so refresh/back doesn't
  // re-open the sheet.
  const [importRequest, setImportRequest] = useState<{ pageId: string; text?: string } | null>(null);
  useEffect(() => {
    if (!router.isReady || router.query.import !== '1') return;
    const targetPage = router.query.page as string | undefined;
    if (!targetPage) return;
    setImportRequest({ pageId: targetPage, text: consumeCatalogImportDraft(targetPage) });
    router.replace(`/catalog?page=${targetPage}`, undefined, { shallow: true });
  }, [router, router.isReady, router.query.import, router.query.page]);

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
          <CatalogManager
            pageId={selectedPageId}
            importRequested={importRequest?.pageId === selectedPageId}
            importInitialText={importRequest?.pageId === selectedPageId ? importRequest.text : undefined}
          />
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

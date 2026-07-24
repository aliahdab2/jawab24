import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, ChevronDown } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, Select, Skeleton } from '@/components/ui';
import { CatalogManager } from '@/components/catalog/CatalogManager';
import { BusinessReadinessCard } from '@/components/business/BusinessReadinessCard';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import { KnowledgeBasePanel } from '@/components/knowledge-base/KnowledgeBasePanel';
import { pagesApi, catalogApi, type CatalogVerticalInfo } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isCatalogVisible } from '@/lib/featureFlags';
import { consumeCatalogImportDraft } from '@/lib/catalogImportDraft';
import { usePageFilter } from '@/hooks/usePageFilter';
import { useSaveKnowledgeBase } from '@/hooks/useSaveKnowledgeBase';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import type { Page, CatalogItem } from '@jawab24/shared';

const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => ({ default: m.TestSmartReplyModal })),
  { ssr: false },
);

/**
 * «نشاطك التجاري» — the unified business surface (B1): readiness summary →
 * products (catalog) → structured fact rows → the free-text Business Info
 * editor, one page per connected page. Replaces /catalog as the nav
 * destination; /catalog redirects here preserving its deep-link params.
 */
function BusinessPageInner() {
  const t = useTranslations('business');
  const tCatalog = useTranslations('catalog');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, user, _hasHydrated } = useAuthStore();
  const canSee = isCatalogVisible(user);

  // Platform-admin canary (same guard as /catalog): deep links fail closed —
  // anyone outside the allowlist is bounced to the dashboard. Wait for store
  // hydration so we don't bounce the founder on first paint.
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
  // and the API rejects manual writes there (409 PAGE_HAS_STORE).
  const pages = useMemo(
    () => (pagesData ?? []).filter((p) => !p.ecommerceStoreId),
    [pagesData],
  );

  const { pageId, updatePageId, validPages, syncFromUrl } = usePageFilter(pages, {
    // Shared with the legacy /catalog page so redirects land on the same page.
    storageKey: 'catalogPageId',
    validateAgainst: 'all',
  });

  useEffect(() => {
    if (!router.isReady) return;
    syncFromUrl(router.query.page as string | undefined);
  }, [router.isReady, router.query.page, syncFromUrl]);

  // ?import=1 (Business Info price-list warning CTA — also arrives via the
  // /catalog redirect): open the import sheet, prefilled from the
  // sessionStorage draft. Consumed once + URL cleaned so refresh/back doesn't
  // re-open the sheet.
  const [importRequest, setImportRequest] = useState<{ pageId: string; text?: string } | null>(null);
  useEffect(() => {
    if (!router.isReady || router.query.import !== '1') return;
    const targetPage = router.query.page as string | undefined;
    if (!targetPage) return;
    setImportRequest({ pageId: targetPage, text: consumeCatalogImportDraft(targetPage) });
    router.replace(`/business?page=${targetPage}`, undefined, { shallow: true });
  }, [router, router.isReady, router.query.import, router.query.page]);

  // Default to the first page once loaded.
  useEffect(() => {
    if (!pageId && validPages.length > 0) updatePageId(validPages[0].id);
  }, [validPages, pageId, updatePageId]);

  const selectedPageId = pageId && validPages.some((p) => p.id === pageId) ? pageId : '';
  const selectedPage = validPages.find((p) => p.id === selectedPageId);

  // Same queryKey as CatalogManager below — one fetch feeds both the readiness
  // chip count and the manager list.
  const { data: catalogData } = useQuery<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>({
    queryKey: ['catalog', selectedPageId],
    queryFn: () => catalogApi.list(selectedPageId).then((r) => r.data),
    enabled: !!selectedPageId,
  });
  const productsCount = selectedPageId ? catalogData?.data?.length : 0;

  // KB editor state (inline panel) — same shared save hook as /pages; the
  // pages query is invalidated so readiness chips/fact rows refresh on save.
  const { saveKnowledgeBase, saving, saved } = useSaveKnowledgeBase(
    () => { void queryClient.invalidateQueries({ queryKey: ['pages'] }); },
  );

  // «معلومات نشاطك التجاري» starts collapsed when structured data already
  // exists (facts first, free text second); expanded for a fresh page so the
  // merchant's first action is visible.
  const hasAnyKb = !!selectedPage?.knowledgeBase;
  const [infoOpen, setInfoOpen] = useState(!hasAnyKb);
  useEffect(() => { setInfoOpen(!selectedPage?.knowledgeBase); }, [selectedPage?.id, selectedPage?.knowledgeBase]);
  const infoSectionRef = useRef<HTMLDivElement>(null);
  const openAndScrollToInfo = () => {
    setInfoOpen(true);
    // After the collapse animation frame, bring the editor into view.
    requestAnimationFrame(() => infoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const [testReplyOpen, setTestReplyOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        beside={
          validPages.length > 1 ? (
            <div className="min-w-[9rem] max-w-[14rem]">
              <Select
                value={selectedPageId}
                onChange={updatePageId}
                options={validPages.map((p) => ({ value: p.id, label: p.name }))}
                aria-label={tCatalog('selectPage')}
                placeholder={tCatalog('selectPage')}
                compact
              />
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-3 mt-4" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-28 rounded-2xl" />
          {[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : validPages.length === 0 || !selectedPage ? (
        <EmptyState icon={Store} title={t('noPage')} />
      ) : (
        <div className="mt-4 space-y-4">
          {/* 1 — Readiness */}
          <BusinessReadinessCard
            page={selectedPage}
            productsCount={productsCount}
            onTryReply={() => setTestReplyOpen(true)}
          />

          {/* 2 — Products & services (catalog) */}
          <section aria-label={t('products.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('products.title')}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-3">{t('products.hint')}</p>
            <CatalogManager
              pageId={selectedPage.id}
              page={selectedPage}
              importRequested={importRequest?.pageId === selectedPage.id}
              importInitialText={importRequest?.pageId === selectedPage.id ? importRequest.text : undefined}
            />
          </section>

          {/* 3 — Structured facts */}
          <BusinessFactRows page={selectedPage} onAnswerMissing={openAndScrollToInfo} />

          {/* 4 — Free-text Business Info (collapsed once structured data exists) */}
          <section
            ref={infoSectionRef}
            aria-label={t('info.title')}
            className="rounded-2xl border border-theme-border bg-card overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              aria-expanded={infoOpen}
              className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-start"
            >
              <span>
                <span className="block text-base sm:text-lg font-semibold text-foreground">{t('info.title')}</span>
                <span className="block text-xs sm:text-sm text-muted-foreground mt-0.5">{t('info.hint')}</span>
              </span>
              <ChevronDown
                className={`w-5 h-5 text-icon-muted flex-shrink-0 transition-transform ${infoOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {infoOpen && (
              <div className="flex flex-col border-t border-theme-border">
                <KnowledgeBasePanel
                  page={selectedPage}
                  onSave={(text) => saveKnowledgeBase(selectedPage.id, text)}
                  saving={saving}
                  saved={saved}
                  bodyClassName="p-3 sm:p-5"
                  footerClassName="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 border-t border-theme-border bg-card"
                />
              </div>
            )}
          </section>
        </div>
      )}

      {testReplyOpen && selectedPage && (
        <TestSmartReplyModal page={selectedPage} onClose={() => setTestReplyOpen(false)} />
      )}
    </>
  );
}

export default function BusinessPage() {
  return (
    <DashboardLayout title="Your Business">
      <BusinessPageInner />
    </DashboardLayout>
  );
}

export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.business]);

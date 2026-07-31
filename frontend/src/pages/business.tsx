import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Store, ChevronDown } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, EmptyState, Select, Skeleton } from '@/components/ui';
import { CatalogManager } from '@/components/catalog/CatalogManager';
import { BusinessReadinessCard, type FixableChipKey } from '@/components/business/BusinessReadinessCard';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { BusinessFactSheet, type EditableFactKey } from '@/components/business/BusinessFactSheet';
import { BusinessHoursSheet } from '@/components/business/BusinessHoursSheet';
import { KnowledgeBasePanel } from '@/components/knowledge-base/KnowledgeBasePanel';
import { api, pagesApi, catalogApi, type CatalogVerticalInfo } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { unwrapBusinessProfile, type BusinessProfile } from '@jawab24/shared';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';
import { isCatalogVisible } from '@/lib/featureFlags';
import { consumeCatalogImportDraft } from '@/lib/catalogImportDraft';
import { isStorePolicyKey } from '@/utils/businessCoverage';
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
  const tPages = useTranslations('pages');
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
  // Store-linked pages are INCLUDED. The old exclusion was inherited from
  // /catalog, where it guarded manual catalog writes (409 PAGE_HAS_STORE) —
  // but that guard is catalog-only, and filtering here locked Salla/Zid/
  // Shopify merchants out of facts their store does NOT sync (hours, address,
  // phone, WhatsApp). The catalog section below branches on the store instead.
  const pages = useMemo(() => pagesData ?? [], [pagesData]);

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
    // A store-linked page has no manual import — its catalog is the store sync
    // and the API would 409. Clean the URL but don't open the sheet.
    if (!pagesData?.find((p) => p.id === targetPage)?.ecommerceStoreId) {
      setImportRequest({ pageId: targetPage, text: consumeCatalogImportDraft(targetPage) });
    }
    router.replace(`/business?page=${targetPage}`, undefined, { shallow: true });
  }, [router, router.isReady, router.query.import, router.query.page, pagesData]);

  // Default to the first page once loaded.
  useEffect(() => {
    if (!pageId && validPages.length > 0) updatePageId(validPages[0].id);
  }, [validPages, pageId, updatePageId]);

  const selectedPageId = pageId && validPages.some((p) => p.id === pageId) ? pageId : '';
  const selectedPage = validPages.find((p) => p.id === selectedPageId);

  // A store page's products live in the store sync, not the manual catalog —
  // don't fetch a list that is empty by construction.
  const hasStore = !!selectedPage?.ecommerceStoreId;

  // Same queryKey as CatalogManager below — one fetch feeds both the readiness
  // chip count and the manager list.
  const { data: catalogData } = useQuery<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>({
    queryKey: ['catalog', selectedPageId],
    queryFn: () => catalogApi.list(selectedPageId).then((r) => r.data),
    enabled: !!selectedPageId && !hasStore,
  });
  const productsCount = selectedPageId ? catalogData?.data?.length : 0;

  // KB editor state (inline panel) — same shared save hook as /pages; the
  // pages query is invalidated so readiness chips/fact rows refresh on save.
  const { saveKnowledgeBase, saving, saved } = useSaveKnowledgeBase(
    () => { void queryClient.invalidateQueries({ queryKey: ['pages'] }); },
  );

  // «معلومات إضافية» always starts collapsed: every fact now has its own
  // structured editor, so the free-text box is the overflow surface (FAQs,
  // one-off details) — not the place a merchant should land by default.
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => { setInfoOpen(false); }, [selectedPage?.id]);

  const [testReplyOpen, setTestReplyOpen] = useState(false);

  // ── Single-field fact editing (B1 part 2) ────────────────────────────────
  const [editingFact, setEditingFact] = useState<EditableFactKey | null>(null);
  const [editingHours, setEditingHours] = useState(false);
  const [savingFact, setSavingFact] = useState(false);

  /** Current confirmed value for a fact, as the sheet's single text field. */
  const factValue = (key: EditableFactKey): string => {
    const { merchant = {} } = unwrapBusinessProfile(selectedPage?.businessProfile);
    switch (key) {
      case 'address': return merchant.address ?? '';
      case 'phone': return (merchant.phones ?? []).filter((p) => p?.trim()).join(', ');
      case 'website': return merchant.website ?? '';
      case 'delivery': return merchant.policies?.shipping ?? '';
      case 'payment': return merchant.policies?.payment ?? '';
    }
  };

  /**
   * Persist one fact. `mutate` receives the existing CONFIRMED merchant half
   * and returns the full patch.
   *
   * ⚠️ applyMerchantEdit treats the PATCH as the merchant's FULL intent: every
   * tracked field absent from it becomes a "cleared" tombstone. So the patch
   * must always carry the whole merchant half with one field changed — a
   * partial `{ address }` body would wipe hours/phones/policies.
   */
  const saveProfile = async (
    mutate: (merchant: BusinessProfile) => BusinessProfile,
    onDone: () => void,
  ) => {
    if (!selectedPage) return;
    const { merchant = {} } = unwrapBusinessProfile(selectedPage.businessProfile);
    const patch = mutate({ ...merchant });

    setSavingFact(true);
    try {
      await api.put(`/pages/${selectedPage.id}`, { businessProfile: patch });
      // Refetch so the readiness chips + rows reflect the new confirmed value.
      await queryClient.invalidateQueries({ queryKey: ['pages'] });
      onDone();
      toast.success(tPages('savedStatus'));
    } catch (error) {
      captureError(error, 'Failed to save business fact', { tags: { action: 'save-business-fact' } });
      toast.error(tPages('saveFailed'));
    } finally {
      setSavingFact(false);
    }
  };

  const saveFact = (key: EditableFactKey, raw: string, whatsapp?: string) => {
    const value = raw.trim();
    return saveProfile((patch) => {
      switch (key) {
        case 'address': patch.address = value || undefined; break;
        case 'phone':
          patch.phones = value ? value.split(/[,،]/).map((p) => p.trim()).filter(Boolean) : undefined;
          // The WhatsApp mark rides with the numbers it belongs to. Spread the
          // existing container: `channels` also holds `preferred`.
          patch.channels = { ...patch.channels, whatsapp: whatsapp?.trim() || undefined };
          break;
        case 'website': patch.website = value || undefined; break;
        case 'delivery': patch.policies = { ...patch.policies, shipping: value || undefined }; break;
        case 'payment': patch.policies = { ...patch.policies, payment: value || undefined }; break;
      }
      return patch;
    }, () => setEditingFact(null));
  };

  const saveHours = (hours: Record<string, string[]> | undefined) =>
    saveProfile((patch) => { patch.hours = hours; return patch; }, () => setEditingHours(false));

  /** Readiness chip → the matching editor. */
  const handleFixChip = (key: FixableChipKey) => {
    if (key === 'hours') setEditingHours(true);
    else setEditingFact(key);
  };

  return (
    <>
      {/* A reading column, matching /settings' `max-w-4xl`. Unconstrained, this
          page inherits the shell's 1600px: measured at a 1728px viewport the
          cards ran 1312px wide, which put the subtitle at 109 characters per line
          (readable prose is 45–75) and left ~1200px between a fact row's label
          and its own Edit button — the eye had to cross the whole viewport to
          pair a field with its control. The cards are lists and prose, not a
          data grid; they do not benefit from the width. */}
      <div className="max-w-4xl mx-auto">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        beside={
          validPages.length > 1 ? (
            // Wider than the 14rem it used to cap at: «الفريق الدمشقي للتدريب
            // والتأهيل» truncated, and this control scopes the ENTIRE page, so a
            // half-read name is a wrong-page read on an account with 10 pages.
            <div className="min-w-[9rem] max-w-[14rem] sm:max-w-[20rem]">
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
        // Mobile reorders facts ABOVE products: with a 27-item catalog the fact
        // rows sat 4–6 screens down on a 390px viewport, burying the gaps that
        // actually make Jawab fail. Desktop keeps the approved mock order.
        // CSS order only — one DOM, never duplicated markup.
        <div className="mt-4 flex flex-col gap-4">
          {/* 1 — Readiness */}
          <div className="order-1">
            <BusinessReadinessCard
              page={selectedPage}
              productsCount={productsCount}
              onTryReply={() => setTestReplyOpen(true)}
              onFixChip={handleFixChip}
            />
          </div>

          {/* 2 — Products & services (catalog) */}
          <section
            aria-label={t('products.title')}
            className="order-3 md:order-2 rounded-2xl border border-theme-border bg-card p-4 sm:p-5"
          >
            <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('products.title')}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-3">{t('products.hint')}</p>
            {hasStore ? (
              // Store-linked page: products sync from Salla/Zid/Shopify and the
              // catalog API rejects manual writes (409 PAGE_HAS_STORE) — so no
              // import/add affordances, just the truth and where to manage it.
              <div className="flex items-center gap-3 rounded-xl bg-muted border border-theme-border p-4">
                <Store className="w-5 h-5 text-brand-600 flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('products.storeSynced')}</p>
                  <Link href="/integrations" className="text-sm text-brand-600 hover:underline underline-offset-2">
                    {t('products.manageStores')}
                  </Link>
                </div>
              </div>
            ) : (
              <CatalogManager
                pageId={selectedPage.id}
                page={selectedPage}
                importRequested={importRequest?.pageId === selectedPage.id}
                importInitialText={importRequest?.pageId === selectedPage.id ? importRequest.text : undefined}
              />
            )}
          </section>

          {/* 3 — Structured facts */}
          <div className="order-2 md:order-3">
            <BusinessFactRows
              page={selectedPage}
              onEditFact={setEditingFact}
              onEditHours={() => setEditingHours(true)}
            />
          </div>

          {/* 3b — Fact lists (G1b): renders ONLY when the page has collections
              (born from reviewed extraction) — that absence IS the rollout
              gate, so most pages see nothing here. Mobile keeps it beside the
              other structured data, above the big catalog block. */}
          <div className="order-2 md:order-3">
            <BusinessListsSection pageId={selectedPage.id} />
          </div>

          {/* 4 — Free-text Business Info (collapsed once structured data exists) */}
          <section

            aria-label={t('info.title')}
            className="order-4 rounded-2xl border border-theme-border bg-card overflow-hidden"
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
      </div>

      {/* Sheets and modals stay OUTSIDE the reading column — they are fixed /
          full-screen overlays and must not inherit its width. */}
      {testReplyOpen && selectedPage && (
        <TestSmartReplyModal page={selectedPage} onClose={() => setTestReplyOpen(false)} />
      )}

      {editingHours && selectedPage && (
        <BusinessHoursSheet
          initialHours={unwrapBusinessProfile(selectedPage.businessProfile).merchant?.hours}
          saving={savingFact}
          onSave={saveHours}
          onClose={() => setEditingHours(false)}
        />
      )}

      {editingFact && selectedPage && (
        <BusinessFactSheet
          factKey={editingFact}
          label={t(`facts.${editingFact}`)}
          initialValue={factValue(editingFact)}
          initialWhatsapp={unwrapBusinessProfile(selectedPage?.businessProfile).merchant?.channels?.whatsapp}
          // Not `hasStore`: the sheet's hint tells the merchant they need not answer,
          // so it may only appear when the store REALLY answers (active + synced
          // policies), never merely because a store id is on the page.
          // The field list comes from `STORE_POLICY_KEYS` (via isStorePolicyKey)
          // so adding a store-answerable policy row never leaves this hint behind.
          storeAnswered={!!selectedPage.storeAnswersPolicies && isStorePolicyKey(editingFact)}
          saving={savingFact}
          onSave={(value, whatsapp) => saveFact(editingFact, value, whatsapp)}
          onClose={() => setEditingFact(null)}
        />
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

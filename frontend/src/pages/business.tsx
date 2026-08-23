import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Store, ChevronDown } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button, PageHeader, EmptyState, Select, Skeleton, ViewOnlyBanner } from '@/components/ui';
import { CatalogManager } from '@/components/catalog/CatalogManager';
import { BusinessReadinessCard, type FixableChipKey } from '@/components/business/BusinessReadinessCard';
import { BusinessFactRows } from '@/components/business/BusinessFactRows';
import { BusinessListsSection } from '@/components/business/BusinessListsSection';
import { BusinessFactSheet, type EditableFactKey, type FactSavePayload } from '@/components/business/BusinessFactSheet';
import { BusinessHoursSheet } from '@/components/business/BusinessHoursSheet';
import { useCallback } from 'react';
import { KnowledgeBasePanel } from '@/components/knowledge-base/KnowledgeBasePanel';
import { api, pagesApi, catalogApi, factCollectionsApi, type CatalogVerticalInfo, type FactCollectionWithRows } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { todayISODate } from '@/utils/dateUtils';
import { KbCleanupSheet } from '@/components/catalog/KbCleanupSheet';
import {
  unwrapBusinessProfile, whatsappNumbers, businessPhoneEntries, businessPhoneList,
  normalizePhoneEntries, hasFieldLinesToClean, isRowLive,
  type BusinessProfile, type StoredBusinessProfile,
} from '@jawab24/shared';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';
import { consumeCatalogImportDraft } from '@/lib/catalogImportDraft';
import { computeFactCoverage, isStorePolicyKey, shouldShowProductsSection } from '@/utils/businessCoverage';
import { usePageFilter } from '@/hooks/usePageFilter';
import { useSaveKnowledgeBase } from '@/hooks/useSaveKnowledgeBase';
import { useWorkspaceRole } from '@/hooks';
import { usesChannelWording } from '@/lib/featureFlags';
import { authorizationOutcome, AUTHORIZATION_MESSAGE_KEY } from '@/utils/authorizationOutcome';
import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
import type { PageDetail, PageListItem, CatalogItem } from '@jawab24/shared';

const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => ({ default: m.TestSmartReplyModal })),
  { ssr: false },
);

/** Anchor for the readiness card's products chip (scrollIntoView target). */
const PRODUCTS_SECTION_ID = 'business-products-section';

/**
 * Which profile fields each single-field sheet actually reviews — sent as
 * `businessProfileConfirmFields` so the server confirms exactly what the
 * merchant had in front of them, and nothing that merely rode along in the
 * full-replace echo. Must mirror what `saveFact` writes per key.
 */
const CONFIRM_FIELDS: Record<EditableFactKey, ReadonlyArray<keyof BusinessProfile>> = {
  address: ['address'],
  phone: ['phones', 'channels'],
  website: ['website'],
  email: ['email'],
  delivery: ['policies'],
  payment: ['policies'],
};

/**
 * «نشاطك التجاري» — the unified business surface (B1): readiness summary →
 * products (catalog) → structured fact rows → the free-text Business Info
 * editor, one page per connected page. Replaces /catalog as the nav
 * destination; /catalog redirects here preserving its deep-link params.
 */
function BusinessPageInner() {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const tPages = useTranslations('pages');
  const tCatalog = useTranslations('catalog');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  // «صفحات» ⇄ «قنوات» — the same policy the sidebar item and /pages read, so
  // the button here can never send a merchant to a screen that calls its own
  // contents something else.
  const channelWording = usesChannelWording(!!user?.isAdmin);
  // Every write on this page — catalog items, fact rows, fact lists, and the
  // Business Info text — is `requireRole('admin')` server-side. One flag feeds
  // all four sections so the page can never end up half-gated: a banner saying
  // "view only" over sections that still look editable is worse than either
  // state on its own.
  const { canEdit } = useWorkspaceRole();

  const { data: pagesData, isLoading } = useQuery<PageListItem[]>({
    queryKey: ['pages'],
    queryFn: () => pagesApi.getAll().then((r) => r.data),
    enabled: isAuthenticated,
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
    // Connected pages only (owner ruling 2026-08-04): a disconnected page
    // receives no messages, so its business info answers nobody — showing it
    // here just clutters the selector with dead pages. It reappears the
    // moment it's reconnected on /pages.
    validateAgainst: 'connected',
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

  // Default to the first page once loaded — but never while a ?page= deep link
  // names a valid page. On a warm-cache client-side nav (the /pages funnel)
  // validPages are populated on the FIRST commit while `pageId` is still ''
  // (syncFromUrl's setState hasn't landed), so an unguarded default here
  // overwrote the deep-linked selection and rewrote the URL to the first page.
  // An absent or invalid param still falls through, so a stale link degrades
  // to the first page as before.
  useEffect(() => {
    if (!router.isReady) return;
    const urlPage = router.query.page as string | undefined;
    if (urlPage && validPages.some((p) => p.id === urlPage)) return;
    if (!pageId && validPages.length > 0) updatePageId(validPages[0].id);
  }, [router.isReady, router.query.page, validPages, pageId, updatePageId]);

  const selectedPageId = pageId && validPages.some((p) => p.id === pageId) ? pageId : '';
  const listPage = validPages.find((p) => p.id === selectedPageId);

  // The LIST endpoint no longer ships `knowledgeBase` / `businessProfile` (they
  // were 66% of its bytes and no list screen reads them — see serializeListPage
  // in backend controllers/pages.ts). This screen is the editor for exactly that
  // text, so it reads the single page, which still carries the full row.
  const {
    data: pageDetail,
    isError: pageDetailError,
    refetch: refetchPageDetail,
  } = useQuery<PageDetail>({
    queryKey: ['page', selectedPageId],
    queryFn: () => pagesApi.getById(selectedPageId).then((r) => r.data),
    enabled: isAuthenticated && !!selectedPageId,
  });
  // Prefer the detail row; fall back to the list entry so identity-only fields
  // (name, id, connection state) render immediately while the detail loads.
  //
  // ⛔ The fallback is for IDENTITY ONLY. Nothing that reads `businessProfile`
  // or the KB text — and above all nothing that WRITES them — may run against
  // the list row: `PUT /pages/:id { businessProfile }` is a FULL REPLACE
  // (applyMerchantEdit tombstones every tracked field absent from the patch),
  // so a save seeded from a row that merely lacks the field wipes every other
  // merchant-confirmed fact. Every such reader below therefore renders under
  // `pageDetail ? …`, which also NARROWS the type: those components take
  // `PageDetail`, which a `PageListItem` cannot satisfy, so the compiler — not
  // a convention — is what keeps the list row out of them.
  const selectedPage = pageDetail ?? listPage;

  // A store page's products live in the store sync, not the manual catalog —
  // don't fetch a list that is empty by construction.
  const hasStore = !!selectedPage?.ecommerceStoreId;

  // Same queryKey as CatalogManager below — one fetch feeds both the readiness
  // chip count and the manager list.
  const { data: catalogData, isError: catalogError } = useQuery<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>({
    queryKey: ['catalog', selectedPageId],
    queryFn: () => catalogApi.list(selectedPageId).then((r) => r.data),
    enabled: !!selectedPageId && !hasStore,
  });
  const productsCount = selectedPageId ? catalogData?.data?.length : 0;

  // Same queryKey as BusinessListsSection below — one fetch feeds both the
  // readiness products signal and the lists editor. Products can live in the
  // G1b lists instead of the catalog (BAMBO: 245 rows), and the readiness card
  // must never say «لا منتجات بعد» above them.
  const { data: factCollections } = useQuery<FactCollectionWithRows[]>({
    queryKey: ['fact-collections', selectedPageId],
    queryFn: () => factCollectionsApi.list(selectedPageId).then((r) => r.data.data),
    enabled: !!selectedPageId,
  });
  const factRowsCount = useMemo(() => {
    if (!selectedPageId) return 0;
    if (!factCollections) return undefined;
    const today = todayISODate();
    return factCollections.reduce((n, c) => n + c.rows.filter((r) => isRowLive(r, today)).length, 0);
  }, [selectedPageId, factCollections]);

  // One home for products (owner ruling 2026-08-05): when the lists carry them,
  // the catalog section — and its contradicting «أضف ما تبيعه» pitch — hides.
  // The rule and its carve-outs live in `shouldShowProductsSection`.
  const showProductsSection = shouldShowProductsSection({
    hasStore,
    catalogError,
    importRequested: importRequest?.pageId === selectedPageId,
    productsCount,
    factRowsCount,
  });

  /**
   * Refresh BOTH page queries after an edit on this screen.
   *
   * An edit here changes the list row (readiness chips, `kbFilled`) AND the
   * detail row (`knowledgeBase` / `businessProfile`, which only the single-page
   * read carries since the list stopped shipping them). Invalidating just
   * ['pages'] leaves the editor showing the pre-save text.
   */
  const invalidatePageQueries = useCallback(
    () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pages'] }),
      queryClient.invalidateQueries({ queryKey: ['page', selectedPageId] }),
    ]),
    [queryClient, selectedPageId],
  );

  // KB editor state (inline panel) — same shared save hook as /pages; both page
  // queries are invalidated so readiness chips/fact rows AND the editor text
  // refresh on save.
  const { saveKnowledgeBase, saving, saved } = useSaveKnowledgeBase(
    () => { void invalidatePageQueries(); },
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
  // Rendered INSIDE the open sheet: a failure toast would sit under the
  // sheet's z-50 overlay (toasts are capped at z-45 so they can never block a
  // modal footer again), so the sheet itself must carry the error.
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * C-F1 — the offer to remove Business Info lines that contradict a fact the
   * merchant just confirmed. Held as a SNAPSHOT (the KB text + the profile as
   * saved) rather than read from `selectedPage` at render time: the save
   * invalidates ['pages'], and a refetch landing while the sheet is open would
   * otherwise swap the text under the proposals the merchant is reviewing.
   */
  const [fieldCleanup, setFieldCleanup] = useState<{ kbText: string; profile: StoredBusinessProfile } | null>(null);
  useEffect(() => { setSaveError(null); }, [editingFact, editingHours]);

  /** Which facts currently carry an unconfirmed Facebook-synced value — the
   *  sheets label the prefill's origin and let an unchanged save count as the
   *  explicit confirmation. */
  const factSuggested = useMemo(
    () => (selectedPage ? computeFactCoverage(selectedPage).suggested : {}),
    [selectedPage],
  );
  /** Row key → suggested-value key ('phone' row reads the 'phones' field). */
  const hasFbSuggestion = (key: EditableFactKey): boolean =>
    key === 'phone' ? factSuggested.phones !== undefined : factSuggested[key] !== undefined;

  /** Current confirmed value for a fact, as the sheet's single text field. */
  const factValue = (key: EditableFactKey): string => {
    const { merchant = {} } = unwrapBusinessProfile(selectedPage?.businessProfile);
    switch (key) {
      case 'address': return merchant.address ?? '';
      // `phone` edits through `initialEntries` — a joined string cannot carry
      // per-number descriptions without inventing a separator a description
      // could itself contain.
      case 'phone': return '';
      case 'website': return merchant.website ?? '';
      case 'email': return merchant.email ?? '';
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
    confirmFields: ReadonlyArray<keyof BusinessProfile>,
  ) => {
    if (!selectedPage) return;
    // ⛔ HARD REFUSAL, not an optimisation. The body below is a FULL REPLACE of
    // the merchant container, so it must be seeded from the row that actually
    // carries `businessProfile` — the DETAIL read. Seeding it from the list row
    // (which no longer ships that field) would send a container holding only
    // the field just edited, and applyMerchantEdit would tombstone every other
    // merchant-confirmed fact. The UI gates these editors on `pageDetail`, so
    // this should be unreachable; it stays as the last line of defence, because
    // the failure it prevents is silent and irreversible.
    if (!pageDetail) return;
    const { merchant = {} } = unwrapBusinessProfile(pageDetail.businessProfile);
    const patch = mutate({ ...merchant });

    setSavingFact(true);
    setSaveError(null);
    try {
      // `businessProfileConfirmFields` names the field(s) whose sheet the
      // merchant actually had open — only those (plus genuinely changed
      // values) get provenance-confirmed server-side. The rest of the
      // full-replace echo keeps its provenance, so an fb_sync value can no
      // longer be laundered into "merchant-confirmed" by an unrelated save
      // (the MES «+971556087128» incident, 2026-08-08).
      await api.put(`/pages/${selectedPage.id}`, {
        businessProfile: patch,
        businessProfileConfirmFields: confirmFields,
      });
      // Refetch so the readiness chips + rows reflect the new confirmed value.
      await invalidatePageQueries();
      onDone();
      toast.success(tPages('savedStatus'));

      // C-F1 (#720): confirming a fact is exactly when to offer removing the
      // Business Info line that contradicts it. Until this existed the cleanup
      // was only reachable after a catalog import, so a merchant who never
      // imports kept answering customers from the stale line forever.
      //
      // The save is already committed and its toast has fired — this is a
      // strictly additive follow-up, so any failure here must not look like a
      // failed save. Nothing is removed without explicit confirmation (D-038);
      // field lines reach the sheet UNCHECKED.
      try {
        const kbText = selectedPage.knowledgeBase ?? '';
        // `patch` is the merchant half; wrap it as the container the unwrapper
        // expects. Reading a flat profile yields an empty `merchant` and the
        // feature silently never fires — the bug the 07-23 browser pass caught.
        const profile: StoredBusinessProfile = { merchant: patch };
        if (hasFieldLinesToClean(kbText, profile)) {
          setFieldCleanup({ kbText, profile });
        }
      } catch (error) {
        captureError(error, 'KB field-cleanup offer detection failed', {
          tags: { action: 'kb-cleanup-offer' },
          extra: { pageId: selectedPage.id },
        });
      }
    } catch (error) {
      // A refused write is an authorization OUTCOME, not a defect — same
      // shared verdict the Business Info save and the fact lists use, so no
      // Sentry event and a message that says who can do it. Reachable even
      // with the gate above: a member demoted mid-session still holds an open
      // sheet, and the persisted role is a snapshot.
      const outcome = authorizationOutcome(error);
      if (outcome) {
        setSaveError(tc(AUTHORIZATION_MESSAGE_KEY[outcome]));
      } else {
        captureError(error, 'Failed to save business fact', { tags: { action: 'save-business-fact' } });
        setSaveError(tPages('saveFailed'));
      }
    } finally {
      setSavingFact(false);
    }
  };

  const saveFact = (key: EditableFactKey, payload: FactSavePayload) => {
    return saveProfile((patch) => {
      if (payload.kind === 'phones') {
        // A stored WhatsApp mark on a number NOT among the listed phones
        // (legacy/imported data) is invisible to the sheet — carry it
        // through the save instead of silently dropping it. Compare against
        // the NUMBERS: an entry object would never match a stored mark.
        const prevPhones = businessPhoneList(patch);
        const orphans = whatsappNumbers(patch).filter((n) => !prevPhones.includes(n));
        // Canonicalized here as well as server-side: the patch is compared
        // against the stored value to decide whether `phones` changed, and a
        // non-canonical echo would stamp merchant provenance on a field the
        // merchant never touched (see businessPhone.ts).
        const entries = normalizePhoneEntries(payload.entries);
        patch.phones = entries.length ? entries : undefined;
        // The WhatsApp marks ride with the numbers they belong to — any
        // subset of the listed numbers (stored as an array; legacy rows may
        // still hold a single string, normalized on read by
        // `whatsappNumbers`). Spread the existing container: `channels`
        // also holds `preferred`.
        const marked = [...orphans, ...payload.whatsapp];
        patch.channels = { ...patch.channels, whatsapp: marked.length ? marked : undefined };
        return patch;
      }

      const value = payload.value.trim();
      switch (key) {
        case 'address': patch.address = value || undefined; break;
        case 'website': patch.website = value || undefined; break;
        case 'email': patch.email = value || undefined; break;
        case 'delivery': patch.policies = { ...patch.policies, shipping: value || undefined }; break;
        case 'payment': patch.policies = { ...patch.policies, payment: value || undefined }; break;
        case 'phone': break; // handled above
      }
      return patch;
    }, () => setEditingFact(null), CONFIRM_FIELDS[key]);
  };

  const saveHours = (hours: Record<string, string[]> | undefined) =>
    saveProfile((patch) => { patch.hours = hours; return patch; }, () => setEditingHours(false), ['hours']);

  /** Readiness chip → the matching editor. `products` scrolls to the catalog
   *  section instead: it has no single-field sheet, and whenever its chip is
   *  amber the section is guaranteed rendered (an uncovered products area
   *  means no store, no list rows and an empty catalog — exactly the case
   *  `shouldShowProductsSection` keeps visible). */
  const handleFixChip = (key: FixableChipKey) => {
    if (key === 'hours') setEditingHours(true);
    else if (key === 'products') document.getElementById(PRODUCTS_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        // Absence needs a reason: «connect a page» is wrong advice for a
        // merchant whose pages exist but all lost their connection — say
        // that, and point at the one place that fixes it (/pages).
        pages.length > 0 ? (
          <EmptyState
            icon={Store}
            title={t(channelWording ? 'noConnectedPageChannels' : 'noConnectedPage')}
            description={t(channelWording ? 'noConnectedPageHintChannels' : 'noConnectedPageHint')}
            action={
              <Link href="/pages">
                <Button variant="primary">{t(channelWording ? 'goToChannels' : 'goToPages')}</Button>
              </Link>
            }
          />
        ) : (
          // Instruction WITH its affordance: «اربط صفحة…» with no button was a
          // dead end — the one page that fixes it is /pages, same as the
          // lost-connection state above.
          <EmptyState
            icon={Store}
            title={t(channelWording ? 'noPageChannels' : 'noPage')}
            action={
              <Link href="/pages">
                <Button variant="primary">{t(channelWording ? 'goToChannels' : 'goToPages')}</Button>
              </Link>
            }
          />
        )
      ) : (
        // Mobile reorders facts ABOVE products: with a 27-item catalog the fact
        // rows sat 4–6 screens down on a 390px viewport, burying the gaps that
        // actually make Jawab fail. Desktop keeps the approved mock order.
        // CSS order only — one DOM, never duplicated markup.
        <div className="mt-4 flex flex-col gap-4">
          {/* One banner for the WHOLE page — every section below it is view-only
              for a member, so the answer to "why can't I change this?" is given
              once, at the top, instead of per section. */}
          {/* order-first, not order-0: Tailwind v3 ships no `order-0` utility,
              so that class would be dead CSS and the banner would only land
              first by DOM luck. */}
          {!canEdit && <ViewOnlyBanner className="order-first" />}

          {/* The detail read carries `businessProfile`; the list row does not.
              Everything below that reads or writes it therefore waits for the
              detail — a facts screen rendered from the list row would report
              every fact as missing and invite the merchant to "fix" rows whose
              save is a full replace. Failing loudly here beats a screen that
              quietly lies about what the merchant has already told us. */}
          {pageDetailError && (
            <div className="order-first rounded-2xl border border-theme-border bg-card p-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t('detail.loadFailed')}</p>
              <Button variant="secondary" size="sm" onClick={() => void refetchPageDetail()}>
                {tc('tryAgain')}
              </Button>
            </div>
          )}

          {/* 1 — Readiness */}
          <div className="order-1">
            {pageDetail ? (
              <BusinessReadinessCard
                page={pageDetail}
                productsCount={productsCount}
                factRowsCount={factRowsCount}
                onTryReply={() => setTestReplyOpen(true)}
                onFixChip={canEdit ? handleFixChip : undefined}
              />
            ) : (
              <Skeleton className="h-32 rounded-2xl" />
            )}
          </div>

          {/* 2 — Products & services (catalog) */}
          {showProductsSection && (
          <section
            id={PRODUCTS_SECTION_ID}
            aria-label={t('products.title')}
            className="order-3 md:order-2 rounded-2xl border border-theme-border bg-card p-4 sm:p-5"
          >
            {/* «اضغط على السعر لتعديله» is an instruction about rendered prices —
                over an empty catalog (or a store box with no tappable prices) it
                contradicts what's on screen, so it earns its place only when
                price rows actually render below it. */}
            <h2 className={`text-base sm:text-lg font-semibold text-foreground ${!hasStore && (productsCount ?? 0) > 0 ? '' : 'mb-3'}`}>{t('products.title')}</h2>
            {!hasStore && (productsCount ?? 0) > 0 && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-3">{t('products.hint')}</p>
            )}
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
                // `pageDetail`, not `selectedPage`: this prop exists only to
                // offer the post-import Business-Info cleanup, which needs the
                // KB text the list row does not carry. Passing the list row
                // would make the offer silently never fire; passing undefined
                // makes the dependency explicit and the catalog itself still
                // renders (it keys off pageId).
                page={pageDetail}
                importRequested={importRequest?.pageId === selectedPage.id}
                importInitialText={importRequest?.pageId === selectedPage.id ? importRequest.text : undefined}
                readOnly={!canEdit}
              />
            )}
          </section>
          )}

          {/* 3 — Structured facts. Gated on the detail read: these rows are the
              entry point to `saveProfile`, which full-replaces the merchant
              container, so they must never render from a row that lacks it. */}
          <div className="order-2 md:order-3">
            {pageDetail ? (
              <BusinessFactRows
                page={pageDetail}
                onEditFact={setEditingFact}
                onEditHours={() => setEditingHours(true)}
                readOnly={!canEdit}
              />
            ) : (
              <Skeleton className="h-64 rounded-2xl" />
            )}
          </div>

          {/* 3b — Fact lists (G1b): pages with collections render them; a page
              without any shows an ADMIN the «add list» empty state (creation
              UI, slice 4) while a plain member sees nothing. Mobile keeps it
              beside the other structured data, above the big catalog block. */}
          <div className="order-2 md:order-3">
            <BusinessListsSection pageId={selectedPage.id} readOnly={!canEdit} />
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
                {/* The business-info TEXT comes from the single-page read, not the
                    list. Never render the editor before it arrives: an empty
                    textarea over a page that HAS text reads as the merchant's
                    info having vanished — the exact failure this screen must not
                    show, least of all on the slow connections we're optimising
                    for. In practice the section starts collapsed, so the detail
                    has normally resolved long before this renders. */}
                {pageDetail ? (
                  <KnowledgeBasePanel
                    page={pageDetail}
                    onSave={(text) => saveKnowledgeBase(pageDetail.id, text)}
                    saving={saving}
                    saved={saved}
                    bodyClassName="p-3 sm:p-5"
                    footerClassName="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 border-t border-theme-border bg-card"
                  />
                ) : (
                  <div className="p-3 sm:p-5" aria-busy="true">
                    <Skeleton className="h-40 rounded-xl" />
                  </div>
                )}
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
          fbSuggested={factSuggested.hours !== undefined}
          saving={savingFact}
          saveError={saveError}
          onSave={saveHours}
          onClose={() => setEditingHours(false)}
        />
      )}

      {editingFact && selectedPage && (
        <BusinessFactSheet
          factKey={editingFact}
          label={t(`facts.${editingFact}`)}
          initialValue={factValue(editingFact)}
          initialEntries={businessPhoneEntries(unwrapBusinessProfile(selectedPage?.businessProfile).merchant ?? {})}
          initialWhatsapp={unwrapBusinessProfile(selectedPage?.businessProfile).merchant?.channels?.whatsapp}
          // Not `hasStore`: the sheet's hint tells the merchant they need not answer,
          // so it may only appear when the store REALLY answers (active + synced
          // policies), never merely because a store id is on the page.
          // The field list comes from `STORE_POLICY_KEYS` (via isStorePolicyKey)
          // so adding a store-answerable policy row never leaves this hint behind.
          storeAnswered={!!selectedPage.storeAnswersPolicies && isStorePolicyKey(editingFact)}
          fbSuggested={hasFbSuggestion(editingFact)}
          saving={savingFact}
          saveError={saveError}
          onSave={(payload) => saveFact(editingFact, payload)}
          onClose={() => setEditingFact(null)}
        />
      )}

      {/* C-F1 (#720). `items={[]}`: this pass is about FIELD lines only — the
          product matcher has nothing to match and returns [] immediately. */}
      {fieldCleanup && selectedPage && (
        <KbCleanupSheet
          pageId={selectedPage.id}
          kbText={fieldCleanup.kbText}
          items={[]}
          profile={fieldCleanup.profile}
          onClose={() => setFieldCleanup(null)}
          onDone={(removed) => {
            setFieldCleanup(null);
            // The KB text changed on the server — refetch so the Business Info
            // editor below does not keep showing the line that was just removed.
            // Must include the DETAIL query: the text lives there now, not on the
            // list row.
            void invalidatePageQueries();
            if (removed > 0) toast.success(tCatalog('cleanup.toastDone', { count: removed }));
          }}
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

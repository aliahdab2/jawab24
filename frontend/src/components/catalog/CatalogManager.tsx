import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardPaste, Plus, ScanSearch, Tag } from 'lucide-react';
import { postsScanBlockerForPage } from '@/utils/page';
import { AxiosError } from 'axios';
import { Button, EmptyState, Select, Skeleton, ConfirmationModal } from '@/components/ui';
import { catalogApi, type CatalogItemInput, type CatalogVerticalInfo } from '@/lib/api';
import {
  CATALOG_VERTICALS, CATALOG_VERTICAL_DEFAULT_TYPE, MAX_CATALOG_ITEMS_PER_PAGE,
  matchCatalogLinesInKb, hasFieldLinesToClean,
  type CatalogItem, type CatalogVertical, type PageDetail, type PostsScanBlocker,
} from '@jawab24/shared';
import { captureError } from '@/lib/sentryHelpers';
import { CatalogItemRow } from './CatalogItemRow';
import { CatalogItemFormSheet } from './CatalogItemFormSheet';
import { CatalogImportSheet } from './CatalogImportSheet';
import { KbCleanupSheet } from './KbCleanupSheet';

const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => ({ default: m.TestSmartReplyModal })),
  { ssr: false },
);

/** Why the posts scan is unavailable → the line shown in its place. Flat keys:
 *  the translation validator caps nesting at two levels. */
const SCAN_BLOCKER_KEY: Record<PostsScanBlocker, string> = {
  noFacebook: 'scan.unavailableNoFacebook',
  disconnected: 'scan.unavailableDisconnected',
};

interface CatalogManagerProps {
  pageId: string;
  /** Full page object — enables the post-save "try it" moment (opens the Test
   *  Smart Reply modal). Optional: hosts without it just skip the nudge. */
  page?: PageDetail;
  /** Open the import sheet on mount (deep link from the Business Info warning). */
  importRequested?: boolean;
  /** Pre-fill for the import paste box when importRequested is set. */
  importInitialText?: string;
  /**
   * View-only (workspace `member`). Every catalog write — create, update,
   * delete, batch import, posts scan, vertical — is `requireRole('admin')`
   * server-side (`routes/catalog.ts`), so a member gets the list and none of
   * the affordances. Without this the whole section was a type-then-403 dead
   * end sitting directly above the Business Info panel's "view only" banner.
   */
  readOnly?: boolean;
}

/** The catalog editor for one page. Host-agnostic (takes pageId via props) so it
 *  can live on the dedicated /catalog page or inside the Business Info modal. */
export function CatalogManager({ pageId, page, importRequested, importInitialText, readOnly = false }: CatalogManagerProps) {
  const t = useTranslations('catalog');
  const queryClient = useQueryClient();
  const queryKey = ['catalog', pageId];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  /** Which entry to the review flow is open: paste/upload import or the page
   *  scan (posts + configured Post Replies, D-059). */
  const [sheetMode, setSheetMode] = useState<'paste' | 'scan' | null>(null);
  /** Prefilled question for the post-save "try it" moment (null = modal closed). */
  const [tryItQuestion, setTryItQuestion] = useState<string | null>(null);
  /** Phase C: fresh items to offer KB cleanup against (null = sheet closed). */
  const [cleanupItems, setCleanupItems] = useState<CatalogItem[] | null>(null);
  /** How many items the import that opened the cleanup sheet actually CREATED —
   *  cleanupItems holds the whole fresh catalog (the matcher needs it), so its
   *  length is the wrong number for the "N added" fallback toast. */
  const [cleanupImportCount, setCleanupImportCount] = useState(0);

  const { data: listData, isLoading, isError } = useQuery<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>({
    queryKey,
    queryFn: () => catalogApi.list(pageId).then((r) => r.data),
    enabled: !!pageId,
  });

  // Deep-link entry: open the import sheet once when the page asks for it —
  // after the catalog list resolves, so the sheet's reconcile step never
  // classifies against a still-loading (empty) catalog (#492 review).
  // Never for a member: `?import=1` is a URL, so it is reachable by anyone who
  // was sent the link, and the sheet's every write would 403.
  useEffect(() => {
    if (importRequested && !isLoading && !readOnly) setSheetMode('paste');
  }, [importRequested, isLoading, readOnly]);
  const items = useMemo(() => listData?.data ?? [], [listData]);
  const vertical = listData?.vertical;
  // Fresh items default to the vertical's natural type (dealer → vehicle,
  // institute → course); the type chips in the form stay switchable.
  const defaultType = CATALOG_VERTICAL_DEFAULT_TYPE[vertical?.effective ?? 'other'];

  // Pre-fill currency on a fresh item from the most recent one on this page.
  const lastCurrency = useMemo(
    () => items.find((i) => i.currency)?.currency ?? undefined,
    [items],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    // Readiness (needsBusinessInfo / setup checklist) keys off the page payload's
    // catalogItemsCount, so refresh pages too once the count could have changed.
    queryClient.invalidateQueries({ queryKey: ['pages'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: CatalogItemInput) => catalogApi.create(pageId, data).then((r) => r.data),
    onSuccess: () => { invalidate(); toast.success(t('toast.created')); },
    onError: (err: AxiosError<{ code?: string }>) => {
      if (err.response?.status === 403 && err.response.data?.code === 'CATALOG_LIMIT_REACHED') {
        toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
      } else {
        toast.error(t('toast.saveError'));
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Partial<CatalogItemInput> & { sortOrder?: number } }) =>
      catalogApi.update(pageId, itemId, data).then((r) => r.data),
    onSuccess: () => invalidate(),
    onError: () => toast.error(t('toast.saveError')),
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => catalogApi.remove(pageId, itemId),
    onSuccess: () => { invalidate(); toast.success(t('toast.deleted')); },
    onError: () => toast.error(t('toast.deleteError')),
  });

  const verticalMutation = useMutation({
    mutationFn: (v: CatalogVertical) => catalogApi.setVertical(pageId, v).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: () => toast.error(t('toast.saveError')),
  });

  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  /** Resolves true on success so the form sheet only clears its fields once the
   *  server confirmed (M5, PR #407) — a failed batch-add must not eat the
   *  merchant's typed item. Error toasts come from the mutations' onError. */
  const handleSave = async (data: CatalogItemInput, addAnother: boolean): Promise<boolean> => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ itemId: editing.id, data });
        toast.success(t('toast.updated'));
        setFormOpen(false);
        setEditing(null);
      } else {
        await createMutation.mutateAsync(data);
        if (!addAnother) setFormOpen(false);
      }
      return true;
    } catch {
      return false;
    }
  };

  /** One-tap availability flip from the row (dealer marks a car sold). */
  const handleToggleAvailability = (item: CatalogItem, enabled: boolean) => {
    updateMutation.mutate({ itemId: item.id, data: { isAvailable: enabled } });
  };

  /** Inline price save from the row. '' clears back to "price on request".
   *  A price typed onto a currency-less item inherits the page's last-used
   *  currency — a bare number would otherwise render ambiguous to the AI. */
  const handleSavePrice = (item: CatalogItem, price: string) => {
    const data: Partial<CatalogItemInput> = { price: price === '' ? null : price };
    if (price !== '' && !item.currency && lastCurrency) data.currency = lastCurrency;
    updateMutation.mutate({ itemId: item.id, data });
  };

  // TODO(M6, PR #407): fold reorder into ONE backend operation (single PATCH
  // with both ids or a positions array) — two independent PATCHes are not
  // atomic and cost two cache bumps. Deferred from review; acceptable for the
  // founder-only canary, must land before GA.
  const handleMove = (item: CatalogItem, direction: 'up' | 'down') => {
    const idx = items.findIndex((i) => i.id === item.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const other = items[swapIdx];
    // Swap the two rows' sortOrder. Two independent PATCHes; the list re-sorts on refetch.
    updateMutation.mutate({ itemId: item.id, data: { sortOrder: other.sortOrder } });
    updateMutation.mutate({ itemId: other.id, data: { sortOrder: item.sortOrder } });
  };

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (item: CatalogItem) => { setEditing(item); setFormOpen(true); };

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Tag}
        title={t('toast.loadError')}
        action={<Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey })}>{t('actions.retry')}</Button>}
      />
    );
  }

  // The vertical picker is hidden when Facebook already told us the business
  // type — a derived vertical is applied silently; for the merchant even a
  // prefilled dropdown is one more control to parse, and a wrong default costs
  // nothing (the type chips in the form fix it). It shows when we're guessing
  // ('default') and stays for merchants who have used it ('merchant').
  const verticalControl = !readOnly && vertical && vertical.source !== 'facebook' && (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground whitespace-nowrap">{t('vertical.label')}</span>
      <Select
        compact
        aria-label={t('vertical.label')}
        value={vertical.effective}
        onChange={(v) => verticalMutation.mutate(v as CatalogVertical)}
        disabled={verticalMutation.isPending}
        options={CATALOG_VERTICALS.map((v) => ({ value: v, label: t(`verticalOptions.${v}`) }))}
      />
    </div>
  );

  // Don't offer an import path that cannot work on this page. The gate reads
  // data the pages query already carries, so the dead end is closed before the
  // click rather than explained after it (the scan answered 409 PAGE_DISCONNECTED
  // on every WhatsApp-only or token-less page, surfaced as "please try again").
  // A host that passes no `page` keeps the unguarded behaviour — we can't prove
  // the action is impossible without it.
  //
  // Posts unreadable ≠ nothing to scan (D-059): the page scan also reads the
  // merchant's configured Post Replies from our own DB, so a blocked page that
  // HAS them still scans (replies-only — the sheet explains the degradation).
  // Only a blocked page with no Post Reply either is a true dead end.
  const scanBlocker: PostsScanBlocker | null = page ? postsScanBlockerForPage(page) : null;
  const canScanPosts = scanBlocker === null;
  const canScan = canScanPosts || page?.hasPostReplyTrigger === true;

  /**
   * The reason, NAMING the page it applies to. Built once and reused by every
   * place that shows it (empty state, the toolbar's disabled-button tooltip, the
   * toolbar line) so they cannot drift apart.
   *
   * The name is not decoration: /business shows one page at a time behind a
   * selector that sits several rows above this text, and «أعد ربط هذه الصفحة»
   * gave a merchant with 10 pages — 8 of them blocked for two different reasons —
   * no way to tell WHICH page to reconnect. Reported from prod 2026-07-27.
   */
  const scanBlockedReason = scanBlocker !== null && page
    ? t(SCAN_BLOCKER_KEY[scanBlocker], { page: page.name })
    : null;

  return (
    <div>
      {items.length === 0 && readOnly ? (
        // A member cannot paste, scan or add — so the pitch for those paths is
        // noise. State the fact and stop.
        <p className="text-sm text-muted-foreground">{t('empty.viewOnly')}</p>
      ) : items.length === 0 ? (
        <div>
          {/* Compact empty state: one line of mental model + ONE primary action.
              The big dashed hero («أضف ما تبيعه» + a scan pitch) is gone — the
              owner ruled the section «اخدة مكان كبير» and the posts scan
              «مو كتير ناجح» (2026-08-05): merchants keep prices OUT of posts
              (comment-bait), so the scan proposes name-only items while a
              pasted price list comes back complete — 56/56 priced rows in the
              الدمشقي replay. Paste leads; the scan survives as a footnote. */}
          <p className="text-sm text-muted-foreground mb-3">{t('empty.body')}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="primary" onClick={() => setSheetMode('paste')}>
              <ClipboardPaste className="w-4 h-4 me-1.5" aria-hidden="true" />
              {t('import.cta')}
            </Button>
            <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
              <span>{t('empty.or')}</span>
              {canScan && (
                <>
                  <button type="button" onClick={() => setSheetMode('scan')} className="underline underline-offset-2 hover:text-foreground transition-colors">
                    {t('scan.cta')}
                  </button>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <button type="button" onClick={openAdd} className="underline underline-offset-2 hover:text-foreground transition-colors">
                {t('empty.cta')}
              </button>
            </div>
          </div>
          {/* Absence needs a reason, or the merchant reads it as a missing
              feature. Names the page and the one thing that would unlock it. */}
          {scanBlockedReason && (
            <p className="text-xs text-muted-foreground mt-3">{scanBlockedReason}</p>
          )}
          {verticalControl && <div className="mt-4">{verticalControl}</div>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('limitLabel', { count: items.length, max: MAX_CATALOG_ITEMS_PER_PAGE })}
              </span>
              {verticalControl}
            </div>
            {/* Every button here is a write. Removed for a member rather than
                disabled: "disabled with a reason" is the right shape when the
                action is temporarily blocked (reconnect the page and it works);
                a role they do not have is not a reason they can act on, and the
                banner above the section already explains it. */}
            {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {/* Blocked → DISABLED with the reason, never removed. A button that
                  silently disappears reads as "the feature was deleted" (owner
                  report, 2026-07-27); a disabled one keeps it discoverable and
                  says what would unlock it. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSheetMode('scan')}
                disabled={!canScan || items.length >= MAX_CATALOG_ITEMS_PER_PAGE}
                title={!canScan ? scanBlockedReason ?? undefined : undefined}
              >
                <ScanSearch className="w-4 h-4 me-1.5" aria-hidden="true" />
                {t('scan.cta')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSheetMode('paste')} disabled={items.length >= MAX_CATALOG_ITEMS_PER_PAGE}>
                <ClipboardPaste className="w-4 h-4 me-1.5" aria-hidden="true" />
                {t('import.cta')}
              </Button>
              <Button variant="primary" size="sm" onClick={openAdd} disabled={items.length >= MAX_CATALOG_ITEMS_PER_PAGE}>
                <Plus className="w-4 h-4 me-1.5" aria-hidden="true" />
                {t('add')}
              </Button>
            </div>
            )}
          </div>
          {/* The toolbar's disabled scan button needs its reason VISIBLE — a title
              attribute alone is invisible on touch, where most merchants are.
              With no scan button there is no reason to explain. */}
          {!readOnly && scanBlockedReason && (
            <p className="text-xs text-muted-foreground mb-3">{scanBlockedReason}</p>
          )}
          <ul className="space-y-2">
            {items.map((item, i) => (
              <CatalogItemRow
                key={item.id}
                item={item}
                isFirst={i === 0}
                isLast={i === items.length - 1}
                disabled={busy}
                onEdit={openEdit}
                onDelete={setDeleting}
                onMove={handleMove}
                onToggleAvailability={handleToggleAvailability}
                onSavePrice={handleSavePrice}
                readOnly={readOnly}
              />
            ))}
          </ul>
        </>
      )}

      {formOpen && (
        <CatalogItemFormSheet
          key={editing?.id ?? 'new'}
          item={editing}
          defaultCurrency={lastCurrency}
          defaultType={defaultType}
          vertical={vertical?.effective}
          saving={createMutation.isPending || updateMutation.isPending}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}

      {sheetMode !== null && (
        <CatalogImportSheet
          key={sheetMode}
          pageId={pageId}
          mode={sheetMode}
          existingItems={items}
          vertical={vertical?.effective}
          defaultCurrency={lastCurrency}
          initialText={importRequested ? importInitialText : undefined}
          onDone={async (count, firstItemName, updatedCount) => {
            invalidate();
            setSheetMode(null);

            // Confirmed price updates are already committed (PATCHes ran before
            // the batch) — acknowledge them even when the cleanup sheet takes
            // over the rest of the flow below.
            if (updatedCount) toast.success(t('reconcile.toastUpdated', { count: updatedCount }));

            // Phase C: if the imported products still have their old free-text
            // lines in Business Info (or a structured field is duplicated in the
            // narrative — bug #720), offer to remove them. Fetch fresh items so
            // the just-imported ones are matched. Non-blocking; failure falls
            // through to the normal success toast.
            const kb = page?.knowledgeBase?.trim();
            if (kb) {
              try {
                // Reuse the react-query cache (invalidate() above triggered a
                // refetch) instead of a second parallel GET — fetchQuery dedupes
                // the in-flight request and populates the cache once.
                const fresh = (await queryClient.fetchQuery({ queryKey, queryFn: () => catalogApi.list(pageId).then((r) => r.data) }))?.data ?? [];
                const hasProductLines = matchCatalogLinesInKb(kb, fresh).length > 0;
                // Same predicate the fact-save trigger uses (shared, so the two
                // entry points cannot drift into disagreeing about when to ask).
                const hasFieldLines = hasFieldLinesToClean(kb, page?.businessProfile);
                if (hasProductLines || hasFieldLines) {
                  setCleanupImportCount(count);
                  setCleanupItems(fresh);
                  return; // the cleanup sheet is the next step; its own onDone toasts
                }
              } catch (err) {
                // The cleanup OFFER is optional (fall through to the success
                // toast), but a persistent failure means the feature never
                // surfaces — surface the signal instead of losing it.
                captureError(err, 'KB cleanup offer detection failed', { extra: { pageId } });
              }
            }

            // The value proof, zero effort: right after saving, offer to SEE
            // the AI answer a price question about their own product. Only
            // when the host gave us the page (the modal needs it). An
            // updates-only save created nothing — its toast already fired above.
            if (page && firstItemName) {
              toast.success(t('import.toastImported', { count }), {
                duration: 10000,
                action: {
                  label: t('tryIt.action'),
                  onClick: () => setTryItQuestion(t('tryIt.question', { name: firstItemName })),
                },
              });
            } else if (count > 0) {
              toast.success(t('import.toastImported', { count }));
            }
          }}
          onClose={() => {
            setSheetMode(null);
            // Confirmed price updates PATCH before the batch insert — if the
            // batch then failed and the merchant cancels, those updates are
            // already committed. Refetch so the list never shows stale prices.
            invalidate();
          }}
        />
      )}

      {page?.knowledgeBase && cleanupItems && (
        <KbCleanupSheet
          pageId={pageId}
          kbText={page.knowledgeBase}
          items={cleanupItems}
          profile={page.businessProfile}
          onClose={() => setCleanupItems(null)}
          onDone={(removed) => {
            setCleanupItems(null);
            invalidate();
            // Updates-only imports created nothing — their toast already fired.
            if (removed > 0) toast.success(t('cleanup.toastDone', { count: removed }));
            else if (cleanupImportCount > 0) toast.success(t('import.toastImported', { count: cleanupImportCount }));
          }}
        />
      )}

      {page && tryItQuestion !== null && (
        <TestSmartReplyModal
          page={page}
          initialQuestion={tryItQuestion}
          onClose={() => setTryItQuestion(null)}
        />
      )}

      <ConfirmationModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
        title={t('delete.title')}
        message={t('delete.body', { name: deleting?.name ?? '' })}
        confirmText={t('delete.confirm')}
        variant="danger"
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardPaste, Plus, ScanSearch, Tag } from 'lucide-react';
import { AxiosError } from 'axios';
import { Button, EmptyState, Select, Skeleton, ConfirmationModal } from '@/components/ui';
import { catalogApi, type CatalogItemInput, type CatalogVerticalInfo } from '@/lib/api';
import {
  CATALOG_VERTICALS, CATALOG_VERTICAL_DEFAULT_TYPE, MAX_CATALOG_ITEMS_PER_PAGE,
  type CatalogItem, type CatalogVertical, type Page,
} from '@jawab24/shared';
import { CatalogItemRow } from './CatalogItemRow';
import { CatalogItemFormSheet } from './CatalogItemFormSheet';
import { CatalogImportSheet } from './CatalogImportSheet';

const TestSmartReplyModal = dynamic(
  () => import('@/components/test-smart-reply/TestSmartReplyModal').then((m) => ({ default: m.TestSmartReplyModal })),
  { ssr: false },
);

interface CatalogManagerProps {
  pageId: string;
  /** Full page object — enables the post-save "try it" moment (opens the Test
   *  Smart Reply modal). Optional: hosts without it just skip the nudge. */
  page?: Page;
  /** Open the import sheet on mount (deep link from the Business Info warning). */
  importRequested?: boolean;
  /** Pre-fill for the import paste box when importRequested is set. */
  importInitialText?: string;
}

/** The catalog editor for one page. Host-agnostic (takes pageId via props) so it
 *  can live on the dedicated /catalog page or inside the Business Info modal. */
export function CatalogManager({ pageId, page, importRequested, importInitialText }: CatalogManagerProps) {
  const t = useTranslations('catalog');
  const queryClient = useQueryClient();
  const queryKey = ['catalog', pageId];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  /** Which entry to the review flow is open: paste/upload import, or the posts scan. */
  const [sheetMode, setSheetMode] = useState<'paste' | 'scan' | null>(null);
  /** Prefilled question for the post-save "try it" moment (null = modal closed). */
  const [tryItQuestion, setTryItQuestion] = useState<string | null>(null);

  // Deep-link entry: open the import sheet once when the page asks for it.
  useEffect(() => {
    if (importRequested) setSheetMode('paste');
  }, [importRequested]);

  const { data: listData, isLoading, isError } = useQuery<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>({
    queryKey,
    queryFn: () => catalogApi.list(pageId).then((r) => r.data),
    enabled: !!pageId,
  });
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
  const verticalControl = vertical && vertical.source !== 'facebook' && (
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

  return (
    <div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          {/* Ghost example row — teaches the shape by showing it (Simplicity
              contract §8), in the merchant's OWN trade: the example item follows
              the page's vertical ("name|price" i18n pair, split here). The row
              deliberately mimics a real listing so it teaches; the "Example"
              badge is what keeps it from reading AS one (a UX review mistook this
              ghost for live data). The badge sits OUTSIDE the opacity fade so the
              signal is unmistakable. */}
          {(() => {
            const [exampleName, examplePrice] = t(`exampleItems.${vertical?.effective ?? 'other'}`).split('|');
            return (
              <div className="mb-5">
                <div className="flex mb-1.5">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {t('example.badge')}
                  </span>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 opacity-60 text-start pointer-events-none select-none">
                  <div className="min-w-0 flex-1">
                    <span dir="auto" className="text-sm font-semibold text-foreground">{exampleName}</span>
                  </div>
                  <span dir="auto" className="text-sm font-semibold text-foreground tabular-nums">{examplePrice}</span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full status-success">{t('availability.in')}</span>
                </div>
              </div>
            );
          })()}
          <h3 className="text-base font-semibold text-foreground">{t('empty.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">{t('empty.body')}</p>
          {/* ONE decision: scan. The manual paths exist but read as footnotes —
              an ordinary merchant should never have to weigh three buttons. */}
          <Button variant="primary" onClick={() => setSheetMode('scan')}>
            <ScanSearch className="w-4 h-4 me-1.5" aria-hidden="true" />
            {t('scan.cta')}
          </Button>
          <div className="flex items-center justify-center gap-1 mt-3 text-sm text-muted-foreground">
            <span>{t('empty.or')}</span>
            <button type="button" onClick={() => setSheetMode('paste')} className="underline underline-offset-2 hover:text-foreground transition-colors">
              {t('import.cta')}
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={openAdd} className="underline underline-offset-2 hover:text-foreground transition-colors">
              {t('empty.cta')}
            </button>
          </div>
          {verticalControl && <div className="mt-5 flex justify-center">{verticalControl}</div>}
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
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSheetMode('scan')} disabled={items.length >= MAX_CATALOG_ITEMS_PER_PAGE}>
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
          </div>
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
          defaultCurrency={lastCurrency}
          initialText={importRequested ? importInitialText : undefined}
          onDone={(count, firstItemName) => {
            invalidate();
            setSheetMode(null);
            // The value proof, zero effort: right after saving, offer to SEE
            // the AI answer a price question about their own product. Only
            // when the host gave us the page (the modal needs it).
            if (page && firstItemName) {
              toast.success(t('import.toastImported', { count }), {
                duration: 10000,
                action: {
                  label: t('tryIt.action'),
                  onClick: () => setTryItQuestion(t('tryIt.question', { name: firstItemName })),
                },
              });
            } else {
              toast.success(t('import.toastImported', { count }));
            }
          }}
          onClose={() => setSheetMode(null)}
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

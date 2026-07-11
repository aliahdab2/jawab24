import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardPaste, Plus, Tag } from 'lucide-react';
import { AxiosError } from 'axios';
import { Button, EmptyState, Skeleton, ConfirmationModal } from '@/components/ui';
import { catalogApi, type CatalogItemInput } from '@/lib/api';
import { MAX_CATALOG_ITEMS_PER_PAGE, type CatalogItem } from '@jawab24/shared';
import { CatalogItemRow } from './CatalogItemRow';
import { CatalogItemFormSheet } from './CatalogItemFormSheet';
import { CatalogImportSheet } from './CatalogImportSheet';

interface CatalogManagerProps {
  pageId: string;
  /** Open the import sheet on mount (deep link from the Business Info warning). */
  importRequested?: boolean;
  /** Pre-fill for the import paste box when importRequested is set. */
  importInitialText?: string;
}

/** The catalog editor for one page. Host-agnostic (takes pageId via props) so it
 *  can live on the dedicated /catalog page or inside the Business Info modal. */
export function CatalogManager({ pageId, importRequested, importInitialText }: CatalogManagerProps) {
  const t = useTranslations('catalog');
  const queryClient = useQueryClient();
  const queryKey = ['catalog', pageId];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Deep-link entry: open the import sheet once when the page asks for it.
  useEffect(() => {
    if (importRequested) setImportOpen(true);
  }, [importRequested]);

  const { data: items = [], isLoading, isError } = useQuery<CatalogItem[]>({
    queryKey,
    queryFn: () => catalogApi.list(pageId).then((r) => r.data.data),
    enabled: !!pageId,
  });

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

  return (
    <div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center">
          {/* Ghost example row — teaches the shape by showing it (Simplicity contract §8) */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 opacity-60 mb-5 text-start pointer-events-none select-none">
            <div className="min-w-0 flex-1">
              <span dir="auto" className="text-sm font-semibold text-foreground">{t('empty.exampleName')}</span>
            </div>
            <span dir="auto" className="text-sm font-semibold text-foreground tabular-nums">{t('empty.examplePrice')}</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full status-success">{t('availability.in')}</span>
          </div>
          <h3 className="text-base font-semibold text-foreground">{t('empty.title')}</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">{t('empty.body')}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <Button variant="primary" onClick={openAdd}>
              <Plus className="w-4 h-4 me-1.5" aria-hidden="true" />
              {t('empty.cta')}
            </Button>
            {/* The highest-value entry: target merchants arrive with an existing list. */}
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <ClipboardPaste className="w-4 h-4 me-1.5" aria-hidden="true" />
              {t('import.cta')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {t('limitLabel', { count: items.length, max: MAX_CATALOG_ITEMS_PER_PAGE })}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)} disabled={items.length >= MAX_CATALOG_ITEMS_PER_PAGE}>
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
          saving={createMutation.isPending || updateMutation.isPending}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}

      {importOpen && (
        <CatalogImportSheet
          pageId={pageId}
          initialText={importRequested ? importInitialText : undefined}
          onDone={(count) => {
            invalidate();
            toast.success(t('import.toastImported', { count }));
            setImportOpen(false);
          }}
          onClose={() => setImportOpen(false)}
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

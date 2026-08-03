import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListChecks, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { isRowLive } from '@jawab24/shared';
import { factCollectionsApi, type FactCollectionWithRows, type FactRowDto } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate } from '@/utils/dateUtils';
import { ListRowSheet } from './ListRowSheet';

interface BusinessListsSectionProps {
  pageId: string;
}

/**
 * «قوائم النشاط» — the fact-list editor (G1b slice 1).
 *
 * Renders ONLY when the page has fact collections, which is the rollout gate:
 * collections are born from reviewed extraction (D-038), so a page that was
 * never through that process simply doesn't show the section — no feature
 * flag, no canary widening. Today that is the pilot merchant.
 *
 * Expired rows are SHOWN here (grouped under a collapsed «منتهية» divider),
 * unlike the prompt where they are excluded: the merchant re-announcing a
 * cohort edits last month's row and changes one date — deleting expired rows
 * would force retyping the whole slot. The AI never sees them; the editor is
 * exactly where they should remain visible.
 */
export function BusinessListsSection({ pageId }: BusinessListsSectionProps) {
  const t = useTranslations('business');
  const queryClient = useQueryClient();

  const { data } = useQuery<FactCollectionWithRows[]>({
    queryKey: ['fact-collections', pageId],
    queryFn: () => factCollectionsApi.list(pageId).then((r) => r.data.data),
    enabled: !!pageId,
  });

  const [editing, setEditing] = useState<{ collection: FactCollectionWithRows; row: FactRowDto | null } | null>(null);
  const [showExpired, setShowExpired] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const collections = data ?? [];
  if (collections.length === 0) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fact-collections', pageId] });

  const save = async (body: Parameters<React.ComponentProps<typeof ListRowSheet>['onSave']>[0]) => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.row) {
        await factCollectionsApi.updateRow(pageId, editing.collection.id, editing.row.id, body);
      } else {
        await factCollectionsApi.addRow(pageId, editing.collection.id, body);
      }
      await refresh();
      setEditing(null);
      toast.success(t('lists.saved'));
    } catch (error) {
      captureError(error, 'Failed to save fact row', { tags: { action: 'save-fact-row' } });
      toast.error(t('lists.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async () => {
    if (!editing?.row) return;
    setSaving(true);
    try {
      await factCollectionsApi.deleteRow(pageId, editing.collection.id, editing.row.id);
      await refresh();
      setEditing(null);
      toast.success(t('lists.deleted'));
    } catch (error) {
      captureError(error, 'Failed to delete fact row', { tags: { action: 'delete-fact-row' } });
      toast.error(t('lists.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setCompleteness = async (collection: FactCollectionWithRows, isComplete: boolean | null) => {
    try {
      await factCollectionsApi.setCompleteness(pageId, collection.id, isComplete);
      await refresh();
      toast.success(t('lists.saved'));
    } catch (error) {
      captureError(error, 'Failed to set list completeness', { tags: { action: 'set-list-completeness' } });
      toast.error(t('lists.saveFailed'));
    }
  };

  /** Compact one-line meta under the row name: attributes · price · date. */
  const rowMeta = (row: FactRowDto): string => {
    const parts: string[] = [];
    for (const a of row.attributes ?? []) parts.push(a.value);
    if (row.price) {
      parts.push(`${formatCatalogPrice(row.price)}${row.currency ? ` ${row.currency}` : ''}`);
    }
    if (row.startsAt) parts.push(t('lists.startsOn', { date: row.startsAt }));
    return parts.join(' · ');
  };

  // DISPLAY grouping only — the authoritative exclusion happens server-side at
  // prompt-build time. `isRowLive` (@jawab24/shared) is the SAME predicate the
  // renderer and the SQL clause use, so the badge a merchant sees can never
  // disagree with what the AI was given. Never re-derive "expired" locally.
  const today = todayISODate();
  const isExpired = (row: FactRowDto) => !isRowLive(row, today);

  return (
    <section aria-label={t('lists.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <ListChecks className="w-5 h-5 text-brand-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('lists.title')}</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{t('lists.hint')}</p>
        </div>
      </div>

      <div className="mt-3 space-y-5">
        {collections.map((collection) => {
          const live = collection.rows.filter((r) => !isExpired(r));
          const expired = collection.rows.filter(isExpired);
          const expanded = !!showExpired[collection.id];
          return (
            <div key={collection.id}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">{collection.label}</h3>
                <button
                  type="button"
                  onClick={() => setEditing({ collection, row: null })}
                  className="min-h-[36px] inline-flex items-center gap-1 rounded-lg text-xs font-medium text-brand-600 hover:text-brand-700 px-2"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('lists.addRow')}
                </button>
              </div>

              {/* The merchant's completeness word (D-038, tri-state). It changes
                  what customers are TOLD about absence, so the question names
                  that consequence rather than asking abstractly. */}
              {collection.isComplete === null ? (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap rounded-xl bg-muted border border-theme-border px-3 py-2">
                  <span className="text-xs text-muted-foreground">{t('lists.completenessAsk')}</span>
                  <button
                    type="button"
                    onClick={() => setCompleteness(collection, true)}
                    className="min-h-[32px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-foreground hover:bg-surface-100"
                  >
                    {t('lists.completenessYes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompleteness(collection, false)}
                    className="min-h-[32px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-surface-100"
                  >
                    {t('lists.completenessNo')}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {collection.isComplete ? t('lists.completenessConfirmed') : t('lists.completenessPartial')}
                  {' '}
                  <button
                    type="button"
                    onClick={() => setCompleteness(collection, null)}
                    className="text-brand-600 hover:underline underline-offset-2"
                  >
                    {t('lists.completenessReset')}
                  </button>
                </p>
              )}

              <ul className="mt-1 divide-y divide-theme-border -mx-4 sm:-mx-5">
                {live.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setEditing({ collection, row })}
                      className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-foreground truncate">{row.name}</span>
                        {rowMeta(row) && (
                          <span className="block text-xs text-muted-foreground truncate mt-0.5">{rowMeta(row)}</span>
                        )}
                      </span>
                      <span className="flex-shrink-0 inline-flex items-center justify-center min-w-[64px] rounded-lg border border-theme-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                        {t('lists.edit')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {expired.length > 0 && (
                <div className="-mx-4 sm:-mx-5 border-t border-theme-border">
                  <button
                    type="button"
                    onClick={() => setShowExpired((prev) => ({ ...prev, [collection.id]: !expanded }))}
                    aria-expanded={expanded}
                    className="w-full min-h-[44px] flex items-center gap-2 px-4 sm:px-5 text-xs text-muted-foreground hover:bg-surface-100"
                  >
                    <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('lists.expiredToggle', { count: expired.length })}
                  </button>
                  {expanded && (
                    <ul className="divide-y divide-theme-border">
                      {expired.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => setEditing({ collection, row })}
                            className="w-full min-h-[56px] flex items-center gap-3 px-4 sm:px-5 py-2.5 text-start opacity-60 hover:opacity-100 hover:bg-surface-100 transition"
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-foreground truncate">{row.name}</span>
                              {rowMeta(row) && (
                                <span className="block text-xs text-muted-foreground truncate mt-0.5">{rowMeta(row)}</span>
                              )}
                            </span>
                            <span className="flex-shrink-0 text-xs text-muted-foreground">{t('lists.expired')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ListRowSheet
          row={editing.row}
          collectionLabel={editing.collection.label}
          attributeLabels={(editing.collection.rows[0]?.attributes ?? []).map((a) => a.label)}
          canDelete={editing.collection.rows.length > 1}
          saving={saving}
          onSave={save}
          onDelete={removeRow}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

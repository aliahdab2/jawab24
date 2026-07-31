import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListChecks, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { factCollectionsApi, type FactCollectionWithRows, type FactRowDto } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate } from '@/utils/dateUtils';
import { groupFactCollections, rowKeyValue, type FactListGroup } from '@/utils/factListGrouping';
import { ListRowSheet } from './ListRowSheet';

interface BusinessListsSectionProps {
  pageId: string;
}

interface EditingState {
  collection: FactCollectionWithRows;
  row: FactRowDto | null;
  /** Prefill for a NEW row added from an entity card: the card's name and,
   *  when the card already has a row in that keyed list, its key value. */
  initial?: { name?: string; attributes?: { label: string; value: string }[] };
}

/**
 * «قوائم النشاط» — the fact-list editor (G1b slice 1; grouped view slice 2).
 *
 * Renders ONLY when the page has fact collections, which is the rollout gate:
 * collections are born from reviewed extraction (D-038), so a page that was
 * never through that process simply doesn't show the section — no feature
 * flag, no canary widening. Today that is the pilot merchant.
 *
 * The rows are presented as ONE CARD PER ENTITY (a course's prices AND its
 * cohort dates together), joined by `groupFactCollections` — a presentation
 * join only. The collections stay separate in the data because they carry
 * opposite answering semantics (keyed/gated schedules vs un-keyed complete
 * price list) and opposite expiry (slots self-expire, prices never do); the
 * merchant confusion of seeing one course name in two flat lists is a UI
 * problem, solved here in the UI.
 *
 * Expired rows are SHOWN here (grouped under a collapsed «منتهية» divider per
 * card), unlike the prompt where they are excluded: the merchant re-announcing
 * a cohort edits last month's row and changes one date — deleting expired rows
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

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showExpired, setShowExpired] = useState<Record<string, boolean>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const collections = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupFactCollections(collections), [collections]);

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

  /** Compact one-line meta for a row inside its card. The card title already
   *  names the entity, so the key value (how customers find it) is dropped —
   *  what remains is what distinguishes the row: level/days/time · price · date. */
  const rowMeta = (collection: FactCollectionWithRows, row: FactRowDto): string => {
    const parts: string[] = [];
    for (const a of row.attributes ?? []) {
      if (collection.keyAttr && a.label === collection.keyAttr) continue;
      parts.push(a.value);
    }
    if (row.price) {
      parts.push(`${formatCatalogPrice(row.price)}${row.currency ? ` ${row.currency}` : ''}`);
    }
    if (row.startsAt) parts.push(t('lists.startsOn', { date: row.startsAt }));
    return parts.join(' · ');
  };

  /** Prefill for adding a row to `collection` from an entity card. */
  const addFromGroup = (group: FactListGroup, collection: FactCollectionWithRows) => {
    const sibling = group.rows.find((r) => r.collection.id === collection.id);
    const keyValue = sibling ? rowKeyValue(collection, sibling.row) : null;
    setEditing({
      collection,
      row: null,
      initial: {
        name: sibling?.row.name ?? group.title,
        ...(collection.keyAttr && keyValue
          ? { attributes: [{ label: collection.keyAttr, value: keyValue }] }
          : {}),
      },
    });
  };

  // Local-timezone today for DISPLAY grouping only — the authoritative
  // exclusion happens server-side at prompt-build time.
  const today = todayISODate();
  const isExpired = (row: FactRowDto) => !!row.endsAt && row.endsAt < today;

  const rowButton = (entry: FactListGroup['rows'][number], expired: boolean) => {
    const meta = rowMeta(entry.collection, entry.row);
    return (
      <li key={entry.row.id}>
        <button
          type="button"
          onClick={() => setEditing({ collection: entry.collection, row: entry.row })}
          className={`w-full min-h-[48px] flex items-center gap-3 px-4 py-2 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors ${expired ? 'opacity-60 hover:opacity-100' : ''}`}
        >
          {entry.row.startsAt ? (
            <CalendarClock className="w-4 h-4 flex-shrink-0 text-icon-muted" aria-hidden="true" />
          ) : (
            <span className="w-4 flex-shrink-0" aria-hidden="true" />
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-foreground truncate">{meta || entry.row.name}</span>
          </span>
          <span className="flex-shrink-0 text-xs font-medium text-muted-foreground">
            {expired ? t('lists.expired') : t('lists.edit')}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section aria-label={t('lists.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <ListChecks className="w-5 h-5 text-brand-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('lists.title')}</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{t('lists.groupedHint')}</p>
        </div>
      </div>

      {/* Per-list controls: the completeness word (D-038, tri-state) belongs to
          the LIST, not to any one card — it changes what customers are TOLD
          about absence, so the question names that consequence. */}
      <div className="mt-3 space-y-2">
        {collections.map((collection) => (
          <div key={collection.id} className="rounded-xl bg-muted border border-theme-border px-3 py-2">
            {collection.isComplete === null ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">{collection.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{t('lists.completenessAsk')}</span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
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
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{collection.label}</span>
                <span className="text-xs text-muted-foreground">
                  {collection.isComplete ? t('lists.completenessConfirmed') : t('lists.completenessPartial')}
                  {' '}
                  <button
                    type="button"
                    onClick={() => setCompleteness(collection, null)}
                    className="text-brand-600 hover:underline underline-offset-2"
                  >
                    {t('lists.completenessReset')}
                  </button>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* One card per entity — the course name appears exactly once. */}
      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const live = group.rows.filter((r) => !isExpired(r.row));
          const expired = group.rows.filter((r) => isExpired(r.row));
          const expanded = !!showExpired[group.key];
          return (
            <div key={group.key} className="rounded-xl border border-theme-border overflow-hidden">
              <h3 className="px-4 pt-3 pb-1 text-sm font-semibold text-foreground">{group.title}</h3>

              <ul className="divide-y divide-theme-border">
                {live.map((entry) => rowButton(entry, false))}
              </ul>

              <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-t border-theme-border">
                {/* Progressive disclosure: one quiet «+» per card; the
                    per-list choices appear only while adding. With a single
                    list there is nothing to choose — go straight to the sheet. */}
                {addingTo !== group.key ? (
                  <button
                    type="button"
                    onClick={() =>
                      collections.length === 1
                        ? addFromGroup(group, collections[0])
                        : setAddingTo(group.key)
                    }
                    className="min-h-[32px] inline-flex items-center gap-1 rounded-full border border-dashed border-theme-border px-2.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    {t('lists.add')}
                  </button>
                ) : (
                  collections.map((collection) => (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => {
                        setAddingTo(null);
                        addFromGroup(group, collection);
                      }}
                      className="min-h-[32px] inline-flex items-center gap-1 rounded-full border border-dashed border-brand-500/50 px-2.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      {collection.label}
                    </button>
                  ))
                )}
                {expired.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowExpired((prev) => ({ ...prev, [group.key]: !expanded }))}
                    aria-expanded={expanded}
                    className="ms-auto min-h-[32px] inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('lists.expiredToggle', { count: expired.length })}
                  </button>
                )}
              </div>

              {expanded && expired.length > 0 && (
                <ul className="divide-y divide-theme-border border-t border-theme-border">
                  {expired.map((entry) => rowButton(entry, true))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ListRowSheet
          row={editing.row}
          initial={editing.initial}
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

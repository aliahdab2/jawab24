import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListChecks, CalendarClock, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { factCollectionsApi, type FactCollectionWithRows, type FactRowDto } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate, formatPlainDate } from '@/utils/dateUtils';
import { groupFactCollections, rowKeyValue, type FactListGroup } from '@/utils/factListGrouping';
import { sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels, type FactListSection } from '@/utils/factListLayout';
import { useLanguage } from '@/i18n/hooks';
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
 * «قوائم النشاط» — the fact-list editor (G1b slices 1–3).
 *
 * Renders ONLY when the page has fact collections, which is the rollout gate:
 * collections are born from reviewed extraction (D-038), so a page that was
 * never through that process simply doesn't show the section — no feature
 * flag, no canary widening. Today that is the pilot merchant.
 *
 * Presentation is ONE CARD PER ENTITY (a course's prices AND its cohort dates
 * together, joined by `groupFactCollections`), and inside a card the rows are
 * bucketed into LABELLED SECTIONS per collection (`sectionizeGroup`) — the
 * owner's complaint was that price rows and session rows sat in one flat list
 * with bare values and repeated tier names. The collections themselves stay
 * separate in the data: they carry opposite answering semantics (keyed/gated
 * schedules vs un-keyed complete price list) and opposite expiry, all
 * measured. Nothing here is business-specific — section titles, hoisted
 * pairs, and field labels all come from the merchant's own collections.
 *
 * Expired rows are SHOWN here (behind a per-card «منتهية» toggle), unlike the
 * prompt where they are excluded: the merchant re-announcing a cohort edits
 * last month's row and changes one date. The AI never sees them.
 */
export function BusinessListsSection({ pageId }: BusinessListsSectionProps) {
  const t = useTranslations('business');
  const { intlLocale } = useLanguage();
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
  // exclusion happens server-side at prompt-build time. Mirrors the engine's
  // isRowLive rule: the START date decides; endsAt is a fallback for undated
  // rows only (owner ruling 2026-07-31 — the end date is never load-bearing).
  const today = todayISODate();
  const isExpired = (row: FactRowDto) =>
    row.startsAt ? row.startsAt < today : !!row.endsAt && row.endsAt < today;

  /** One row line inside its section: labelled pairs · price · readable date,
   *  wrapping (never truncating), the whole line one edit button. */
  const rowButton = (section: FactListSection, row: FactRowDto, expired: boolean) => {
    const pairs = rowDisplayAttributes(section, row);
    const date = row.startsAt ? formatPlainDate(row.startsAt, intlLocale) : null;
    const hasContent = pairs.length > 0 || row.price || date;
    return (
      <li key={row.id}>
        <button
          type="button"
          onClick={() => setEditing({ collection: section.collection, row })}
          className={`w-full min-h-[48px] grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors ${expired ? 'opacity-60 hover:opacity-100' : ''}`}
        >
          <span className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {!hasContent && (
              <span className="text-sm text-foreground break-words" dir="auto">{row.name}</span>
            )}
            {pairs.map((a) => (
              <span key={a.label} className="text-sm text-foreground break-words" dir="auto">
                <span className="text-muted-foreground">{a.label}: </span>
                {a.value}
              </span>
            ))}
            {row.price && (
              <span className="text-sm font-semibold text-foreground whitespace-nowrap tabular-nums">
                {formatCatalogPrice(row.price)}
                {row.currency && (
                  <span className="text-xs font-medium text-muted-foreground ms-1">{row.currency}</span>
                )}
              </span>
            )}
            {date && (
              <span className="text-sm text-foreground whitespace-nowrap">
                <span className="text-muted-foreground">{t('lists.startsLabel')} </span>
                {date}
              </span>
            )}
          </span>
          <span className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
            {expired && <span className="text-xs text-muted-foreground">{t('lists.expired')}</span>}
            <Pencil className="w-4 h-4 text-icon-muted" aria-hidden="true" />
            <span className="sr-only">{t('lists.edit')}</span>
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

      {/* One card per entity — the name appears exactly once; inside, one
          labelled section per list so a price and a session can't be
          confused. Section titles are the merchant's own list labels. */}
      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const sections = sectionizeGroup(group, collections);
          const expiredCount = group.rows.filter((r) => isExpired(r.row)).length;
          const expanded = !!showExpired[group.key];
          return (
            <div key={group.key} className="rounded-xl border border-theme-border overflow-hidden">
              <h3 className="px-4 pt-3 pb-1 text-sm font-semibold text-foreground" dir="auto">{group.title}</h3>

              {sections.map((section) => {
                const live = section.rows.filter((r) => !isExpired(r.row));
                const expiredRows = section.rows.filter((r) => isExpired(r.row));
                if (live.length === 0 && !(expanded && expiredRows.length > 0)) return null;
                return (
                  <div key={section.collection.id}>
                    {collections.length > 1 && (
                      <div className="flex items-baseline gap-2 flex-wrap px-4 pt-2 pb-1 border-t border-theme-border">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" dir="auto">
                          {section.collection.label}
                        </span>
                        {section.shared.map((s) => (
                          <span
                            key={s.label}
                            dir="auto"
                            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {t('lists.attrPair', { label: s.label, value: s.value })}
                          </span>
                        ))}
                      </div>
                    )}
                    <ul className="divide-y divide-theme-border">
                      {live.map((entry) => rowButton(section, entry.row, false))}
                      {expanded && expiredRows.map((entry) => rowButton(section, entry.row, true))}
                    </ul>
                  </div>
                );
              })}

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
                {expiredCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowExpired((prev) => ({ ...prev, [group.key]: !expanded }))}
                    aria-expanded={expanded}
                    className="ms-auto min-h-[32px] inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('lists.expiredToggle', { count: expiredCount })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <ListRowSheet
          row={editing.row}
          initial={editing.initial}
          collectionLabel={editing.collection.label}
          keyAttr={editing.collection.keyAttr}
          attributeLabels={collectionAttributeLabels(editing.collection)}
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

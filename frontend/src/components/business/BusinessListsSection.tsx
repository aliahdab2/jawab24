import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListChecks, CalendarClock, Pencil, ChevronDown, CalendarDays, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { factCollectionsApi, type FactCollectionWithRows, type FactRowDto, type FactEntitySaveBody } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate, formatPlainDateParts } from '@/utils/dateUtils';
import { groupFactCollections, rowKeyValue, type FactListGroup } from '@/utils/factListGrouping';
import {
  sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels,
  discoverFaceLabel, buildEntityUnit, buildTierBlocks, isDatedCollection,
  sessionValueKind, sectionKeyGroups, type FactListSection, type FactEntityUnit,
} from '@/utils/factListLayout';
import { useLanguage } from '@/i18n/hooks';
import { ListRowSheet } from './ListRowSheet';
import { FactEntitySheet } from './FactEntitySheet';

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
  const [entityEditing, setEntityEditing] = useState<{ unit: FactEntityUnit; baseCollection: FactCollectionWithRows | null } | null>(null);
  const [showExpired, setShowExpired] = useState<Record<string, boolean>>({});
  // Session groups are collapsible but start EXPANDED — the owner's ruling
  // («كل دورة ومعها كل معلوماتها») outranks the expert's collapsed default;
  // the toggle only adds the scan-across-levels affordance he asked for.
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const collections = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupFactCollections(collections), [collections]);
  const faceLabel = useMemo(() => discoverFaceLabel(collections), [collections]);
  // Entity cards earn their chrome only when entities aggregate ACROSS lists
  // (a course whose price sits in one list and dates in another) — the join
  // the cards exist to show. A directory-shaped page (hundreds of outlets,
  // one row each, plus a size list whose only duplicates are same-list series
  // variants) reads far better as one compact section per list, so the layout
  // self-selects from the merchant's own data.
  const aggregates = useMemo(
    () => groups.some((g) => new Set(g.rows.map((r) => r.collection.id)).size > 1),
    [groups],
  );

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

  /** Tapping ANY row opens the whole item as ONE form — price, fields and
   *  dates together (the merchant's mental model). Saved atomically. */
  const openEntity = (group: FactListGroup, tapped: { collection: FactCollectionWithRows; row: FactRowDto }) => {
    const unit = buildEntityUnit(group, collections, faceLabel, tapped);
    const baseCollection =
      unit.base?.collection ?? collections.find((c) => !isDatedCollection(c)) ?? null;
    setEntityEditing({ unit, baseCollection });
  };

  const saveEntity = async (body: FactEntitySaveBody) => {
    setSaving(true);
    try {
      await factCollectionsApi.saveEntity(pageId, body);
      await refresh();
      setEntityEditing(null);
      toast.success(t('lists.saved'));
    } catch (error) {
      captureError(error, 'Failed to save fact entity', { tags: { action: 'save-fact-entity' } });
      toast.error(t('lists.saveFailed'));
    } finally {
      setSaving(false);
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

  /** Display price with digit grouping («35,000») — display only; forms keep
   *  plain digits. Falls back to the raw string for non-numeric prices. */
  const displayPrice = (price: string): string => {
    const n = Number(price);
    return Number.isFinite(n) ? n.toLocaleString(intlLocale) : formatCatalogPrice(price);
  };

  const priceTag = (row: FactRowDto, opts?: { prominent?: boolean }) =>
    row.price ? (
      <span
        className={`${opts?.prominent ? 'text-base font-bold' : 'text-sm font-semibold'} text-foreground whitespace-nowrap tabular-nums`}
        dir="auto"
      >
        {displayPrice(row.price)}
        {row.currency && (
          <span className="text-xs font-medium text-muted-foreground ms-1">{row.currency}</span>
        )}
      </span>
    ) : null;

  const expiredBadge = (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
      {t('lists.expired')}
    </span>
  );

  /** «تعديل» as a visible chip — helper-text-weight edit affordances were the
   *  expert's point 4; the chip reads as the row's action, not as a caption. */
  const editChip = (
    <span className="inline-flex items-center gap-1 rounded-lg bg-brand-500/10 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:text-brand-300 whitespace-nowrap">
      <Pencil className="w-3 h-3" aria-hidden="true" />
      {t('lists.edit')}
    </span>
  );

  /** A TIER line (Shopify-variant / ticket-type pattern): a PROMINENT title —
   *  the tier value when one exists, else the row name — with the price and
   *  its «تعديل» chip anchored together at the end edge (expert points 1–2:
   *  the eye lands on the price first, and the action belongs to it). */
  const tierRow = (group: FactListGroup, section: FactListSection, row: FactRowDto, expired: boolean, opts?: { soleBase?: boolean }) => {
    const facePair = faceLabel
      ? row.attributes?.find((a) => a.label === faceLabel)
      : undefined;
    const pairs = rowDisplayAttributes(section, row, {
      dropLabels: faceLabel ? [faceLabel] : undefined,
    });
    // The bold line is the TIER value when one exists. Without one, the row's
    // other fields carry the line — never the entity name again (the card
    // header already says it; repeating it was the original complaint).
    // A card's ONLY price row with no tier value and no fields earns the
    // generic «السعر الأساسي» (round-6 expert point 7) — with several
    // unlabelled rows we can't know which is "base", so we never guess.
    const title =
      facePair?.value ??
      (opts?.soleBase && pairs.length === 0 && row.price ? t('lists.basePrice') : null);
    const priceInLine = !title && pairs.length === 0 && !!row.price;
    return (
      <li key={row.id} className="list-none">
        <button
          type="button"
          onClick={() => openEntity(group, { collection: section.collection, row })}
          className={`w-full min-h-[52px] flex items-center gap-3 px-4 py-3 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors ${expired ? 'opacity-60 hover:opacity-100' : ''}`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
              {title ? (
                <span className="text-[15px] font-bold text-foreground break-words" dir="auto">{title}</span>
              ) : pairs.length > 0 ? (
                <span className="text-sm text-foreground break-words" dir="auto">
                  {pairs.map((a, i) => (
                    <span key={a.label}>
                      <span className="text-muted-foreground">{a.label}: </span>
                      {a.value}
                      {i < pairs.length - 1 && t('lists.listSeparator')}
                    </span>
                  ))}
                </span>
              ) : priceInLine ? (
                priceTag(row, { prominent: true })
              ) : (
                <span className="text-[15px] font-bold text-foreground break-words" dir="auto">{row.name}</span>
              )}
              {expired && expiredBadge}
            </span>
            {title && pairs.length > 0 && (
              <span className="block text-xs text-muted-foreground mt-0.5 break-words" dir="auto">
                {pairs.map((a) => `${a.label}: ${a.value}`).join(t('lists.listSeparator'))}
              </span>
            )}
          </span>
          <span className="flex-shrink-0 flex flex-col items-end gap-1">
            {!priceInLine && priceTag(row, { prominent: true })}
            {editChip}
          </span>
        </button>
      </li>
    );
  };

  /** A SESSION line (calendar-agenda pattern): a date chip leads, the
   *  session's values follow as visually grouped fragments — tighter than a
   *  dot-separated sentence, lighter than a card (expert point 3). Field
   *  names stay available to assistive tech and on hover; which field means
   *  «days» vs «time» is never guessed — the values speak for themselves.
   *  Desktop-only height trim (expert point 5): rows shorten ~25% on lg,
   *  mobile keeps its breathing room («don't densify» ruling). */
  const sessionRow = (section: FactListSection, row: FactRowDto, expired: boolean) => {
    const pairs = rowDisplayAttributes(section, row, {
      dropLabels: faceLabel ? [faceLabel] : undefined,
    });
    const parts = formatPlainDateParts(row.startsAt, intlLocale);
    return (
      <li
        key={row.id}
        className={`min-h-[48px] lg:min-h-[36px] flex items-center gap-3 px-3 py-2 lg:py-1 ${expired ? 'opacity-60' : ''}`}
      >
        {parts ? (
          <span
            className="flex-shrink-0 w-11 rounded-lg bg-card border border-theme-border text-center py-1 leading-tight"
            title={t('lists.startsLabel')}
          >
            <span className="block text-sm font-bold text-foreground tabular-nums">{parts.day}</span>
            <span className="block text-[10px] text-muted-foreground">{parts.month}</span>
          </span>
        ) : (
          <span className="flex-shrink-0 w-11 flex items-center justify-center text-icon-muted">
            <CalendarClock className="w-4 h-4" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1 flex items-center gap-x-1.5 gap-y-1 flex-wrap">
          {pairs.map((a) => {
            const kind = sessionValueKind(a.value);
            return (
              <span
                key={a.label}
                title={a.label}
                dir="auto"
                className={`inline-flex items-center gap-1 rounded-md bg-card border border-theme-border/60 px-1.5 py-0.5 text-[13px] font-medium text-foreground break-words ${kind === 'time' ? 'tabular-nums' : ''}`}
              >
                {kind === 'weekday' && <CalendarDays className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />}
                {kind === 'time' && <Clock className="w-3 h-3 flex-shrink-0 text-icon-muted" aria-hidden="true" />}
                <span className="sr-only">{a.label}: </span>
                {a.value}
              </span>
            );
          })}
          {pairs.length === 0 && (
            <span className="text-sm text-foreground break-words" dir="auto">{row.name}</span>
          )}
          {expired && expiredBadge}
        </span>
      </li>
    );
  };

  /** A DIRECTORY line (contact-list pattern): bold name, muted labelled
   *  detail beneath, price at the end when the list prices things. */
  const directoryRow = (group: FactListGroup, section: FactListSection, row: FactRowDto, expired: boolean, dropKey = false) => {
    const pairs = rowDisplayAttributes(section, row, { keepKey: !dropKey });
    return (
      <li key={row.id} className="list-none">
        <button
          type="button"
          onClick={() => openEntity(group, { collection: section.collection, row })}
          className={`w-full min-h-[52px] flex items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-100 active:bg-surface-200 transition-colors ${expired ? 'opacity-60 hover:opacity-100' : ''}`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground break-words" dir="auto">{row.name}</span>
              {expired && expiredBadge}
            </span>
            {pairs.length > 0 && (
              <span className="block text-xs text-muted-foreground mt-0.5 break-words" dir="auto">
                {pairs.map((a) => `${a.label}: ${a.value}`).join(t('lists.listSeparator'))}
              </span>
            )}
          </span>
          {priceTag(row)}
          {editChip}
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
      <div className="mt-3 rounded-xl border border-theme-border bg-muted/40 divide-y divide-theme-border/60">
        {collections.map((collection) => (
          <div key={collection.id} className="px-3 py-2.5">
            {collection.isComplete === null ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground">{collection.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{t('lists.completenessAsk')}</span>
                  <span className="block text-[11px] text-muted-foreground/80 mt-0.5">{t('lists.completenessHint')}</span>
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
        {!aggregates && collections.map((collection) => {
          const syntheticGroup: FactListGroup = {
            key: collection.id,
            title: collection.label,
            rows: collection.rows.map((row) => ({ collection, row })),
          };
          const [section] = sectionizeGroup(syntheticGroup, [collection]);
          if (!section) return null;
          const live = section.rows.filter((r) => !isExpired(r.row));
          const expiredRows = section.rows.filter((r) => isExpired(r.row));
          const expanded = !!showExpired[collection.id];
          return (
            <div key={collection.id} className="rounded-xl border border-theme-border overflow-hidden">
              <div className="px-4 pt-3 pb-2 border-b border-theme-border bg-muted/30">
                <h3 className="text-[15px] font-bold text-foreground" dir="auto">{collection.label}</h3>
              </div>
              {(() => {
                // Grouped by the list's KEY value (the merchant's search axis —
                // «which pharmacies are in area X» — and the same axis the
                // reply engine gates rows by). Falls back to the flat list
                // whenever the data doesn't compress (no key / all unique).
                const keyGroups = sectionKeyGroups(section, live);
                if (!keyGroups) {
                  return (
                    <ul className="divide-y divide-theme-border/60">
                      {live.map((entry) => directoryRow(syntheticGroup, section, entry.row, false))}
                      {expanded && expiredRows.map((entry) => directoryRow(syntheticGroup, section, entry.row, true))}
                    </ul>
                  );
                }
                return (
                  <div>
                    {keyGroups.map((kg) => (
                      <div key={kg.value ?? '__missing__'}>
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-y border-theme-border/60 first:border-t-0">
                          <span className="text-xs font-bold text-foreground break-words" dir="auto">
                            {kg.display ?? t('lists.missingKeyGroup', { label: collection.keyAttr ?? '' })}
                          </span>
                          <span className="text-[11px] text-muted-foreground">({kg.rows.length})</span>
                          {kg.display && collection.keyAttr && (
                            <button
                              type="button"
                              onClick={() => setEditing({
                                collection,
                                row: null,
                                initial: { attributes: [{ label: collection.keyAttr as string, value: kg.display as string }] },
                              })}
                              aria-label={`${t('lists.addItem')} — ${kg.display}`}
                              className="ms-auto min-h-[28px] inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                            >
                              <Plus className="w-3 h-3" aria-hidden="true" />
                              {t('lists.addItem')}
                            </button>
                          )}
                        </div>
                        <ul className="divide-y divide-theme-border/60">
                          {kg.rows.map((entry) => directoryRow(syntheticGroup, section, entry.row, false, !!kg.display))}
                        </ul>
                      </div>
                    ))}
                    {expanded && expiredRows.length > 0 && (
                      <ul className="divide-y divide-theme-border/60 border-t border-theme-border/60">
                        {expiredRows.map((entry) => directoryRow(syntheticGroup, section, entry.row, true))}
                      </ul>
                    )}
                  </div>
                );
              })()}
              <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-t border-theme-border">
                <button
                  type="button"
                  onClick={() => setEditing({ collection, row: null })}
                  className="min-h-[32px] inline-flex items-center gap-1 rounded-full border border-dashed border-theme-border px-2.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                >
                  <Plus className="w-3 h-3" aria-hidden="true" />
                  {t('lists.addItem')}
                </button>
                {expiredRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowExpired((prev) => ({ ...prev, [collection.id]: !expanded }))}
                    aria-expanded={expanded}
                    className="ms-auto min-h-[32px] inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('lists.expiredToggle', { count: expiredRows.length })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {aggregates && groups.map((group) => {
          const sections = sectionizeGroup(group, collections);
          const expiredCount = group.rows.filter((r) => isExpired(r.row)).length;
          const expanded = !!showExpired[group.key];
          return (
            <div key={group.key} className="rounded-xl border border-theme-border overflow-hidden">
              <div className="flex items-center justify-between gap-2 flex-wrap px-4 pt-3 pb-2 border-b border-theme-border bg-muted/30">
                <h3 className="text-[15px] font-bold text-foreground" dir="auto">{group.title}</h3>
                {collections.some(isDatedCollection) && (() => {
                  // «قادمة» is a promise — only rows with a REAL future start
                  // date earn it (round-8: wrong counts destroy trust).
                  // Undated announced sessions get their own neutral badge
                  // instead of inflating the upcoming number.
                  const live = group.rows.filter((r) =>
                    isDatedCollection(r.collection) && !isExpired(r.row));
                  const scheduled = live.filter((r) => !!r.row.startsAt).length;
                  const unscheduled = live.length - scheduled;
                  return scheduled > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                      {t('lists.upcomingCount', { count: scheduled })}
                    </span>
                  ) : unscheduled > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {t('lists.announcedCount', { count: unscheduled })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {t('lists.noSessions')}
                    </span>
                  );
                })()}
              </div>

              {/* Tier blocks — each price line with ITS dates directly under
                  it (owner: «كل دورة ومعها كل معلوماتها»). Same matching as
                  the entity form, so what you see is what the form edits. */}
              {(() => {
                const sectionOf = (collectionId: string) =>
                  sections.find((sec) => sec.collection.id === collectionId);
                const { blocks, orphans } = buildTierBlocks(group, collections, faceLabel);
                const datedCollection = collections.find(isDatedCollection);
                // Collapsible per tier (expert's one architectural ask): the
                // count line doubles as the toggle, open by default (owner
                // ruling — see collapsedSessions above).
                const sessionZone = (rows: typeof group.rows, zoneKey: string) => {
                  const collapsed = !!collapsedSessions[zoneKey];
                  const liveCount = rows.filter((r) => !isExpired(r.row)).length;
                  return (
                    <div className="mx-3 mb-3 rounded-xl bg-muted/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setCollapsedSessions((prev) => ({ ...prev, [zoneKey]: !collapsed }))}
                        aria-expanded={!collapsed}
                        className="w-full min-h-[32px] flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${collapsed ? 'ltr:-rotate-90 rtl:rotate-90' : ''}`}
                          aria-hidden="true"
                        />
                        {/* Neutral count — the toggle groups dated AND undated
                            rows, so it must not promise «قادمة» (round-8). */}
                        {t('lists.sessionsCount', { count: liveCount })}
                      </button>
                      {!collapsed && (
                        <ul className="divide-y divide-theme-border/50">
                          {rows.filter((r) => !isExpired(r.row)).map((entry) => {
                            const sec = sectionOf(entry.collection.id);
                            return sec && sessionRow(sec, entry.row, false);
                          })}
                          {expanded && rows.filter((r) => isExpired(r.row)).map((entry) => {
                            const sec = sectionOf(entry.collection.id);
                            return sec && sessionRow(sec, entry.row, true);
                          })}
                        </ul>
                      )}
                    </div>
                  );
                };
                const soleBase = blocks.filter((b) => b.base).length === 1;
                // The explanatory sentence appears once per card — three empty
                // tiers repeating «لا مواعيد معلنة بعد» was round-6 point 6;
                // later tiers keep only the compact add action.
                let gapHintShown = false;
                return (
                  <>
                    {blocks.map((block, bi) => {
                      const baseSection = block.base ? sectionOf(block.base.collection.id) : null;
                      const liveSessions = block.sessions.filter((r) => !isExpired(r.row));
                      const showSessions = liveSessions.length > 0 || (expanded && block.sessions.length > 0);
                      const showGapHint = !gapHintShown && block.base && datedCollection && liveSessions.length === 0;
                      if (showGapHint) gapHintShown = true;
                      return (
                        <div key={block.base?.row.id ?? `tier-${bi}`} className={bi > 0 ? 'border-t border-theme-border' : ''}>
                          {block.base && baseSection && (
                            <ul>{tierRow(group, baseSection, block.base.row, isExpired(block.base.row), { soleBase })}</ul>
                          )}
                          {showSessions && sessionZone(block.sessions, `${group.key}:${block.base?.row.id ?? `tier-${bi}`}`)}
                          {showGapHint && (
                            <div className="mx-3 mb-3 rounded-xl bg-muted/40 px-3 py-2">
                              <span className="text-xs text-muted-foreground" dir="auto">
                                {t('lists.tierGap', { list: datedCollection?.label ?? '' })}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {orphans.length > 0 && (
                      <div className="border-t border-theme-border pt-1">
                        {datedCollection && (
                          <p className="px-4 pt-1 pb-1 text-[11px] font-semibold text-muted-foreground" dir="auto">
                            {datedCollection.label}
                          </p>
                        )}
                        {sessionZone(orphans, `${group.key}:orphans`)}
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-t border-theme-border">
                {/* Progressive disclosure: one quiet «+» per card; the
                    per-list choices appear only while adding. With a single
                    list there is nothing to choose — go straight to the sheet. */}
                {(() => {
                  const base = collections.find((c) => !isDatedCollection(c)) ?? collections[0];
                  const label = faceLabel
                    ? t('lists.addNamed', { thing: faceLabel })
                    : t('lists.addItem');
                  return (
                    <button
                      type="button"
                      onClick={() => addFromGroup(group, base)}
                      className="min-h-[32px] inline-flex items-center gap-1 rounded-full border border-dashed border-theme-border px-2.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      {label}
                    </button>
                  );
                })()}
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

      {entityEditing && (
        <FactEntitySheet
          unit={entityEditing.unit}
          baseCollection={entityEditing.baseCollection}
          saving={saving}
          onSave={saveEntity}
          onClose={() => setEntityEditing(null)}
        />
      )}

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

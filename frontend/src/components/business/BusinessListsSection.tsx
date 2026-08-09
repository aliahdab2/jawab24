import React, { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListChecks, CalendarClock, Pencil, ChevronDown, CalendarDays, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { isRowLive, MAX_COLLECTIONS_PER_PAGE, MAX_ROWS_PER_COLLECTION, normalizeArabic } from '@jawab24/shared';
import { factCollectionsApi, type FactCollectionWithRows, type FactRowDto, type FactEntitySaveBody } from '@/lib/api';
import { addErrorBreadcrumb, captureError, getBackendErrorCode, getStatusCode } from '@/lib/sentryHelpers';
import { authorizationOutcome, AUTHORIZATION_MESSAGE_KEY } from '@/utils/authorizationOutcome';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate, formatPlainDateParts } from '@/utils/dateUtils';
import { groupFactCollections, rowKeyValue, type FactListGroup } from '@/utils/factListGrouping';
import {
  sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels,
  discoverFaceLabel, buildEntityUnit, buildTierBlocks, isDatedCollection,
  sessionValueKind, sectionKeyGroups, sectionPartitionLabel, type FactListSection, type FactEntityUnit,
} from '@/utils/factListLayout';
import { useLanguage } from '@/i18n/hooks';
import { ListRowSheet } from './ListRowSheet';
import { FactEntitySheet } from './FactEntitySheet';
import { NewListSheet } from './NewListSheet';

interface BusinessListsSectionProps {
  pageId: string;
  /**
   * View-only (workspace `member`). Every row write — add, edit, delete,
   * completeness — is `requireRole('admin')` server-side
   * (`routes/factCollections.ts`), so a member reads the lists and gets none of
   * the affordances. The rows themselves stay legible: what the AI answers from
   * is information the whole workspace needs.
   */
  readOnly?: boolean;
}

interface EditingState {
  collection: FactCollectionWithRows;
  row: FactRowDto | null;
  /** Prefill for a NEW row added from an entity card: the card's name and,
   *  when the card already has a row in that keyed list, its key value. */
  initial?: { name?: string; attributes?: { label: string; value: string }[] };
}

/**
 * «قوائم النشاط» — the fact-list editor (G1b slices 1–4).
 *
 * Visibility: a page with collections renders them for every workspace role.
 * A page WITHOUT collections shows an admin the empty state with the «add
 * list» door (slice 4 — before it, collections were born only from reviewed
 * extraction/seeding and this section rendered nothing); a plain member still
 * sees nothing — there is no affordance a member may use here, and an empty
 * pitch card would be noise on every page.
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
export function BusinessListsSection({ pageId, readOnly = false }: BusinessListsSectionProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');
  const { intlLocale } = useLanguage();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<FactCollectionWithRows[]>({
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
  /** Directory-layout pages only: which list's tab is open. The entity-card
   *  layout (aggregates) is exempt BY DESIGN — it merges lists per entity
   *  («كل دورة ومعها كل معلوماتها», the owner's ruling), and tabs-by-list
   *  would tear that entity apart again. null → the first list. */
  const [activeListId, setActiveListId] = useState<string | null>(null);
  /** In-list live search — the 213-row directory is unusable without one.
   *  One shared value is safe: at most one search box is on screen (tabs show
   *  one list; single-list pages have one card; the entity layout has one box
   *  over all cards). */
  const [listSearch, setListSearch] = useState('');
  /**
   * Entity cards start COLLAPSED to one line — name, price summary, dates
   * badge (owner ruling 2026-08-05: 40 fully-expanded course cards made the
   * pilot page ~16 screens; a price edit meant ~12 screens of scrolling).
   * This refines, not reverses, the earlier «كل دورة ومعها كل معلوماتها»
   * ruling: everything about the entity is still together — behind ONE tap,
   * and inside the open card the sessions still start expanded.
   */
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  /** Prefix for the cards' `aria-controls` IDREFs — see `panelId` below. */
  const cardsIdBase = useId();
  /** The «add list» flow (G1b creation UI): 'naming' shows the label sheet;
   *  an object is the confirmed label, for which the row sheet collects the
   *  FIRST item — the collection is created WITH that row in one atomic POST
   *  (a born-empty list renders no prompt block and no card, so it must not
   *  exist). */
  const [newList, setNewList] = useState<'naming' | { label: string } | null>(null);

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

  /**
   * A failed load must NEVER look like an empty one. Rendering `null` on error
   * told the merchant "you have no lists" when the truth was "we could not
   * reach the server" — the most alarming possible failure, indistinguishable
   * from the benign one, and invisible to Sentry because nothing reported it.
   * `return null` is now reserved for the genuinely-empty case.
   *
   * These early returns MUST stay below every hook above: the memos were added
   * by the grouped-lists work after this guard was written, and returning above
   * them would change the hook count between renders.
   */
  if (isError) {
    captureError(error, 'Failed to load fact collections', {
      tags: { action: 'load-fact-collections' },
      extra: { pageId, statusCode: getStatusCode(error), backendCode: getBackendErrorCode(error) },
    });
    return (
      <section aria-label={t('lists.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
        <p className="text-sm text-muted-foreground" role="alert">{t('lists.loadFailed')}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 min-h-[32px] inline-flex items-center gap-1 rounded-full border border-theme-border px-3 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
        >
          {tc('tryAgain')}
        </button>
      </section>
    );
  }

  // NO loading skeleton, deliberately. Absence IS the rollout gate: this section
  // renders only for pages that have collections, which today is a small
  // minority — a skeleton would flash on every /business page for a section that
  // is then going to render nothing. Pinned by "renders NOTHING for a page
  // without collections".
  if (isLoading) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fact-collections', pageId] });

  /**
   * Turn a failed write into the RIGHT instruction.
   *
   * Every failure used to surface as «تعذّر الحفظ — حاول مجدداً» / "try again",
   * which is wrong for most of them: retrying never clears a stale row (the
   * server says *reload*), never frees a full collection, and never makes the
   * last row deletable. The server now names the reason; this maps it to copy
   * and, for a stale editor, refetches so the retry can actually succeed.
   */
  const reportWriteFailure = async (error: unknown, action: string) => {
    const backendCode = getBackendErrorCode(error);
    // A 403 from the role guard is an AUTHORIZATION OUTCOME, not a defect —
    // same verdict the Business Info save reaches, from the same shared
    // classifier so the two cannot drift. It must not reach Sentry: filing an
    // ordinary refusal made every one of them look like a bug in the tracker.
    const outcome = authorizationOutcome(error);
    if (outcome) {
      addErrorBreadcrumb('authorization', `Fact-list write refused (${action})`, {
        code: outcome,
        pageId,
      });
      toast.error(tc(AUTHORIZATION_MESSAGE_KEY[outcome]));
      return;
    }
    captureError(error, `Failed to ${action}`, {
      tags: { action, backendCode: backendCode ?? 'none' },
      extra: { pageId, statusCode: getStatusCode(error), backendCode },
    });
    switch (backendCode) {
      case 'STALE_ROW':
        // The row changed under us. Retrying the same body cannot work, so
        // reload and close the sheet rather than inviting a doomed second tap.
        // BOTH editors are dismissed: each holds row ids that the refetch has
        // just invalidated, and the entity sheet can hit this too (its bulk
        // save resolves every rowId it was opened with).
        toast.error(t('lists.errStaleRow'));
        await refresh();
        setEditing(null);
        setEntityEditing(null);
        break;
      case 'ROW_LIMIT':
        toast.error(t('lists.errRowLimit', { max: MAX_ROWS_PER_COLLECTION }));
        break;
      case 'LAST_ROW':
        toast.error(t('lists.errLastRow'));
        break;
      case 'DATE_ORDER':
        toast.error(t('lists.errDateOrder'));
        break;
      case 'COLLECTION_LIMIT':
        toast.error(t('lists.errCollectionLimit', { max: MAX_COLLECTIONS_PER_PAGE }));
        break;
      case 'DUPLICATE_LABEL':
        // The naming sheet pre-checks against the LOADED labels, so reaching
        // here means another admin created the rival concurrently — refetch so
        // it appears, and keep the sheet open for a rename.
        toast.error(t('lists.errDuplicateLabel'));
        await refresh();
        break;
      default:
        toast.error(t('lists.saveFailed'));
    }
  };

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
      await reportWriteFailure(error, 'save-fact-row');
    } finally {
      setSaving(false);
    }
  };

  /** Create the named list WITH its first item — one atomic POST; the server
   *  pins source='editor' and never takes a keyAttr from this door. */
  const createList = async (body: Parameters<React.ComponentProps<typeof ListRowSheet>['onSave']>[0]) => {
    if (!newList || newList === 'naming') return;
    setSaving(true);
    try {
      await factCollectionsApi.createCollection(pageId, { label: newList.label, rows: [body] });
      await refresh();
      setNewList(null);
      toast.success(t('lists.createdList'));
    } catch (error) {
      await reportWriteFailure(error, 'create-fact-collection');
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
      await reportWriteFailure(error, 'delete-fact-row');
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
      await reportWriteFailure(error, 'set-list-completeness');
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
      await reportWriteFailure(error, 'save-fact-entity');
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

  /** Both creation sheets, shared by the empty state and the populated
   *  section — the flow is identical, only the surrounding chrome differs. */
  const createSheets = (
    <>
      {newList === 'naming' && (
        <NewListSheet
          existingLabels={collections.map((c) => c.label)}
          onContinue={(label) => setNewList({ label })}
          onClose={() => setNewList(null)}
        />
      )}
      {newList !== null && newList !== 'naming' && (
        <ListRowSheet
          row={null}
          collectionLabel={newList.label}
          keyAttr={null}
          attributeLabels={[]}
          canDelete={false}
          saving={saving}
          onSave={createList}
          onDelete={() => {}}
          onClose={() => setNewList(null)}
        />
      )}
    </>
  );

  /** The «add list» door — dashed, like every add affordance in this section.
   *  Not gated on the collection cap: the 409 copy names the limit, same
   *  stance as «إضافة عنصر» versus the row cap. */
  const addListButton = readOnly ? null : (
    <button
      type="button"
      onClick={() => setNewList('naming')}
      className="min-h-[36px] inline-flex items-center gap-1 rounded-full border border-dashed border-theme-border px-3 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
    >
      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      {t('lists.addList')}
    </button>
  );

  if (collections.length === 0) {
    // A plain member still sees nothing here — the only affordance is a write.
    if (readOnly) return null;
    return (
      <section aria-label={t('lists.title')} className="rounded-2xl border border-theme-border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <ListChecks className="w-5 h-5 text-brand-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('lists.title')}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{t('lists.emptyHint')}</p>
          </div>
        </div>
        <div className="mt-3">{addListButton}</div>
        {createSheets}
      </section>
    );
  }

  // DISPLAY grouping only — the authoritative exclusion happens server-side at
  // prompt-build time. `isRowLive` (@jawab24/shared) is the SAME predicate the
  // renderer and the SQL clause use, so the badge a merchant sees can never
  // disagree with what the AI was given. Never re-derive "expired" locally.
  const today = todayISODate();
  const isExpired = (row: FactRowDto) => !isRowLive(row, today);

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
   *  expert's point 4; the chip reads as the row's action, not as a caption.
   *  Absent when view-only: there is no action for it to name. */
  const editChip = readOnly ? null : (
    <span className="inline-flex items-center gap-1 rounded-lg bg-brand-500/10 px-2 py-1 text-[11px] font-semibold text-brand-700 dark:text-brand-300 whitespace-nowrap">
      <Pencil className="w-3 h-3" aria-hidden="true" />
      {t('lists.edit')}
    </span>
  );

  /**
   * The shell every tappable row shares: a real <button> for someone who can
   * edit, plain markup for a member. One helper rather than a `readOnly &&` at
   * each of the four row shapes — a row that forgot the check would be exactly
   * the tap-then-403 dead end this gate exists to close.
   */
  const rowShell = (base: string, expired: boolean, onClick: () => void, children: React.ReactNode) =>
    readOnly ? (
      <div className={`${base} ${expired ? 'opacity-60' : ''}`}>{children}</div>
    ) : (
      <button
        type="button"
        onClick={onClick}
        className={`${base} hover:bg-surface-100 active:bg-surface-200 transition-colors ${expired ? 'opacity-60 hover:opacity-100' : ''}`}
      >
        {children}
      </button>
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
        {rowShell(
          'w-full min-h-[52px] flex items-center gap-3 px-4 py-3 text-start',
          expired,
          () => openEntity(group, { collection: section.collection, row }),
          <>
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
          </>,
        )}
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

  /** Tri-state completeness control (D-038), compact enough to sit inline in
   *  a card header or a block row. The ASK text is the caller's job — this is
   *  only the answer/state affordance. */
  const completenessControl = (collection: FactCollectionWithRows) =>
    // View-only: the ANSWER is information (it changes what the AI claims about
    // this list), the ASK and the reset are writes. An unanswered list simply
    // shows nothing rather than a question a member cannot answer.
    readOnly ? (
      collection.isComplete === null ? null : (
        <span className="text-xs text-muted-foreground">
          {collection.isComplete ? t('lists.completenessConfirmed') : t('lists.completenessPartial')}
        </span>
      )
    ) : collection.isComplete === null ? (
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
    ) : (
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
    );

  /** A DIRECTORY line (contact-list pattern): bold name, muted labelled
   *  detail beneath, price at the end when the list prices things. */
  const directoryRow = (group: FactListGroup, section: FactListSection, row: FactRowDto, expired: boolean, dropLabel: string | null = null) => {
    const pairs = rowDisplayAttributes(
      section, row,
      dropLabel ? { keepKey: false, dropLabels: [dropLabel] } : { keepKey: true },
    );
    return (
      <li key={row.id} className="list-none">
        {rowShell(
          'w-full min-h-[44px] flex items-center gap-3 px-4 py-2 text-start',
          expired,
          () => openEntity(group, { collection: section.collection, row }),
          <>
          {/* ONE flowing line — name then muted detail; wraps only when it must.
              The two-line row cost 13 size rows twice the height they need. */}
          <span className="min-w-0 flex-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground break-words" dir="auto">{row.name}</span>
            {pairs.length > 0 && (
              <span className="text-xs text-muted-foreground break-words" dir="auto">
                {pairs.map((a) => `${a.label}: ${a.value}`).join(t('lists.listSeparator'))}
              </span>
            )}
            {expired && expiredBadge}
          </span>
          {priceTag(row)}
          {editChip}
          </>,
        )}
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

      {/* The completeness word (D-038, tri-state) belongs to the LIST — it
          changes what customers are TOLD about absence. On directory pages the
          control lives inside each list's own card (see below); the stacked
          block here serves only the entity-card layout, where cards are per
          ENTITY and per-LIST controls have no card to live in. The question +
          consequence hint are said ONCE for the whole block, not per list. */}
      {aggregates && (
        <div className="mt-3 rounded-xl border border-theme-border bg-muted/40">
          <div className="px-3 pt-2.5 pb-2 border-b border-theme-border/60">
            <span className="block text-xs font-semibold text-foreground">{t('lists.completenessAsk')}</span>
            <span className="block text-[11px] text-muted-foreground/80 mt-0.5">{t('lists.completenessHint')}</span>
          </div>
          <div className="divide-y divide-theme-border/60">
            {collections.map((collection) => (
              <div key={collection.id} className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground" dir="auto">{collection.label}</span>
                {completenessControl(collection)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Directory layout with SEVERAL lists → one list at a time behind
          wrapping pill-tabs. Stacked, a 213-row directory buried the price
          lists 4-6 screens down (owner report, 2026-08-04 — BAMBO). Pills
          (not underline tabs) so long Arabic labels WRAP on a phone instead
          of truncating or side-scrolling. Single-list pages get no bar, and
          the entity-card layout is exempt (see activeListId). */}
      {!aggregates && collections.length > 1 && (
        <div role="group" aria-label={t('lists.listTabsLabel')} className="mt-4 flex flex-wrap gap-1.5">
          {collections.map((collection) => {
            const selected = collection.id === (collections.some((c) => c.id === activeListId) ? activeListId : collections[0]?.id);
            const liveCount = collection.rows.filter((row) => isRowLive(row, today)).length;
            return (
              <button
                key={collection.id}
                type="button"
                aria-pressed={selected}
                onClick={() => { setActiveListId(collection.id); setListSearch(''); }}
                className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
                  selected
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-card text-foreground/80 border-theme-border hover:bg-surface-100'
                }`}
              >
                <span dir="auto" className="break-words text-start">{collection.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${selected ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>
                  {liveCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* One card per entity — the name appears exactly once; inside, one
          labelled section per list so a price and a session can't be
          confused. Section titles are the merchant's own list labels. */}
      <div className="mt-4 space-y-3">
        {!aggregates && collections
          .filter((collection) => collections.length <= 1
            || collection.id === (collections.some((c) => c.id === activeListId) ? activeListId : collections[0]?.id))
          .map((collection) => {
          const syntheticGroup: FactListGroup = {
            key: collection.id,
            title: collection.label,
            rows: collection.rows.map((row) => ({ collection, row })),
          };
          const [section] = sectionizeGroup(syntheticGroup, [collection]);
          if (!section) return null;
          // Live in-list search (name, any attribute, either script's digits,
          // hamza/taa-marbuta folded — the data itself spells «صيدليه زناته»).
          // Only lists long enough to be un-scannable get the box.
          const searchable = section.rows.length >= 20;
          const query = searchable ? listSearch.trim() : '';
          const fold = (s: string) => normalizeArabic(s, { normalizeTaaMarbuta: true }).toLowerCase();
          const foldedQuery = fold(query);
          const rowMatches = (row: FactRowDto) => {
            if (!foldedQuery) return true;
            if (fold(row.name).includes(foldedQuery)) return true;
            return (row.attributes ?? []).some((a) => fold(a.value).includes(foldedQuery) || fold(a.label).includes(foldedQuery));
          };
          const allLive = section.rows.filter((r) => !isExpired(r.row));
          const live = allLive.filter((r) => rowMatches(r.row));
          const expiredRows = section.rows.filter((r) => isExpired(r.row) && rowMatches(r.row));
          const expanded = !!showExpired[collection.id];
          return (
            // NO overflow-hidden on this card — it would trap the sticky area
            // headers inside it instead of letting them stick to the page's
            // scroll container.
            <div key={collection.id} className="rounded-xl border border-theme-border">
              <div className="px-4 pt-3 pb-2 border-b border-theme-border bg-muted/30 rounded-t-xl">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-[15px] font-bold text-foreground" dir="auto">{collection.label}</h3>
                  {collection.isComplete !== null && completenessControl(collection)}
                </div>
                {/* The completeness ASK lives with its list (owner: the three
                    stacked question blocks pushed all content down) — and
                    disappears once answered, leaving only the state chip. */}
                {collection.isComplete === null && (
                  <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                    <span className="min-w-0">
                      <span className="block text-xs text-muted-foreground">{t('lists.completenessAsk')}</span>
                      <span className="block text-[11px] text-muted-foreground/80 mt-0.5">{t('lists.completenessHint')}</span>
                    </span>
                    {completenessControl(collection)}
                  </div>
                )}
              </div>
              {searchable && (
                <div className="px-4 py-2.5 border-b border-theme-border/60">
                  {/* dir=auto resolves from the VALUE, and an empty value falls
                      back to LTR — which left-aligned the Arabic placeholder on
                      an RTL page (owner catch, 2026-08-04). Empty → inherit the
                      page direction; typed → auto, so a Latin query («Detox»)
                      still lays out naturally. */}
                  <input
                    type="search"
                    dir={listSearch ? 'auto' : undefined}
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    placeholder={t('lists.searchPlaceholder')}
                    aria-label={t('lists.searchPlaceholder')}
                    className="input w-full !py-2 text-sm"
                  />
                  {query && (
                    <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
                      {live.length === 0 && expiredRows.length === 0
                        ? t('lists.searchNoResults')
                        : t('lists.searchCount', { shown: live.length, total: allLive.length })}
                    </p>
                  )}
                </div>
              )}
              {(() => {
                // Grouped by the list's KEY value (the merchant's search axis —
                // «which pharmacies are in area X» — and the same axis the
                // reply engine gates rows by). Keyless lists partition by the
                // attribute the data itself elects (سلسلة عادي/جامبو on the
                // size list). Falls back to the flat list whenever the data
                // doesn't compress (no partition / all unique).
                const partitionLabel = sectionPartitionLabel(section);
                const keyGroups = sectionKeyGroups(section, live, partitionLabel);
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
                        {/* sticky: on a 224-row directory the reader must
                            always know which area they are inside. The offset
                            mirrors the mobile top bar (fixed, h-14 sm:h-16,
                            landscape h-10, hidden from lg) — top-0 alone pins
                            the header BEHIND that bar. Solid bg (not /60) so
                            scrolled rows don't ghost through. The value sits
                            in a FILLED brand pill — items are outlined chips,
                            the header is filled: unmistakably a heading. */}
                        <div className="sticky top-14 sm:top-16 max-lg:landscape:top-10 lg:top-0 z-10 flex items-center gap-2 px-4 py-2 bg-surface-100 border-y border-theme-border/60 border-s-[3px] border-s-brand-500 first:border-t-0">
                          <span className="rounded-full bg-brand-600 text-white text-[15px] font-bold px-3.5 py-1 break-words" dir="auto">
                            {kg.display ?? t('lists.missingKeyGroup', { label: partitionLabel ?? '' })}
                          </span>
                          <span className="min-w-[24px] text-center rounded-full bg-card border border-theme-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">{kg.rows.length}</span>
                          {!readOnly && kg.display && partitionLabel && (
                            <button
                              type="button"
                              onClick={() => setEditing({
                                collection,
                                row: null,
                                initial: { attributes: [{ label: partitionLabel, value: kg.display as string }] },
                              })}
                              aria-label={`${t('lists.addItem')} — ${kg.display}`}
                              className="ms-auto min-h-[28px] inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                            >
                              <Plus className="w-3 h-3" aria-hidden="true" />
                              {t('lists.addItem')}
                            </button>
                          )}
                        </div>
                        {/* Name-only rows (no price, no attributes left once the
                            header said the key) compress into wrapped chips —
                            224 pharmacies must not cost 224 full-width rows.
                            One row carrying more detail keeps the whole group
                            on full rows, so a group never mixes densities.
                            Narrow screens use a 2-column grid — long Arabic
                            names made free pills fall one per line on mobile;
                            from sm: the pills flow freely. */}
                        {kg.rows.every((entry) =>
                          rowDisplayAttributes(section, entry.row, kg.display && partitionLabel ? { keepKey: false, dropLabels: [partitionLabel] } : { keepKey: true }).length === 0 && !entry.row.price,
                        ) ? (
                          <ul className="grid grid-cols-2 gap-2 px-4 py-3 sm:flex sm:flex-wrap">
                            {kg.rows.map((entry) => (
                              <li key={entry.row.id} className="list-none min-w-0">
                                {readOnly ? (
                                  <span
                                    title={entry.row.name}
                                    className="w-full sm:w-auto min-w-0 min-h-[36px] inline-flex items-center justify-between sm:justify-start gap-1.5 rounded-full border border-theme-border bg-card px-3 py-1 text-sm text-foreground"
                                  >
                                    <span dir="auto" className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap sm:whitespace-normal sm:break-words text-start">{entry.row.name}</span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openEntity(syntheticGroup, { collection: section.collection, row: entry.row })}
                                    title={entry.row.name}
                                    className="w-full sm:w-auto min-w-0 min-h-[36px] inline-flex items-center justify-between sm:justify-start gap-1.5 rounded-full border border-theme-border bg-card px-3 py-1 text-sm text-foreground hover:bg-surface-100 active:bg-surface-200 transition-colors"
                                  >
                                    <span dir="auto" className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap sm:whitespace-normal sm:break-words text-start">{entry.row.name}</span>
                                    <Pencil className="w-3 h-3 text-icon-muted flex-shrink-0" aria-hidden="true" />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <ul className="divide-y divide-theme-border/60">
                            {kg.rows.map((entry) => directoryRow(syntheticGroup, section, entry.row, false, kg.display ? partitionLabel : null))}
                          </ul>
                        )}
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
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setEditing({ collection, row: null })}
                    className="min-h-[32px] inline-flex items-center gap-1 rounded-full border border-dashed border-theme-border px-2.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-surface-100"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    {t('lists.addItem')}
                  </button>
                )}
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
        {aggregates && (() => {
          // Live search over ALL entity cards — same folding as the directory
          // search (either script's digits, hamza/taa-marbuta), matching the
          // entity name and any row name/attribute. The pilot page holds 40
          // cards; without a box, reaching one specific course is a scroll
          // hunt even with collapsed rows.
          const fold = (s: string) => normalizeArabic(s, { normalizeTaaMarbuta: true }).toLowerCase();
          // `searchable` gates the QUERY itself, not just the box — same rule as
          // the directory search above. Below the threshold the box is gone, so a
          // value left over from a larger list would filter nothing yet still
          // force every card open, with nothing on screen to clear it.
          const searchable = groups.length >= 8;
          const query = searchable ? fold(listSearch.trim()) : '';
          const groupMatches = (group: FactListGroup) => {
            if (!query) return true;
            if (fold(group.title).includes(query)) return true;
            return group.rows.some(({ row }) =>
              fold(row.name).includes(query)
              || (row.attributes ?? []).some((a) => fold(a.value).includes(query) || fold(a.label).includes(query)));
          };
          const visibleGroups = searchable ? groups.filter(groupMatches) : groups;
          return (
            <>
              {searchable && (
                <div>
                  {/* Same dir rule as the directory box: empty → inherit the
                      page direction (an empty value's dir=auto falls back to
                      LTR and left-aligns the Arabic placeholder). */}
                  <input
                    type="search"
                    dir={listSearch ? 'auto' : undefined}
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    placeholder={t('lists.searchAllPlaceholder')}
                    aria-label={t('lists.searchAllPlaceholder')}
                    className="input w-full !py-2 text-sm"
                  />
                  {query && (
                    <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
                      {/* Its own key: this box counts entity CARDS, and the
                          directory's `searchCount` says «صفوف»/rows — reusing it
                          reported «صفًا واحدًا من أصل 8» for one course. */}
                      {visibleGroups.length === 0
                        ? t('lists.searchNoResults')
                        : t('lists.searchCountCards', { shown: visibleGroups.length, total: groups.length })}
                    </p>
                  )}
                </div>
              )}
              {visibleGroups.map((group, groupIndex) => {
          // IDREF for aria-controls. `group.key` is the normalized entity name
          // (Arabic, with spaces) — never a valid HTML id, so index off useId.
          const panelId = `${cardsIdBase}-panel-${groupIndex}`;
          const sections = sectionizeGroup(group, collections);
          const expiredCount = group.rows.filter((r) => isExpired(r.row)).length;
          const expanded = !!showExpired[group.key];
          // A search hit renders OPEN: the merchant searched to see the item's
          // details, not to be handed another closed door.
          const open = query ? true : !!openCards[group.key];
          /** Collapsed-row price summary from the live base rows: one price, or
           *  the min–max span when tiers differ. Display only.
           *
           *  A span is only honest within ONE currency: the demo's ICDL group
           *  holds 35,000 ل.س beside a 10.00-USD online tier, and «10–35,000
           *  ل.س» would launder the dollar into lira (same failure family as
           *  the bundle-unit price bug). Mixed currencies → the majority
           *  currency's span alone. */
          const priceSummary = (() => {
            const priced = group.rows
              .filter((r) => !isExpired(r.row) && r.row.price)
              .map((r) => ({ raw: r.row.price as string, num: Number(r.row.price), currency: r.row.currency ?? '' }));
            if (priced.length === 0) return null;
            const byCurrency = new Map<string, number[]>();
            for (const p of priced) {
              if (!Number.isFinite(p.num)) continue;
              byCurrency.set(p.currency, [...(byCurrency.get(p.currency) ?? []), p.num]);
            }
            // Every price non-numeric («حسب الطلب») → show the first as-is.
            if (byCurrency.size === 0) return displayPrice(priced[0].raw);
            const [currency, nums] = [...byCurrency.entries()]
              .sort((a, b) => b[1].length - a[1].length)[0];
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const span = min === max
              ? min.toLocaleString(intlLocale)
              : `${min.toLocaleString(intlLocale)}–${max.toLocaleString(intlLocale)}`;
            return currency ? `${span} ${currency}` : span;
          })();
          const datesBadge = collections.some(isDatedCollection) && (() => {
            // «قادمة» is a promise — only rows with a REAL future start
            // date earn it (round-8: wrong counts destroy trust).
            // Undated announced sessions get their own neutral badge
            // instead of inflating the upcoming number.
            const live = group.rows.filter((r) =>
              isDatedCollection(r.collection) && !isExpired(r.row));
            const scheduled = live.filter((r) => !!r.row.startsAt).length;
            const unscheduled = live.length - scheduled;
            return scheduled > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
                {t('lists.upcomingCount', { count: scheduled })}
              </span>
            ) : unscheduled > 0 ? (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                {t('lists.announcedCount', { count: unscheduled })}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                {t('lists.noSessions')}
              </span>
            );
          })();
          return (
            <div key={group.key} className="rounded-xl border border-theme-border overflow-hidden">
              {/* The whole header is the toggle — one line per entity while
                  closed (name · price span · dates badge), the full card on
                  tap. The badge and summary stay visible either way, so
                  closing a card never hides the answer to «بقديش؟».

                  The HEADING WRAPS THE BUTTON (WAI-ARIA APG accordion). The
                  reverse — an <h3> inside the <button> — is invalid HTML: a
                  button takes phrasing content only, and nesting flow content
                  in it costs the entity its heading semantics. */}
              <h3>
                <button
                  type="button"
                  onClick={() => setOpenCards((prev) => ({ ...prev, [group.key]: !open }))}
                  aria-expanded={open}
                  // The panel is unmounted while collapsed, so the IDREF only
                  // resolves when open — a dangling aria-controls is worse than
                  // none (AT announces a target that isn't there).
                  aria-controls={open ? panelId : undefined}
                  className={`w-full flex items-center gap-2 px-4 py-3 bg-muted/30 text-start hover:bg-muted/50 transition-colors ${open ? 'border-b border-theme-border' : ''}`}
                >
                  {/* Name, price and badge WRAP as a unit; only the chevron is
                      pinned. With all four in one flex row, a long course name on
                      a 412px phone was squeezed to a one-character column («دور/
                      ة/الح…») by the price span beside it. */}
                  <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[15px] font-bold text-foreground min-w-0 max-w-full break-words" dir="auto">{group.title}</span>
                    {priceSummary && (
                      <span className="text-sm font-semibold text-foreground whitespace-nowrap tabular-nums" dir="auto">
                        {priceSummary}
                      </span>
                    )}
                    {datesBadge}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 flex-shrink-0 text-icon-muted transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </h3>
              {open && (<div id={panelId}>
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
                // The explanatory sentence appears once per card (three empty
                // tiers repeating it was round-6 point 6) — and ONLY on cards
                // with no announced dates AT ALL: on a card where another tier
                // has dates, a tier's absence is already visible by contrast,
                // and the card badge counts the announced sessions anyway.
                const cardHasLiveSessions =
                  blocks.some((b) => b.sessions.some((r) => !isExpired(r.row))) ||
                  orphans.some((r) => !isExpired(r.row));
                let gapHintShown = cardHasLiveSessions;
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
                          {/* A session-only block has no tier row — and the tier
                              row is the entity sheet's ONLY door. Without this
                              fallback, an entity whose rows are all schedule
                              rows (or whose base row is missing) renders with
                              nothing tappable: the exact «cannot edit the
                              course» dead end. The chip carries the accessible
                              name; the sessions themselves stay non-interactive
                              as everywhere else. */}
                          {!readOnly && !block.base && block.sessions.length > 0 && (
                            <ul>
                              <li className="list-none">
                                {rowShell(
                                  'w-full min-h-[44px] flex items-center justify-end px-4 py-2 text-start',
                                  false,
                                  () => openEntity(group, block.sessions[0]),
                                  editChip,
                                )}
                              </li>
                            </ul>
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
                  {!readOnly && (() => {
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
              </div>)}
            </div>
          );
              })}
            </>
          );
        })()}
      </div>

      {addListButton && <div className="mt-3">{addListButton}</div>}

      {createSheets}

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

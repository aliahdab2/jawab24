import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, ScanSearch, Trash2, X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button, CharCounter, Textarea } from '@/components/ui';
import { FileUploadButton } from '@/components/knowledge-base/FileUploadButton';
import { catalogApi, type CatalogExtractResponse, type CatalogItemInput } from '@/lib/api';
import {
  MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEMS_PER_PAGE, reconcileCatalogProposals,
  type CatalogVertical, type ReconcileExistingItem, type ReconcileKind,
} from '@jawab24/shared';
import {
  CatalogItemFields, draftDatesInvalid, draftFromInput, draftToInput, type CatalogItemDraft,
} from './CatalogItemFields';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { todayISODate } from '@/utils/dateUtils';

/** Below this the extract button stays disabled — mirrors the backend Zod min,
 *  so the merchant never burns a click on a request that would 400. */
const MIN_IMPORT_CHARS = 10;

type Phase = 'input' | 'extracting' | 'scanning' | 'review' | 'saving';

/** The merchant's call on an `update`-classified row (D-038: default = keep —
 *  a price change must be an explicit choice, never a side effect of saving). */
type UpdateChoice = 'keep' | 'update' | 'separate';

interface ProposalRow {
  id: number;
  draft: CatalogItemDraft;
  removed: boolean;
  expanded: boolean;
  nameError: boolean;
  /** Arrival-time reconcile vs the existing catalog. 'new' has no match. */
  kind: ReconcileKind;
  match: ReconcileExistingItem | null;
  updateChoice: UpdateChoice;
}

/** Add-bound rows INSERT via /batch; an `update` row only inserts when the
 *  merchant explicitly chose "add as separate" (a restored duplicate is the
 *  merchant overriding the auto-deselect — also an insert). */
function isAddBound(row: ProposalRow): boolean {
  return row.kind !== 'update' || row.updateChoice === 'separate';
}

interface CatalogImportSheetProps {
  pageId: string;
  /** 'paste' (default): paste/upload → extract. 'scan': read the page's recent
   *  FB posts server-side — no input step, opens straight into the review.
   *  'scanReplies': same, from the page's configured Post Reply auto-replies. */
  mode?: 'paste' | 'scan' | 'scanReplies';
  /** The page's current catalog (any CatalogItem[] fits) — proposals are
   *  classified against it (D-038: new / already-there / price-changed)
   *  instead of blind-inserting. */
  existingItems?: ReconcileExistingItem[];
  /** Page vertical — picks the name example shown on an expanded review row. */
  vertical?: CatalogVertical;
  /** Applied at save to rows that got a price but no currency (posts and
   *  pasted lists rarely state one; a bare number reads ambiguous to the AI). */
  defaultCurrency?: string;
  /** Pre-filled paste (e.g. arriving from the Business Info price-list warning). */
  initialText?: string;
  /** scanReplies only: the scan reported the page has no Post Reply configured —
   *  the host hides the action (the presence gate closing after the fact). */
  onNoPostReplies?: () => void;
  /** Called with the number of items created + the first created item's name
   *  (feeds the "try asking Jawab about it" nudge) + the number of existing
   *  items whose price was updated — parent refreshes + closes. */
  onDone: (count: number, firstItemName?: string, updatedCount?: number) => void;
  onClose: () => void;
}

/**
 * Bulk import: paste/upload (or a posts scan) → AI extracts proposals →
 * merchant reviews → save all. Nothing is persisted until the final step, and
 * no failure path ever discards what the merchant typed or reviewed (M5).
 * One DetailSheet with an internal phase machine — review rows expand inline
 * (never a nested sheet; that breaks on mobile keyboards).
 *
 * The review step doubles as PRICE COMPLETION: merchants deliberately keep
 * prices out of public posts (comment-bait is their growth loop), so scanned
 * rows often arrive priceless — the AI can only deflect on those ("price on
 * request"). Missing prices get a warning badge + a count-up nudge; prices
 * stay private (only ever sent inside replies/DMs, never posted).
 */
export function CatalogImportSheet({
  pageId, mode = 'paste', existingItems, vertical, defaultCurrency, initialText, onNoPostReplies, onDone, onClose,
}: CatalogImportSheetProps) {
  const t = useTranslations('catalog');

  const isScanMode = mode === 'scan' || mode === 'scanReplies';
  const [phase, setPhase] = useState<Phase>(isScanMode ? 'scanning' : 'input');
  const [text, setText] = useState(initialText ?? '');
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [meta, setMeta] = useState<Pick<CatalogExtractResponse, 'dropped' | 'overflow' | 'truncated'> | null>(null);
  const [scanUpToDate, setScanUpToDate] = useState(false);
  const [noPostReplies, setNoPostReplies] = useState(false);

  /** Classify arriving proposals against the current catalog (D-038): a name
   *  already there with the same price starts DESELECTED (nothing to do); with
   *  a different price it becomes an explicit update-vs-keep decision. Runs
   *  once at arrival — the classification is the review's starting point, not
   *  a live validator chasing the merchant's edits. */
  const buildRows = (items: CatalogItemInput[]): ProposalRow[] => {
    const classified = reconcileCatalogProposals(
      items.map((input) => {
        const n = typeof input.price === 'number' ? input.price : Number(input.price);
        return {
          name: input.name,
          price: input.price == null || input.price === '' || !Number.isFinite(n) ? null : n,
          currency: input.currency ?? null,
          input,
        };
      }),
      existingItems ?? [],
    );
    return classified.map((c, i) => ({
      id: i,
      draft: draftFromInput(c.proposal.input),
      removed: c.kind === 'duplicate',
      expanded: false,
      nameError: false,
      kind: c.kind,
      match: c.match,
      updateChoice: 'keep' as UpdateChoice,
    }));
  };

  const activeRows = rows.filter((r) => !r.removed);
  /** Rows the save will INSERT / rows whose matched item gets a price PATCH.
   *  `keep` update-rows and deselected duplicates contribute to neither. */
  const addRows = activeRows.filter(isAddBound);
  const updateRows = activeRows.filter((r) => r.kind === 'update' && r.updateChoice === 'update');
  // The price nudge concerns rows about to be INSERTED priceless — an update
  // row's matched item already has whatever price the merchant kept.
  const pricelessCount = addRows.filter((r) => !r.draft.price.trim()).length;

  // Scan modes fire immediately on mount — there is no input step. The ref
  // guards React 18 dev double-invoke (a second POST would burn the rate limit).
  const scanFired = useRef(false);
  useEffect(() => {
    if (!isScanMode || scanFired.current) return;
    scanFired.current = true;
    (async () => {
      try {
        if (mode === 'scanReplies') {
          const { data } = await catalogApi.scanPostReplies(pageId);
          if (data.noPostReplies) {
            // Presence gate closed after the fact: nothing was scanned (and no
            // paid call burned) — show why in place, and let the host hide the
            // action so the dead end isn't offered again.
            setNoPostReplies(true);
            onNoPostReplies?.();
            setPhase('review');
            return;
          }
          setRows(buildRows(data.items));
          setMeta({ dropped: data.dropped, overflow: data.overflow, truncated: data.truncated });
        } else {
          const { data } = await catalogApi.scanPosts(pageId);
          setRows(buildRows(data.items));
          setMeta({ dropped: data.dropped, overflow: data.overflow, truncated: data.truncated });
          setScanUpToDate(data.upToDate);
        }
        setPhase('review');
      } catch (err) {
        // Nothing typed, nothing lost — toast and close; the scan button remains.
        const code = (err as AxiosError<{ code?: string }>).response?.data?.code;
        if (code === 'daily_limit_reached') toast.error(t('import.toastDailyLimit'));
        else if (code === 'CATALOG_LIMIT_REACHED') toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
        // The page lost its Facebook connection (or never had one). `postsScanBlocker`
        // hides the action for this case, so reaching here means the token died
        // between render and click — "try again" would be false advice.
        else if (code === 'PAGE_DISCONNECTED') toast.error(t('scan.toastDisconnected'));
        else toast.error(t('scan.toastError'));
        onClose();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once mount effect
  }, []);

  const appendExtractedFile = (extracted: string) => {
    setText((prev) => (prev ? `${prev}\n\n${extracted}` : extracted).slice(0, MAX_CATALOG_IMPORT_CHARS));
  };

  const patchRow = (id: number, patch: Partial<ProposalRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const patchRowDraft = (id: number, patch: Partial<CatalogItemDraft>) => {
    setRows((prev) => prev.map((r) => (r.id === id
      ? { ...r, draft: { ...r.draft, ...patch }, nameError: patch.name !== undefined ? false : r.nameError }
      : r)));
  };

  const extract = async () => {
    setPhase('extracting');
    try {
      const { data } = await catalogApi.extract(pageId, text.trim());
      setRows(buildRows(data.items));
      setMeta({ dropped: data.dropped, overflow: data.overflow, truncated: data.truncated });
      setPhase('review');
    } catch (err) {
      // Whatever went wrong, the pasted text stays — back to input.
      const axiosErr = err as AxiosError<{ code?: string }>;
      const code = axiosErr.response?.data?.code;
      if (code === 'CATALOG_LIMIT_REACHED') {
        toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
      } else if (code === 'daily_limit_reached') {
        toast.error(t('import.toastDailyLimit'));
      } else {
        toast.error(t('import.toastExtractError'));
      }
      setPhase('input');
    }
  };

  const saveAll = async () => {
    // A row edited to a blank name can't be saved — surface it inline instead
    // of a rejected batch (same one-required-field rule as the manual form).
    // Only add-bound rows: an update PATCHes price/currency, never the name.
    const blank = addRows.find((r) => !r.draft.name.trim());
    if (blank) {
      patchRow(blank.id, { expanded: true, nameError: true });
      return;
    }
    // Inverted dates: expand the row — the end-date field shows the inline error.
    const badDates = addRows.find((r) => draftDatesInvalid(r.draft));
    if (badDates) {
      patchRow(badDates.id, { expanded: true });
      return;
    }

    setPhase('saving');
    try {
      // Confirmed updates FIRST: each PATCH is idempotent, so if the batch
      // insert below fails, retrying the whole save re-applies them harmlessly.
      // Price/currency only (D-038: the source proposes a price, nothing else)
      // — and a proposal that never asserted a currency must not overwrite the
      // stored one, so `currency` is omitted when the draft has none (the
      // defaultCurrency fallback is for INSERTS, not existing rows).
      await Promise.all(updateRows.map((r) => {
        const data: { price: string | null; currency?: string } = {
          price: r.draft.price.trim() === '' ? null : r.draft.price.trim(),
        };
        if (r.draft.currency.trim()) data.currency = r.draft.currency.trim();
        // updateRows are 'update'-classified, which always carries a match.
        return catalogApi.update(pageId, r.match!.id, data);
      }));

      if (addRows.length > 0) {
        await catalogApi.batchCreate(pageId, addRows.map((r) => {
          const input = draftToInput(r.draft);
          // Currency fallback: a typed price with no stated currency inherits
          // the page's last-used one (extraction rarely finds a currency in posts).
          if (input.price != null && !input.currency && defaultCurrency) input.currency = defaultCurrency;
          return input;
        }));
      }
      onDone(addRows.length, addRows[0]?.draft.name.trim() || undefined, updateRows.length);
    } catch (err) {
      // Review state is kept — a failed save must not eat the merchant's edits.
      const axiosErr = err as AxiosError<{ code?: string }>;
      if (axiosErr.response?.data?.code === 'CATALOG_LIMIT_REACHED') {
        toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
      } else {
        // "Couldn't add the items" would misdescribe a save that carried
        // confirmed price updates — use the generic changes copy then.
        toast.error(updateRows.length > 0 ? t('reconcile.toastSaveError') : t('import.toastImportError'));
      }
      setPhase('review');
    }
  };

  /** Merchant-facing price text for the update-conflict line. */
  const priceLabel = (price: string | null, currency: string | null): string => {
    if (price === null || price === '') return t('reconcile.noPrice');
    const p = formatCatalogPrice(price);
    return currency ? `${p} ${currency}` : p;
  };

  /** [title, hint] for the empty review card — each entry path has its own story. */
  const emptyStateKeys = (): [string, string] => {
    if (mode === 'scanReplies') {
      return noPostReplies
        ? ['replyScan.noReplies', 'replyScan.noRepliesHint']
        : ['replyScan.emptyResult', 'replyScan.emptyResultHint'];
    }
    if (mode === 'scan') {
      return scanUpToDate ? ['scan.upToDate', 'scan.upToDateHint'] : ['scan.emptyResult', 'scan.emptyResultHint'];
    }
    return ['import.emptyResult', 'import.emptyResultHint'];
  };
  const [emptyTitleKey, emptyHintKey] = emptyStateKeys();

  const titleId = 'catalog-import-title';
  const inReview = phase === 'review' || phase === 'saving';
  // The scanning spinner and the empty/up-to-date card are short. Without this
  // they'd pin to the top of the full-height mobile sheet (a "void" below) and,
  // on desktop, force the panel to its 90vh cap around a tiny card. sm:h-auto
  // lets the panel size to content on desktop; justify-center parks the light
  // phases in the middle on the always-full-height mobile sheet.
  const contentLight = phase === 'scanning' || (inReview && rows.length === 0);

  return (
    <DetailSheet dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }} panelClassName="sm:h-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {mode === 'scanReplies' ? t('replyScan.title') : mode === 'scan' ? t('scan.title') : t('import.title')}
        </h2>
        <button type="button" onClick={onClose} aria-label={t('actions.cancel')}
          className="p-1.5 rounded-lg text-icon-muted hover:bg-muted transition-colors">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className={clsx('flex-1 overflow-y-auto px-5 py-4 flex flex-col', contentLight && 'justify-center')} aria-busy={phase === 'extracting' || phase === 'scanning' || phase === 'saving'}>
        {phase === 'scanning' && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center" role="status">
            <ScanSearch className="w-8 h-8 mx-auto text-icon-muted" aria-hidden="true" />
            <p className="text-sm text-muted-foreground mt-3 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {mode === 'scanReplies' ? t('replyScan.scanning') : t('scan.scanning')}
            </p>
          </div>
        )}

        {(phase === 'input' || phase === 'extracting') && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('import.pasteHint')}</p>
            <Textarea
              label={t('import.pasteLabel')}
              dir="auto"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('import.pastePlaceholder')}
              maxLength={MAX_CATALOG_IMPORT_CHARS}
              disabled={phase === 'extracting'}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileUploadButton onExtracted={appendExtractedFile} disabled={phase === 'extracting'} />
                <span className="text-xs text-muted-foreground">{t('import.orUpload')}</span>
              </div>
              <CharCounter value={text} max={MAX_CATALOG_IMPORT_CHARS} hideWhenZero />
            </div>
            {phase === 'extracting' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {t('import.extracting')}
              </div>
            )}
          </div>
        )}

        {inReview && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <h3 className="text-base font-semibold text-foreground">{t(emptyTitleKey)}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t(emptyHintKey)}</p>
          </div>
        )}

        {inReview && rows.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {mode === 'scanReplies'
                ? t('replyScan.reviewHint', { count: rows.length })
                : mode === 'scan'
                  ? t('scan.reviewHint', { count: rows.length })
                  : t('import.reviewHint', { count: rows.length })}
            </p>
            {/* The price-completion nudge — the real work of the review step.
                Posts rarely carry prices (deliberately); a priceless item only
                lets the AI deflect. The privacy promise is what makes merchants
                willing to hand the price over at all. */}
            {pricelessCount > 0 && (
              <div className="alert-warning rounded-xl px-3 py-2 text-xs space-y-0.5">
                <p className="font-semibold">{t('scan.pricelessNote', { count: pricelessCount })}</p>
                <p>{t('scan.pricePrivacy')}</p>
              </div>
            )}
            {meta && (meta.dropped > 0 || meta.overflow > 0 || meta.truncated) && (
              <div className="alert-warning rounded-xl px-3 py-2 text-xs space-y-0.5">
                {meta.dropped > 0 && <p>{t('import.droppedNote', { count: meta.dropped })}</p>}
                {meta.overflow > 0 && <p>{t('import.overflowNote', { count: meta.overflow })}</p>}
                {meta.truncated && <p>{t('import.truncatedNote')}</p>}
              </div>
            )}

            {/* One decision per row: the price. Name is text, the price is an
                always-visible input (the merchant's actual task — no expand
                needed), and ALL machinery (type, dates, details, availability)
                lives behind the "details" tap for the few who want it. */}
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className={clsx('rounded-xl border border-border bg-card', row.removed && 'opacity-60')}>
                  <div className="flex items-center gap-2.5 p-3">
                    <div className="min-w-0 flex-1">
                      <span dir="auto" className={clsx('text-sm font-semibold text-foreground', row.removed && 'line-through')}>
                        {row.draft.name.trim() || t('fields.name')}
                      </span>
                      {row.draft.endsAt !== '' && row.draft.endsAt < todayISODate() && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground ms-2">
                          {t('badges.ended')}
                        </span>
                      )}
                      {/* Stays visible on the deselected row — it explains WHY
                          the row arrived deselected (D-038 reconcile). */}
                      {row.kind === 'duplicate' && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground ms-2">
                          {t('reconcile.duplicateBadge')}
                        </span>
                      )}
                    </div>
                    {/* Every enabled control must map to something the save
                        actually applies (#492 M1 — no silently-discarded edits):
                        an update row PATCHes price/currency only, so Details
                        editing unlocks only for «add as separate» (which inserts
                        the full draft), and a «keep» row applies nothing, so its
                        price input locks too. */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        aria-label={t('fields.priceOptional')}
                        dir="auto"
                        inputMode="decimal"
                        className="input w-24 !py-1.5 text-sm tabular-nums"
                        value={row.draft.price}
                        onChange={(e) => patchRowDraft(row.id, { price: e.target.value })}
                        placeholder={t('scan.pricePlaceholder')}
                        disabled={row.removed || (row.kind === 'update' && row.updateChoice === 'keep')}
                      />
                      {row.draft.currency.trim() && (
                        <span dir="auto" className="text-xs font-medium text-muted-foreground">{row.draft.currency.trim()}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => patchRow(row.id, { expanded: !row.expanded })}
                      disabled={row.removed || (row.kind === 'update' && row.updateChoice !== 'separate')}
                      aria-expanded={row.expanded}
                      className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:cursor-not-allowed py-1.5"
                    >
                      {t('import.details')}
                      {row.expanded
                        ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                        : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => patchRow(row.id, { removed: !row.removed, expanded: false })}
                      aria-label={row.removed ? t('import.restore') : t('import.remove')}
                      className={clsx(
                        'w-8 h-8 grid place-items-center rounded-lg border border-border transition-colors flex-shrink-0',
                        row.removed
                          ? 'text-icon-muted hover:text-foreground hover:bg-muted'
                          : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
                      )}
                    >
                      {row.removed
                        ? <RotateCcw className="w-4 h-4" aria-hidden="true" />
                        : <Trash2 className="w-4 h-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {/* The reconcile decision (D-038): this name is already in the
                      catalog at a different price. The merchant decides — keep
                      (default: saving must never change a price as a side
                      effect), update the existing item, or add separately. */}
                  {row.kind === 'update' && row.match && !row.removed && (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="alert-warning rounded-lg px-2.5 py-1.5 text-xs">
                        {t('reconcile.conflict', {
                          existing: priceLabel(row.match.price, row.match.currency),
                          proposed: priceLabel(row.draft.price.trim() || null, row.draft.currency.trim() || row.match.currency),
                        })}
                      </p>
                      {/* aria-pressed toggles, not radio roles — same rationale
                          as the type chips (L7, PR #407). */}
                      <div className="flex flex-wrap gap-2" role="group" aria-label={t('reconcile.choiceLabel')}>
                        {(['update', 'keep', 'separate'] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            aria-pressed={row.updateChoice === choice}
                            // Leaving «separate» collapses Details — its fields
                            // only apply to the separate-insert path (M1 lock).
                            onClick={() => patchRow(row.id, { updateChoice: choice, expanded: choice === 'separate' ? row.expanded : false })}
                            className={clsx(
                              'px-3 py-1 rounded-full text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30',
                              row.updateChoice === choice
                                ? 'bg-brand-500 text-white border-brand-500'
                                : 'bg-card text-foreground/80 border-border hover:bg-muted',
                            )}
                          >
                            {t(`reconcile.${choice}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {row.expanded && !row.removed && (
                    <div className="px-3 pb-3 pt-1 border-t border-border">
                      <CatalogItemFields
                        draft={row.draft}
                        onChange={(patch) => patchRowDraft(row.id, patch)}
                        nameError={row.nameError ? t('errors.nameRequired') : undefined}
                        vertical={vertical}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row gap-2 px-5 py-4 border-t border-border flex-shrink-0 pb-safe-modal">
        {phase === 'scanning' ? (
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
        ) : (phase === 'input' || phase === 'extracting') ? (
          <>
            <Button type="button" variant="secondary" onClick={onClose} disabled={phase === 'extracting'}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={extract}
              loading={phase === 'extracting'}
              disabled={text.trim().length < MIN_IMPORT_CHARS}
            >
              {t('import.extract')}
            </Button>
          </>
        ) : (
          <>
            {/* Back to the paste — the text is untouched, so a bad extraction
                costs nothing. Scan mode has no input step to go back to. */}
            {mode === 'paste' && (
              <Button type="button" variant="ghost" onClick={() => setPhase('input')} disabled={phase === 'saving'} className="sm:me-auto">
                {t('import.back')}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onClose} disabled={phase === 'saving'}>
              {t('actions.cancel')}
            </Button>
            {rows.length > 0 && (
              <Button
                type="button"
                variant="primary"
                onClick={saveAll}
                loading={phase === 'saving'}
                disabled={addRows.length + updateRows.length === 0}
              >
                {/* With confirmed updates in the mix, "Add N" would miscount
                    the save — the generic label covers inserts + patches. */}
                {updateRows.length > 0 ? t('reconcile.saveChanges') : t('import.addItems', { count: addRows.length })}
              </Button>
            )}
          </>
        )}
      </div>
    </DetailSheet>
  );
}

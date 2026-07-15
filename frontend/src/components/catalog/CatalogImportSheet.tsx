import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, ScanSearch, Trash2, X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button, CharCounter, Textarea } from '@/components/ui';
import { FileUploadButton } from '@/components/knowledge-base/FileUploadButton';
import { catalogApi, type CatalogExtractResponse } from '@/lib/api';
import { MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEMS_PER_PAGE } from '@jawab24/shared';
import {
  CatalogItemFields, draftDatesInvalid, draftFromInput, draftToInput, todayISODate, type CatalogItemDraft,
} from './CatalogItemFields';

/** Below this the extract button stays disabled — mirrors the backend Zod min,
 *  so the merchant never burns a click on a request that would 400. */
const MIN_IMPORT_CHARS = 10;

type Phase = 'input' | 'extracting' | 'scanning' | 'review' | 'saving';

interface ProposalRow {
  id: number;
  draft: CatalogItemDraft;
  removed: boolean;
  expanded: boolean;
  nameError: boolean;
}

interface CatalogImportSheetProps {
  pageId: string;
  /** 'paste' (default): paste/upload → extract. 'scan': read the page's recent
   *  FB posts server-side — no input step, opens straight into the review. */
  mode?: 'paste' | 'scan';
  /** Applied at save to rows that got a price but no currency (posts and
   *  pasted lists rarely state one; a bare number reads ambiguous to the AI). */
  defaultCurrency?: string;
  /** Pre-filled paste (e.g. arriving from the Business Info price-list warning). */
  initialText?: string;
  /** Called with the number of items created + the first saved item's name
   *  (feeds the "try asking Jawab about it" nudge) — parent refreshes + closes. */
  onDone: (count: number, firstItemName?: string) => void;
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
export function CatalogImportSheet({ pageId, mode = 'paste', defaultCurrency, initialText, onDone, onClose }: CatalogImportSheetProps) {
  const t = useTranslations('catalog');

  const [phase, setPhase] = useState<Phase>(mode === 'scan' ? 'scanning' : 'input');
  const [text, setText] = useState(initialText ?? '');
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [meta, setMeta] = useState<Pick<CatalogExtractResponse, 'dropped' | 'overflow' | 'truncated'> | null>(null);
  const [scanUpToDate, setScanUpToDate] = useState(false);

  const activeRows = rows.filter((r) => !r.removed);
  const pricelessCount = activeRows.filter((r) => !r.draft.price.trim()).length;

  // Scan mode fires immediately on mount — there is no input step. The ref
  // guards React 18 dev double-invoke (a second POST would burn the rate limit).
  const scanFired = useRef(false);
  useEffect(() => {
    if (mode !== 'scan' || scanFired.current) return;
    scanFired.current = true;
    (async () => {
      try {
        const { data } = await catalogApi.scanPosts(pageId);
        setRows(data.items.map((item, i) => ({
          id: i, draft: draftFromInput(item), removed: false, expanded: false, nameError: false,
        })));
        setMeta({ dropped: data.dropped, overflow: data.overflow, truncated: data.truncated });
        setScanUpToDate(data.upToDate);
        setPhase('review');
      } catch (err) {
        // Nothing typed, nothing lost — toast and close; the scan button remains.
        const code = (err as AxiosError<{ code?: string }>).response?.data?.code;
        if (code === 'daily_limit_reached') toast.error(t('import.toastDailyLimit'));
        else if (code === 'CATALOG_LIMIT_REACHED') toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
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
      setRows(data.items.map((item, i) => ({
        id: i, draft: draftFromInput(item), removed: false, expanded: false, nameError: false,
      })));
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
    const blank = activeRows.find((r) => !r.draft.name.trim());
    if (blank) {
      patchRow(blank.id, { expanded: true, nameError: true });
      return;
    }
    // Inverted dates: expand the row — the end-date field shows the inline error.
    const badDates = activeRows.find((r) => draftDatesInvalid(r.draft));
    if (badDates) {
      patchRow(badDates.id, { expanded: true });
      return;
    }

    setPhase('saving');
    try {
      await catalogApi.batchCreate(pageId, activeRows.map((r) => {
        const input = draftToInput(r.draft);
        // Currency fallback: a typed price with no stated currency inherits
        // the page's last-used one (extraction rarely finds a currency in posts).
        if (input.price != null && !input.currency && defaultCurrency) input.currency = defaultCurrency;
        return input;
      }));
      onDone(activeRows.length, activeRows[0]?.draft.name.trim() || undefined);
    } catch (err) {
      // Review state is kept — a failed save must not eat the merchant's edits.
      const axiosErr = err as AxiosError<{ code?: string }>;
      if (axiosErr.response?.data?.code === 'CATALOG_LIMIT_REACHED') {
        toast.error(t('toast.limitReached', { max: MAX_CATALOG_ITEMS_PER_PAGE }));
      } else {
        toast.error(t('import.toastImportError'));
      }
      setPhase('review');
    }
  };

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
          {mode === 'scan' ? t('scan.title') : t('import.title')}
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
              {t('scan.scanning')}
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
            <h3 className="text-base font-semibold text-foreground">
              {mode === 'scan' && scanUpToDate ? t('scan.upToDate') : mode === 'scan' ? t('scan.emptyResult') : t('import.emptyResult')}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === 'scan' && scanUpToDate ? t('scan.upToDateHint') : mode === 'scan' ? t('scan.emptyResultHint') : t('import.emptyResultHint')}
            </p>
          </div>
        )}

        {inReview && rows.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {mode === 'scan' ? t('scan.reviewHint', { count: rows.length }) : t('import.reviewHint', { count: rows.length })}
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
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        aria-label={t('fields.priceOptional')}
                        dir="auto"
                        inputMode="decimal"
                        className="input w-24 !py-1.5 text-sm tabular-nums"
                        value={row.draft.price}
                        onChange={(e) => patchRowDraft(row.id, { price: e.target.value })}
                        placeholder={t('scan.pricePlaceholder')}
                        disabled={row.removed}
                      />
                      {row.draft.currency.trim() && (
                        <span dir="auto" className="text-xs font-medium text-muted-foreground">{row.draft.currency.trim()}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => patchRow(row.id, { expanded: !row.expanded })}
                      disabled={row.removed}
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
                  {row.expanded && !row.removed && (
                    <div className="px-3 pb-3 pt-1 border-t border-border">
                      <CatalogItemFields
                        draft={row.draft}
                        onChange={(patch) => patchRowDraft(row.id, patch)}
                        nameError={row.nameError ? t('errors.nameRequired') : undefined}
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
                disabled={activeRows.length === 0}
              >
                {t('import.addItems', { count: activeRows.length })}
              </Button>
            )}
          </>
        )}
      </div>
    </DetailSheet>
  );
}

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button, CharCounter, Textarea } from '@/components/ui';
import { FileUploadButton } from '@/components/knowledge-base/FileUploadButton';
import { catalogApi, type CatalogExtractResponse } from '@/lib/api';
import { MAX_CATALOG_IMPORT_CHARS, MAX_CATALOG_ITEMS_PER_PAGE, type CatalogItemType } from '@jawab24/shared';
import {
  CatalogItemFields, draftDatesInvalid, draftFromInput, draftToInput, todayISODate, type CatalogItemDraft,
} from './CatalogItemFields';

/** Below this the extract button stays disabled — mirrors the backend Zod min,
 *  so the merchant never burns a click on a request that would 400. */
const MIN_IMPORT_CHARS = 10;

type Phase = 'input' | 'extracting' | 'review' | 'saving';

interface ProposalRow {
  id: number;
  draft: CatalogItemDraft;
  removed: boolean;
  expanded: boolean;
  nameError: boolean;
}

interface CatalogImportSheetProps {
  pageId: string;
  /** Pre-filled paste (e.g. arriving from the Business Info price-list warning). */
  initialText?: string;
  /** Called with the number of items created — parent refreshes + toasts + closes. */
  onDone: (count: number) => void;
  onClose: () => void;
}

/**
 * Bulk import: paste/upload → AI extracts proposals → merchant reviews →
 * save all. Nothing is persisted until the final step, and no failure path
 * ever discards what the merchant typed or reviewed (M5 principle).
 * One DetailSheet with an internal phase machine — review rows expand inline
 * (never a nested sheet; that breaks on mobile keyboards).
 */
export function CatalogImportSheet({ pageId, initialText, onDone, onClose }: CatalogImportSheetProps) {
  const t = useTranslations('catalog');

  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState(initialText ?? '');
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [meta, setMeta] = useState<Pick<CatalogExtractResponse, 'dropped' | 'overflow' | 'truncated'> | null>(null);

  const activeRows = rows.filter((r) => !r.removed);

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
      await catalogApi.batchCreate(pageId, activeRows.map((r) => draftToInput(r.draft)));
      onDone(activeRows.length);
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

  return (
    <DetailSheet dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <h2 id={titleId} className="text-lg font-semibold text-foreground">{t('import.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('actions.cancel')}
          className="p-1.5 rounded-lg text-icon-muted hover:bg-muted transition-colors">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4" aria-busy={phase === 'extracting' || phase === 'saving'}>
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
            <h3 className="text-base font-semibold text-foreground">{t('import.emptyResult')}</h3>
            <p className="text-sm text-muted-foreground mt-1">{t('import.emptyResultHint')}</p>
          </div>
        )}

        {inReview && rows.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('import.reviewHint', { count: rows.length })}
            </p>
            {meta && (meta.dropped > 0 || meta.overflow > 0 || meta.truncated) && (
              <div className="alert-warning rounded-xl px-3 py-2 text-xs space-y-0.5">
                {meta.dropped > 0 && <p>{t('import.droppedNote', { count: meta.dropped })}</p>}
                {meta.overflow > 0 && <p>{t('import.overflowNote', { count: meta.overflow })}</p>}
                {meta.truncated && <p>{t('import.truncatedNote')}</p>}
              </div>
            )}

            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className={clsx('rounded-xl border border-border bg-card', row.removed && 'opacity-60')}>
                  <div className="flex items-center gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => patchRow(row.id, { expanded: !row.expanded })}
                      disabled={row.removed}
                      aria-expanded={row.expanded}
                      aria-label={t('actions.edit')}
                      className="flex items-center gap-3 min-w-0 flex-1 text-start disabled:cursor-not-allowed"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span dir="auto" className={clsx('text-sm font-semibold text-foreground', row.removed && 'line-through')}>
                            {row.draft.name.trim() || t('fields.name')}
                          </span>
                          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                            {t(`types.${row.draft.type as CatalogItemType}`)}
                          </span>
                          {!row.draft.isAvailable && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {t('availability.out')}
                            </span>
                          )}
                          {row.draft.endsAt !== '' && row.draft.endsAt < todayISODate() && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {t('badges.ended')}
                            </span>
                          )}
                        </div>
                      </div>
                      <span dir="auto" className="text-sm font-semibold text-foreground whitespace-nowrap tabular-nums">
                        {row.draft.price.trim() ? (
                          <>
                            {row.draft.price.trim()}
                            {row.draft.currency.trim() && <span className="text-xs font-medium text-muted-foreground ms-1">{row.draft.currency.trim()}</span>}
                          </>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">{t('priceOnRequest')}</span>
                        )}
                      </span>
                      {!row.removed && (
                        row.expanded
                          ? <ChevronUp className="w-4 h-4 text-icon-muted flex-shrink-0" aria-hidden="true" />
                          : <ChevronDown className="w-4 h-4 text-icon-muted flex-shrink-0" aria-hidden="true" />
                      )}
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
        {(phase === 'input' || phase === 'extracting') ? (
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
            {/* Back to the paste — the text is untouched, so a bad extraction costs nothing. */}
            <Button type="button" variant="ghost" onClick={() => setPhase('input')} disabled={phase === 'saving'} className="sm:me-auto">
              {t('import.back')}
            </Button>
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

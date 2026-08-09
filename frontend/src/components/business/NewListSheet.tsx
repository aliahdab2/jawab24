import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, ArrowRight } from 'lucide-react';
import { DetailSheet, Button } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface NewListSheetProps {
  /** Labels already taken on this page — the uq_fact_collections_page_label
   *  rule, answered inline before a request is ever sent (the server still
   *  refuses a race with 409 DUPLICATE_LABEL). Exact-match, same as the DB. */
  existingLabels: string[];
  onContinue: (label: string) => void;
  onClose: () => void;
}

/**
 * Step 1 of the merchant's «add list» (G1b creation UI): name the list.
 * Step 2 is the existing ListRowSheet, opened by the caller for the first
 * item — a collection is created WITH that row in one atomic POST, because a
 * born-empty list would be invisible (it renders no prompt block and no card).
 *
 * keyAttr is deliberately not asked for: un-keyed lists answer fine (the MES
 * showrooms precedent) and reply-time gating stays an admin/seeder concern.
 */
export function NewListSheet({ existingLabels, onContinue, onClose }: NewListSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');

  const [label, setLabel] = useState('');
  const trimmed = label.trim();
  const taken = trimmed.length > 0 && existingLabels.some((l) => l === trimmed);

  useEscapeKey(onClose, true);

  const submit = () => {
    if (!trimmed || taken) return;
    onContinue(trimmed);
  };

  const titleId = 'new-list-sheet-title';

  return (
    <DetailSheet
      fitContent
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}
      onSwipeDismiss={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id={titleId} className="text-base sm:text-lg font-semibold text-foreground">
          {t('lists.newListTitle')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        <div>
          <label htmlFor="new-list-label" className="block text-sm text-muted-foreground mb-1.5">
            {t('lists.newListNameLabel')}
          </label>
          <input
            id="new-list-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            dir={label ? 'auto' : undefined}
            autoFocus
            maxLength={120}
            placeholder={t('lists.newListNamePlaceholder')}
            aria-invalid={taken || undefined}
            className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {taken && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {t('lists.errDuplicateLabel')}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('lists.newListNameHint')}</p>
      </div>

      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={!trimmed || taken}
          icon={<ArrowRight className="w-4 h-4 rtl:rotate-180" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('continue')}
        </Button>
      </div>
    </DetailSheet>
  );
}

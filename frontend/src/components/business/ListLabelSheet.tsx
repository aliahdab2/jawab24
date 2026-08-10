import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { DetailSheet, Button } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface ListLabelSheetProps {
  /** Labels already taken on this page — the uq_fact_collections_page_label
   *  rule, answered inline before a request is ever sent (the server still
   *  refuses a race with 409 DUPLICATE_LABEL). Exact-match, same as the DB.
   *  When RENAMING, the caller excludes the list's own label: re-saving the
   *  name a list already has must not read as a clash. */
  existingLabels: string[];
  /** Prefilled name — the current label when renaming, empty when creating. */
  initialLabel?: string;
  title: string;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  /** Renaming writes on submit, so its button must show progress. Creation
   *  hands off to step 2 (the first row) and never waits on the network here. */
  saving?: boolean;
  /** Shown under the input — why the name matters, per purpose. */
  hint?: string;
  onSubmit: (label: string) => void;
  onClose: () => void;
}

/**
 * Name a list — the ONE input shared by both doors onto `fact_collections.label`:
 * step 1 of «add list» (G1b creation UI) and «تعديل الاسم» on an existing list.
 *
 * They must agree on what a valid name is, because the label is unique per page
 * AND is the header the prompt renderer puts above the list's rows: a name the
 * create sheet accepts but the rename sheet refuses (or vice versa) would be a
 * list the merchant cannot re-save under its own name. One component, so the
 * trim rule, the cap and the inline duplicate refusal cannot drift apart.
 *
 * keyAttr is deliberately not asked for at either door: un-keyed lists answer
 * fine (the MES showrooms precedent) and reply-time gating stays an
 * admin/seeder concern.
 */
export function ListLabelSheet({
  existingLabels,
  initialLabel = '',
  title,
  submitLabel,
  submitIcon,
  saving = false,
  hint,
  onSubmit,
  onClose,
}: ListLabelSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');

  const [label, setLabel] = useState(initialLabel);
  const trimmed = label.trim();
  const taken = trimmed.length > 0 && existingLabels.some((l) => l === trimmed);
  // Renaming to the same name is a no-op, not an error: the server returns the
  // row untouched (and skips the cache invalidation), so the button stays live
  // and the sheet simply closes.
  const canSubmit = trimmed.length > 0 && !taken && !saving;

  useEscapeKey(onClose, true);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  const titleId = 'list-label-sheet-title';

  return (
    <DetailSheet
      fitContent
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}
      onSwipeDismiss={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <h2 id={titleId} className="text-base sm:text-lg font-semibold text-foreground">
          {title}
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
          <label htmlFor="list-label-input" className="block text-sm text-muted-foreground mb-1.5">
            {t('lists.newListNameLabel')}
          </label>
          <input
            id="list-label-input"
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
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>

      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={!canSubmit}
          loading={saving}
          icon={submitIcon}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {submitLabel}
        </Button>
      </div>
    </DetailSheet>
  );
}

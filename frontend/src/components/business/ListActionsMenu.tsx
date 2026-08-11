import React, { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import * as Popover from '@radix-ui/react-popover';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { ConfirmationModal } from '@/components/ui';
import { getLocaleDirection } from '@/utils/locale';
import type { FactCollectionWithRows } from '@/lib/api';

interface ListActionsMenuProps {
  collection: FactCollectionWithRows;
  saving: boolean;
  /** Open the rename sheet (the menu closes itself first). */
  onRename: () => void;
  /** Delete the whole list — only ever called from the ARMED second tap. */
  onDelete: () => void;
  /** D-038 tri-state completeness answer. */
  onSetCompleteness: (isComplete: boolean | null) => void;
  /** Whether the completeness question lives in this menu. The entity-card
   *  layout has no per-list card, so the menu is that question's only home;
   *  the directory layout already asks it inside each list's own card and
   *  must not ask twice. */
  showCompleteness: boolean;
}

/**
 * The ⋯ menu behind each list's management actions (rename · delete ·
 * completeness).
 *
 * It exists because the flat version measured badly the same night it
 * shipped: with rename and delete as always-visible buttons plus the two
 * completeness answers, a three-list page stacked TWELVE buttons above the
 * content — the owner's «عم حسهم كتار», with the section at 4.3 viewport
 * heights (390px, 2026-08-10). One line per list with the actions folded
 * behind ⋯ is the layout he approved from the mock.
 *
 * Built on Radix Popover — already a dependency (InfoPopover) — rather than
 * adding @radix-ui/react-dropdown-menu for three items.
 *
 * The delete confirm lives INSIDE the menu and disarms when it closes: an
 * armed destructive button must never sit on the page waiting for a stray
 * tap (same posture as the row sheet's two-step delete).
 */
export function ListActionsMenu({
  collection,
  saving,
  onRename,
  onDelete,
  onSetCompleteness,
  showCompleteness,
}: ListActionsMenuProps) {
  const t = useTranslations('business');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
  };

  const itemClass =
    'w-full min-h-[40px] flex items-center gap-2 rounded-lg px-2.5 text-sm text-start text-foreground hover:bg-surface-100';

  return (
    <Popover.Root
      open={open}
      onOpenChange={setOpen}
    >
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={t('lists.listOptionsFor', { list: collection.label })}
          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full border border-theme-border text-muted-foreground hover:text-foreground hover:bg-surface-100 flex-shrink-0"
        >
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          // A portal escapes <html dir> — one of the few places dir is set by hand.
          dir={getLocaleDirection(locale)}
          aria-label={t('lists.listOptionsFor', { list: collection.label })}
          className="z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-theme-border bg-card shadow-lg p-1.5"
        >
          {showCompleteness && (
            <div className="px-2.5 pt-2 pb-2.5 mb-1 border-b border-theme-border/60">
              <span className="block text-xs font-semibold text-foreground">{t('lists.completenessAsk')}</span>
              {collection.isComplete === null ? (
                <span className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { onSetCompleteness(true); close(); }}
                    className="min-h-[32px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-foreground hover:bg-surface-100"
                  >
                    {t('lists.completenessYes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { onSetCompleteness(false); close(); }}
                    className="min-h-[32px] rounded-full border border-theme-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-surface-100"
                  >
                    {t('lists.completenessNo')}
                  </button>
                </span>
              ) : (
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  {collection.isComplete ? t('lists.completenessConfirmed') : t('lists.completenessPartial')}
                  {' '}
                  <button
                    type="button"
                    onClick={() => { onSetCompleteness(null); close(); }}
                    className="text-brand-600 hover:underline underline-offset-2"
                  >
                    {t('lists.completenessReset')}
                  </button>
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              close();
              // Hand focus to the trigger BEFORE the sheet mounts: the sheet
              // captures document.activeElement at first render as its return
              // target, and this menu item is about to unmount with the menu —
              // a disconnected opener means focus falls to <body> on close.
              triggerRef.current?.focus();
              onRename();
            }}
            aria-label={t('lists.renameActionFor', { list: collection.label })}
            className={itemClass}
          >
            <Pencil className="w-3.5 h-3.5 text-icon-muted" aria-hidden="true" />
            {t('lists.renameAction')}
          </button>

          <button
            type="button"
            onClick={() => { close(); setConfirmingDelete(true); }}
            disabled={saving}
            aria-label={t('lists.deleteListActionFor', { list: collection.label })}
            className={`${itemClass} hover:text-red-600`}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t('lists.deleteListAction')}
          </button>
        </Popover.Content>
      </Popover.Portal>

      {/* The product's own destructive confirmation — the same dialog every
          other delete in the app uses (danger icon, red action, its own z
          tier). An in-menu two-tap was a THIRD confirm pattern for a thing
          that destroys a merchant's whole list, and it hid the one number
          that matters behind a hover: this states the row count in prose and
          demands a deliberate second gesture (owner, 2026-08-11). */}
      <ConfirmationModal
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
        variant="danger"
        loading={saving}
        title={t('lists.deleteListTitle')}
        message={t('lists.deleteListMessage', { list: collection.label, count: collection.rows.length })}
        confirmText={t('lists.deleteListAction')}
      />
    </Popover.Root>
  );
}

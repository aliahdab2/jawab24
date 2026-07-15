import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button } from '@/components/ui';
import type { CatalogItem, CatalogItemType } from '@jawab24/shared';
import type { CatalogItemInput } from '@/lib/api';
import { CatalogItemFields, draftDatesInvalid, draftToInput, makeDraft } from './CatalogItemFields';

interface CatalogItemFormSheetProps {
  /** null = create mode; an item = edit mode. */
  item: CatalogItem | null;
  /** Currency to pre-fill on a fresh create (last used on this page). */
  defaultCurrency?: string;
  /** Item type preselected on a fresh create — the page vertical's default
   *  (dealer → vehicle, institute → course). The type chips stay switchable. */
  defaultType?: CatalogItemType;
  saving: boolean;
  /** Resolves true when the server confirmed the save. `addAnother` keeps the
   *  sheet open — fields are cleared only AFTER success so a failed request
   *  never eats the merchant's typed item. */
  onSave: (data: CatalogItemInput, addAnother: boolean) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Add/edit an offering. Fields live in the shared CatalogItemFields (same
 * editor as the import review rows); "Save & add another" keeps the sheet open
 * for batch entry (retaining type + currency). Lifts above the mobile keyboard
 * via the shared DetailSheet.
 */
export function CatalogItemFormSheet({ item, defaultCurrency, defaultType, saving, onSave, onClose }: CatalogItemFormSheetProps) {
  const t = useTranslations('catalog');
  const isEdit = item !== null;

  const [draft, setDraft] = useState(() => makeDraft(item, { currency: defaultCurrency, type: defaultType }));
  const [showNameError, setShowNameError] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const patchDraft = (patch: Partial<typeof draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    if (patch.name !== undefined && showNameError) setShowNameError(false);
  };

  const submit = async (addAnother: boolean) => {
    if (!draft.name.trim()) {
      setShowNameError(true);
      nameRef.current?.focus();
      return;
    }
    if (draftDatesInvalid(draft)) return; // inline error already visible on the end-date field
    const ok = await onSave(draftToInput(draft), addAnother);
    if (ok && addAnother) {
      // Keep type + currency (Simplicity contract §4/§5); clear the rest and refocus.
      setDraft((prev) => ({ ...prev, name: '', price: '', description: '', isAvailable: true, startsAt: '', endsAt: '', attributes: [] }));
      setShowNameError(false);
      nameRef.current?.focus();
    }
  };

  const titleId = 'catalog-form-title';

  return (
    <DetailSheet dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }} panelClassName="sm:h-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {isEdit ? t('editItem') : t('addItem')}
        </h2>
        <button type="button" onClick={onClose} aria-label={t('actions.cancel')}
          className="p-1.5 rounded-lg text-icon-muted hover:bg-muted transition-colors">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <form
        className="flex-1 overflow-y-auto px-5 py-4"
        onSubmit={(e) => { e.preventDefault(); submit(false); }}
      >
        <CatalogItemFields
          draft={draft}
          onChange={patchDraft}
          nameError={showNameError ? t('errors.nameRequired') : undefined}
          nameRef={nameRef}
        />
      </form>

      <div className="flex flex-col-reverse sm:flex-row gap-2 px-5 py-4 border-t border-border flex-shrink-0 pb-safe-modal">
        {!isEdit && (
          <Button type="button" variant="ghost" onClick={() => submit(true)} disabled={saving} className="sm:me-auto">
            {t('actions.saveAndAddAnother')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" variant="primary" onClick={() => submit(false)} loading={saving}>
          {t('actions.save')}
        </Button>
      </div>
    </DetailSheet>
  );
}

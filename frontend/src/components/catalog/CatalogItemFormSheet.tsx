import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { DetailSheet } from '@/components/ui/DetailSheet';
import { Button, Input, Textarea } from '@/components/ui';
import { CATALOG_ITEM_TYPES, type CatalogItem, type CatalogItemType } from '@jawab24/shared';
import type { CatalogItemInput } from '@/lib/api';

interface CatalogItemFormSheetProps {
  /** null = create mode; an item = edit mode. */
  item: CatalogItem | null;
  /** Currency to pre-fill on a fresh create (last used on this page). */
  defaultCurrency?: string;
  saving: boolean;
  /** `addAnother` keeps the sheet open with cleared fields for batch entry. */
  onSave: (data: CatalogItemInput, addAnother: boolean) => void;
  onClose: () => void;
}

/**
 * Add/edit an offering. Simplicity contract: only the name is required; type
 * defaults to "product" via chips; price accepts whatever the merchant types
 * (server normalizes Arabic-Indic digits); "Save & add another" keeps the sheet
 * open for batch entry (retaining type + currency). Lifts above the mobile
 * keyboard via the shared DetailSheet.
 */
export function CatalogItemFormSheet({ item, defaultCurrency, saving, onSave, onClose }: CatalogItemFormSheetProps) {
  const t = useTranslations('catalog');
  const isEdit = item !== null;

  const [type, setType] = useState<CatalogItemType>(item?.type ?? 'product');
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [currency, setCurrency] = useState(item?.currency ?? defaultCurrency ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [showNameError, setShowNameError] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const build = (): CatalogItemInput | null => {
    const trimmedName = name.trim();
    if (!trimmedName) { setShowNameError(true); nameRef.current?.focus(); return null; }
    return {
      type,
      name: trimmedName,
      price: price.trim() === '' ? null : price.trim(),
      currency: currency.trim() === '' ? null : currency.trim(),
      description: description.trim() === '' ? null : description.trim(),
      isAvailable,
    };
  };

  const submit = (addAnother: boolean) => {
    const data = build();
    if (!data) return;
    onSave(data, addAnother);
    if (addAnother) {
      // Keep type + currency (Simplicity contract §4/§5); clear the rest and refocus.
      setName(''); setPrice(''); setDescription(''); setIsAvailable(true); setShowNameError(false);
      nameRef.current?.focus();
    }
  };

  const titleId = 'catalog-form-title';

  return (
    <DetailSheet dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}>
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
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
        onSubmit={(e) => { e.preventDefault(); submit(false); }}
      >
        {/* Type — chips, product preselected; picking another never blocks saving */}
        <div>
          <span className="label">{t('fields.type')}</span>
          <div className="flex flex-wrap gap-2 mt-1.5" role="radiogroup" aria-label={t('fields.type')}>
            {CATALOG_ITEM_TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                role="radio"
                aria-checked={type === ty}
                onClick={() => setType(ty)}
                className={clsx(
                  'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30',
                  type === ty
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-card text-foreground/80 border-border hover:bg-muted',
                )}
              >
                {t(`types.${ty}`)}
              </button>
            ))}
          </div>
        </div>

        <Input
          ref={nameRef}
          label={t('fields.name')}
          dir="auto"
          value={name}
          onChange={(e) => { setName(e.target.value); if (showNameError) setShowNameError(false); }}
          placeholder={t('fields.namePlaceholder')}
          error={showNameError ? t('fields.name') : undefined}
          maxLength={200}
        />

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Input
            label={t('fields.priceOptional')}
            dir="auto"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={t('fields.pricePlaceholder')}
          />
          <Input
            label={t('fields.currency')}
            dir="auto"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={10}
          />
        </div>

        <Textarea
          label={t('fields.descriptionOptional')}
          dir="auto"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('fields.descriptionPlaceholder')}
          maxLength={600}
        />

        <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 cursor-pointer">
          <span className="text-sm font-medium text-foreground/90">{t('fields.available')}</span>
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            className="sr-only peer"
          />
          <span aria-hidden="true"
            className="relative w-11 h-6 rounded-full bg-surface-300 dark:bg-surface-600 peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
        </label>
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

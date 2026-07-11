import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Input, Textarea } from '@/components/ui';
import { CATALOG_ITEM_TYPES, type CatalogItem, type CatalogItemType } from '@jawab24/shared';
import type { CatalogItemInput } from '@/lib/api';

/**
 * The single source for a catalog item's editable fields — used by the add/edit
 * sheet (CatalogItemFormSheet) and the import review rows (CatalogImportSheet).
 * All string-typed so inputs stay controlled; conversion to the API payload
 * lives in draftToInput.
 */
export interface CatalogItemDraft {
  type: CatalogItemType;
  name: string;
  price: string;
  currency: string;
  description: string;
  isAvailable: boolean;
}

export function makeDraft(item?: CatalogItem | null, defaults?: { currency?: string }): CatalogItemDraft {
  return {
    type: item?.type ?? 'product',
    name: item?.name ?? '',
    price: item?.price ?? '',
    currency: item?.currency ?? defaults?.currency ?? '',
    description: item?.description ?? '',
    isAvailable: item?.isAvailable ?? true,
  };
}

/** Import proposals arrive as CatalogItemInput (price already a number) — same draft shape. */
export function draftFromInput(input: CatalogItemInput): CatalogItemDraft {
  return {
    type: input.type ?? 'product',
    name: input.name,
    price: input.price === null || input.price === undefined ? '' : String(input.price),
    currency: input.currency ?? '',
    description: input.description ?? '',
    isAvailable: input.isAvailable ?? true,
  };
}

/** Draft → API payload. Callers must reject a blank name first (the one required field). */
export function draftToInput(draft: CatalogItemDraft): CatalogItemInput {
  return {
    type: draft.type,
    name: draft.name.trim(),
    price: draft.price.trim() === '' ? null : draft.price.trim(),
    currency: draft.currency.trim() === '' ? null : draft.currency.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    isAvailable: draft.isAvailable,
  };
}

interface CatalogItemFieldsProps {
  draft: CatalogItemDraft;
  onChange: (patch: Partial<CatalogItemDraft>) => void;
  nameError?: string;
  nameRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Simplicity contract: only the name is required; type defaults to "product"
 * via chips; price accepts whatever the merchant types (server normalizes
 * Arabic-Indic digits).
 */
export function CatalogItemFields({ draft, onChange, nameError, nameRef }: CatalogItemFieldsProps) {
  const t = useTranslations('catalog');

  return (
    <div className="space-y-4">
      {/* Type — chips, product preselected; picking another never blocks saving.
          aria-pressed toggles (not radio roles): full radio semantics would
          require roving tabindex + arrow-key nav; pressed-state buttons are
          honest to how these behave and keyboard-complete as-is (L7, PR #407). */}
      <div>
        <span className="label">{t('fields.type')}</span>
        <div className="flex flex-wrap gap-2 mt-1.5" role="group" aria-label={t('fields.type')}>
          {CATALOG_ITEM_TYPES.map((ty) => (
            <button
              key={ty}
              type="button"
              aria-pressed={draft.type === ty}
              onClick={() => onChange({ type: ty })}
              className={clsx(
                'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30',
                draft.type === ty
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
        value={draft.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={t('fields.namePlaceholder')}
        error={nameError}
        maxLength={200}
      />

      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Input
          label={t('fields.priceOptional')}
          dir="auto"
          inputMode="decimal"
          value={draft.price}
          onChange={(e) => onChange({ price: e.target.value })}
          placeholder={t('fields.pricePlaceholder')}
        />
        <Input
          label={t('fields.currency')}
          dir="auto"
          value={draft.currency}
          onChange={(e) => onChange({ currency: e.target.value })}
          maxLength={10}
        />
      </div>

      <Textarea
        label={t('fields.descriptionOptional')}
        dir="auto"
        value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder={t('fields.descriptionPlaceholder')}
        maxLength={600}
      />

      <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 cursor-pointer">
        <span className="text-sm font-medium text-foreground/90">{t('fields.available')}</span>
        <input
          type="checkbox"
          checked={draft.isAvailable}
          onChange={(e) => onChange({ isAvailable: e.target.checked })}
          className="sr-only peer"
        />
        <span aria-hidden="true"
          className="relative w-11 h-6 rounded-full bg-surface-300 dark:bg-surface-600 peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
      </label>
    </div>
  );
}

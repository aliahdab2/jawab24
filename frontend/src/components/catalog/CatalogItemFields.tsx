import { useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { CalendarPlus, X } from 'lucide-react';
import { Input, Textarea } from '@/components/ui';
import { CATALOG_ITEM_TYPES, MAX_CATALOG_ITEM_ATTRIBUTES, type CatalogItem, type CatalogItemType } from '@jawab24/shared';
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
  /** 'YYYY-MM-DD' or '' = not set (native date-input value shape). */
  startsAt: string;
  endsAt: string;
  attributes: Array<{ label: string; value: string }>;
}

/** Today as local 'YYYY-MM-DD' — for the "Ended" badge comparisons. */
export function todayISODate(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** DB numeric strings arrive as "3500.00" — show "3500". Non-numeric passes through. */
export function formatCatalogPrice(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? String(n) : price;
}

/** Both dates set and inverted — callers block submit and show the inline error. */
export function draftDatesInvalid(draft: CatalogItemDraft): boolean {
  return draft.startsAt !== '' && draft.endsAt !== '' && draft.endsAt < draft.startsAt;
}

export function makeDraft(item?: CatalogItem | null, defaults?: { currency?: string; type?: CatalogItemType }): CatalogItemDraft {
  return {
    type: item?.type ?? defaults?.type ?? 'product',
    name: item?.name ?? '',
    price: item?.price ?? '',
    currency: item?.currency ?? defaults?.currency ?? '',
    description: item?.description ?? '',
    isAvailable: item?.isAvailable ?? true,
    startsAt: item?.startsAt ?? '',
    endsAt: item?.endsAt ?? '',
    attributes: item?.attributes?.map((a) => ({ ...a })) ?? [],
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
    startsAt: input.startsAt ?? '',
    endsAt: input.endsAt ?? '',
    attributes: input.attributes?.map((a) => ({ ...a })) ?? [],
  };
}

/** Draft → API payload. Callers must reject a blank name first (the one required field). */
export function draftToInput(draft: CatalogItemDraft): CatalogItemInput {
  const attributes = draft.attributes
    .map((a) => ({ label: a.label.trim(), value: a.value.trim() }))
    .filter((a) => a.label !== '' && a.value !== '');
  return {
    type: draft.type,
    name: draft.name.trim(),
    price: draft.price.trim() === '' ? null : draft.price.trim(),
    currency: draft.currency.trim() === '' ? null : draft.currency.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    isAvailable: draft.isAvailable,
    startsAt: draft.startsAt === '' ? null : draft.startsAt,
    endsAt: draft.endsAt === '' ? null : draft.endsAt,
    attributes: attributes.length === 0 ? null : attributes,
  };
}

/** Types with suggested detail labels ('custom' has none). The labels
 *  themselves are i18n strings (pipe-separated) — what's stored is plain text. */
const SUGGESTED_DETAIL_TYPES: CatalogItemType[] = ['product', 'service', 'course', 'vehicle'];

/** Types whose offerings are naturally time-bound (course cohorts, booked
 *  services) — the date fields show by default. Every OTHER type hides them
 *  behind a "+ add dates" affordance: a shelf product or a car listing must
 *  never stare at meaningless schedule pickers (the one-size-fits-none fix). */
const TIME_BOUND_TYPES: CatalogItemType[] = ['course', 'service'];

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

  // Dates show for time-bound types, for any item that already carries a date
  // (an extracted offer expiry must stay visible/editable on every type), or
  // after the merchant reveals them (limited offers exist in every vertical).
  // Reveal is sticky for the mount — switching type away never hides set dates.
  const [datesRevealed, setDatesRevealed] = useState(false);
  const showDates = TIME_BOUND_TYPES.includes(draft.type)
    || draft.startsAt !== '' || draft.endsAt !== '' || datesRevealed;

  // Type-suggested detail labels (Salla-style chips) — i18n pipe-separated
  // strings, minus the labels already in use. What's stored is the plain text.
  const usedLabels = new Set(draft.attributes.map((a) => a.label.trim()));
  const suggestions = SUGGESTED_DETAIL_TYPES.includes(draft.type)
    ? t(`suggestedDetails.${draft.type}`).split('|').map((s) => s.trim()).filter((s) => s && !usedLabels.has(s))
    : [];

  const patchAttribute = (index: number, patch: Partial<{ label: string; value: string }>) => {
    onChange({ attributes: draft.attributes.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  };
  const addAttribute = (label: string) => {
    if (draft.attributes.length >= MAX_CATALOG_ITEM_ATTRIBUTES) return;
    onChange({ attributes: [...draft.attributes, { label, value: '' }] });
  };
  const removeAttribute = (index: number) => {
    onChange({ attributes: draft.attributes.filter((_, i) => i !== index) });
  };

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
        // The example follows the selected type — a dealer is taught with a
        // car, an institute with a course, never someone else's trade.
        placeholder={t(`namePlaceholders.${draft.type}`)}
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
          maxLength={30}
        />
      </div>

      {/* Time-bound offerings (course cohorts, limited offers). Shown by default
          only where dates are natural (TIME_BOUND_TYPES) — other types get a
          reveal affordance instead of two always-on pickers. Date inputs read
          LTR even in RTL (ISO dates + native pickers; same as admin/ai-cost). */}
      {showDates ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('fields.startsAt')}
            type="date"
            dir="ltr"
            value={draft.startsAt}
            onChange={(e) => onChange({ startsAt: e.target.value })}
          />
          <Input
            label={t('fields.endsAt')}
            type="date"
            dir="ltr"
            value={draft.endsAt}
            onChange={(e) => onChange({ endsAt: e.target.value })}
            error={draftDatesInvalid(draft) ? t('errors.dateOrder') : undefined}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDatesRevealed(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border border-dashed border-border text-foreground/70 hover:bg-muted transition-colors"
        >
          <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
          {t('fields.addDates')}
        </button>
      )}

      {/* Flexible details — label+value pairs. The type suggests labels
          (chips); anything else is a custom pair. Rendered to the AI as text. */}
      <div>
        <span className="label">{t('fields.details')}</span>
        <div className="space-y-2 mt-1.5">
          {draft.attributes.map((attr, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-center">
              <Input
                aria-label={t('fields.detailLabel')}
                placeholder={t('fields.detailLabel')}
                dir="auto"
                value={attr.label}
                onChange={(e) => patchAttribute(i, { label: e.target.value })}
                maxLength={30}
              />
              <Input
                aria-label={t('fields.detailValue')}
                placeholder={t('fields.detailValue')}
                dir="auto"
                value={attr.value}
                onChange={(e) => patchAttribute(i, { value: e.target.value })}
                maxLength={100}
              />
              <button
                type="button"
                onClick={() => removeAttribute(i)}
                aria-label={t('fields.removeDetail')}
                className="w-8 h-8 grid place-items-center rounded-lg border border-border text-icon-muted hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          {draft.attributes.length < MAX_CATALOG_ITEM_ATTRIBUTES && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => addAttribute(label)}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-border text-foreground/70 hover:bg-muted transition-colors"
                >
                  + {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => addAttribute('')}
                className="px-3 py-1 rounded-full text-xs font-medium border border-dashed border-border text-foreground/70 hover:bg-muted transition-colors"
              >
                + {t('fields.addDetail')}
              </button>
            </div>
          )}
        </div>
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

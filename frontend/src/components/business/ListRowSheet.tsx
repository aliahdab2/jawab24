import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Trash2, Plus } from 'lucide-react';
import { parseMerchantPrice, MAX_FACT_ATTR_LABEL_LENGTH, MAX_FACT_ROW_ATTRIBUTES } from '@jawab24/shared';
import { ValueLengthFeedback, factValueTooLong } from './ValueLengthFeedback';
import { DetailSheet, Button, InfoPopover, Toggle } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { formatCatalogPrice } from '@/utils/priceFormat';
import { formatPlainDate } from '@/utils/dateUtils';
import type { FactRowDto } from '@/lib/api';

/** Attributes per row are capped so a merchant can't balloon the prompt block
 *  one field at a time — 12 is far above any real row (max seen: 4). The
 *  SERVER'S constant, not a local literal: the server used to cap at the
 *  catalog's 6 and silently sliced off fields 7–12 that this sheet accepted. */
const MAX_ATTRS = MAX_FACT_ROW_ATTRIBUTES;

/** Mirrors the server's `name` cap. A silent client cap is friendlier than a
 *  400 the merchant cannot read, and it keeps VALIDATION responses meaningful:
 *  one arriving now is a contract drift, not a typo. */
const MAX_ROW_NAME = 200;

interface AttrField {
  label: string;
  value: string;
  /** true = authored in this sheet session (label editable, removable);
   *  false = part of the list's existing shape (label fixed). */
  added: boolean;
}

interface ListRowSheetProps {
  /** null = adding a new row to the collection. */
  row: FactRowDto | null;
  /** Prefill for a NEW row (ignored when editing): adding from an entity card
   *  carries the card's name and its known key value, so the merchant only
   *  types what is actually new (the date, the price). */
  initial?: { name?: string; attributes?: { label: string; value: string }[] };
  /** Collection label — the sheet subtitle, so the merchant knows which list
   *  they are editing («مواعيد الدورات المعلنة»). */
  collectionLabel: string;
  /** The collection's key attribute. A merchant-added field must not reuse it:
   *  the reply-time matcher gates rows by this label, and a duplicate would
   *  make one row carry two competing key values. */
  keyAttr: string | null;
  /** The collection's attribute schema — the UNION of labels across all rows
   *  (never rows[0]: 22 of the pilot's 46 price rows have no attributes). */
  attributeLabels: string[];
  /** Whether this row may be deleted (the LAST row of a collection may not —
   *  an empty collection would silently drop its coverage boundary). */
  canDelete: boolean;
  /** Today as `YYYY-MM-DD`, from the SAME source the list renders visibility
   *  with — passed in, never read from the clock here, so the sheet's account
   *  of what customers see cannot disagree with the list's (`isRowLive`). */
  today: string;
  /** BCP-47 tag for date display. The native picker's own format follows the
   *  BROWSER locale and is not ours to set; everything WE render goes through
   *  Intl with the app's locale. */
  intlLocale: string;
  saving: boolean;
  onSave: (body: {
    name: string;
    attributes: { label: string; value: string }[] | null;
    price: string | null;
    currency: string | null;
    startsAt: string | null;
    endsAt: string | null;
    isAvailable: boolean;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Single-row bottom sheet for the fact-list editor.
 *
 * Mobile-first per the binding B1 constraints: labelled fields, 44px+ targets,
 * `dir="auto"` on text inputs, built on DetailSheet (which owns the keyboard
 * offset — never hand-roll that).
 *
 * - Schema labels («الأيام», «الساعة», «المستوى») come from the list and stay
 *   fixed; the merchant edits VALUES. New fields the merchant authors here
 *   («الوصف», «المدة», «الوزن» — whatever their business needs) get an
 *   editable label and join the list's shape on save. No vocabulary is
 *   hardcoded; every business gets its own fields.
 * - TWO date fields. The start date drives visibility (a dated row hides from
 *   the AI the day after it starts — owner ruling 2026-07-31: the end date is
 *   never load-bearing). The end date is optional and descriptive. Legacy rows
 *   carry endsAt === startsAt from the one-field era; that artifact is shown
 *   as an EMPTY end field, and saving writes exactly what the fields say.
 * - The key attribute value IS editable — it is data like any other value;
 *   the matcher just reads it.
 */
export function ListRowSheet({
  row,
  initial,
  collectionLabel,
  keyAttr,
  attributeLabels,
  canDelete,
  today,
  intlLocale,
  saving,
  onSave,
  onDelete,
  onClose,
}: ListRowSheetProps) {
  const t = useTranslations('business');
  const tc = useTranslations('common');

  const [name, setName] = useState(row?.name ?? initial?.name ?? '');
  // "35000.00" → "35000": the merchant edits what they'd write, not the
  // numeric column's storage form.
  const [price, setPrice] = useState(row?.price ? formatCatalogPrice(row.price) : '');
  const [currency, setCurrency] = useState(row?.currency ?? '');
  const [date, setDate] = useState(row?.startsAt ?? '');
  // endsAt === startsAt is the one-field era's artifact, not merchant intent.
  const [endDate, setEndDate] = useState(
    row?.endsAt && row.endsAt !== row.startsAt ? row.endsAt : '',
  );
  const [attrs, setAttrs] = useState<AttrField[]>(() => {
    if (row) {
      const own = (row.attributes ?? []).map((a) => ({ ...a, added: false }));
      // Labels the list has that this row lacks render as empty fields, so a
      // sparse row can gain them without "add field" ceremony.
      const missing = attributeLabels
        .filter((label) => !own.some((a) => a.label === label))
        .map((label) => ({ label, value: '', added: false }));
      return [...own, ...missing];
    }
    return attributeLabels.map((label) => ({
      label,
      value: initial?.attributes?.find((a) => a.label === label)?.value ?? '',
      added: false,
    }));
  });
  /**
   * Temporarily-unavailable, as the AI already understands it.
   *
   * `fact_rows.is_available` has always existed and the prompt renderer has
   * always honoured it — an unavailable row prints «غير متاح حالياً», which is
   * exactly the answer BAMBO's «رقم 7» needed (seeded that way by SCRIPT).
   * No editor ever exposed it for lists, so only the catalog — dead in prod at
   * one item fleet-wide — could set it. This was never removed; it was never
   * given a door (owner, 2026-08-11).
   */
  const [isAvailable, setIsAvailable] = useState(row?.isAvailable ?? true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEscapeKey(onClose, true);

  /** A merchant-authored label collides when it duplicates the list's key
   *  attribute or any other field in this sheet. */
  const labelTaken = (label: string, index: number): boolean => {
    const norm = label.trim();
    if (!norm) return false;
    if (keyAttr && norm === keyAttr.trim()) return true;
    return attrs.some((a, i) => i !== index && a.label.trim() === norm);
  };
  const anyLabelTaken = attrs.some((a, i) => a.added && labelTaken(a.label, i));
  const dateRangeInvalid = !!date && !!endDate && endDate < date;
  /** Over-limit fields say so inline (ValueLengthFeedback) and block Save,
   *  instead of the server's 400 that used to surface as a misleading
   *  «راجع السعر والتواريخ» toast on a long note. */
  const anyValueTooLong = attrs.some((a) => factValueTooLong(a.value));
  /** The SAME reader the server validates with (@jawab24/shared), so what the
   *  sheet accepts and what the API accepts cannot drift. Empty is valid — a
   *  row without a price is an ordinary row, not an incomplete one. */
  const priceInvalid = !parseMerchantPrice(price).ok;

  /**
   * What the start date DOES, stated at the field.
   *
   * The rule (D-057) is that a dated row leaves the prompt the day after it
   * starts — so a start date in the past means «customers never see this row»,
   * silently. That consequence used to live only behind an info icon, which is
   * a WCAG 3.3.2 gap (instructions must be available where input is required)
   * and, more plainly, the reason a merchant can set a date and watch a row
   * vanish with no explanation anywhere on the screen.
   *
   * Computed from `isRowLive`'s own comparison, not a second reading of it.
   */
  const startDateState: 'none' | 'live' | 'passed' =
    !date ? 'none' : date >= today ? 'live' : 'passed';
  /** Never make an existing value unreachable: a row already dated in the past
   *  keeps its own date as the floor, so editing its NAME does not force a
   *  date change. New rows cannot be dated into invisibility at all. */
  const minStartDate = row?.startsAt && row.startsAt < today ? row.startsAt : today;

  const originalEnd = row?.endsAt && row.endsAt !== row.startsAt ? row.endsAt : '';
  const dirty =
    name.trim() !== (row?.name ?? '') ||
    price.trim() !== (row?.price ? formatCatalogPrice(row.price) : '') ||
    currency.trim() !== (row?.currency ?? '') ||
    date !== (row?.startsAt ?? '') ||
    endDate !== originalEnd ||
    isAvailable !== (row?.isAvailable ?? true) ||
    JSON.stringify(attrs.map((a) => [a.label.trim(), a.value.trim()])) !==
      JSON.stringify([
        ...(row?.attributes ?? []).map((a) => [a.label.trim(), a.value.trim()]),
        ...(row
          ? attributeLabels
              .filter((label) => !(row.attributes ?? []).some((a) => a.label === label))
              .map((label) => [label, ''])
          : attributeLabels.map((label) => [
              label,
              initial?.attributes?.find((a) => a.label === label)?.value.trim() ?? '',
            ])),
      ]);

  const submit = () => {
    if (saving || !name.trim() || anyLabelTaken || dateRangeInvalid || priceInvalid || anyValueTooLong) return;
    const keptAttrs = attrs
      .map((a) => ({ label: a.label.trim(), value: a.value.trim() }))
      .filter((a) => a.label.length > 0 && a.value.length > 0);
    onSave({
      name: name.trim(),
      attributes: keptAttrs.length ? keptAttrs : null,
      price: price.trim() || null,
      currency: currency.trim() || null,
      startsAt: date || null,
      // Exactly what the field says — the start date owns visibility, so an
      // empty end simply stores null (no more silent endsAt=startsAt).
      endsAt: endDate || null,
      isAvailable,
    });
  };

  const titleId = 'list-row-sheet-title';
  const inputClass =
    'w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <DetailSheet
      panelClassName="sm:max-h-[85vh]"
      dialogProps={{ role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:p-5 border-b border-theme-border flex-shrink-0">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base sm:text-lg font-semibold text-foreground truncate">
            {row ? t('lists.editRow') : t('lists.addRow')}
          </h2>
          <p className="text-xs text-muted-foreground truncate" dir="auto">{collectionLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('close')}
          className="min-h-[44px] min-w-[44px] -me-2 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-500"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
        <div>
          <label htmlFor="list-row-name" className="block text-sm text-muted-foreground mb-1.5">
            {t('lists.rowName')}
          </label>
          <input
            id="list-row-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            dir={name ? 'auto' : undefined}
            autoFocus={!row}
            maxLength={MAX_ROW_NAME}
            className={inputClass}
          />
        </div>

        {attrs.map((a, i) => (
          <div key={i}>
            {a.added ? (
              <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-start">
                <div>
                  <label htmlFor={`list-row-attr-label-${i}`} className="block text-sm text-muted-foreground mb-1.5">
                    {t('lists.fieldLabel')}
                  </label>
                  <input
                    id={`list-row-attr-label-${i}`}
                    type="text"
                    value={a.label}
                    onChange={(e) => setAttrs((prev) => prev.map((p, j) => (j === i ? { ...p, label: e.target.value } : p)))}
                    dir={a.label ? 'auto' : undefined}
                    aria-invalid={labelTaken(a.label, i) || undefined}
                    maxLength={MAX_FACT_ATTR_LABEL_LENGTH}
                    className={inputClass}
                  />
                  {labelTaken(a.label, i) && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                      {t('lists.fieldLabelTaken')}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={`list-row-attr-${i}`} className="block text-sm text-muted-foreground mb-1.5">
                    {t('lists.fieldValue')}
                  </label>
                  <input
                    id={`list-row-attr-${i}`}
                    type="text"
                    value={a.value}
                    onChange={(e) => setAttrs((prev) => prev.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
                    dir={a.value ? 'auto' : undefined}
                    aria-invalid={factValueTooLong(a.value) || undefined}
                    aria-describedby={`list-row-attr-${i}-length`}
                    className={inputClass}
                  />
                  <ValueLengthFeedback value={a.value} fieldId={`list-row-attr-${i}`} />
                </div>
                <button
                  type="button"
                  onClick={() => setAttrs((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={tc('delete')}
                  className="mt-7 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <label htmlFor={`list-row-attr-${i}`} className="block text-sm text-muted-foreground mb-1.5" dir="auto">
                  {a.label}
                </label>
                <input
                  id={`list-row-attr-${i}`}
                  type="text"
                  value={a.value}
                  onChange={(e) => setAttrs((prev) => prev.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
                  dir={a.value ? 'auto' : undefined}
                  aria-invalid={factValueTooLong(a.value) || undefined}
                  aria-describedby={`list-row-attr-${i}-length`}
                  className={inputClass}
                />
                <ValueLengthFeedback value={a.value} fieldId={`list-row-attr-${i}`} />
              </>
            )}
          </div>
        ))}

        {attrs.length < MAX_ATTRS && (
          <button
            type="button"
            onClick={() => setAttrs((prev) => [...prev, { label: '', value: '', added: true }])}
            className="min-h-[36px] inline-flex items-center gap-1 rounded-lg text-xs font-medium text-brand-600 hover:text-brand-700 px-2 -ms-2"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('lists.addField')}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="list-row-price" className="block text-sm text-muted-foreground mb-1.5">
              {t('lists.rowPrice')}
            </label>
            <input
              id="list-row-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={t('lists.rowPriceOptional')}
              aria-invalid={priceInvalid || undefined}
              aria-describedby={priceInvalid ? 'list-row-price-error' : undefined}
              className={inputClass}
            />
            {/* Said HERE, at the field, while the merchant is still looking at
                it — not as a toast after a failed round-trip. */}
            {priceInvalid && (
              <p id="list-row-price-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                {t('lists.priceInvalid')}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="list-row-currency" className="block text-sm text-muted-foreground mb-1.5">
              {t('lists.rowCurrency')}
            </label>
            <input
              id="list-row-currency"
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              dir={currency ? 'auto' : undefined}
              placeholder={t('lists.rowCurrencyPlaceholder')}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="flex items-center gap-1.5 mb-1.5">
              <label htmlFor="list-row-date" className="text-sm text-muted-foreground">
                {t('lists.rowDate')}
              </label>
              {/* What the dates DO, in the merchant's terms — one tap away
                  instead of a standing paragraph (owner request). */}
              <InfoPopover label={t('lists.rowDate')}>{t('lists.rowDateHint')}</InfoPopover>
            </span>
            <input
              id="list-row-date"
              type="date"
              value={date}
              min={minStartDate}
              onChange={(e) => setDate(e.target.value)}
              aria-describedby={startDateState === 'none' ? undefined : 'list-row-date-effect'}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="list-row-end-date" className="block text-sm text-muted-foreground mb-1.5">
              {t('lists.rowEndDate')}
            </label>
            <input
              id="list-row-end-date"
              type="date"
              value={endDate}
              min={date || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              aria-invalid={dateRangeInvalid || undefined}
              className={inputClass}
            />
          </div>
        </div>
        {dateRangeInvalid && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">{t('lists.dateRangeInvalid')}</p>
        )}

        {/* Temporarily unavailable — the row STAYS in the list and the AI says
            «غير متاح حالياً» instead of denying the item exists. That honest
            middle answer is what «رقم 7» needed; without this door only a
            seeding script could set it. */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-theme-border px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{t('lists.availableLabel')}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {isAvailable ? t('lists.availableHint') : t('lists.unavailableHint')}
            </span>
          </span>
          <Toggle
            enabled={isAvailable}
            onChange={setIsAvailable}
            aria-label={t('lists.availableLabel')}
          />
        </div>
        {/* The consequence, in the merchant's terms, next to the control that
            causes it — and only once a date exists, so an undated row (the
            common case) reads no warning about a feature it never uses. */}
        {startDateState === 'live' && (
          <p id="list-row-date-effect" className="text-xs text-muted-foreground">
            {t('lists.rowDateShownUntil', { date: formatPlainDate(date, intlLocale) ?? date })}
          </p>
        )}
        {startDateState === 'passed' && (
          <p id="list-row-date-effect" className="text-xs text-amber-700 dark:text-amber-400" role="status">
            {t('lists.rowDatePassed')}
          </p>
        )}

        {/* Destructive action at the END of the form, spatially far from Save
            (round-6 expert point 5). Two-step confirm as before. */}
        {row && canDelete && (
          <section aria-label={t('lists.deleteRowAction')} className="danger-zone rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm danger-zone-text">{t('lists.deleteRowAction')}</span>
            {confirmingDelete ? (
              <Button variant="danger" size="sm" onClick={onDelete} loading={saving}>
                {t('lists.deleteConfirm')}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border danger-zone-btn px-3 text-sm font-semibold"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {tc('delete')}
              </button>
            )}
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving && !confirmingDelete}
          disabled={!dirty || !name.trim() || anyLabelTaken || dateRangeInvalid || priceInvalid || anyValueTooLong}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>
    </DetailSheet>
  );
}

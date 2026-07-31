import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check, Trash2 } from 'lucide-react';
import { DetailSheet, Button } from '@/components/ui';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { formatCatalogPrice } from '@/utils/priceFormat';
import type { FactRowDto } from '@/lib/api';

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
  /** The collection's attribute schema (labels of the first row) — a NEW row
   *  starts with these labels and empty values, keeping rows in one shape. */
  attributeLabels: string[];
  /** Whether this row may be deleted (the LAST row of a collection may not —
   *  an empty collection would silently drop its coverage boundary). */
  canDelete: boolean;
  saving: boolean;
  onSave: (body: {
    name: string;
    attributes: { label: string; value: string }[] | null;
    price: string | null;
    currency: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Single-row bottom sheet for the fact-list editor (G1b slice 1).
 *
 * Mobile-first per the binding B1 constraints: one screen of labelled fields,
 * 44px+ targets, `dir="auto"` on text inputs, built on DetailSheet (which owns
 * the keyboard offset — never hand-roll that). Deliberate slice-1 bounds:
 *
 * - Attribute LABELS are fixed; only VALUES are editable. The labels («الأيام»,
 *   «الساعة», «المستوى») are the list's schema, set at extraction — letting a
 *   row rename them would fork rows out of their collection's shape. A NEW row
 *   inherits its labels from the collection's first row for the same reason.
 * - ONE date field. A cohort slot self-expires at its start (startsAt=endsAt —
 *   how every seeded row works), so the sheet exposes «تاريخ البدء» and writes
 *   both. The label says what expiry does; a merchant must not need to know
 *   the two-column mechanics. Rows with a differing endsAt (none exist today)
 *   round-trip untouched unless the date is edited.
 * - The key attribute (`keyAttr`) value IS editable — it is data like any
 *   other value; the matcher just reads it. The sheet marks it so the merchant
 *   knows customers find the row by that word.
 */
export function ListRowSheet({
  row,
  initial,
  collectionLabel,
  attributeLabels,
  canDelete,
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
  const [attrs, setAttrs] = useState<{ label: string; value: string }[]>(
    () => row
      ? (row.attributes ?? []).map((a) => ({ ...a }))
      : attributeLabels.map((label) => ({
          label,
          value: initial?.attributes?.find((a) => a.label === label)?.value ?? '',
        })),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEscapeKey(onClose, true);

  const dirty =
    name.trim() !== (row?.name ?? '') ||
    price.trim() !== (row?.price ? formatCatalogPrice(row.price) : '') ||
    currency.trim() !== (row?.currency ?? '') ||
    date !== (row?.startsAt ?? '') ||
    JSON.stringify(attrs.map((a) => a.value.trim())) !==
      JSON.stringify((row?.attributes ?? []).map((a) => a.value.trim()));

  const submit = () => {
    if (saving || !name.trim()) return;
    const keptAttrs = attrs
      .map((a) => ({ label: a.label, value: a.value.trim() }))
      .filter((a) => a.value.length > 0);
    onSave({
      name: name.trim(),
      attributes: keptAttrs.length ? keptAttrs : null,
      price: price.trim() || null,
      currency: currency.trim() || null,
      // One date drives BOTH columns, unconditionally — see the sheet doc
      // comment. An earlier version preserved a differing endsAt, which let a
      // date edit produce endsAt < startsAt (an instantly-expired row that
      // silently vanishes from the prompt). The service guards the invariant
      // too; the sheet just never constructs the case.
      startsAt: date || null,
      endsAt: date || null,
    });
  };

  const titleId = 'list-row-sheet-title';

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
          <p className="text-xs text-muted-foreground truncate">{collectionLabel}</p>
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
            className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {attrs.map((a, i) => (
          <div key={a.label + i}>
            <label htmlFor={`list-row-attr-${i}`} className="block text-sm text-muted-foreground mb-1.5">
              {a.label}
            </label>
            <input
              id={`list-row-attr-${i}`}
              type="text"
              value={a.value}
              onChange={(e) => setAttrs((prev) => prev.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
              dir={a.value ? 'auto' : undefined}
              className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        ))}

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
              className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
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
              className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="list-row-date" className="block text-sm text-muted-foreground mb-1.5">
            {t('lists.rowDate')}
          </label>
          <input
            id="list-row-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-theme-border bg-card px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {/* What expiry DOES, in the merchant's terms — the whole point of
              dated rows. Shown always, not only when a date is set, so the
              merchant learns the behaviour before relying on it. */}
          <p className="mt-1.5 text-xs text-muted-foreground">{t('lists.rowDateHint')}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 pb-safe-modal lg:pb-4 lg:px-5 border-t border-theme-border bg-card">
        {row && canDelete && (
          confirmingDelete ? (
            <Button
              variant="danger"
              size="sm"
              onClick={onDelete}
              loading={saving}
              className="max-sm:h-11"
            >
              {t('lists.deleteConfirm')}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={tc('delete')}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-red-600"
            >
              <Trash2 className="w-5 h-5" aria-hidden="true" />
            </button>
          )
        )}
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose} className="max-sm:hidden">
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving && !confirmingDelete}
          disabled={!dirty || !name.trim()}
          icon={<Check className="w-4 h-4" />}
          className="max-sm:h-11 max-sm:px-6 max-sm:flex-1"
        >
          {tc('save')}
        </Button>
      </div>
    </DetailSheet>
  );
}

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { Toggle } from '@/components/ui';
import type { CatalogItem } from '@jawab24/shared';
import { todayISODate } from './CatalogItemFields';

interface CatalogItemRowProps {
  item: CatalogItem;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onEdit: (item: CatalogItem) => void;
  onDelete: (item: CatalogItem) => void;
  onMove: (item: CatalogItem, direction: 'up' | 'down') => void;
  /** One-tap availability flip — dealers mark cars sold daily; no form needed. */
  onToggleAvailability: (item: CatalogItem, enabled: boolean) => void;
  /** Inline price save (trimmed string; '' = price on request). Server
   *  normalizes Arabic-Indic digits — pass the raw text through. */
  onSavePrice: (item: CatalogItem, price: string) => void;
}

/** "3500.00" → "3500", "49.90" → "49.9" — merchant-facing, no trailing zeros. */
function formatPrice(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? String(n) : price;
}

/**
 * One catalog row, tuned for the two edits merchants make constantly:
 * price (tap the price → inline input; Enter/blur saves, Escape cancels) and
 * availability (Toggle). Everything else lives behind the edit pencil. No type
 * badge — the type shapes the FORM, the merchant shouldn't have to read it.
 */
export function CatalogItemRow({
  item, isFirst, isLast, disabled, onEdit, onDelete, onMove, onToggleAvailability, onSavePrice,
}: CatalogItemRowProps) {
  const t = useTranslations('catalog');

  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');

  const startPriceEdit = () => {
    if (disabled) return;
    setPriceDraft(item.price !== null ? formatPrice(item.price) : '');
    setEditingPrice(true);
  };
  const commitPrice = () => {
    setEditingPrice(false);
    const next = priceDraft.trim();
    const current = item.price !== null ? formatPrice(item.price) : '';
    if (next !== current) onSavePrice(item, next);
  };

  // Dealers think "sold", shops think "out of stock" — same flag, honest words.
  const outLabel = item.type === 'vehicle' ? t('availability.sold') : t('availability.out');

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      {/* Reorder controls */}
      <div className="flex flex-col flex-shrink-0">
        <button type="button" onClick={() => onMove(item, 'up')} disabled={disabled || isFirst}
          aria-label={t('actions.moveUp')}
          className="p-0.5 rounded text-icon-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronUp className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onMove(item, 'down')} disabled={disabled || isLast}
          aria-label={t('actions.moveDown')}
          className="p-0.5 rounded text-icon-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Name + dates + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span dir="auto" className="text-sm font-semibold text-foreground">{item.name}</span>
          {/* Past endsAt: the AI already stopped offering this item (excluded
              from the prompt block) — the badge tells the merchant why. */}
          {item.endsAt && item.endsAt < todayISODate() && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t('badges.ended')}
            </span>
          )}
        </div>
        {(item.startsAt || item.endsAt) && (
          <p className="text-xs text-muted-foreground mt-0.5" dir="auto">
            {item.startsAt && t('badges.startsOn', { date: item.startsAt })}
            {item.startsAt && item.endsAt && ' · '}
            {item.endsAt && t('badges.endsOn', { date: item.endsAt })}
          </p>
        )}
        {item.description && (
          <p dir="auto" className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
        )}
      </div>

      {/* Price — tap to edit in place */}
      {editingPrice ? (
        <input
          aria-label={t('fields.priceOptional')}
          dir="auto"
          inputMode="decimal"
          autoFocus
          className="input w-24 !py-1.5 text-sm tabular-nums flex-shrink-0"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={commitPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitPrice(); }
            if (e.key === 'Escape') setEditingPrice(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={startPriceEdit}
          disabled={disabled}
          aria-label={t('inlinePrice.editLabel', { name: item.name })}
          dir="auto"
          className="text-sm font-semibold text-foreground whitespace-nowrap tabular-nums text-end px-2 py-1.5 -my-1.5 rounded-lg hover:bg-muted transition-colors disabled:cursor-not-allowed flex-shrink-0"
        >
          {item.price !== null ? (
            <>
              {formatPrice(item.price)}
              {item.currency && <span className="text-xs font-medium text-muted-foreground ms-1">{item.currency}</span>}
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4">{t('inlinePrice.addPrice')}</span>
          )}
        </button>
      )}

      {/* Availability — one tap. */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Toggle
          size="sm"
          enabled={item.isAvailable}
          disabled={disabled}
          onChange={(enabled) => onToggleAvailability(item, enabled)}
          aria-label={t('inlineAvailability.toggleLabel', { name: item.name })}
        />
        <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap w-12 text-start">
          {item.isAvailable ? t('availability.in') : outLabel}
        </span>
      </div>

      {/* Edit / delete */}
      <div className="flex gap-1 flex-shrink-0">
        <button type="button" onClick={() => onEdit(item)} disabled={disabled} aria-label={t('actions.edit')}
          className="w-8 h-8 grid place-items-center rounded-lg border border-border text-icon-muted hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onDelete(item)} disabled={disabled} aria-label={t('actions.delete')}
          className="w-8 h-8 grid place-items-center rounded-lg border border-border text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 transition-colors">
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

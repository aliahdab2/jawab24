import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { CatalogItem, CatalogItemType } from '@jawab24/shared';

interface CatalogItemRowProps {
  item: CatalogItem;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onEdit: (item: CatalogItem) => void;
  onDelete: (item: CatalogItem) => void;
  onMove: (item: CatalogItem, direction: 'up' | 'down') => void;
}

/** "3500.00" → "3500", "49.90" → "49.9" — merchant-facing, no trailing zeros. */
function formatPrice(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? String(n) : price;
}

export function CatalogItemRow({ item, isFirst, isLast, disabled, onEdit, onDelete, onMove }: CatalogItemRowProps) {
  const t = useTranslations('catalog');

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

      {/* Name + type + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span dir="auto" className="text-sm font-semibold text-foreground">{item.name}</span>
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            {t(`types.${item.type as CatalogItemType}`)}
          </span>
        </div>
        {item.description && (
          <p dir="auto" className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
        )}
      </div>

      {/* Price */}
      <div dir="auto" className="text-sm font-semibold text-foreground whitespace-nowrap tabular-nums text-end">
        {item.price !== null ? (
          <>
            {formatPrice(item.price)}
            {item.currency && <span className="text-xs font-medium text-muted-foreground ms-1">{item.currency}</span>}
          </>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{t('priceOnRequest')}</span>
        )}
      </div>

      {/* Availability pill — green in stock, neutral (muted) out of stock */}
      <span className={clsx(
        'text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0',
        item.isAvailable ? 'status-success' : 'bg-muted text-muted-foreground',
      )}>
        {item.isAvailable ? t('availability.in') : t('availability.out')}
      </span>

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

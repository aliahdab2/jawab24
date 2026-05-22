import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { BookOpen } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { CatalogItemCard } from './CatalogItemCard';
import type { CatalogItem, CatalogItemType, CatalogStatusFilter } from '@/lib/api';

const TYPES: ('all' | CatalogItemType)[] = ['all', 'course', 'service', 'product', 'event', 'branch', 'package'];
const STATUSES: CatalogStatusFilter[] = ['active', 'expired', 'archived', 'all'];

interface Props {
    items: CatalogItem[];
    statusFilter: CatalogStatusFilter;
    onStatusChange: (s: CatalogStatusFilter) => void;
    onAddClick?: () => void;
}

export function CatalogList({ items, statusFilter, onStatusChange, onAddClick }: Props) {
    const t = useTranslations('catalog');
    const [typeFilter, setTypeFilter] = useState<'all' | CatalogItemType>('all');

    // Counts per type (within the current status filter)
    const countsByType = useMemo(() => {
        const c: Record<string, number> = { all: items.length };
        for (const it of items) c[it.type] = (c[it.type] ?? 0) + 1;
        return c;
    }, [items]);

    const visibleItems = useMemo(
        () => (typeFilter === 'all' ? items : items.filter(i => i.type === typeFilter)),
        [items, typeFilter],
    );

    return (
        <div className="flex flex-col gap-4">
            {/* Status filter (active / expired / archived / all) */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status filter">
                {STATUSES.map(s => (
                    <button
                        key={s}
                        type="button"
                        role="tab"
                        aria-selected={statusFilter === s}
                        onClick={() => onStatusChange(s)}
                        className={clsx(
                            'px-3 py-1.5 text-sm rounded-full transition-colors border',
                            statusFilter === s
                                ? 'bg-brand-500 text-white border-brand-500'
                                : 'bg-surface-50 text-surface-700 border-surface-200 hover:bg-surface-100',
                        )}
                    >
                        {t(`statusFilter.${s}`)}
                    </button>
                ))}
            </div>

            {/* Type tabs */}
            <div className="flex flex-wrap gap-2 border-b border-surface-200 pb-2" role="tablist" aria-label="Type filter">
                {TYPES.map(typ => {
                    const count = countsByType[typ] ?? 0;
                    if (typ !== 'all' && count === 0) return null;
                    return (
                        <button
                            key={typ}
                            type="button"
                            role="tab"
                            aria-selected={typeFilter === typ}
                            onClick={() => setTypeFilter(typ)}
                            className={clsx(
                                'px-3 py-1.5 text-sm rounded-md transition-colors',
                                typeFilter === typ
                                    ? 'bg-brand-50 text-brand-700 font-semibold'
                                    : 'text-surface-600 hover:bg-surface-50',
                            )}
                        >
                            {t(`types.${typ}`)}
                            <span className="ms-1.5 text-xs text-muted-foreground">({count})</span>
                        </button>
                    );
                })}
            </div>

            {/* Items */}
            {visibleItems.length === 0 ? (
                <EmptyState
                    icon={BookOpen}
                    title={t('emptyState.title')}
                    description={t('emptyState.body')}
                    action={onAddClick ? <Button onClick={onAddClick}>{t('emptyState.cta')}</Button> : undefined}
                />
            ) : (
                <ul className="flex flex-col gap-3" aria-live="polite">
                    {visibleItems.map(item => (
                        <li key={item.id}>
                            <CatalogItemCard item={item} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

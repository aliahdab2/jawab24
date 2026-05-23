import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { BookOpen, Plus, SearchX } from 'lucide-react';
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
    onEditItem?: (item: CatalogItem) => void;
    onArchiveItem?: (item: CatalogItem) => void;
    onRestoreItem?: (item: CatalogItem) => void;
    onDeleteItemPermanent?: (item: CatalogItem) => void;
}

// At very low item counts the type filter is pure visual noise — the merchant
// can see every item at a glance and the filter pills crowd the layout for no
// benefit. Show it only once the list is long enough that a filter saves real
// scrolling. Threshold picked by eye, not measured; revisit with real data.
const TYPE_FILTER_THRESHOLD = 6;

export function CatalogList({ items, statusFilter, onStatusChange, onAddClick, onEditItem, onArchiveItem, onRestoreItem, onDeleteItemPermanent }: Props) {
    const t = useTranslations('catalog');
    const [typeFilter, setTypeFilter] = useState<'all' | CatalogItemType>('all');

    // Reset the type filter whenever the status filter changes — otherwise the
    // user picks "Expired" with type still on "Courses" and gets a misleading
    // empty state if no expired courses exist.
    useEffect(() => {
        setTypeFilter('all');
    }, [statusFilter]);

    // Counts per type within the current status slice.
    const countsByType = useMemo(() => {
        const c: Record<string, number> = { all: items.length };
        for (const it of items) c[it.type] = (c[it.type] ?? 0) + 1;
        return c;
    }, [items]);

    const visibleItems = useMemo(
        () => (typeFilter === 'all' ? items : items.filter(i => i.type === typeFilter)),
        [items, typeFilter],
    );

    // Empty-state context distinguishes "no items at all" from "filter hid them".
    const isTrulyEmpty = items.length === 0;
    const isFilteredEmpty = items.length > 0 && visibleItems.length === 0;

    return (
        <div className="flex flex-col gap-4">
            {/* "Add item" CTA — only when there are existing items. Empty state
                renders its own CTA inside <EmptyState>, so no duplicate here. */}
            {!isTrulyEmpty && onAddClick && (
                <div className="flex justify-end">
                    <Button onClick={onAddClick} size="sm">
                        <Plus className="w-4 h-4 me-1" aria-hidden="true" />
                        {t('addItem')}
                    </Button>
                </div>
            )}

            {/* Status filter — these are filter buttons, not real ARIA tabs
                (no associated tabpanels). Use aria-pressed for toggle semantics. */}
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('statusFilter.groupLabel')}>
                {STATUSES.map(s => (
                    <button
                        key={s}
                        type="button"
                        aria-pressed={statusFilter === s}
                        onClick={() => onStatusChange(s)}
                        className={clsx(
                            'px-3 py-1.5 text-sm rounded-full transition-colors border',
                            statusFilter === s
                                ? 'bg-brand-500 text-white border-brand-500 hover:bg-brand-600'
                                : 'bg-card text-foreground/80 border-theme-border hover:bg-muted',
                        )}
                    >
                        {t(`statusFilter.${s}`)}
                    </button>
                ))}
            </div>

            {/* Type filter — hidden when list is short enough that filtering
                wouldn't save the merchant any scrolling (visual noise reduction). */}
            <div
                className={clsx(
                    'flex flex-wrap gap-2 border-b border-theme-border pb-2',
                    items.length < TYPE_FILTER_THRESHOLD && 'hidden',
                )}
                role="group"
                aria-label={t('typeFilter.groupLabel')}
            >
                {TYPES.map(typ => {
                    const count = countsByType[typ] ?? 0;
                    if (typ !== 'all' && count === 0) return null;
                    return (
                        <button
                            key={typ}
                            type="button"
                            aria-pressed={typeFilter === typ}
                            onClick={() => setTypeFilter(typ)}
                            className={clsx(
                                'px-3 py-1.5 text-sm rounded-md transition-colors',
                                typeFilter === typ
                                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-semibold'
                                    : 'text-muted-foreground hover:bg-muted',
                            )}
                        >
                            {t(`types.${typ}`)}
                            <span className="ms-1.5 text-xs text-muted-foreground">({count})</span>
                        </button>
                    );
                })}
            </div>

            {/* Items.

                Empty-state copy is filter-aware so we never show the
                "Add your first item" CTA to a merchant who already has items
                — they might be on the Archived or Expired filter that just
                happens to be empty right now. Showing them a generic
                "no items" message in that case implies the catalog is empty
                overall, which is wrong and misleading.

                - status=active|all + truly empty → onboarding CTA
                - status=expired + empty           → status-specific message
                - status=archived + empty          → status-specific message
                - any status + filtered by type    → "no matches" hint
            */}
            {isTrulyEmpty && (statusFilter === 'active' || statusFilter === 'all') ? (
                <EmptyState
                    icon={BookOpen}
                    title={t('emptyState.title')}
                    description={t('emptyState.body')}
                    action={onAddClick ? <Button onClick={onAddClick}>{t('emptyState.cta')}</Button> : undefined}
                />
            ) : isTrulyEmpty && statusFilter === 'expired' ? (
                <EmptyState
                    icon={BookOpen}
                    title={t('emptyStatus.expiredTitle')}
                    description={t('emptyStatus.expiredBody')}
                />
            ) : isTrulyEmpty && statusFilter === 'archived' ? (
                <EmptyState
                    icon={BookOpen}
                    title={t('emptyStatus.archivedTitle')}
                    description={t('emptyStatus.archivedBody')}
                />
            ) : isFilteredEmpty ? (
                <EmptyState
                    icon={SearchX}
                    variant="search"
                    title={t('emptyFiltered.title')}
                    description={t('emptyFiltered.body')}
                />
            ) : (
                <ul className="flex flex-col gap-3" aria-live="polite">
                    {visibleItems.map(item => (
                        <li key={item.id}>
                            <CatalogItemCard
                                item={item}
                                onEdit={onEditItem ? () => onEditItem(item) : undefined}
                                onArchive={onArchiveItem ? () => onArchiveItem(item) : undefined}
                                onRestore={onRestoreItem ? () => onRestoreItem(item) : undefined}
                                onDeletePermanent={onDeleteItemPermanent ? () => onDeleteItemPermanent(item) : undefined}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

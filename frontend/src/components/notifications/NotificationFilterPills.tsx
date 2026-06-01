import React from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { formatBadgeCount, type NotificationFilter } from '@/components/ui/notificationUtils';

interface NotificationFilterPillsProps {
    activeFilter: NotificationFilter;
    onChange: (filter: NotificationFilter) => void;
    counts: Record<NotificationFilter, number>;
}

// Mirrors the "Inbox" sidebar group (Comments / Messages / Leads). Account-health
// events (billing/system) intentionally have no tab — they pin to the top of "All".
const FILTERS: { value: NotificationFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'filter.all' },
    { value: 'comments', labelKey: 'filter.comments' },
    { value: 'messages', labelKey: 'filter.messages' },
    { value: 'leads', labelKey: 'filter.leads' },
];

export function NotificationFilterPills({
    activeFilter,
    onChange,
    counts,
}: NotificationFilterPillsProps) {
    const t = useTranslations('notifications');

    return (
        <div
            // Fixed set of 4 filters → a segmented control that always fits the
            // row (each pill flex-1), never a horizontal scroll that hides the
            // Leads tab off-screen.
            className="flex items-center gap-1.5 px-4 py-2"
            role="tablist"
            aria-label={t('filterLabel')}
        >
            {FILTERS.map(({ value }) => {
                const isActive = activeFilter === value;
                const count = value === 'all' ? undefined : counts[value];

                return (
                    <button
                        key={value}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onChange(value)}
                        className={clsx(
                            'flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-1.5 rounded-full text-xs font-medium transition-colors',
                            isActive
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-muted text-muted-foreground hover:bg-surface-200 dark:hover:bg-surface-300 hover:text-foreground/80',
                        )}
                    >
                        <span className="truncate">{t(`filter.${value}` as Parameters<typeof t>[0])}</span>
                        {count !== undefined && count > 0 && (
                            <span className={clsx(
                                'shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full',
                                isActive
                                    ? 'bg-white/20 text-white'
                                    : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400',
                            )}>
                                {formatBadgeCount(count)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

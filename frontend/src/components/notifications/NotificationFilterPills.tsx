import React from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';

export type NotificationFilter = 'all' | 'comments' | 'billing' | 'system';

export const FILTER_TYPE_MAP: Record<NotificationFilter, string[] | null> = {
    all: null,
    comments: ['stale_comment', 'new_comment', 'flagged_reply', 'skipped_reply'],
    billing: ['payment_failed', 'subscription_expiring', 'trial_ending', 'subscription_renewed'],
    system: ['page_disconnected', 'kb_gap'],
};

interface NotificationFilterPillsProps {
    activeFilter: NotificationFilter;
    onChange: (filter: NotificationFilter) => void;
    counts: Record<NotificationFilter, number>;
}

const FILTERS: { value: NotificationFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'filter.all' },
    { value: 'comments', labelKey: 'filter.comments' },
    { value: 'billing', labelKey: 'filter.billing' },
    { value: 'system', labelKey: 'filter.system' },
];

export function NotificationFilterPills({
    activeFilter,
    onChange,
    counts,
}: NotificationFilterPillsProps) {
    const t = useTranslations('notifications');

    return (
        <div
            className="flex items-center gap-1.5 px-5 py-2 overflow-x-auto"
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
                            'flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                            isActive
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'bg-muted text-muted-foreground hover:bg-muted hover:text-foreground/80',
                        )}
                    >
                        {t(`filter.${value}` as Parameters<typeof t>[0])}
                        {count !== undefined && count > 0 && (
                            <span className={clsx(
                                'min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full',
                                isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                            )}>
                                {count > 99 ? '99+' : count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

import React from 'react';
import clsx from 'clsx';
import { ChevronDown, Clock, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface NotificationGroupHeaderProps {
    icon: LucideIcon;
    iconColor: string;
    bgColor: string;
    ringColor: string;
    count: number;
    unreadCount: number;
    typeLabel: string;
    latestTimestamp: string;
    isExpanded: boolean;
    onToggle: () => void;
    getRelativeTime: (dateString: string) => string;
}

export function NotificationGroupHeader({
    icon: Icon,
    iconColor,
    bgColor,
    ringColor,
    count,
    unreadCount,
    typeLabel,
    latestTimestamp,
    isExpanded,
    onToggle,
    getRelativeTime,
}: NotificationGroupHeaderProps) {
    const t = useTranslations('notifications');
    const hasUnread = unreadCount > 0;

    return (
        <button
            onClick={onToggle}
            className={clsx(
                'w-full px-5 py-3.5 transition-colors duration-200 cursor-pointer text-start',
                hasUnread
                    ? 'bg-brand-50/40 hover:bg-brand-50/70'
                    : 'hover:bg-background',
            )}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t('collapse') : t('expand')}
        >
            <div className="flex items-center gap-3.5">
                {/* Icon */}
                <div className={clsx(
                    'w-10 h-10 rounded-xl ring-1 flex items-center justify-center flex-shrink-0',
                    bgColor, ringColor,
                    !hasUnread && 'opacity-50',
                )}>
                    <Icon className={clsx('w-5 h-5', iconColor)} aria-hidden="true" />
                </div>

                <div className="flex-1 min-w-0">
                    {/* Summary */}
                    <div className="flex items-center gap-2">
                        <p className={clsx(
                            'text-[13px] leading-snug',
                            hasUnread
                                ? 'font-semibold text-foreground'
                                : 'font-normal text-muted-foreground',
                        )}>
                            {t('groupSummary', { count })} — {typeLabel}
                        </p>
                        {hasUnread && (
                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[10px] font-bold text-white bg-brand-500 rounded-full flex-shrink-0">
                                {unreadCount}
                            </span>
                        )}
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                        <p className="text-[11px] text-muted-foreground">
                            {getRelativeTime(latestTimestamp)}
                        </p>
                    </div>
                </div>

                {/* Expand/Collapse chevron */}
                <ChevronDown
                    className={clsx(
                        'w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0',
                        isExpanded && 'rotate-180',
                    )}
                    aria-hidden="true"
                />
            </div>
        </button>
    );
}

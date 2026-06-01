import React from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatBadgeCount, type NotificationStyle } from '@/components/ui/notificationUtils';
import { NotificationAvatar, NotificationTimestamp, NotificationTitle, UnreadAccentBar } from './NotificationVisuals';

interface NotificationGroupHeaderProps {
    style: NotificationStyle;
    count: number;
    unreadCount: number;
    typeLabel: string;
    latestTimestamp: string;
    isExpanded: boolean;
    onToggle: () => void;
    getRelativeTime: (dateString: string) => string;
}

export function NotificationGroupHeader({
    style,
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
                'relative w-full px-5 py-3.5 transition-colors duration-200 cursor-pointer text-start',
                hasUnread
                    ? 'bg-brand-50/40 dark:bg-brand-900/20 hover:bg-brand-50/70 dark:hover:bg-brand-900/30'
                    : 'hover:bg-muted',
            )}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t('collapse') : t('expand')}
        >
            {/* Unread accent bar — matches single notification items */}
            {hasUnread && <UnreadAccentBar />}

            <div className="flex items-center gap-3.5">
                <NotificationAvatar style={style} muted={!hasUnread} />

                <div className="flex-1 min-w-0">
                    <NotificationTitle
                        unread={hasUnread}
                        trailing={hasUnread ? (
                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[10px] font-bold text-white bg-brand-500 rounded-full flex-shrink-0">
                                {formatBadgeCount(unreadCount)}
                            </span>
                        ) : undefined}
                    >
                        {t('groupSummary', { count })} — {typeLabel}
                    </NotificationTitle>

                    <NotificationTimestamp
                        time={latestTimestamp}
                        getRelativeTime={getRelativeTime}
                        className="mt-1"
                    />
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

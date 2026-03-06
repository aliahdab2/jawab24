import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import clsx from 'clsx';
import {
    Bell, X, Check, CheckCheck, ChevronRight, ChevronLeft, Clock,
    MessageCircle, AlertTriangle, CreditCard, CheckCircle, Unplug, BookOpen,
    type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead, getUnreadCount } from '@/lib/notifications';
import { SwipeableNotificationItem } from './SwipeableNotificationItem';
import { NotificationFilterPills, FILTER_TYPE_MAP, type NotificationFilter } from '../notifications/NotificationFilterPills';
import { NotificationGroupHeader } from '../notifications/NotificationGroup';
import { NotificationEmptyState } from '../notifications/NotificationEmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    data: unknown;
    read: boolean;
    createdAt: string;
}

interface GroupedNotifications {
    id: string;
    type: string;
    notifications: Notification[];
    latestTimestamp: string;
    unreadCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

interface NotificationStyle {
    icon: LucideIcon;
    iconColor: string;
    bgColor: string;
    ringColor: string;
}

const NOTIFICATION_STYLES: Record<string, NotificationStyle> = {
    stale_comment:         { icon: Bell,          iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    new_comment:           { icon: MessageCircle, iconColor: 'text-blue-600 dark:text-blue-400',       bgColor: 'bg-blue-50 dark:bg-blue-900/30',       ringColor: 'notif-ring-blue' },
    flagged_reply:         { icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    skipped_reply:         { icon: AlertTriangle, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    payment_failed:        { icon: CreditCard,    iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    subscription_expiring: { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    trial_ending:          { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    subscription_renewed:  { icon: CheckCircle,   iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-900/30', ringColor: 'notif-ring-emerald' },
    page_disconnected:     { icon: Unplug,        iconColor: 'text-slate-600 dark:text-slate-400',     bgColor: 'bg-slate-100 dark:bg-slate-900/30',    ringColor: 'notif-ring-slate' },
    kb_gap:                { icon: BookOpen,       iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
};

const DEFAULT_STYLE: NotificationStyle = {
    icon: Bell, iconColor: 'text-brand-600', bgColor: 'bg-brand-50', ringColor: 'ring-brand-200/60',
};

const ACTIONABLE_TYPES = new Set(['stale_comment', 'new_comment', 'flagged_reply', 'skipped_reply']);
const GROUP_TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNotificationStyle(type: string): NotificationStyle {
    return NOTIFICATION_STYLES[type] ?? DEFAULT_STYLE;
}

function getNotificationRoute(notification: Notification): string | null {
    const data = notification.data as Record<string, string> | undefined;
    const isMessage = data?.type === 'message';

    // Comment/message notifications: deep-link to the specific item when possible
    const isCommentType = ['stale_comment', 'new_comment', 'flagged_reply', 'skipped_reply'].includes(notification.type);
    if (isCommentType) {
        if (isMessage && data?.messageId) {
            return `/messages?messageId=${encodeURIComponent(data.messageId)}`;
        }
        if (!isMessage && data?.commentId) {
            return `/comments?commentId=${encodeURIComponent(data.commentId)}`;
        }
        // Fallback to filter page when no specific ID available
        return isMessage ? '/messages?filter=needs_action' : '/comments?filter=needs_action';
    }

    // Non-comment notifications: use stored deepLink or type-based fallback
    if (data?.deepLink) return data.deepLink;

    switch (notification.type) {
        case 'payment_failed':
        case 'subscription_expiring':
        case 'subscription_renewed':
        case 'trial_ending':
            return '/pricing';
        case 'page_disconnected':
        case 'kb_gap':
            return '/pages';
        default:
            return null;
    }
}

function groupNotifications(
    notifications: Notification[],
): (Notification | GroupedNotifications)[] {
    if (notifications.length === 0) return [];

    const result: (Notification | GroupedNotifications)[] = [];
    let currentGroup: Notification[] = [notifications[0]];

    for (let i = 1; i < notifications.length; i++) {
        const prev = notifications[i - 1];
        const curr = notifications[i];
        const timeDiff = Math.abs(
            new Date(prev.createdAt).getTime() - new Date(curr.createdAt).getTime(),
        );

        if (curr.type === prev.type && timeDiff <= GROUP_TIME_WINDOW_MS) {
            currentGroup.push(curr);
        } else {
            flushGroup(currentGroup, result);
            currentGroup = [curr];
        }
    }
    flushGroup(currentGroup, result);
    return result;
}

function flushGroup(
    group: Notification[],
    result: (Notification | GroupedNotifications)[],
) {
    if (group.length === 1) {
        result.push(group[0]);
    } else {
        result.push({
            id: group[0].id,
            type: group[0].type,
            notifications: group,
            latestTimestamp: group[0].createdAt,
            unreadCount: group.filter(n => !n.read).length,
        });
    }
}

function isGroup(item: Notification | GroupedNotifications): item is GroupedNotifications {
    return 'notifications' in item;
}

function computeFilterCounts(notifications: Notification[]): Record<NotificationFilter, number> {
    const counts: Record<NotificationFilter, number> = { all: notifications.length, comments: 0, billing: 0, system: 0 };
    for (const n of notifications) {
        if (FILTER_TYPE_MAP.comments?.includes(n.type)) counts.comments++;
        else if (FILTER_TYPE_MAP.billing?.includes(n.type)) counts.billing++;
        else if (FILTER_TYPE_MAP.system?.includes(n.type)) counts.system++;
    }
    return counts;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface NotificationBellProps {
    /** 'light' for sidebar (dark text), 'dark' for mobile header (white text on dark bg) */
    variant?: 'light' | 'dark';
}

export function NotificationBell({ variant = 'light' }: NotificationBellProps) {
    const isDark = variant === 'dark';
    const { isAuthenticated } = useAuthStore();
    const { t, language } = useTranslation();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const dropdownRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);

    useBodyScrollLock(isOpen);

    // Fetch unread count on mount and periodically
    useEffect(() => {
        if (!isAuthenticated) return;

        const fetchUnreadCount = async () => {
            const count = await getUnreadCount();
            setUnreadCount(count);
        };

        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 60000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    // Fetch notifications when dropdown opens
    useEffect(() => {
        if (!isOpen || !isAuthenticated) return;

        const fetchNotifications = async () => {
            setLoading(true);
            const result = await getNotifications();
            setNotifications(result.notifications);
            setUnreadCount(result.unreadCount);
            setLoading(false);
        };

        fetchNotifications();
    }, [isOpen, isAuthenticated]);

    // Reset filter and expanded groups when dropdown closes
    useEffect(() => {
        if (!isOpen) {
            setActiveFilter('all');
            setExpandedGroups(new Set());
        }
    }, [isOpen]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                dropdownRef.current && !dropdownRef.current.contains(target) &&
                bellRef.current && !bellRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Derived data
    const filterCounts = useMemo(() => computeFilterCounts(notifications), [notifications]);

    const filteredAndGrouped = useMemo(() => {
        const types = FILTER_TYPE_MAP[activeFilter];
        const filtered = types ? notifications.filter(n => types.includes(n.type)) : notifications;
        return groupNotifications(filtered);
    }, [notifications, activeFilter]);

    // ── Handlers ──

    const getRelativeTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return t('notifications.justNow');
        if (diffMins < 60) return t('notifications.minutesAgo', { count: diffMins });
        if (diffHours < 24) return t('notifications.hoursAgo', { count: diffHours });
        return t('notifications.daysAgo', { count: diffDays });
    };

    const handleMarkAsRead = async (notificationId: string) => {
        await markNotificationAsRead(notificationId);
        setNotifications(prev =>
            prev.map(n => n.id === notificationId ? { ...n, read: true } : n),
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read) {
            handleMarkAsRead(notification.id);
        }

        const route = getNotificationRoute(notification);
        if (route) {
            setIsOpen(false);
            router.push(route);
        }
    };

    const handleReplyNow = (notification: Notification) => {
        if (!notification.read) {
            handleMarkAsRead(notification.id);
        }
        setIsOpen(false);
        const route = getNotificationRoute(notification);
        router.push(route || '/comments');
    };

    const handleMarkAllAsRead = async () => {
        await markAllNotificationsAsRead();
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
    };

    const handleDismissNotification = (notificationId: string, wasUnread: boolean) => {
        const dismissed = notifications.find(n => n.id === notificationId);
        const dismissedIndex = notifications.findIndex(n => n.id === notificationId);

        setNotifications(prev => prev.filter(n => n.id !== notificationId));
        if (wasUnread) {
            setUnreadCount(prev => Math.max(0, prev - 1));
        }

        let undone = false;
        const apiTimer = setTimeout(() => {
            if (!undone) {
                markNotificationAsRead(notificationId);
            }
        }, 5000);

        toast(t('notifications.dismissed'), {
            duration: 4000,
            action: {
                label: t('notifications.undo'),
                onClick: () => {
                    undone = true;
                    clearTimeout(apiTimer);
                    if (dismissed) {
                        setNotifications(prev => {
                            const updated = [...prev];
                            const insertAt = Math.min(dismissedIndex, updated.length);
                            updated.splice(insertAt, 0, dismissed);
                            return updated;
                        });
                        if (wasUnread) {
                            setUnreadCount(prev => prev + 1);
                        }
                    }
                },
            },
        });
    };

    const handleDismissGroup = (group: GroupedNotifications) => {
        const ids = group.notifications.map(n => n.id);
        const unreadInGroup = group.unreadCount;

        setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
        if (unreadInGroup > 0) {
            setUnreadCount(prev => Math.max(0, prev - unreadInGroup));
        }

        for (const n of group.notifications) {
            if (!n.read) markNotificationAsRead(n.id);
        }

        toast(t('notifications.dismissed'), { duration: 4000 });
    };

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    // ── Render helpers ──

    const renderNotificationItem = (notification: Notification, indented = false) => {
        const style = getNotificationStyle(notification.type);
        const IconComponent = style.icon;
        const isUnread = !notification.read;
        const isActionable = ACTIONABLE_TYPES.has(notification.type);

        return (
            <SwipeableNotificationItem
                key={notification.id}
                onDismiss={() => handleDismissNotification(notification.id, isUnread)}
                enabled={isUnread}
            >
                <div
                    className={clsx(
                        'group relative px-5 py-3.5 transition-colors duration-200 cursor-pointer',
                        indented && 'ps-14',
                        isUnread
                            ? 'bg-brand-50/40 dark:bg-brand-900/20 hover:bg-brand-50/70 dark:hover:bg-brand-900/30'
                            : 'hover:bg-muted',
                    )}
                    onClick={() => handleNotificationClick(notification)}
                >
                    {/* Unread accent bar */}
                    {isUnread && (
                        <div className="absolute inset-y-0 start-0 w-[3px] bg-brand-500 rounded-e-full" />
                    )}

                    <div className="flex items-start gap-3.5">
                        {/* Icon */}
                        <div className={clsx(
                            'w-10 h-10 rounded-xl ring-1 flex items-center justify-center flex-shrink-0',
                            style.bgColor, style.ringColor,
                            !isUnread && 'opacity-50',
                        )}>
                            <IconComponent className={clsx('w-5 h-5', style.iconColor)} aria-hidden="true" />
                        </div>

                        <div className="flex-1 min-w-0">
                            {/* Title */}
                            <div className="flex items-center gap-2">
                                <p className={clsx(
                                    'text-[13px] leading-snug truncate',
                                    isUnread
                                        ? 'font-semibold text-foreground'
                                        : 'font-normal text-muted-foreground',
                                )}>
                                    {notification.title}
                                </p>
                                {isUnread && (
                                    <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                                )}
                            </div>

                            {/* Body */}
                            <p className={clsx(
                                'text-xs leading-relaxed mt-0.5 line-clamp-2',
                                isUnread ? 'text-muted-foreground' : 'text-muted-foreground/70',
                            )}>
                                {notification.body}
                            </p>

                            {/* Timestamp */}
                            <div className="flex items-center gap-1 mt-1.5">
                                <Clock className="w-3 h-3 text-icon-muted" aria-hidden="true" />
                                <p className="text-[11px] text-muted-foreground">
                                    {getRelativeTime(notification.createdAt)}
                                </p>
                            </div>

                            {/* Reply Now CTA */}
                            {isActionable && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleReplyNow(notification);
                                    }}
                                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                                    aria-label={t('notifications.replyNow')}
                                >
                                    <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                    {t('notifications.replyNow')}
                                </button>
                            )}
                        </div>

                        {/* Action area */}
                        <div className="flex items-center self-center flex-shrink-0">
                            {getNotificationRoute(notification) ? (
                                <>
                                    <ChevronRight className="w-4 h-4 text-icon-muted group-hover:text-muted-foreground transition-colors ltr:block rtl:hidden" />
                                    <ChevronLeft className="w-4 h-4 text-icon-muted group-hover:text-muted-foreground transition-colors rtl:block ltr:hidden" />
                                </>
                            ) : isUnread ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleMarkAsRead(notification.id);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/30 text-surface-400 dark:text-surface-600 hover:text-brand-600 transition-colors"
                                    title={t('notifications.markAsRead')}
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            </SwipeableNotificationItem>
        );
    };

    const renderGroupedItem = (group: GroupedNotifications) => {
        const style = getNotificationStyle(group.type);
        const isExpanded = expandedGroups.has(group.id);
        const typeLabelKey = `notifications.typeLabel.${group.type}` as TranslationKey;

        return (
            <div key={group.id} className="border-b border-theme-border">
                <SwipeableNotificationItem
                    onDismiss={() => handleDismissGroup(group)}
                    enabled={group.unreadCount > 0}
                >
                    <NotificationGroupHeader
                        icon={style.icon}
                        iconColor={style.iconColor}
                        bgColor={style.bgColor}
                        ringColor={style.ringColor}
                        count={group.notifications.length}
                        unreadCount={group.unreadCount}
                        typeLabel={t(typeLabelKey)}
                        latestTimestamp={group.latestTimestamp}
                        isExpanded={isExpanded}
                        onToggle={() => toggleGroup(group.id)}
                        getRelativeTime={getRelativeTime}
                    />
                </SwipeableNotificationItem>

                {/* Expanded individual items */}
                {isExpanded && (
                    <div className="bg-surface-50/50">
                        {group.notifications.map(n => renderNotificationItem(n, true))}
                    </div>
                )}
            </div>
        );
    };

    // ── Main render ──

    return (
        <div className="relative">
            {/* Bell Button */}
            <button
                ref={bellRef}
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    'relative p-2 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center',
                    isDark
                        ? isOpen
                            ? 'bg-white/20 text-white'
                            : 'hover:bg-white/10 text-white/90'
                        : isOpen
                            ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                            : 'hover:bg-muted text-muted-foreground',
                )}
                aria-label={t('notifications.title')}
            >
                <Bell className={clsx('w-5 h-5', unreadCount > 0 && 'animate-pulse-soft')} />
                {unreadCount > 0 && (
                    <span className={clsx(
                        'absolute -top-1 -end-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-bold text-white bg-red-500 rounded-full shadow-sm shadow-red-200 ring-2',
                        isDark ? 'ring-black/30' : 'ring-white',
                    )}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Backdrop + Dropdown — portaled to body */}
            {isOpen && typeof document !== 'undefined' && createPortal(
                <>
                <div
                    className="fixed inset-0 bg-black/30 z-[99] animate-fade-in"
                    onClick={() => setIsOpen(false)}
                />
                <div
                    ref={dropdownRef}
                    className={clsx(
                        'fixed start-4 end-4 bg-card rounded-2xl shadow-2xl shadow-surface-900/10 border border-theme-border overflow-hidden z-[100] animate-fade-in',
                        isDark
                            ? 'max-h-[60vh]'
                            : 'top-20 sm:end-auto sm:start-[272px] sm:w-[420px] max-h-[70vh]',
                    )}
                    style={isDark ? { top: 'calc(var(--sai-top) + 4.5rem)' } : undefined}
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                >
                    {/* Header Row 1: Title + Close */}
                    <div className="flex items-center justify-between px-5 pt-3.5 pb-2 bg-gradient-to-b from-muted to-card">
                        <div className="flex items-center gap-2.5">
                            <h3 className="font-bold text-foreground">
                                {t('notifications.title')}
                            </h3>
                            {unreadCount > 0 && (
                                <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-[11px] font-bold text-brand-700 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/50 rounded-full">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            )}
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1.5 rounded-lg hover:bg-muted text-surface-400 dark:text-surface-600 hover:text-muted-foreground transition-colors"
                            aria-label={t('notifications.close')}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Header Row 2: Mark all read (separated from close) */}
                    {unreadCount > 0 && (
                        <div className="px-5 pb-2">
                            <button
                                onClick={handleMarkAllAsRead}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                            >
                                <CheckCheck className="w-3.5 h-3.5" />
                                {t('notifications.markAllRead')}
                            </button>
                        </div>
                    )}

                    {/* Header Row 3: Filter pills */}
                    {!loading && notifications.length > 0 && (
                        <>
                            <NotificationFilterPills
                                activeFilter={activeFilter}
                                onChange={setActiveFilter}
                                counts={filterCounts}
                            />
                            <div className="border-b border-theme-border" />
                        </>
                    )}

                    {/* Notifications List */}
                    <div className="max-h-[400px] overflow-y-auto">
                        {loading ? (
                            <div className="p-10 text-center">
                                <div className="w-8 h-8 border-[3px] border-brand-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">{t('notifications.loading')}</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <NotificationEmptyState variant="global" />
                        ) : filteredAndGrouped.length === 0 ? (
                            <NotificationEmptyState
                                variant="filtered"
                                filterName={t(`notifications.filter.${activeFilter}`)}
                            />
                        ) : (
                            filteredAndGrouped.map((item) =>
                                isGroup(item)
                                    ? renderGroupedItem(item)
                                    : renderNotificationItem(item),
                            )
                        )}
                    </div>
                </div>
                </>,
                document.body,
            )}
        </div>
    );
}

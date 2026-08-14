import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import clsx from 'clsx';
import { Bell, X, Check, CheckCheck, ChevronRight, ChevronLeft, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore, useUIStore } from '@/lib/store';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';
import { useBodyScrollLock, useNotificationPoller } from '@/hooks';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '@/lib/notifications';
import { SwipeableNotificationItem } from './SwipeableNotificationItem';
import { NotificationFilterPills } from '../notifications/NotificationFilterPills';
import { NotificationGroupHeader } from '../notifications/NotificationGroup';
import { NotificationEmptyState } from '../notifications/NotificationEmptyState';
import { NotificationAvatar, NotificationTimestamp, NotificationTitle, UnreadAccentBar } from '../notifications/NotificationVisuals';
import { formatRelativeTime } from '@/utils/dateUtils';
import {
    type Notification,
    type GroupedNotifications,
    ACTIONABLE_TYPES,
    getNotificationStyle,
    getNotificationRoute,
    groupNotifications,
    isGroup,
    computeFilterCounts,
    formatBadgeCount,
    getNotificationBucket,
    pinAccountHealthFirst,
    type NotificationFilter,
} from './notificationUtils';

// ─── Component ───────────────────────────────────────────────────────────────

interface NotificationBellProps {
    /** 'light' for sidebar (dark text), 'dark' for mobile header (white text on dark bg) */
    variant?: 'light' | 'dark';
}

export function NotificationBell({ variant = 'light' }: NotificationBellProps) {
    const isDark = variant === 'dark';
    const { isAuthenticated } = useAuthStore();
    const t = useTranslations('notifications');
    // «تراجع» moved to `common`: it is a generic UI word shared with the
    // post-suggestion card's toast, not copy belonging to either feature.
    const tc = useTranslations('common');
    const locale = useLocale();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const storeUnreadCount = useUIStore((s) => s.notificationUnreadCount);
    const setNotificationUnreadCount = useUIStore((s) => s.setNotificationUnreadCount);
    const [unreadCount, setUnreadCount] = useState(storeUnreadCount);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const dropdownRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);

    useBodyScrollLock(isOpen);
    useNotificationPoller();

    // Sync local display count from shared store (only one instance polls — see useNotificationPoller)
    useEffect(() => {
        setUnreadCount(storeUnreadCount);
    }, [storeUnreadCount]);

    // Fetch notifications when dropdown opens
    useEffect(() => {
        if (!isOpen || !isAuthenticated) return;

        const fetchNotifications = async () => {
            setLoading(true);
            const result = await getNotifications();
            setNotifications(result.notifications);
            setUnreadCount(result.unreadCount);
            setNotificationUnreadCount(result.unreadCount);
            setLoading(false);
        };

        fetchNotifications();
    }, [isOpen, isAuthenticated, setNotificationUnreadCount]);

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
        // "All" pins unread account-health alerts (billing/system) to the top so
        // they can't be missed; the per-tab views filter by channel bucket.
        if (activeFilter === 'all') {
            return groupNotifications(pinAccountHealthFirst(notifications));
        }
        const filtered = notifications.filter(n => getNotificationBucket(n) === activeFilter);
        return groupNotifications(filtered);
    }, [notifications, activeFilter]);

    // ── Handlers ──

    const getRelativeTime = (dateString: string) =>
        formatRelativeTime(dateString, t);

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

        toast(t('dismissed'), {
            duration: 4000,
            action: {
                label: tc('undo'),
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
            setUnreadCount(prev => {
                const next = Math.max(0, prev - unreadInGroup);
                setNotificationUnreadCount(next);
                return next;
            });
        }

        for (const n of group.notifications) {
            if (!n.read) markNotificationAsRead(n.id);
        }

        toast(t('dismissed'), { duration: 4000 });
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
                    {isUnread && <UnreadAccentBar />}

                    <div className="flex items-start gap-3.5">
                        <NotificationAvatar style={style} muted={!isUnread} />

                        <div className="flex-1 min-w-0">
                            <NotificationTitle
                                unread={isUnread}
                                truncate
                                trailing={isUnread
                                    ? <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                                    : undefined}
                            >
                                {notification.title}
                            </NotificationTitle>

                            {/* Body — dir="auto" so embedded customer names / phone numbers
                                don't break bidi ordering (e.g. a lead body that leads with a
                                Latin name or a phone number inside RTL Arabic copy). */}
                            <p
                                dir="auto"
                                className={clsx(
                                    'text-xs leading-relaxed mt-0.5 line-clamp-2',
                                    isUnread ? 'text-muted-foreground' : 'text-muted-foreground/70',
                                )}
                            >
                                {notification.body}
                            </p>

                            <NotificationTimestamp
                                time={notification.createdAt}
                                getRelativeTime={getRelativeTime}
                                className="mt-1.5"
                            />

                            {/* Reply Now CTA */}
                            {isActionable && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleReplyNow(notification);
                                    }}
                                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                                    aria-label={t('replyNow')}
                                >
                                    <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                    {t('replyNow')}
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
                                    className="p-1.5 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/30 text-icon-muted hover:text-brand-600 transition-colors"
                                    title={t('markAsRead')}
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
        const typeLabelKey = `typeLabel.${group.type}` as Parameters<typeof t>[0];

        return (
            <div key={group.id} className="border-b border-theme-border">
                <SwipeableNotificationItem
                    onDismiss={() => handleDismissGroup(group)}
                    enabled={group.unreadCount > 0}
                >
                    <NotificationGroupHeader
                        style={style}
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
                aria-label={t('title')}
            >
                <Bell className={clsx('w-5 h-5', unreadCount > 0 && 'animate-pulse-soft')} />
                {unreadCount > 0 && (
                    <span className={clsx(
                        'absolute -top-1 -end-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-bold text-white bg-red-500 rounded-full shadow-sm shadow-red-200 ring-2',
                        isDark ? 'ring-black/30' : 'ring-white',
                    )}>
                        {formatBadgeCount(unreadCount)}
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
                        'max-h-[60vh] lg:max-h-[70vh] sm:end-auto sm:start-[272px] sm:w-[420px]',
                    )}
                    style={{ top: 'calc(var(--sai-top) + 4.5rem)' }}
                    dir={isRTLLocale(locale) ? 'rtl' : 'ltr'}
                >
                    {/* Header Row 1: Title + Close */}
                    <div className="flex items-center justify-between px-5 pt-3.5 pb-2 bg-gradient-to-b from-muted to-card">
                        <div className="flex items-center gap-2.5">
                            <h3 className="font-bold text-foreground">
                                {t('title')}
                            </h3>
                            {unreadCount > 0 && (
                                <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-[11px] font-bold text-brand-700 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/50 rounded-full">
                                    {formatBadgeCount(unreadCount)}
                                </span>
                            )}
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1.5 rounded-lg hover:bg-muted text-icon-muted hover:text-muted-foreground transition-colors"
                            aria-label={t('close')}
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
                                {t('markAllRead')}
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
                                <p className="text-sm text-muted-foreground">{t('loading')}</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <NotificationEmptyState variant="global" />
                        ) : filteredAndGrouped.length === 0 ? (
                            <NotificationEmptyState
                                variant="filtered"
                                filterName={t(`filter.${activeFilter}` as Parameters<typeof t>[0])}
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

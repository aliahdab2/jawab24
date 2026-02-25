import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { Bell, X, Check, CheckCheck, ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead, getUnreadCount } from '@/lib/notifications';
import { SwipeableNotificationItem } from './SwipeableNotificationItem';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    data: unknown;
    read: boolean;
    createdAt: string;
}

/** Get the route a notification should navigate to when clicked */
function getNotificationRoute(notification: Notification): string | null {
    const data = notification.data as Record<string, string> | undefined;
    if (data?.deepLink) return data.deepLink;

    switch (notification.type) {
        case 'stale_comment':
        case 'new_comment':
        case 'flagged_reply':
            return '/comments';
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

/** Returns [emoji, bgColor, ringColor] for each notification type */
function getNotificationStyle(type: string): [string, string, string] {
    switch (type) {
        case 'stale_comment':
            return ['\u{1F514}', 'bg-amber-50', 'ring-amber-200/60'];
        case 'new_comment':
            return ['\u{1F4AC}', 'bg-blue-50', 'ring-blue-200/60'];
        case 'flagged_reply':
            return ['\u26A0\uFE0F', 'bg-red-50', 'ring-red-200/60'];
        case 'payment_failed':
            return ['\u{1F4B3}', 'bg-red-50', 'ring-red-200/60'];
        case 'subscription_expiring':
        case 'trial_ending':
            return ['\u23F0', 'bg-orange-50', 'ring-orange-200/60'];
        case 'subscription_renewed':
            return ['\u2705', 'bg-emerald-50', 'ring-emerald-200/60'];
        case 'page_disconnected':
            return ['\u{1F50C}', 'bg-slate-100', 'ring-slate-200/60'];
        case 'kb_gap':
            return ['\u{1F4DA}', 'bg-amber-50', 'ring-amber-200/60'];
        default:
            return ['\u{1F514}', 'bg-brand-50', 'ring-brand-200/60'];
    }
}

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
    const dropdownRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);

    // Lock background scroll when dropdown is open
    useBodyScrollLock(isOpen);

    // Fetch unread count on mount and periodically
    useEffect(() => {
        if (!isAuthenticated) return;

        const fetchUnreadCount = async () => {
            const count = await getUnreadCount();
            setUnreadCount(count);
        };

        fetchUnreadCount();

        // Poll every 60 seconds
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

    // Close dropdown when clicking outside (dropdown is portaled, so check both refs)
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

    const handleMarkAsRead = async (notificationId: string) => {
        await markNotificationAsRead(notificationId);
        setNotifications(prev =>
            prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
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

    return (
        <div className="relative">
            {/* Bell Button */}
            <button
                ref={bellRef}
                onClick={() => setIsOpen(!isOpen)}
                className={`relative p-2 rounded-xl transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center ${
                    isDark
                        ? isOpen
                            ? 'bg-white/20 text-white'
                            : 'hover:bg-white/10 text-white/90'
                        : isOpen
                            ? 'bg-brand-100 text-brand-700'
                            : 'hover:bg-surface-100 text-surface-600'
                }`}
                aria-label={t('notifications.title')}
            >
                <Bell className={`w-5 h-5 ${unreadCount > 0 ? 'animate-pulse-soft' : ''}`} />
                {unreadCount > 0 && (
                    <span className={`absolute -top-1 -end-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center text-[11px] font-bold text-white bg-red-500 rounded-full shadow-sm shadow-red-200 ring-2 ${isDark ? 'ring-black/30' : 'ring-white'}`}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Backdrop + Dropdown — portaled to body to escape sidebar stacking context */}
            {isOpen && typeof document !== 'undefined' && createPortal(
                <>
                <div
                    className="fixed inset-0 bg-black/30 z-[99] animate-fade-in"
                    onClick={() => setIsOpen(false)}
                />
                <div
                    ref={dropdownRef}
                    className={`fixed start-4 end-4 bg-white rounded-2xl shadow-2xl shadow-surface-900/10 border border-surface-100 overflow-hidden z-[100] animate-fade-in ${
                        isDark
                            ? 'max-h-[60vh]'
                            : 'top-20 sm:end-auto sm:start-[272px] sm:w-[420px] max-h-[70vh]'
                    }`}
                    style={isDark ? { top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)' } : undefined}
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100 bg-gradient-to-b from-surface-50 to-white">
                        <div className="flex items-center gap-2.5">
                            <h3 className="font-bold text-surface-900">
                                {t('notifications.title')}
                            </h3>
                            {unreadCount > 0 && (
                                <span className="min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-[11px] font-bold text-brand-700 bg-brand-100 rounded-full">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                                >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    {t('notifications.markAllRead')}
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-600 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-[400px] overflow-y-auto">
                        {loading ? (
                            <div className="p-10 text-center">
                                <div className="w-8 h-8 border-[3px] border-brand-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-3" />
                                <p className="text-sm text-surface-400">{t('notifications.loading')}</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="p-10 text-center">
                                <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
                                    <Bell className="w-7 h-7 text-surface-300" />
                                </div>
                                <p className="text-sm font-medium text-surface-400">
                                    {t('notifications.empty')}
                                </p>
                            </div>
                        ) : (
                            notifications.map((notification) => {
                                const [icon, iconBg, iconRing] = getNotificationStyle(notification.type);
                                const isUnread = !notification.read;

                                return (
                                    <SwipeableNotificationItem
                                        key={notification.id}
                                        onDismiss={() => handleDismissNotification(notification.id, isUnread)}
                                        enabled={isUnread}
                                    >
                                        <div
                                            className={`group relative px-5 py-3.5 transition-colors duration-200 cursor-pointer ${
                                                isUnread
                                                    ? 'bg-brand-50/40 hover:bg-brand-50/70'
                                                    : 'hover:bg-surface-50'
                                            }`}
                                            onClick={() => handleNotificationClick(notification)}
                                        >
                                        {/* Unread accent bar */}
                                        {isUnread && (
                                            <div className="absolute inset-y-0 start-0 w-[3px] bg-brand-500 rounded-e-full" />
                                        )}

                                        <div className="flex items-start gap-3.5">
                                            {/* Icon in colored circle */}
                                            <div className={`w-10 h-10 rounded-xl ${iconBg} ring-1 ${iconRing} flex items-center justify-center flex-shrink-0 text-lg ${
                                                isUnread ? '' : 'opacity-50'
                                            }`}>
                                                {icon}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                {/* Title row */}
                                                <div className="flex items-center gap-2">
                                                    <p className={`text-[13px] leading-snug truncate ${
                                                        isUnread
                                                            ? 'font-semibold text-surface-900'
                                                            : 'font-normal text-surface-500'
                                                    }`}>
                                                        {notification.title}
                                                    </p>
                                                    {isUnread && (
                                                        <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                                                    )}
                                                </div>

                                                {/* Body */}
                                                <p className={`text-xs leading-relaxed mt-0.5 line-clamp-2 ${
                                                    isUnread ? 'text-surface-600' : 'text-surface-400'
                                                }`}>
                                                    {notification.body}
                                                </p>

                                                {/* Timestamp */}
                                                <div className="flex items-center gap-1 mt-1.5">
                                                    <Clock className="w-3 h-3 text-surface-300" />
                                                    <p className="text-[11px] text-surface-400">
                                                        {getRelativeTime(notification.createdAt)}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Action area */}
                                            <div className="flex items-center self-center flex-shrink-0">
                                                {getNotificationRoute(notification) ? (
                                                    <>
                                                        <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-surface-500 transition-colors ltr:block rtl:hidden" />
                                                        <ChevronLeft className="w-4 h-4 text-surface-300 group-hover:text-surface-500 transition-colors rtl:block ltr:hidden" />
                                                    </>
                                                ) : isUnread ? (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleMarkAsRead(notification.id);
                                                        }}
                                                        className="p-1.5 rounded-lg hover:bg-brand-100 text-surface-400 hover:text-brand-600 transition-colors"
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
                            })
                        )}
                    </div>
                </div>
                </>,
                document.body
            )}
        </div>
    );
}

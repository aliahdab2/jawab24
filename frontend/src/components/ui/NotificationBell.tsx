import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { useTranslation } from '@/i18n';
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead, getUnreadCount } from '@/lib/notifications';

interface Notification {
    id: string;
    type: string;
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
    data: unknown;
    read: boolean;
    createdAt: string;
}

export function NotificationBell() {
    const { token } = useAuthStore();
    const { t, language } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch unread count on mount and periodically
    useEffect(() => {
        if (!token) return;

        const fetchUnreadCount = async () => {
            const count = await getUnreadCount(token);
            setUnreadCount(count);
        };

        fetchUnreadCount();
        
        // Poll every 60 seconds
        const interval = setInterval(fetchUnreadCount, 60000);
        return () => clearInterval(interval);
    }, [token]);

    // Fetch notifications when dropdown opens
    useEffect(() => {
        if (!isOpen || !token) return;

        const fetchNotifications = async () => {
            setLoading(true);
            const result = await getNotifications(token);
            setNotifications(result.notifications);
            setUnreadCount(result.unreadCount);
            setLoading(false);
        };

        fetchNotifications();
    }, [isOpen, token]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleMarkAsRead = async (notificationId: string) => {
        if (!token) return;
        await markNotificationAsRead(token, notificationId);
        setNotifications(prev => 
            prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const handleMarkAllAsRead = async () => {
        if (!token) return;
        await markAllNotificationsAsRead(token);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
    };

    const getNotificationTitle = (notification: Notification) => {
        return language === 'ar' ? notification.titleAr : notification.titleEn;
    };

    const getNotificationBody = (notification: Notification) => {
        return language === 'ar' ? notification.bodyAr : notification.bodyEn;
    };

    const getRelativeTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return language === 'ar' ? 'الآن' : 'Just now';
        if (diffMins < 60) return language === 'ar' ? `منذ ${diffMins} دقيقة` : `${diffMins}m ago`;
        if (diffHours < 24) return language === 'ar' ? `منذ ${diffHours} ساعة` : `${diffHours}h ago`;
        return language === 'ar' ? `منذ ${diffDays} يوم` : `${diffDays}d ago`;
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'payment_failed':
                return '💳';
            case 'subscription_expiring':
            case 'trial_ending':
                return '⏰';
            case 'page_disconnected':
                return '🔌';
            default:
                return '🔔';
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-xl hover:bg-surface-100 transition-colors"
                aria-label={t('notifications.title')}
            >
                <Bell className="w-5 h-5 text-surface-600" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown - opens into main content area (start = right in LTR, left in RTL) */}
            {isOpen && (
                <div 
                    className="absolute start-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-surface-100 overflow-hidden z-50 max-h-[80vh]"
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 bg-surface-50">
                        <h3 className="font-semibold text-surface-900">
                            {language === 'ar' ? 'الإشعارات' : 'Notifications'}
                        </h3>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
                                >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    {language === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 rounded-lg hover:bg-surface-200 text-surface-500"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-[400px] overflow-y-auto">
                        {loading ? (
                            <div className="p-8 text-center text-surface-500">
                                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="p-8 text-center text-surface-500">
                                <Bell className="w-10 h-10 mx-auto mb-3 text-surface-300" />
                                <p className="text-sm">
                                    {language === 'ar' ? 'لا توجد إشعارات' : 'No notifications'}
                                </p>
                            </div>
                        ) : (
                            notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={`px-4 py-3 border-b border-surface-50 hover:bg-surface-50 transition-colors cursor-pointer ${
                                        !notification.read ? 'bg-brand-50/30' : ''
                                    }`}
                                    onClick={() => !notification.read && handleMarkAsRead(notification.id)}
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="text-xl flex-shrink-0">
                                            {getNotificationIcon(notification.type)}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium text-sm text-surface-900 truncate">
                                                    {getNotificationTitle(notification)}
                                                </p>
                                                {!notification.read && (
                                                    <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                                                )}
                                            </div>
                                            <p className="text-xs text-surface-600 mt-0.5 line-clamp-2">
                                                {getNotificationBody(notification)}
                                            </p>
                                            <p className="text-[10px] text-surface-400 mt-1">
                                                {getRelativeTime(notification.createdAt)}
                                            </p>
                                        </div>
                                        {!notification.read && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMarkAsRead(notification.id);
                                                }}
                                                className="p-1 rounded hover:bg-surface-200 text-surface-400"
                                                title={language === 'ar' ? 'تحديد كمقروء' : 'Mark as read'}
                                            >
                                                <Check className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

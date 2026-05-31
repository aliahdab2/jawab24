import {
    Bell, MessageCircle, AlertTriangle, CreditCard, CheckCircle, Unplug, BookOpen, Mail, Clock, UserPlus,
    type LucideIcon,
} from 'lucide-react';
import { FILTER_TYPE_MAP, ACTIONABLE_NOTIFICATION_TYPES, type NotificationFilter } from '../notifications/NotificationFilterPills';
import { isIOSNative } from '@/lib/capacitor';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    data: unknown;
    read: boolean;
    createdAt: string;
}

export interface GroupedNotifications {
    id: string;
    type: string;
    notifications: Notification[];
    latestTimestamp: string;
    unreadCount: number;
}

export interface NotificationStyle {
    icon: LucideIcon;
    iconColor: string;
    bgColor: string;
    ringColor: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const NOTIFICATION_STYLES: Record<string, NotificationStyle> = {
    stale_comment:         { icon: MessageCircle, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    stale_message:         { icon: Mail,          iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    new_comment:           { icon: MessageCircle, iconColor: 'text-blue-600 dark:text-blue-400',       bgColor: 'bg-blue-50 dark:bg-blue-900/30',       ringColor: 'notif-ring-blue' },
    flagged_reply:         { icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    skipped_reply:         { icon: AlertTriangle, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    payment_failed:        { icon: CreditCard,    iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    subscription_expiring: { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    trial_ending:          { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    subscription_renewed:  { icon: CheckCircle,   iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-900/30', ringColor: 'notif-ring-emerald' },
    page_disconnected:     { icon: Unplug,        iconColor: 'text-slate-600 dark:text-slate-400',     bgColor: 'bg-slate-100 dark:bg-slate-900/30',    ringColor: 'notif-ring-slate' },
    kb_gap:                { icon: BookOpen,       iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    provider_failover:     { icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    new_lead:              { icon: UserPlus,      iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-900/30', ringColor: 'notif-ring-emerald' },
};

export const DEFAULT_STYLE: NotificationStyle = {
    icon: Bell, iconColor: 'text-brand-600', bgColor: 'bg-brand-50', ringColor: 'ring-brand-200/60',
};

export const ACTIONABLE_TYPES = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);
export const GROUP_TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getNotificationStyle(type: string): NotificationStyle {
    return NOTIFICATION_STYLES[type] ?? DEFAULT_STYLE;
}

/**
 * Shared routing rules for a notification, used by both the in-app bell and
 * the Android push-tap handler. Keep all type-to-route logic here so the two
 * surfaces don't drift.
 *
 * Returns null when the notification doesn't map to a known route.
 */
export function resolveNotificationRoute(
    type: string,
    data: Record<string, string> | undefined,
): string | null {
    const isMessage = data?.type === 'message';

    if (ACTIONABLE_TYPES.has(type)) {
        if (isMessage && data?.messageId) {
            return `/messages?messageId=${encodeURIComponent(data.messageId)}`;
        }
        if (!isMessage && data?.commentId) {
            return `/comments?commentId=${encodeURIComponent(data.commentId)}`;
        }
        if (type === 'flagged_reply' || type === 'skipped_reply') {
            return isMessage ? '/messages?filter=flagged' : '/comments?filter=flagged';
        }
        return (isMessage || type === 'stale_message')
            ? '/messages?filter=needs_action'
            : '/comments?filter=needs_action';
    }

    if (data?.deepLink) return data.deepLink;

    switch (type) {
        case 'payment_failed':
        case 'subscription_expiring':
        case 'subscription_renewed':
        case 'trial_ending':
            // App Store Guideline 3.1.1: iOS reader-app — no taps lead to /pricing.
            return isIOSNative() ? '/dashboard' : '/pricing';
        case 'page_disconnected':
        case 'kb_gap':
            return '/pages';
        default:
            return null;
    }
}

export function getNotificationRoute(notification: Notification): string | null {
    return resolveNotificationRoute(
        notification.type,
        notification.data as Record<string, string> | undefined,
    );
}

export function groupNotifications(
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

export function isGroup(item: Notification | GroupedNotifications): item is GroupedNotifications {
    return 'notifications' in item;
}

export function computeFilterCounts(notifications: Notification[]): Record<NotificationFilter, number> {
    const counts: Record<NotificationFilter, number> = { all: notifications.length, comments: 0, leads: 0, billing: 0, system: 0 };
    for (const n of notifications) {
        if (FILTER_TYPE_MAP.comments?.includes(n.type)) counts.comments++;
        else if (FILTER_TYPE_MAP.leads?.includes(n.type)) counts.leads++;
        else if (FILTER_TYPE_MAP.billing?.includes(n.type)) counts.billing++;
        else if (FILTER_TYPE_MAP.system?.includes(n.type)) counts.system++;
    }
    return counts;
}

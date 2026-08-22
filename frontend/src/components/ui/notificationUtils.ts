import {
    Bell, MessageCircle, AlertTriangle, CreditCard, CheckCircle, Unplug, BookOpen, Mail, Clock, UserPlus,
    CalendarClock, Instagram,
    type LucideIcon,
} from 'lucide-react';
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

// ─── Filter taxonomy ───────────────────────────────────────────────────────────
// Lives in the domain layer (not the pill component) so utilities like
// computeFilterCounts and pinAccountHealthFirst can map types to buckets without
// the UI depending on it the wrong way around.
//
// The tabs mirror the app's own "Inbox" sidebar group (Comments / Messages /
// Leads) so the panel matches where a merchant already works. Comments and
// Messages are deliberately split — a stale DM is not a "comment". Account-health
// events (billing + system) get NO tab: they are rare but critical, so
// pinAccountHealthFirst floats the unread ones to the top of "All" rather than
// hiding them behind a tab a merchant only taps out of curiosity.

export type NotificationFilter = 'all' | 'comments' | 'messages' | 'leads';

/** Notification types that represent actionable comment/message items (used for routing, CTAs, and filtering). */
export const ACTIONABLE_NOTIFICATION_TYPES = ['stale_comment', 'stale_message', 'new_comment', 'flagged_reply', 'skipped_reply'] as const;

/** Inherently comment-channel types. */
const COMMENT_ONLY_TYPES = new Set<string>(['new_comment', 'stale_comment']);
/** Inherently DM-channel types. */
const MESSAGE_ONLY_TYPES = new Set<string>(['stale_message']);
/** Reply-handling alerts fire on EITHER channel; the source is carried in data.type ('comment' | 'message'), stamped by the comment/message processors. */
const CHANNEL_AWARE_TYPES = new Set<string>(['flagged_reply', 'skipped_reply']);

/**
 * Account-health notification types — rare but critical (payment failures,
 * disconnected pages, AI quota, provider failover). They belong to no tab;
 * pinAccountHealthFirst surfaces the unread ones at the top of "All".
 */
export const ACCOUNT_HEALTH_TYPES = new Set<string>([
    'payment_failed', 'subscription_expiring', 'trial_ending', 'trial_ended', 'subscription_renewed',
    'refund_processed', 'ai_usage_warning_80', 'ai_usage_limit_reached', 'ai_usage_on_topup',
    'ai_usage_topup_low',
    'auto_reply_paused_billing', 'auto_reply_paused', 'page_disconnected', 'page_trial_used', 'kb_gap', 'provider_failover',
    'instagram_reconnect_needed',
]);

/**
 * Map a notification to its filter bucket, or null when it belongs to no tab
 * (account-health types, which appear only under "All"). flagged/skipped replies
 * route by the source channel the backend stamps into data.type.
 */
export function getNotificationBucket(n: Notification): Exclude<NotificationFilter, 'all'> | null {
    if (n.type === 'new_lead') return 'leads';
    if (COMMENT_ONLY_TYPES.has(n.type)) return 'comments';
    if (MESSAGE_ONLY_TYPES.has(n.type)) return 'messages';
    if (CHANNEL_AWARE_TYPES.has(n.type)) {
        return (n.data as { type?: string } | null)?.type === 'message' ? 'messages' : 'comments';
    }
    return null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const NOTIFICATION_STYLES: Record<string, NotificationStyle> = {
    stale_comment:         { icon: MessageCircle, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    // Amber, matching stale_comment above: both mean "waiting on the merchant".
    // It was orange, which is the billing/quota hue — so the SAME state rendered
    // in two colors depending on whether it arrived as a comment or a message.
    stale_message:         { icon: Mail,          iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    new_comment:           { icon: MessageCircle, iconColor: 'text-blue-600 dark:text-blue-400',       bgColor: 'bg-blue-50 dark:bg-blue-900/30',       ringColor: 'notif-ring-blue' },
    flagged_reply:         { icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    skipped_reply:         { icon: AlertTriangle, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    payment_failed:        { icon: CreditCard,    iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    // Dead Instagram-direct credential: red like the other dead-channel notices —
    // replies are stopped until the merchant acts.
    instagram_reconnect_needed: { icon: Instagram, iconColor: 'text-red-600 dark:text-red-400',        bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    // Same red billing family as payment_failed: it is the same incident one
    // step later (the gate actually froze replies). Without this entry the
    // card fell through to DEFAULT_STYLE's neutral bell.
    auto_reply_paused_billing: { icon: CreditCard, iconColor: 'text-red-600 dark:text-red-400',        bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    subscription_expiring: { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    trial_ending:          { icon: Clock,         iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    trial_ended:           { icon: Clock,         iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    subscription_renewed:  { icon: CheckCircle,   iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-900/30', ringColor: 'notif-ring-emerald' },
    page_disconnected:     { icon: Unplug,        iconColor: 'text-slate-600 dark:text-slate-400',     bgColor: 'bg-slate-100 dark:bg-slate-900/30',    ringColor: 'notif-ring-slate' },
    // Red, not slate: unlike a disconnected page, a send-failure pause means the
    // page is live and actively dropping customer messages until a human acts.
    auto_reply_paused:     { icon: Unplug,        iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    page_trial_used:       { icon: CreditCard,    iconColor: 'text-orange-600 dark:text-orange-400',   bgColor: 'bg-orange-50 dark:bg-orange-900/30',   ringColor: 'notif-ring-orange' },
    kb_gap:                { icon: BookOpen,       iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
    provider_failover:     { icon: AlertTriangle, iconColor: 'text-red-600 dark:text-red-400',         bgColor: 'bg-red-50 dark:bg-red-900/30',         ringColor: 'notif-ring-red' },
    new_lead:              { icon: UserPlus,      iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-900/30', ringColor: 'notif-ring-emerald' },
    post_reply_orphaned:   { icon: CalendarClock, iconColor: 'text-amber-600 dark:text-amber-400',     bgColor: 'bg-amber-50 dark:bg-amber-900/30',     ringColor: 'notif-ring-amber' },
};

export const DEFAULT_STYLE: NotificationStyle = {
    icon: Bell, iconColor: 'text-brand-600', bgColor: 'bg-brand-50', ringColor: 'ring-brand-200/60',
};

export const ACTIONABLE_TYPES = new Set<string>(ACTIONABLE_NOTIFICATION_TYPES);

/**
 * Types that must NEVER collapse into a group. For these, the per-item body is
 * the whole point: a lead carries the customer's name + phone, so "3 new leads"
 * would hide exactly the information the merchant needs to act. Each renders as
 * its own card even when several arrive consecutively.
 */
export const NON_GROUPABLE_TYPES = new Set<string>(['new_lead']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getNotificationStyle(type: string): NotificationStyle {
    return NOTIFICATION_STYLES[type] ?? DEFAULT_STYLE;
}

/** Clamp a count for display in a badge ("99+" above 99). */
export function formatBadgeCount(count: number): string {
    return count > 99 ? '99+' : String(count);
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

    // Build the leads route from the structured leadId rather than the stored
    // deepLink string, so notifications created before per-lead deep-linking
    // shipped (their deepLink is the bare '/leads') still open the exact lead.
    // Both old and new new_lead payloads carry leadId.
    if (type === 'new_lead' && data?.leadId) {
        return `/leads?leadId=${encodeURIComponent(data.leadId)}`;
    }

    if (data?.deepLink) return data.deepLink;

    switch (type) {
        case 'payment_failed':
        case 'subscription_expiring':
        case 'subscription_renewed':
        case 'trial_ending':
        case 'trial_ended':
        case 'page_trial_used':
            // App Store Guideline 3.1.1: iOS reader-app — no taps lead to /pricing.
            return isIOSNative() ? '/dashboard' : '/pricing';
        case 'page_disconnected':
        // Instagram-direct credential died (Meta 190) — the reconnect action lives
        // on /pages, same as every other dead-channel notice.
        case 'instagram_reconnect_needed':
        // The whole point of the auto-pause alert is "go reconnect this page and
        // switch replies back on" — both live on /pages. A null route here would
        // render the card unclickable (no chevron), stranding the merchant on the
        // one notification that demands an action.
        case 'auto_reply_paused':
        case 'kb_gap':
            return '/pages';
        // The scheduled post published under a different id, so the trigger is orphaned.
        // Land the merchant where Post Replies are configured — re-arming is the fix.
        case 'post_reply_orphaned':
            return '/comments';
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

        // Group consecutive notifications of the same type. We intentionally do
        // NOT split on a time gap: two same-type bursts a few hours apart would
        // otherwise render as two identical, indistinguishable group headers
        // (e.g. two "2 reported replies" rows), which reads as a duplicate bug.
        // NON_GROUPABLE_TYPES (e.g. leads) always stay as individual cards.
        if (curr.type === prev.type && !NON_GROUPABLE_TYPES.has(curr.type)) {
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
    const counts: Record<NotificationFilter, number> = { all: notifications.length, comments: 0, messages: 0, leads: 0 };
    for (const n of notifications) {
        const bucket = getNotificationBucket(n);
        if (bucket) counts[bucket]++;
    }
    return counts;
}

/**
 * Stable-partition unread account-health notifications to the front, for the
 * "All" view only. A payment failure or disconnected page must not sink below a
 * pile of routine comment alerts. Read items keep their chronological spot —
 * once seen, they stop dominating. Order within each partition is preserved
 * (callers pass newest-first), so the result still reads chronologically below
 * the pinned block. Returns the input untouched when nothing is pinned.
 */
export function pinAccountHealthFirst(notifications: Notification[]): Notification[] {
    const pinned: Notification[] = [];
    const rest: Notification[] = [];
    for (const n of notifications) {
        (ACCOUNT_HEALTH_TYPES.has(n.type) && !n.read ? pinned : rest).push(n);
    }
    return pinned.length === 0 ? notifications : [...pinned, ...rest];
}

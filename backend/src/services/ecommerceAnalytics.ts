/**
 * E-Commerce Analytics Aggregator
 *
 * Reads existing tables only (`customerNotificationsLog`, `messages`) — no new
 * persistence, no new tracking. Surfaces business metrics merchants care about
 * (revenue recovered, notifications sent, AI replies) for a single store.
 *
 * Attribution caveat: "revenue recovered" is approximate — it joins
 * `abandoned_cart` notifications to subsequent `order_confirmed` notifications
 * by phone within a 72h window. False credits possible when a customer would
 * have ordered anyway. v2 will tighten this with link-tracking.
 */
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { customerNotificationsLog, messages, pages } from '../db/schema';

export type AnalyticsRange = '30d' | '90d';

/** Notification delivery counters — channel-agnostic. Same shape applies to
 *  SMS (today), WhatsApp Cloud API (planned), and DM follow-ups (Step 3). */
export interface NotificationFunnel {
    sent: number;
    delivered: number;
    failed: number;
    pending: number;
}

/** Per-channel + total funnel, so the UI can render a unified view today
 *  (one channel) and a per-channel breakdown later (WhatsApp + SMS + DM). */
export interface ChannelFunnel {
    total: NotificationFunnel;
    byChannel: Record<string, NotificationFunnel>;
}

export interface NotificationTypeBreakdown {
    abandoned_cart: number;
    order_confirmed: number;
    order_shipped: number;
    order_delivered: number;
    review_request: number;
    digital_delivery: number;
    [key: string]: number;
}

export interface RecoveryStats {
    /** Abandoned-cart notifications that were successfully delivered. */
    abandonedCartsNotified: number;
    /** Distinct customers (by phone) who received an order_confirmed within 72h
     *  of an abandoned_cart notification — approximate attribution. */
    cartsRecovered: number;
    /** Sum of `cartTotal` for the matched abandoned_cart rows. Currency mixed if
     *  the store has multi-currency orders; UI displays as a single sum string. */
    revenueRecovered: number;
    /** Currency from the most recent abandoned_cart row (best-effort label). */
    currency: string | null;
}

export interface ReplyStats {
    /** Outgoing AI/Post Reply/manual replies linked to this store's pageIds within range. */
    totalReplies: number;
    aiReplies: number;
    postReplies: number;
    manualReplies: number;
}

export interface EcommerceAnalyticsOverview {
    storeId: string;
    period: { from: string; to: string; range: AnalyticsRange };
    notifications: {
        funnel: ChannelFunnel;
        byType: NotificationTypeBreakdown;
    };
    recovery: RecoveryStats;
    replies: ReplyStats;
}

const RANGE_DAYS: Record<AnalyticsRange, number> = { '30d': 30, '90d': 90 };
const RECOVERY_WINDOW_HOURS = 72;

export async function getStoreAnalytics(
    storeId: string,
    range: AnalyticsRange,
): Promise<EcommerceAnalyticsOverview> {
    const days = RANGE_DAYS[range];
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const [funnel, byType, recovery, replies] = await Promise.all([
        queryNotificationFunnel(storeId, since),
        queryNotificationsByType(storeId, since),
        queryRecoveryStats(storeId, since),
        queryReplyStats(storeId, since),
    ]);

    return {
        storeId,
        period: { from: since.toISOString(), to: now.toISOString(), range },
        notifications: { funnel, byType },
        recovery,
        replies,
    };
}

/** Empty funnel template — re-cloned per channel and for the total roll-up. */
export function emptyFunnel(): NotificationFunnel {
    return { sent: 0, delivered: 0, failed: 0, pending: 0 };
}

/** Normalize a status value into the funnel's bucket. The pipeline historically
 *  used 'sent' for delivered SMS — collapse it into `delivered` so the UI shows
 *  one number, not two. Unknown statuses fall through to `pending`. */
export function bucketForStatus(status: string | null): keyof NotificationFunnel {
    if (status === 'delivered' || status === 'sent') return 'delivered';
    if (status === 'failed') return 'failed';
    if (status === 'pending') return 'pending';
    return 'pending';
}

async function queryNotificationFunnel(storeId: string, since: Date): Promise<ChannelFunnel> {
    const rows = await db
        .select({
            channel: customerNotificationsLog.channel,
            status: customerNotificationsLog.status,
            count: count(),
        })
        .from(customerNotificationsLog)
        .where(and(
            eq(customerNotificationsLog.ecommerceStoreId, storeId),
            gte(customerNotificationsLog.createdAt, since),
        ))
        .groupBy(customerNotificationsLog.channel, customerNotificationsLog.status);

    const total = emptyFunnel();
    const byChannel: Record<string, NotificationFunnel> = {};

    for (const row of rows) {
        const channel = row.channel ?? 'unknown';
        const bucket = bucketForStatus(row.status);
        if (!byChannel[channel]) byChannel[channel] = emptyFunnel();
        byChannel[channel][bucket] += row.count;
        total[bucket] += row.count;
    }

    return { total, byChannel };
}

async function queryNotificationsByType(storeId: string, since: Date): Promise<NotificationTypeBreakdown> {
    const rows = await db
        .select({ notificationType: customerNotificationsLog.notificationType, count: count() })
        .from(customerNotificationsLog)
        .where(and(
            eq(customerNotificationsLog.ecommerceStoreId, storeId),
            gte(customerNotificationsLog.createdAt, since),
        ))
        .groupBy(customerNotificationsLog.notificationType);

    const byType: NotificationTypeBreakdown = {
        abandoned_cart: 0,
        order_confirmed: 0,
        order_shipped: 0,
        order_delivered: 0,
        review_request: 0,
        digital_delivery: 0,
    };
    for (const row of rows) {
        if (row.notificationType) byType[row.notificationType] = row.count;
    }
    return byType;
}

/**
 * Approximate cart-recovery attribution.
 *
 * Single round-trip implementation: pull abandoned-cart rows in the window and
 * mark each as `recovered` via a SQL EXISTS subquery checking for an
 * `order_confirmed` row with the same phone within RECOVERY_WINDOW_HOURS.
 * Replaces an earlier N+1 loop that issued one query per abandoned cart.
 *
 * Limitations:
 *  - Customer may have ordered independently of the SMS — over-credits us
 *  - Phone-only match misses customers who used a different phone at checkout
 *  - cartTotal is stored as varchar (currency mixed) — sum is best-effort
 */
async function queryRecoveryStats(storeId: string, since: Date): Promise<RecoveryStats> {
    const recoveryWindow = sql.raw(`'${RECOVERY_WINDOW_HOURS} hours'`);

    const rows = await db
        .select({
            cartTotal: customerNotificationsLog.cartTotal,
            recovered: sql<boolean>`EXISTS (
                SELECT 1 FROM customer_notifications_log o
                WHERE o.ecommerce_store_id = ${customerNotificationsLog.ecommerceStoreId}
                  AND o.notification_type = 'order_confirmed'
                  AND o.customer_phone = ${customerNotificationsLog.customerPhone}
                  AND o.created_at >= COALESCE(${customerNotificationsLog.sentAt}, ${customerNotificationsLog.createdAt})
                  AND o.created_at <= COALESCE(${customerNotificationsLog.sentAt}, ${customerNotificationsLog.createdAt}) + interval ${recoveryWindow}
            )`,
        })
        .from(customerNotificationsLog)
        .where(and(
            eq(customerNotificationsLog.ecommerceStoreId, storeId),
            eq(customerNotificationsLog.notificationType, 'abandoned_cart'),
            gte(customerNotificationsLog.createdAt, since),
            // A cancelled row means the customer completed checkout BEFORE the nudge
            // was ever sent (abandoned_cart.completed / order_confirmed cancel) —
            // counting it as "notified", let alone crediting its revenue as
            // "recovered", would inflate both numbers with sends that never happened.
            sql`${customerNotificationsLog.status} IS DISTINCT FROM 'cancelled'`,
        ));

    const abandonedCartsNotified = rows.length;
    if (abandonedCartsNotified === 0) {
        return { abandonedCartsNotified: 0, cartsRecovered: 0, revenueRecovered: 0, currency: null };
    }

    let cartsRecovered = 0;
    let revenueRecovered = 0;
    let currency: string | null = null;

    for (const row of rows) {
        if (!row.recovered) continue;
        cartsRecovered += 1;
        revenueRecovered += parseAmount(row.cartTotal);
        if (!currency) currency = extractCurrency(row.cartTotal);
    }

    return {
        abandonedCartsNotified,
        cartsRecovered,
        revenueRecovered: Math.round(revenueRecovered * 100) / 100,
        currency,
    };
}

async function queryReplyStats(storeId: string, since: Date): Promise<ReplyStats> {
    // The store is linked to one or more pages (pages.ecommerceStoreId). Outgoing
    // replies are stored in `messages` keyed by pageId, not storeId — so we join.
    const rows = await db
        .select({
            replyMethod: messages.replyMethod,
            count: count(),
        })
        .from(messages)
        .innerJoin(pages, eq(pages.id, messages.pageId))
        .where(and(
            eq(pages.ecommerceStoreId, storeId),
            eq(messages.direction, 'outgoing'),
            gte(messages.createdAt, since),
        ))
        .groupBy(messages.replyMethod);

    const stats: ReplyStats = { totalReplies: 0, aiReplies: 0, postReplies: 0, manualReplies: 0 };
    for (const row of rows) {
        stats.totalReplies += row.count;
        if (row.replyMethod === 'ai') stats.aiReplies += row.count;
        // Bucket 'template' alongside 'post_reply' so historical pre-migration DMs
        // (which stored Post Reply trigger sends as 'template') keep counting here.
        // Post-migration the messages-table backfill flips reliable matches to
        // 'post_reply'; the residual 'template' rows are low-signal but still belong
        // closer to "auto-reply" than dropped on the floor.
        else if (row.replyMethod === 'post_reply' || row.replyMethod === 'template') stats.postReplies += row.count;
        else if (row.replyMethod === 'manual') stats.manualReplies += row.count;
    }
    return stats;
}

/** Extract a currency token from a free-form cartTotal string ("120 SAR", "120.50 USD"). */
export function extractCurrency(raw: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/[A-Za-z]{3}|ريال|درهم|\$|€|£/);
    return match ? match[0] : null;
}

/** Parse a free-form amount ("120 SAR", "120.50") into a number, or 0 on failure. */
export function parseAmount(raw: string | null): number {
    if (!raw) return 0;
    const match = raw.match(/-?\d+(\.\d+)?/);
    if (!match) return 0;
    const value = parseFloat(match[0]);
    return Number.isFinite(value) ? value : 0;
}


import { db } from '../db';
import { comments, messages, pages, posts, settings } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { notificationService, NotificationType } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

let logger: Logger = noopLogger;
export function setEscalationLogger(l: Logger): void { logger = l; }

const DEFAULT_COMMENT_ESCALATION_MINUTES = 60;
const DEFAULT_MESSAGE_ESCALATION_MINUTES = 30;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Max individual notifications per user per sweep to prevent flood. */
const MAX_INDIVIDUAL_NOTIFICATIONS = 10;
const PREVIEW_MAX_LENGTH = 80;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function truncatePreview(text: string | null): string {
    if (!text) return '';
    const trimmed = text.trim();
    if (trimmed.length <= PREVIEW_MAX_LENGTH) return trimmed;
    return `${trimmed.slice(0, PREVIEW_MAX_LENGTH)}...`;
}

/** Group rows by userId, filtering out null userIds. */
function groupByUser<T extends { userId: string | null }>(rows: T[]): Map<string, T[]> {
    const byUser = new Map<string, T[]>();
    for (const row of rows) {
        if (!row.userId) continue;
        const arr = byUser.get(row.userId) ?? [];
        arr.push(row);
        byUser.set(row.userId, arr);
    }
    return byUser;
}

interface NotificationItem {
    name: string;
    title: string;
    preview: string;
    data: Record<string, string | undefined>;
}

/**
 * Send per-item notifications with a flood cap.
 * Sends up to MAX_INDIVIDUAL_NOTIFICATIONS, then one overflow summary if needed.
 */
function sendItemNotifications(
    userId: string,
    type: NotificationType,
    items: NotificationItem[],
    overflow: { deepLink: string; labelEn: string; labelAr: string },
): void {
    const toNotify = items.slice(0, MAX_INDIVIDUAL_NOTIFICATIONS);

    for (const item of toNotify) {
        notificationService.sendNotification(userId, {
            type,
            titles: { en: item.title, ar: item.title },
            bodies: { en: item.preview, ar: item.preview },
            data: item.data,
        }).catch(err => captureError(err, `Escalation ${type} notification failed`, { tags: { service: 'escalation', type } }));
    }

    const overflowCount = items.length - toNotify.length;
    if (overflowCount > 0) {
        notificationService.sendNotification(userId, {
            type,
            titles: {
                en: `${overflowCount} more ${overflow.labelEn} need attention`,
                ar: `${overflowCount} ${overflow.labelAr} تحتاج انتباهك`,
            },
            bodies: {
                en: `Plus ${overflowCount} more ${overflow.labelEn} waiting for your reply.`,
                ar: `بالإضافة إلى ${overflowCount} ${overflow.labelAr} بانتظار ردك.`,
            },
            data: { deepLink: overflow.deepLink },
        }).catch(err => captureError(err, `Escalation ${type} overflow notification failed`, { tags: { service: 'escalation', type } }));
    }
}

function buildTitle(name: string | null, pageName: string | null): string {
    const displayName = name || 'Unknown';
    return pageName ? `${displayName} — ${pageName}` : displayName;
}

/**
 * Run a single escalation sweep.
 * Finds unreplied comments/messages past their SLA threshold,
 * flags them as needsAttention, and sends per-conversation notifications.
 */
export async function runEscalationSweep(): Promise<void> {
    try {
        await escalateComments();
        await escalateMessages();
    } catch (error) {
        captureError(error, 'Escalation sweep failed', { tags: { service: 'escalation' } });
    }
}

// ---------------------------------------------------------------------------
// Stale comments — one notification per comment
// ---------------------------------------------------------------------------

interface StaleCommentRow {
    userId: string | null;
    itemId: string;
    pageName: string | null;
    pageId: string | null;
    fromName: string | null;
    messageText: string | null;
    thresholdMinutes: number;
}

async function escalateComments(): Promise<void> {
    const staleRows: StaleCommentRow[] = await db
        .select({
            userId: pages.userId,
            itemId: comments.id,
            pageName: pages.name,
            pageId: posts.pageId,
            fromName: comments.fromName,
            messageText: comments.message,
            thresholdMinutes: sql<number>`COALESCE(${settings.commentEscalationMinutes}, ${DEFAULT_COMMENT_ESCALATION_MINUTES})`,
        })
        .from(comments)
        .innerJoin(posts, eq(comments.postId, posts.id))
        .innerJoin(pages, eq(posts.pageId, pages.id))
        .leftJoin(settings, eq(pages.userId, settings.userId))
        .where(and(
            eq(comments.replied, false),
            eq(comments.needsAttention, false),
            eq(pages.autoReplyEnabled, true),
            sql`${comments.createdTime} < NOW() - MAKE_INTERVAL(mins => COALESCE(${settings.commentEscalationMinutes}, ${DEFAULT_COMMENT_ESCALATION_MINUTES}))`,
        ));

    if (staleRows.length === 0) return;

    for (const [userId, rows] of groupByUser(staleRows)) {
        const ids = rows.map(r => r.itemId);
        const threshold = Number(rows[0].thresholdMinutes);

        await db.update(comments)
            .set({ needsAttention: true, flagReason: `sla_no_reply:${threshold}`, updatedAt: new Date() })
            .where(sql`${comments.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

        const items: NotificationItem[] = rows.map(row => ({
            name: row.fromName || 'Unknown',
            title: buildTitle(row.fromName, row.pageName),
            preview: truncatePreview(row.messageText),
            data: { commentId: row.itemId },
        }));

        sendItemNotifications(userId, 'stale_comment', items, {
            deepLink: '/comments?filter=needs_action',
            labelEn: 'comments',
            labelAr: 'تعليقات إضافية',
        });
    }
}

// ---------------------------------------------------------------------------
// Stale messages — one notification per conversation (senderId + pageId)
// ---------------------------------------------------------------------------

interface StaleMessageRow {
    userId: string | null;
    itemId: string;
    pageName: string | null;
    pageId: string | null;
    senderName: string | null;
    senderId: string | null;
    messageText: string | null;
    thresholdMinutes: number;
}

async function escalateMessages(): Promise<void> {
    const staleRows: StaleMessageRow[] = await db
        .select({
            userId: pages.userId,
            itemId: messages.id,
            pageName: pages.name,
            pageId: messages.pageId,
            senderName: messages.senderName,
            senderId: messages.senderId,
            messageText: messages.message,
            thresholdMinutes: sql<number>`COALESCE(${settings.messageEscalationMinutes}, ${DEFAULT_MESSAGE_ESCALATION_MINUTES})`,
        })
        .from(messages)
        .innerJoin(pages, eq(messages.pageId, pages.id))
        .leftJoin(settings, eq(pages.userId, settings.userId))
        .where(and(
            eq(messages.replied, false),
            eq(messages.needsAttention, false),
            eq(messages.direction, 'incoming'),
            eq(pages.autoReplyEnabled, true),
            sql`${messages.createdTime} < NOW() - MAKE_INTERVAL(mins => COALESCE(${settings.messageEscalationMinutes}, ${DEFAULT_MESSAGE_ESCALATION_MINUTES}))`,
        ));

    if (staleRows.length === 0) return;

    for (const [userId, rows] of groupByUser(staleRows)) {
        const ids = rows.map(r => r.itemId);
        const threshold = Number(rows[0].thresholdMinutes);

        await db.update(messages)
            .set({ needsAttention: true, flagReason: `sla_no_reply:${threshold}`, updatedAt: new Date() })
            .where(sql`${messages.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

        // Group by conversation — multiple messages from same sender on same page → one notification
        const conversations = new Map<string, StaleMessageRow>();
        for (const row of rows) {
            const key = `${row.senderId ?? 'unknown'}:${row.pageId ?? 'unknown'}`;
            conversations.set(key, row); // last one wins (latest message preview)
        }

        const items: NotificationItem[] = [...conversations.values()].map(conv => ({
            name: conv.senderName || 'Unknown',
            title: buildTitle(conv.senderName, conv.pageName),
            preview: truncatePreview(conv.messageText),
            data: {
                type: 'message',
                messageId: conv.itemId,
                ...(conv.senderId ? { senderId: conv.senderId } : {}),
                ...(conv.pageId ? { pageId: conv.pageId } : {}),
            },
        }));

        sendItemNotifications(userId, 'stale_message', items, {
            deepLink: '/messages?filter=needs_action',
            labelEn: 'conversations',
            labelAr: 'محادثات إضافية',
        });
    }
}

/**
 * Start the escalation cron (runs every 5 minutes).
 */
export function startEscalationCron(): void {
    if (intervalHandle) return;
    logger.info('Escalation cron started (every 5 min)');
    intervalHandle = setInterval(runEscalationSweep, SWEEP_INTERVAL_MS);
    runEscalationSweep().catch(err => {
        captureError(err, 'Escalation initial sweep failed');
        logger.error('Escalation initial sweep failed', { error: String(err) });
    });
}

/**
 * Stop the escalation cron (for graceful shutdown).
 */
export function stopEscalationCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger.info('Escalation cron stopped');
    }
}

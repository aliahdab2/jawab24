import { db } from '../db';
import { comments, messages, pages, posts, settings } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { notificationService } from './notifications';
import { captureError } from '../utils/sentryHelpers';

const DEFAULT_COMMENT_ESCALATION_MINUTES = 60;
const DEFAULT_MESSAGE_ESCALATION_MINUTES = 30;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Arabic pluralization for counted nouns.
 * Arabic has: singular (1), dual (2), plural (3-10), singular-accusative (11+).
 */
function arabicPlural(count: number, singular: string, dual: string, plural: string, accusative: string): string {
    if (count === 1) return `${singular}`;
    if (count === 2) return `${dual}`;
    if (count >= 3 && count <= 10) return `${count} ${plural}`;
    return `${count} ${accusative}`;
}

function formatCommentCountAr(count: number): string {
    return arabicPlural(count, 'تعليق واحد', 'تعليقان', 'تعليقات', 'تعليقًا');
}

function formatMessageCountAr(count: number): string {
    return arabicPlural(count, 'رسالة واحدة', 'رسالتان', 'رسائل', 'رسالة');
}

function formatCommentCountEn(count: number): string {
    return count === 1 ? '1 comment' : `${count} comments`;
}

function formatMessageCountEn(count: number): string {
    return count === 1 ? '1 message' : `${count} messages`;
}

/**
 * Run a single escalation sweep.
 * Finds unreplied comments/messages past their SLA threshold,
 * flags them as needsAttention, and sends one notification per user.
 */
export async function runEscalationSweep(): Promise<void> {
    try {
        await escalateComments();
        await escalateMessages();
    } catch (error) {
        captureError(error, 'Escalation sweep failed', { tags: { service: 'escalation' } });
    }
}

/**
 * Escalate stale comments: unreplied + not already flagged + past SLA.
 * Uses a single batch query to find all stale comments across all users,
 * then groups by user for bulk updates and one notification per user.
 */
async function escalateComments(): Promise<void> {
    // Single query: find all stale comments grouped by user, respecting per-user SLA thresholds.
    // Uses COALESCE to fall back to the default escalation threshold.
    const staleRows = await db
        .select({
            userId: pages.userId,
            commentId: comments.id,
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

    // Group by user
    const byUser = new Map<string, { ids: string[]; threshold: number }>();
    for (const row of staleRows) {
        if (!row.userId) continue;
        let entry = byUser.get(row.userId);
        if (!entry) {
            entry = { ids: [], threshold: Number(row.thresholdMinutes) };
            byUser.set(row.userId, entry);
        }
        entry.ids.push(row.commentId);
    }

    // Batch update + notify per user
    for (const [userId, { ids, threshold }] of byUser) {
        await db
            .update(comments)
            .set({
                needsAttention: true,
                flagReason: `sla_no_reply:${threshold}`,
                updatedAt: new Date(),
            })
            .where(sql`${comments.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

        const count = ids.length;
        notificationService.sendNotification(userId, {
            type: 'stale_comment',
            titleEn: 'Unreplied Comments Need Attention',
            titleAr: 'تعليقات بدون رد تحتاج انتباهك',
            bodyEn: `${formatCommentCountEn(count)} waiting for your reply for over ${threshold} minutes.`,
            bodyAr: `${formatCommentCountAr(count)} بانتظار ردك منذ أكثر من ${threshold} دقيقة.`,
            data: { deepLink: '/comments?filter=flagged' },
        }).catch(err => captureError(err, 'Escalation comment notification failed', { tags: { service: 'escalation', type: 'comment' } }));
    }
}

/**
 * Escalate stale messages: unreplied incoming + not already flagged + past SLA.
 * Uses a single batch query instead of per-user loops.
 */
async function escalateMessages(): Promise<void> {
    const staleRows = await db
        .select({
            userId: pages.userId,
            messageId: messages.id,
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

    // Group by user
    const byUser = new Map<string, { ids: string[]; threshold: number }>();
    for (const row of staleRows) {
        if (!row.userId) continue;
        let entry = byUser.get(row.userId);
        if (!entry) {
            entry = { ids: [], threshold: Number(row.thresholdMinutes) };
            byUser.set(row.userId, entry);
        }
        entry.ids.push(row.messageId);
    }

    for (const [userId, { ids, threshold }] of byUser) {
        await db
            .update(messages)
            .set({
                needsAttention: true,
                flagReason: `sla_no_reply:${threshold}`,
                updatedAt: new Date(),
            })
            .where(sql`${messages.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

        const msgCount = ids.length;
        notificationService.sendNotification(userId, {
            type: 'stale_comment',
            titleEn: 'Unreplied Messages Need Attention',
            titleAr: 'رسائل بدون رد تحتاج انتباهك',
            bodyEn: `${formatMessageCountEn(msgCount)} waiting for your reply for over ${threshold} minutes.`,
            bodyAr: `${formatMessageCountAr(msgCount)} بانتظار ردك منذ أكثر من ${threshold} دقيقة.`,
            data: { deepLink: '/messages?filter=flagged' },
        }).catch(err => captureError(err, 'Escalation message notification failed', { tags: { service: 'escalation', type: 'message' } }));
    }
}

/**
 * Start the escalation cron (runs every 5 minutes).
 */
export function startEscalationCron(): void {
    if (intervalHandle) return; // Already running
    console.warn('[Escalation] Cron started (every 5 min)');
    intervalHandle = setInterval(runEscalationSweep, SWEEP_INTERVAL_MS);
    // Run once immediately on startup
    runEscalationSweep().catch(err => console.warn('[Escalation] Initial sweep failed:', err));
}

/**
 * Stop the escalation cron (for graceful shutdown).
 */
export function stopEscalationCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.warn('[Escalation] Cron stopped');
    }
}

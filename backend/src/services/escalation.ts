import { db } from '../db';
import { comments, messages, pages, posts, settings } from '../db/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
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
 * Groups by user to send one notification per user.
 */
async function escalateComments(): Promise<void> {
    // Find all users with their escalation settings
    const userSettings = await db
        .select({
            userId: settings.userId,
            commentEscalationMinutes: settings.commentEscalationMinutes,
        })
        .from(settings);

    for (const us of userSettings) {
        if (!us.userId) continue;

        const thresholdMinutes = us.commentEscalationMinutes ?? DEFAULT_COMMENT_ESCALATION_MINUTES;
        const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        // Find stale comments for this user's pages
        const staleComments = await db
            .select({
                commentId: comments.id,
            })
            .from(comments)
            .innerJoin(posts, eq(comments.postId, posts.id))
            .innerJoin(pages, eq(posts.pageId, pages.id))
            .where(and(
                eq(pages.userId, us.userId),
                eq(comments.replied, false),
                eq(comments.needsAttention, false),
                lte(comments.createdTime, cutoff),
            ));

        if (staleComments.length === 0) continue;

        // Batch update: flag all stale comments for this user
        const staleIds = staleComments.map(c => c.commentId);
        await db
            .update(comments)
            .set({
                needsAttention: true,
                flagReason: `sla_no_reply:${thresholdMinutes}`,
                updatedAt: new Date(),
            })
            .where(sql`${comments.id} IN (${sql.join(staleIds.map(id => sql`${id}`), sql`, `)})`);

        // Send one notification per user (not per comment)
        const count = staleComments.length;
        notificationService.sendNotification(us.userId, {
            type: 'stale_comment',
            titleEn: 'Unreplied Comments Need Attention',
            titleAr: 'تعليقات بدون رد تحتاج انتباهك',
            bodyEn: `${formatCommentCountEn(count)} waiting for your reply for over ${thresholdMinutes} minutes.`,
            bodyAr: `${formatCommentCountAr(count)} بانتظار ردك منذ أكثر من ${thresholdMinutes} دقيقة.`,
            data: { deepLink: '/comments?filter=flagged' },
        }).catch(err => captureError(err, 'Escalation comment notification failed', { tags: { service: 'escalation', type: 'comment' } }));
    }
}

/**
 * Escalate stale messages: unreplied incoming + not already flagged + past SLA.
 */
async function escalateMessages(): Promise<void> {
    const userSettings = await db
        .select({
            userId: settings.userId,
            messageEscalationMinutes: settings.messageEscalationMinutes,
        })
        .from(settings);

    for (const us of userSettings) {
        if (!us.userId) continue;

        const thresholdMinutes = us.messageEscalationMinutes ?? DEFAULT_MESSAGE_ESCALATION_MINUTES;
        const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

        const staleMessages = await db
            .select({
                messageId: messages.id,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.userId, us.userId),
                eq(messages.replied, false),
                eq(messages.needsAttention, false),
                eq(messages.direction, 'incoming'),
                lte(messages.createdTime, cutoff),
            ));

        if (staleMessages.length === 0) continue;

        const staleIds = staleMessages.map(m => m.messageId);
        await db
            .update(messages)
            .set({
                needsAttention: true,
                flagReason: `sla_no_reply:${thresholdMinutes}`,
                updatedAt: new Date(),
            })
            .where(sql`${messages.id} IN (${sql.join(staleIds.map(id => sql`${id}`), sql`, `)})`);

        const msgCount = staleMessages.length;
        notificationService.sendNotification(us.userId, {
            type: 'stale_comment',
            titleEn: 'Unreplied Messages Need Attention',
            titleAr: 'رسائل بدون رد تحتاج انتباهك',
            bodyEn: `${formatMessageCountEn(msgCount)} waiting for your reply for over ${thresholdMinutes} minutes.`,
            bodyAr: `${formatMessageCountAr(msgCount)} بانتظار ردك منذ أكثر من ${thresholdMinutes} دقيقة.`,
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

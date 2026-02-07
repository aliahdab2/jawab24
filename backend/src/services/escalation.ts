import { db } from '../db';
import { comments, messages, pages, posts, settings } from '../db/schema';
import { eq, and, lte, sql } from 'drizzle-orm';
import { notificationService } from './notifications';

const DEFAULT_COMMENT_ESCALATION_MINUTES = 60;
const DEFAULT_MESSAGE_ESCALATION_MINUTES = 30;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;

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
        console.error('[Escalation] Sweep failed:', error);
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
                flagReason: `SLA: no reply after ${thresholdMinutes} min`,
                updatedAt: new Date(),
            })
            .where(sql`${comments.id} IN (${sql.join(staleIds.map(id => sql`${id}`), sql`, `)})`);

        // Send one notification per user (not per comment)
        notificationService.sendTemplateNotification(
            us.userId,
            'stale_comment',
            {
                count: String(staleComments.length),
                minutes: String(thresholdMinutes),
            },
            { deepLink: '/comments?filter=flagged' }
        ).catch(err => console.error('[Escalation] Notification failed:', err));
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
                flagReason: `SLA: no reply after ${thresholdMinutes} min`,
                updatedAt: new Date(),
            })
            .where(sql`${messages.id} IN (${sql.join(staleIds.map(id => sql`${id}`), sql`, `)})`);

        notificationService.sendTemplateNotification(
            us.userId,
            'stale_comment',
            {
                count: String(staleMessages.length),
                minutes: String(thresholdMinutes),
            },
            { deepLink: '/messages?filter=flagged' }
        ).catch(err => console.error('[Escalation] Message notification failed:', err));
    }
}

/**
 * Start the escalation cron (runs every 5 minutes).
 */
export function startEscalationCron(): void {
    if (intervalHandle) return; // Already running
    console.log('[Escalation] Cron started (every 5 min)');
    intervalHandle = setInterval(runEscalationSweep, SWEEP_INTERVAL_MS);
    // Run once immediately on startup
    runEscalationSweep().catch(err => console.error('[Escalation] Initial sweep failed:', err));
}

/**
 * Stop the escalation cron (for graceful shutdown).
 */
export function stopEscalationCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('[Escalation] Cron stopped');
    }
}

import { db } from '../db';
import { comments, instagramComments, messages, pages, posts, settings } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { notificationService, NotificationType } from './notifications';
import { workspaceSettingsService } from './workspaceSettings';
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

/** Group rows by workspaceId, filtering out null workspaceIds. */
function groupByWorkspace<T extends { workspaceId: string | null }>(rows: T[]): Map<string, T[]> {
    const byWorkspace = new Map<string, T[]>();
    for (const row of rows) {
        if (!row.workspaceId) continue;
        const arr = byWorkspace.get(row.workspaceId) ?? [];
        arr.push(row);
        byWorkspace.set(row.workspaceId, arr);
    }
    return byWorkspace;
}

interface NotificationItem {
    name: string;
    title: string;
    preview: string;
    data: Record<string, string | undefined>;
}

/**
 * Send per-item notifications with a flood cap to all members of a workspace.
 * Delegates the member fan-out to notificationService.sendNotificationToWorkspace
 * so the workspace lookup is centralised and testable.
 * Sends up to MAX_INDIVIDUAL_NOTIFICATIONS, then one overflow summary if needed.
 */
async function sendItemNotificationsToWorkspace(
    workspaceId: string,
    type: NotificationType,
    items: NotificationItem[],
    overflow: { deepLink: string; labelEn: string; labelAr: string },
): Promise<void> {
    const toNotify = items.slice(0, MAX_INDIVIDUAL_NOTIFICATIONS);

    for (const item of toNotify) {
        await notificationService.sendNotificationToWorkspace(workspaceId, {
            type,
            titles: { en: item.title, ar: item.title },
            bodies: { en: item.preview, ar: item.preview },
            data: item.data,
        }).catch(err => captureError(err, `Escalation ${type} notification failed`, { tags: { service: 'escalation', type } }));
    }

    const overflowCount = items.length - toNotify.length;
    if (overflowCount > 0) {
        await notificationService.sendNotificationToWorkspace(workspaceId, {
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
 * Was the reply pipeline even expected to answer this workspace's items on this
 * channel? Delegates to the SAME canonical predicate the processors gate on
 * (`isAutoReplyEnabledFromSettings`, used by messageProcessor.ts and
 * commentProcessor.ts) so the SLA sweep can never drift from what the pipeline
 * actually does.
 *
 * WHY (2026-07-29): the sweep only filtered on the per-PAGE
 * `pages.auto_reply_enabled` master switch — a DIFFERENT flag from the
 * per-channel `messagesAutoReply` / `commentsAutoReply` toggles the pipeline
 * reads. Switching a channel off does NOT cascade to the page flag (settings.ts
 * only clamps `aiEnabled`), so a merchant who turned DM auto-reply off still had
 * `auto_reply_enabled=true` pages and got EVERY unanswered DM flagged
 * `sla_no_reply` — 638 flags on one pharmacy page in prod. Those are ~100% false
 * positives: on a manual-only page the merchant replies inside
 * Facebook/Instagram, and we do not ingest Messenger/Instagram `message_echoes`,
 * so their reply is invisible here and the row never clears. A permanently-red
 * Needs Attention counter is worse than no counter — merchants stop trusting it
 * entirely. (WhatsApp Coexistence echoes ARE ingested since 2026-07 — see
 * webhook.ts `processWhatsAppEchoes` — but they are a different channel and do
 * not change this predicate.)
 *
 * Business hours ride along in the same predicate and are evaluated at SWEEP
 * time, which is the semantics we want: a message arriving 02:00 against
 * 09:00–17:00 hours is not flagged overnight (nobody is working, and it already
 * received an away message) but becomes flaggable once the workspace is open.
 *
 * Reversible: if Messenger/Instagram `message_echoes` ingestion lands, manual-only
 * workspaces can be escalated again — their human replies would then be
 * observable, so the flags would clear instead of piling up.
 */
async function shouldEscalateWorkspace(
    workspaceId: string,
    channel: 'messages' | 'comments',
): Promise<boolean> {
    try {
        const wsSettings = await workspaceSettingsService.getSettings(workspaceId);
        return workspaceSettingsService.isAutoReplyEnabledFromSettings(wsSettings, channel);
    } catch (error) {
        // Fail CLOSED: a settings read failure must not resurrect the false
        // positives above. The sweep re-runs every SWEEP_INTERVAL_MS, so a
        // genuinely stale item is picked up on the next pass.
        captureError(error, 'Escalation settings lookup failed', {
            tags: { service: 'escalation', channel },
            extra: { workspaceId },
        });
        return false;
    }
}

/**
 * Resolve comments stuck as pending because they contain no actionable content
 * (punctuation-only, emoji-only, bare @mention). These should have been resolved
 * by the processor but may slip through during transient failures or edge cases.
 * Must run BEFORE escalation so they don't get incorrectly flagged as needing
 * merchant attention.
 *
 * Matches after 10 minutes — enough time for any legitimate processing to finish.
 */
async function resolveStuckSpamComments(): Promise<void> {
    // An item is considered spam-stuck if its entire message (trimmed) contains
    // no letter at all — only dots, punctuation, whitespace, emojis, @mentions,
    // digits, or any combination thereof. Implemented as the inverse: if NO
    // letter is present, the message is non-actionable noise.
    // [[:alpha:]] is Postgres's locale-aware "any letter" class — it matches
    // Arabic, Latin (incl. accented), Cyrillic, Hebrew, etc. That's safer than
    // hardcoded ranges, which previously missed emoji-only DMs and would also
    // miss accented Latin like "café".
    const spamCondition = sql`
        trim(message) <> ''
        AND trim(message) !~ '[[:alpha:]]'
    `;
    const stuckCondition = sql`created_at < NOW() - INTERVAL '10 minutes'`;
    const stuckMessageCondition = sql`created_time < NOW() - INTERVAL '10 minutes'`;

    const [fbResult, igResult, msgResult] = await Promise.all([
        db.update(comments)
            .set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(comments.replied, false),
                eq(comments.resolved, false),
                eq(comments.needsAttention, false),
                stuckCondition,
                spamCondition,
            )),
        db.update(instagramComments)
            .set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(instagramComments.replied, false),
                eq(instagramComments.resolved, false),
                eq(instagramComments.needsAttention, false),
                stuckCondition,
                spamCondition,
            )),
        // Incoming DMs with only punctuation/emoji/@mention would otherwise be
        // flagged sla_no_reply after 15–30 min. Resolve them silently like comments.
        db.update(messages)
            .set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                eq(messages.resolved, false),
                eq(messages.needsAttention, false),
                stuckMessageCondition,
                spamCondition,
            )),
    ]);

    const fbCount = (fbResult as unknown as { rowCount?: number }).rowCount ?? 0;
    const igCount = (igResult as unknown as { rowCount?: number }).rowCount ?? 0;
    const msgCount = (msgResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (fbCount + igCount + msgCount > 0) {
        logger.info('Resolved stuck spam items', { fbCount, igCount, msgCount });
    }
}

/**
 * Run a single escalation sweep.
 * First resolves stuck spam/punctuation comments silently, then finds unreplied
 * comments/messages past their SLA threshold, flags them as needsAttention,
 * and sends per-conversation notifications.
 */
export async function runEscalationSweep(): Promise<void> {
    try {
        await resolveStuckSpamComments();
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
    workspaceId: string | null;
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
            workspaceId: pages.workspaceId,
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

    for (const [workspaceId, rows] of groupByWorkspace(staleRows)) {
        if (!await shouldEscalateWorkspace(workspaceId, 'comments')) continue;

        const ids = rows.map(r => r.itemId);
        const threshold = Number(rows[0].thresholdMinutes);

        await db.update(comments)
            .set({
                needsAttention: true,
                flagReason: 'sla_no_reply',
                flagMeta: { sla_no_reply: { minutes: threshold } },
                updatedAt: new Date(),
            })
            .where(sql`${comments.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

        const items: NotificationItem[] = rows.map(row => ({
            name: row.fromName || 'Unknown',
            title: buildTitle(row.fromName, row.pageName),
            preview: truncatePreview(row.messageText),
            data: { commentId: row.itemId },
        }));

        await sendItemNotificationsToWorkspace(workspaceId, 'stale_comment', items, {
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
    workspaceId: string | null;
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
            workspaceId: pages.workspaceId,
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
            // Skip rows already resolved — either by resolveStuckSpamComments (this same sweep)
            // or by the producer (e.g. nonTextHandler marks stickers resolved at store time).
            // Without this filter, a row resolved earlier in the sweep gets flagged anyway.
            eq(messages.resolved, false),
            eq(messages.needsAttention, false),
            eq(messages.direction, 'incoming'),
            eq(pages.autoReplyEnabled, true),
            sql`${messages.createdTime} < NOW() - MAKE_INTERVAL(mins => COALESCE(${settings.messageEscalationMinutes}, ${DEFAULT_MESSAGE_ESCALATION_MINUTES}))`,
        ));

    if (staleRows.length === 0) return;

    for (const [workspaceId, rows] of groupByWorkspace(staleRows)) {
        if (!await shouldEscalateWorkspace(workspaceId, 'messages')) continue;

        const ids = rows.map(r => r.itemId);
        const threshold = Number(rows[0].thresholdMinutes);

        await db.update(messages)
            .set({
                needsAttention: true,
                flagReason: 'sla_no_reply',
                flagMeta: { sla_no_reply: { minutes: threshold } },
                updatedAt: new Date(),
            })
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

        await sendItemNotificationsToWorkspace(workspaceId, 'stale_message', items, {
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

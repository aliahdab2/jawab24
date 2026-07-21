import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { messages, conversationPauses } from '../db/schema';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';
import { redis } from '../lib/redis';

/**
 * Redis key for the per-conversation "resume marker". When set, manual replies
 * older than the marker timestamp do not count toward the implicit handoff
 * pause. The TTL is set to slightly exceed one pause window, since manual
 * replies older than that window stop counting anyway via the SQL cutoff.
 *
 * Redis (not a DB column) because:
 *   1. The marker is transient — it stops mattering after the pause window.
 *      TTL self-cleaning means no schema column to maintain or backfill.
 *   2. Reuses the existing transient-state pattern (rateLimiter, replyLock).
 *   3. A lost marker (Redis restart) just lets the bot resume slightly earlier
 *      than expected on the next message — self-healing, never blocks delivery.
 */
const RESUME_MARKER_PREFIX = 'handoff:resumed:';
const resumeMarkerKey = (pageId: string, senderId: string) =>
    `${RESUME_MARKER_PREFIX}${pageId}:${senderId}`;

/**
 * Why auto-reply is paused: an explicit UI pause, the implicit handoff a manual
 * reply triggers, or null when not paused.
 */
export type PauseReason = 'explicit' | 'manual_reply' | null;

/**
 * Manages conversation pause state: explicit UI-triggered pauses and implicit
 * pauses triggered by a human agent sending a manual reply (handoff detection).
 */
export class ConversationPauseService {
    /**
     * Check if auto-reply should be paused for this sender.
     * Checks explicit pause first, then falls back to recent manual reply detection.
     */
    async isPaused(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<boolean> {
        const { reason } = await this._resolvePause(pageId, senderId, pauseMinutes);
        return reason !== null;
    }

    /**
     * Get the remaining pause time in milliseconds.
     * Returns 0 if not paused. Used to schedule delayed re-enqueue of messages
     * that arrive during a handoff pause.
     */
    async getRemainingPauseMs(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<number> {
        const { remainingMs } = await this._resolvePause(pageId, senderId, pauseMinutes);
        return remainingMs;
    }

    /**
     * Pause auto-reply for a specific conversation until the given time.
     */
    async pauseConversation(
        pageId: string,
        senderId: string,
        durationMinutes: number = 30,
    ): Promise<{ pausedUntil: Date }> {
        const pausedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

        await db.delete(conversationPauses)
            .where(and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId),
            ));

        await db.insert(conversationPauses).values({ pageId, senderId, pausedUntil });

        return { pausedUntil };
    }

    /**
     * Resume auto-reply for a specific conversation. Clears both pause sources:
     *   1. Deletes any active explicit `conversation_pauses` row.
     *   2. Sets a Redis resume marker so subsequent `_hasRecentManualReply`
     *      checks ignore manual replies older than the marker. Without (2),
     *      a merchant who just typed a reply would press Resume and watch
     *      the bot stay silent for up to `pauseMinutes` — the rolling
     *      implicit-handoff window. The marker neutralizes that window
     *      without mutating the historical `messages.replyMethod` data
     *      (preserves analytics: manual-reply counts stay accurate).
     */
    async resumeConversation(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<void> {
        await db.delete(conversationPauses)
            .where(and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId),
            ));

        // TTL is one pause window plus a small buffer. After that, any manual
        // reply prior to the marker is naturally outside the SQL cutoff anyway.
        const ttlSeconds = pauseMinutes * 60 + 60;
        try {
            await redis.setex(resumeMarkerKey(pageId, senderId), ttlSeconds, Date.now().toString());
        } catch {
            // Best-effort: a lost marker means the bot might stay silent until
            // the rolling window expires. Annoying but not broken.
        }
    }

    /**
     * Get the pause status for a conversation, including WHY it's paused and how
     * many minutes remain until auto-reply resumes.
     *
     * `reason` distinguishes an explicit UI pause from the implicit handoff pause
     * a manual reply triggers — the latter is otherwise invisible to the merchant,
     * who sees the bot go quiet with no explanation. `remainingMinutes` gives the
     * auto-resume countdown for both.
     *
     * `pauseMinutes` MUST be the merchant's configured handoff window (not the
     * default) so both the manual-reply detection and the countdown match the
     * reply pipeline, which gates on `userSettings.handoffPauseDurationMinutes`.
     */
    async getPauseStatus(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<{ paused: boolean; pausedUntil: Date | null; reason: PauseReason; remainingMinutes: number | null }> {
        const { reason, pausedUntil, remainingMs } = await this._resolvePause(pageId, senderId, pauseMinutes);
        return {
            paused: reason !== null,
            pausedUntil,
            reason,
            remainingMinutes: reason !== null ? Math.ceil(remainingMs / 60_000) : null,
        };
    }

    /**
     * Single source of truth for pause state: resolves the active pause (if any),
     * why it's active, when it expires, and how long remains. `isPaused`,
     * `getRemainingPauseMs`, and `getPauseStatus` all derive from this so the
     * explicit-vs-manual-reply precedence and expiry math live in exactly one place.
     *
     * Precedence: an explicit UI pause wins over the implicit manual-reply handoff.
     * Short-circuits on the explicit pause so the messages table is only queried
     * when there's no explicit pause.
     */
    private async _resolvePause(
        pageId: string,
        senderId: string,
        pauseMinutes: number,
    ): Promise<{ reason: PauseReason; pausedUntil: Date | null; remainingMs: number }> {
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) {
            return {
                reason: 'explicit',
                pausedUntil: explicitPause.pausedUntil,
                remainingMs: Math.max(0, explicitPause.pausedUntil.getTime() - Date.now()),
            };
        }

        const recentManual = await this._getRecentManualReply(pageId, senderId, pauseMinutes);
        if (recentManual?.createdAt) {
            const pausedUntil = new Date(new Date(recentManual.createdAt).getTime() + pauseMinutes * 60 * 1000);
            return {
                reason: 'manual_reply',
                pausedUntil,
                remainingMs: Math.max(0, pausedUntil.getTime() - Date.now()),
            };
        }

        return { reason: null, pausedUntil: null, remainingMs: 0 };
    }

    /**
     * Check if there is an active explicit pause for this conversation.
     */
    private async getExplicitPause(
        pageId: string,
        senderId: string,
    ): Promise<{ id: string; pausedUntil: Date } | null> {
        const now = new Date();
        const pause = await db.query.conversationPauses.findFirst({
            where: and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId),
                gt(conversationPauses.pausedUntil, now),
            ),
        });
        if (!pause) return null;
        return { id: pause.id, pausedUntil: pause.pausedUntil };
    }

    /**
     * Look up the most recent unmasked manual reply within the window, applying
     * the Redis resume marker as a virtual cutoff. Sole caller is `_resolvePause`.
     */
    private async _getRecentManualReply(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<{ createdAt: Date | string } | null> {
        const now = Date.now();
        const cutoffMs = now - pauseMinutes * 60 * 1000;

        let resumedAtMs = 0;
        try {
            const raw = await redis.get(resumeMarkerKey(pageId, senderId));
            if (raw) {
                const parsed = parseInt(raw, 10);
                if (Number.isFinite(parsed)) resumedAtMs = parsed;
            }
        } catch {
            // Redis down — fall back to ignoring the marker. The merchant
            // who just pressed Resume will have to wait for the rolling
            // window, but the bot still functions.
        }

        const effectiveCutoff = new Date(Math.max(cutoffMs, resumedAtMs));

        const recentManual = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'outgoing'),
                eq(messages.replyMethod, 'manual'),
                sql`${messages.createdAt} > ${effectiveCutoff}`,
            ),
            orderBy: [desc(messages.createdAt)],
        });

        if (!recentManual?.createdAt) return null;
        return { createdAt: recentManual.createdAt };
    }
}

export const conversationPauseService = new ConversationPauseService();

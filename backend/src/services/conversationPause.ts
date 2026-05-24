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
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) return true;
        return this._hasRecentManualReply(pageId, senderId, pauseMinutes);
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
        const now = Date.now();

        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) {
            const remaining = explicitPause.pausedUntil.getTime() - now;
            return Math.max(0, remaining);
        }

        const recentManual = await this._getRecentManualReply(pageId, senderId, pauseMinutes);
        if (recentManual?.createdAt) {
            const pauseExpiresAt = new Date(recentManual.createdAt).getTime() + pauseMinutes * 60 * 1000;
            return Math.max(0, pauseExpiresAt - now);
        }

        return 0;
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
     * Get the pause status for a conversation.
     */
    async getPauseStatus(
        pageId: string,
        senderId: string,
    ): Promise<{ paused: boolean; pausedUntil: Date | null; reason: string | null }> {
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) {
            return { paused: true, pausedUntil: explicitPause.pausedUntil, reason: 'explicit' };
        }

        const hasManual = await this._hasRecentManualReply(pageId, senderId);
        if (hasManual) {
            return { paused: true, pausedUntil: null, reason: 'manual_reply' };
        }

        return { paused: false, pausedUntil: null, reason: null };
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
     * Check if a manual outgoing reply was sent within the given window and
     * AFTER any active resume marker. The marker is set by resumeConversation;
     * it neutralizes the rolling implicit pause without rewriting message rows.
     */
    private async _hasRecentManualReply(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<boolean> {
        const recent = await this._getRecentManualReply(pageId, senderId, pauseMinutes);
        return !!recent;
    }

    /**
     * Look up the most recent unmasked manual reply within the window. Shared
     * by `getRemainingPauseMs` and `_hasRecentManualReply` so they apply the
     * resume marker identically.
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

import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { messages, conversationPauses } from '../db/schema';
import { DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';

/** DB connection or transaction — methods accepting this can participate in a transaction. */
type DbConn = typeof db;

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

        const cutoff = new Date(now - pauseMinutes * 60 * 1000);
        const recentManual = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'outgoing'),
                eq(messages.replyMethod, 'manual'),
                sql`${messages.createdAt} > ${cutoff}`,
            ),
            orderBy: [desc(messages.createdAt)],
        });

        if (recentManual?.createdAt) {
            const pauseExpiresAt = recentManual.createdAt.getTime() + pauseMinutes * 60 * 1000;
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
     * Resume auto-reply for a specific conversation (remove the pause).
     */
    async resumeConversation(pageId: string, senderId: string): Promise<void> {
        await db.delete(conversationPauses)
            .where(and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId),
            ));
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
     * Check if a manual outgoing reply was sent within the given window.
     */
    private async _hasRecentManualReply(
        pageId: string,
        senderId: string,
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES,
    ): Promise<boolean> {
        const cutoff = new Date(Date.now() - pauseMinutes * 60 * 1000);

        const recentManual = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'outgoing'),
                eq(messages.replyMethod, 'manual'),
                sql`${messages.createdAt} > ${cutoff}`,
            ),
            orderBy: [desc(messages.createdAt)],
        });

        return !!recentManual;
    }
}

export const conversationPauseService = new ConversationPauseService();

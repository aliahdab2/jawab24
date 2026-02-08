import { eq, desc, asc, and, sql, gt, ne } from 'drizzle-orm';
import { db } from '../db';
import { messages, pages, conversationPauses } from '../db/schema';
import { ConversationMessage } from '../types';
import { Message } from '@jawab24/shared';

export interface CreateMessageDTO {
    pageId: string;
    facebookMessageId: string;
    senderId: string;
    senderName?: string;
    message: string;
    direction?: 'incoming' | 'outgoing';
}

export class MessagesService {
    /**
     * Get all messages for a user's pages with cursor-based pagination
     */
    async getMessages(userId: string, options?: {
        limit?: number;
        cursor?: string;
        direction?: 'incoming' | 'outgoing';
    }): Promise<{
        data: Message[];
        pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
    }> {
        const limit = options?.limit || 50;

        const userPages = await db.query.pages.findMany({
            where: eq(pages.userId, userId),
        });

        if (userPages.length === 0) {
            return {
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit }
            };
        }

        const pageIds = userPages.map(p => p.id);

        // Build conditions
        const conditions = [
            sql`${messages.pageId} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`
        ];

        // Filter by direction if specified
        if (options?.direction) {
            conditions.push(eq(messages.direction, options.direction));
        }

        // Cursor-based pagination
        if (options?.cursor) {
            const cursorMessage = await db.query.messages.findFirst({
                where: eq(messages.id, options.cursor),
            });
            if (cursorMessage?.createdAt) {
                conditions.push(sql`${messages.createdAt} < ${cursorMessage.createdAt}`);
            }
        }

        const result = await db.query.messages.findMany({
            where: and(...conditions),
            orderBy: [desc(messages.createdAt)],
            limit: limit + 1,
        });

        const hasMore = result.length > limit;
        const data = hasMore ? result.slice(0, limit) : result;
        const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

        return {
            data: data.map(this.mapToMessage),
            pagination: { hasMore, nextCursor, limit }
        };
    }

    /**
     * Get messages for a specific page
     */
    async getMessagesByPage(pageId: string, limit: number = 50): Promise<Message[]> {
        const result = await db.query.messages.findMany({
            where: eq(messages.pageId, pageId),
            orderBy: [desc(messages.createdAt)],
            limit,
        });

        return result.map(this.mapToMessage);
    }

    /**
     * Get conversation with a specific sender
     */
    async getConversation(pageId: string, senderId: string, limit: number = 50): Promise<Message[]> {
        const result = await db.query.messages.findMany({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId)
            ),
            orderBy: [desc(messages.createdAt)],
            limit,
        });

        return result.map(this.mapToMessage);
    }

    /**
     * Create a new message record
     */
    async createMessage(data: CreateMessageDTO): Promise<Message> {
        const [newMessage] = await db.insert(messages)
            .values({
                pageId: data.pageId,
                facebookMessageId: data.facebookMessageId,
                senderId: data.senderId,
                senderName: data.senderName,
                message: data.message,
                direction: data.direction || 'incoming',
                createdTime: new Date(),
            })
            .returning();

        return this.mapToMessage(newMessage);
    }

    /**
     * Find or create a message from webhook
     */
    async findOrCreateFromWebhook(
        pageId: string,
        facebookMessageId: string,
        senderId: string,
        messageText: string,
        senderName?: string
    ): Promise<{ message: Message; isNew: boolean }> {
        // Check if message already exists
        const existing = await db.query.messages.findFirst({
            where: eq(messages.facebookMessageId, facebookMessageId),
        });

        if (existing) {
            return { message: this.mapToMessage(existing), isNew: false };
        }

        // Create new message
        const newMessage = await this.createMessage({
            pageId,
            facebookMessageId,
            senderId,
            senderName,
            message: messageText,
            direction: 'incoming',
        });

        return { message: newMessage, isNew: true };
    }

    /**
     * Mark message as replied
     */
    async markAsReplied(
        messageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string
    ): Promise<void> {
        await db.update(messages)
            .set({
                replied: true,
                replyText,
                replyMethod,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(messages.id, messageId));
    }

    /**
     * Store outgoing reply as a message
     */
    async storeOutgoingMessage(
        pageId: string,
        senderId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual'
    ): Promise<Message> {
        const [newMessage] = await db.insert(messages)
            .values({
                pageId,
                facebookMessageId: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                senderId,
                message: replyText,
                direction: 'outgoing',
                replied: true,
                replyText,
                replyMethod,
                repliedAt: new Date(),
                createdTime: new Date(),
            })
            .returning();

        return this.mapToMessage(newMessage);
    }

    /**
     * Get unreplied messages
     */
    async getUnrepliedMessages(userId: string, limit: number = 10): Promise<Message[]> {
        const userPages = await db.query.pages.findMany({
            where: eq(pages.userId, userId),
        });

        if (userPages.length === 0) {
            return [];
        }

        const pageIds = userPages.map(p => p.id);

        const result = await db.query.messages.findMany({
            where: and(
                sql`${messages.pageId} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`,
                eq(messages.replied, false),
                eq(messages.direction, 'incoming')
            ),
            orderBy: [desc(messages.createdAt)],
            limit,
        });

        return result.map(this.mapToMessage);
    }

    /**
     * Get conversation history for AI context
     * Returns last N messages between page and sender, formatted for AI
     */
    async getConversationHistory(
        pageId: string, 
        senderId: string, 
        limit: number = 10
    ): Promise<ConversationMessage[]> {
        const result = await db.query.messages.findMany({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId)
            ),
            orderBy: [desc(messages.createdAt)],
            limit,
        });

        // Reverse to get chronological order (oldest first)
        const chronological = result.reverse();

        return chronological.map(msg => ({
            role: msg.direction === 'incoming' ? 'user' as const : 'assistant' as const,
            content: msg.message,
            timestamp: msg.createdAt || undefined,
        }));
    }

    /**
     * Check if there is a newer unreplied incoming message from the same sender.
     * Used to debounce rapid-fire messages: skip older ones and let the newest job reply.
     */
    async hasNewerUnrepliedMessage(
        pageId: string,
        senderId: string,
        currentMessageId: string
    ): Promise<boolean> {
        const currentMsg = await db.query.messages.findFirst({
            where: eq(messages.facebookMessageId, currentMessageId),
        });
        if (!currentMsg?.createdAt) return false;

        const newer = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                ne(messages.id, currentMsg.id),
                sql`${messages.createdAt} > ${currentMsg.createdAt}`
            ),
        });
        return !!newer;
    }

    /**
     * Get all unreplied incoming messages from a sender (oldest first).
     * Used to consolidate rapid-fire messages into a single AI prompt.
     */
    async getUnrepliedFromSender(
        pageId: string,
        senderId: string
    ): Promise<{ id: string; message: string }[]> {
        const result = await db.query.messages.findMany({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false)
            ),
            orderBy: [asc(messages.createdAt)],
        });
        return result.map(r => ({ id: r.id, message: r.message }));
    }

    /**
     * Mark older unreplied messages from the same sender as replied
     * (they were addressed via the consolidated reply to the latest message).
     */
    async markOlderMessagesAsReplied(
        pageId: string,
        senderId: string,
        excludeMessageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual'
    ): Promise<number> {
        const result = await db.update(messages)
            .set({
                replied: true,
                replyText,
                replyMethod,
                repliedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                ne(messages.id, excludeMessageId)
            ))
            .returning({ id: messages.id });
        return result.length;
    }

    /**
     * Get message statistics
     */
    async getStats(userId: string): Promise<{
        total: number;
        replied: number;
        pending: number;
        needsAttention: number;
        byMethod: { template: number; ai: number; manual: number };
    }> {
        const totalResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.userId, userId),
                eq(messages.direction, 'incoming')
            ));

        const total = Number(totalResult[0]?.count || 0);

        if (total === 0) {
            return { total: 0, replied: 0, pending: 0, needsAttention: 0, byMethod: { template: 0, ai: 0, manual: 0 } };
        }

        const repliedResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.userId, userId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, true)
            ));

        const replied = Number(repliedResult[0]?.count || 0);

        // Get needs attention count (only unreplied — resolved ones don't need attention)
        const needsAttentionResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.userId, userId),
                eq(messages.direction, 'incoming'),
                eq(messages.needsAttention, true),
                eq(messages.replied, false)
            ));

        const needsAttention = Number(needsAttentionResult[0]?.count || 0);

        // Get counts by reply method
        const byMethodResult = await db
            .select({
                method: messages.replyMethod,
                count: sql<number>`count(*)`,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.userId, userId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, true)
            ))
            .groupBy(messages.replyMethod);

        const byMethod = { template: 0, ai: 0, manual: 0 };
        byMethodResult.forEach((row) => {
            if (row.method === 'template') byMethod.template = Number(row.count);
            else if (row.method === 'ai') byMethod.ai = Number(row.count);
            else if (row.method === 'manual') byMethod.manual = Number(row.count);
        });

        return {
            total,
            replied,
            pending: total - replied - needsAttention,
            needsAttention,
            byMethod,
        };
    }

    /**
     * Get a single message by internal ID
     */
    async getMessageById(id: string): Promise<(Message & { platform?: string }) | null> {
        const result = await db.query.messages.findFirst({
            where: eq(messages.id, id),
        });
        if (!result) return null;
        return {
            ...this.mapToMessage(result),
            platform: result.platform || 'facebook',
        };
    }

    /**
     * Check if auto-reply should be paused for this sender.
     * Checks explicit pause first, then falls back to recent manual reply detection.
     */
    async isPaused(
        pageId: string,
        senderId: string,
        pauseMinutes: number = 30
    ): Promise<boolean> {
        // 1. Check explicit pause (from UI "pause" button)
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) return true;

        // 2. Fallback: check if a manual reply was sent recently
        return this._hasRecentManualReply(pageId, senderId, pauseMinutes);
    }

    /**
     * Check if there is an active explicit pause for this conversation.
     */
    private async getExplicitPause(
        pageId: string,
        senderId: string
    ): Promise<{ id: string; pausedUntil: Date } | null> {
        const now = new Date();
        const pause = await db.query.conversationPauses.findFirst({
            where: and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId),
                gt(conversationPauses.pausedUntil, now)
            ),
        });
        if (!pause) return null;
        return { id: pause.id, pausedUntil: pause.pausedUntil };
    }

    /**
     * Pause auto-reply for a specific conversation until the given time.
     */
    async pauseConversation(
        pageId: string,
        senderId: string,
        durationMinutes: number = 30
    ): Promise<{ pausedUntil: Date }> {
        const pausedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

        // Upsert: delete existing pause for this page+sender, then insert
        await db.delete(conversationPauses)
            .where(and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId)
            ));

        await db.insert(conversationPauses).values({
            pageId,
            senderId,
            pausedUntil,
        });

        return { pausedUntil };
    }

    /**
     * Resume auto-reply for a specific conversation (remove the pause).
     */
    async resumeConversation(
        pageId: string,
        senderId: string
    ): Promise<void> {
        await db.delete(conversationPauses)
            .where(and(
                eq(conversationPauses.pageId, pageId),
                eq(conversationPauses.senderId, senderId)
            ));
    }

    /**
     * Get the pause status for a conversation.
     */
    async getPauseStatus(
        pageId: string,
        senderId: string
    ): Promise<{ paused: boolean; pausedUntil: Date | null; reason: string | null }> {
        // Check explicit pause
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) {
            return { paused: true, pausedUntil: explicitPause.pausedUntil, reason: 'explicit' };
        }

        // Check implicit (recent manual reply)
        const hasManual = await this._hasRecentManualReply(pageId, senderId);
        if (hasManual) {
            return { paused: true, pausedUntil: null, reason: 'manual_reply' };
        }

        return { paused: false, pausedUntil: null, reason: null };
    }

    /**
     * Check if a manual outgoing reply was sent within the given window.
     * (Internal helper — renamed from isManuallyPaused)
     */
    private async _hasRecentManualReply(
        pageId: string,
        senderId: string,
        pauseMinutes: number = 30
    ): Promise<boolean> {
        const cutoff = new Date(Date.now() - pauseMinutes * 60 * 1000);

        const recentManual = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'outgoing'),
                eq(messages.replyMethod, 'manual'),
                sql`${messages.createdAt} > ${cutoff}`
            ),
            orderBy: [desc(messages.createdAt)],
        });

        return !!recentManual;
    }

    /**
     * Map database record to Message interface
     */
    private mapToMessage(record: typeof messages.$inferSelect): Message {
        return {
            id: record.id,
            pageId: record.pageId ?? '',
            facebookMessageId: record.facebookMessageId,
            senderId: record.senderId,
            senderName: record.senderName ?? null,
            message: record.message,
            direction: record.direction as 'incoming' | 'outgoing',
            replied: record.replied ?? false,
            replyText: record.replyText,
            replyMethod: record.replyMethod as 'template' | 'ai' | 'manual' | null,
            createdTime: record.createdTime,
            repliedAt: record.repliedAt,
            createdAt: record.createdAt,
            needsAttention: record.needsAttention ?? false,
            flagReason: record.flagReason ?? null,
            aiIntent: record.aiIntent ?? null,
        };
    }
}

export const messagesService = new MessagesService();


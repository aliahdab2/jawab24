import { eq, desc, asc, and, sql, gt, ne, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { messages, pages, conversationPauses } from '../db/schema';
import { ConversationMessage } from '../types';
import { Message, DEFAULT_HANDOFF_PAUSE_MINUTES } from '@jawab24/shared';

/** DB connection or transaction — methods accepting this can participate in a transaction. */
type DbConn = typeof db;

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
    async getMessages(workspaceId: string, options?: {
        limit?: number;
        cursor?: string;
        direction?: 'incoming' | 'outgoing';
        replied?: boolean;
        resolved?: boolean;
        needsAttention?: boolean;
    }): Promise<{
        data: Message[];
        pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
    }> {
        const limit = options?.limit || 50;

        const workspacePages = await db.query.pages.findMany({
            where: eq(pages.workspaceId, workspaceId),
        });

        if (workspacePages.length === 0) {
            return {
                data: [],
                pagination: { hasMore: false, nextCursor: null, limit }
            };
        }

        const pageIds = workspacePages.map(p => p.id);

        // Build conditions
        const conditions = [
            sql`${messages.pageId} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`
        ];

        // Filter by direction if specified
        if (options?.direction) {
            conditions.push(eq(messages.direction, options.direction));
        }

        // Filter by replied status
        if (options?.replied !== undefined) {
            conditions.push(eq(messages.replied, options.replied));
        }

        // Filter by resolved status
        if (options?.resolved !== undefined) {
            conditions.push(eq(messages.resolved, options.resolved));
        }

        // Filter by needsAttention
        if (options?.needsAttention !== undefined) {
            conditions.push(eq(messages.needsAttention, options.needsAttention));
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
            // Update senderName if we have one and the record doesn't
            if (senderName && !existing.senderName) {
                await db.update(messages)
                    .set({ senderName })
                    .where(eq(messages.facebookMessageId, facebookMessageId));
                existing.senderName = senderName;
            }
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
     * Look up a cached sender name from previous messages.
     * Returns the most recent non-null senderName for this sender, or null.
     */
    async getSenderNameBySenderId(pageId: string, senderId: string): Promise<string | null> {
        const row = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                isNotNull(messages.senderName),
            ),
            columns: { senderName: true },
            orderBy: [desc(messages.createdAt)],
        });
        return row?.senderName ?? null;
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
        aiIntent?: string,
        conn: DbConn = db
    ): Promise<void> {
        await conn.update(messages)
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
     * Flag a message as needing attention without marking it as replied
     */
    async flagMessage(
        messageId: string,
        flagReason?: string,
        aiIntent?: string,
    ): Promise<void> {
        await db.update(messages)
            .set({
                needsAttention: true,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
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
        replyMethod: 'template' | 'ai' | 'manual',
        conn: DbConn = db
    ): Promise<Message> {
        const [newMessage] = await conn.insert(messages)
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
    async getUnrepliedMessages(workspaceId: string, limit: number = 10): Promise<Message[]> {
        const workspacePages = await db.query.pages.findMany({
            where: eq(pages.workspaceId, workspaceId),
        });

        if (workspacePages.length === 0) {
            return [];
        }

        const pageIds = workspacePages.map(p => p.id);

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
        replyMethod: 'template' | 'ai' | 'manual',
        conn: DbConn = db
    ): Promise<number> {
        const result = await conn.update(messages)
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
     * Resolve all unreplied incoming messages in a conversation.
     * Returns the number of messages resolved.
     */
    async resolveConversation(pageId: string, senderId: string): Promise<number> {
        const result = await db.update(messages)
            .set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                eq(messages.resolved, false)
            ))
            .returning({ id: messages.id });
        return result.length;
    }

    /**
     * Unresolve all resolved incoming messages in a conversation.
     * Returns the number of messages unresolved.
     */
    async unresolveConversation(pageId: string, senderId: string): Promise<number> {
        const result = await db.update(messages)
            .set({ resolved: false, updatedAt: new Date() })
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.resolved, true)
            ))
            .returning({ id: messages.id });
        return result.length;
    }

    /**
     * Get message statistics
     * Uses PostgreSQL FILTER (WHERE ...) to get all counts in a single query
     */
    async getStats(workspaceId: string): Promise<{
        total: number;
        replied: number;
        pending: number;
        resolved: number;
        needsAttention: number;
        autoReplied: number;
        byMethod: { template: number; ai: number; manual: number };
    }> {
        const result = await db
            .select({
                total:          sql<number>`count(*)`,
                replied:        sql<number>`count(*) FILTER (WHERE ${messages.replied} = true)`,
                resolved:       sql<number>`count(*) FILTER (WHERE ${messages.resolved} = true)`,
                needsAttention: sql<number>`count(*) FILTER (WHERE ${messages.needsAttention} = true AND ${messages.resolved} = false)`,
                ai:             sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'ai')`,
                template:       sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'template')`,
                manual:         sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'manual')`,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.workspaceId, workspaceId),
                eq(messages.direction, 'incoming')
            ));

        const row = result[0];
        const total = Number(row?.total || 0);

        if (total === 0) {
            return { total: 0, replied: 0, pending: 0, resolved: 0, needsAttention: 0, autoReplied: 0, byMethod: { template: 0, ai: 0, manual: 0 } };
        }

        const replied = Number(row?.replied || 0);
        const resolved = Number(row?.resolved || 0);
        const ai = Number(row?.ai || 0);
        const template = Number(row?.template || 0);

        return {
            total,
            replied,
            pending: total - replied - resolved,
            resolved,
            needsAttention: Number(row?.needsAttention || 0),
            autoReplied: ai + template,
            byMethod: {
                template,
                ai,
                manual: Number(row?.manual || 0),
            },
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
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES
    ): Promise<boolean> {
        // 1. Check explicit pause (from UI "pause" button)
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) return true;

        // 2. Fallback: check if a manual reply was sent recently
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
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES
    ): Promise<number> {
        const now = Date.now();

        // 1. Check explicit pause
        const explicitPause = await this.getExplicitPause(pageId, senderId);
        if (explicitPause) {
            const remaining = explicitPause.pausedUntil.getTime() - now;
            return Math.max(0, remaining);
        }

        // 2. Check implicit pause (recent manual reply)
        const cutoff = new Date(now - pauseMinutes * 60 * 1000);
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

        if (recentManual?.createdAt) {
            const pauseExpiresAt = recentManual.createdAt.getTime() + pauseMinutes * 60 * 1000;
            const remaining = pauseExpiresAt - now;
            return Math.max(0, remaining);
        }

        return 0;
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
        pauseMinutes: number = DEFAULT_HANDOFF_PAUSE_MINUTES
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
            resolved: record.resolved ?? false,
        };
    }
}

export const messagesService = new MessagesService();


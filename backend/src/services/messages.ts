import { eq, desc, asc, and, or, sql, ne, isNotNull, count, max } from 'drizzle-orm';
import { db } from '../db';
import { messages, pages } from '../db/schema';
import { ConversationMessage } from '../types';
import { Message } from '@jawab24/shared';
import { conversationPauseService } from './conversationPause';

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
        actionRequired?: boolean;  // Composite: (unreplied & unresolved) OR (needsAttention & unresolved)
    }): Promise<{
        data: Message[];
        pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
    }> {
        const limit = options?.limit || 50;

        const workspacePages = await db.query.pages.findMany({
            where: and(
                eq(pages.workspaceId, workspaceId),
                or(eq(pages.autoReplyEnabled, true), eq(pages.instagramAutoReplyEnabled, true)),
            ),
            columns: { id: true },
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

        // Composite actionRequired filter: (unreplied & unresolved) OR (needsAttention & unresolved)
        if (options?.actionRequired) {
            conditions.push(eq(messages.resolved, false));
            conditions.push(sql`(${messages.replied} = false OR ${messages.needsAttention} = true)`);
        } else {
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
     * Check if this is the first incoming message from a sender to a page.
     * Used to gate greeting messages so they only fire on the first conversation,
     * not on every new message.
     */
    async isFirstIncomingMessage(pageId: string, senderId: string): Promise<boolean> {
        // Fetch at most 2 rows — if fewer than 2 exist, this is the first conversation.
        // Uses the composite idx_messages_sender_inbox index and short-circuits early.
        const rows = await db
            .select({ id: messages.id })
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
            ))
            .limit(2);
        return rows.length <= 1;
    }

    /**
     * Get the most recent incoming text message from a sender (for language detection).
     * Skips placeholder messages (e.g. "[Voice Message]") that start with "[".
     */
    async getLastIncomingTextFromSender(pageId: string, senderId: string): Promise<string | null> {
        const rows = await db
            .select({ message: messages.message })
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
            ))
            .orderBy(desc(messages.createdAt))
            .limit(5);

        // Return the first message that isn't a placeholder
        const textRow = rows.find(r => r.message && !r.message.startsWith('['));
        return textRow?.message ?? null;
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
        conn: DbConn = db,
        aiOriginalReply?: string,
    ): Promise<void> {
        await conn.update(messages)
            .set({
                replied: true,
                replyText,
                replyMethod,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                aiIntent: aiIntent ?? null,
                aiOriginalReply: aiOriginalReply ?? null,
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
            columns: { id: true },
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
     * Get a brief summary of a returning customer's history.
     * Returns undefined for first-time customers.
     */
    async getCustomerSummary(pageId: string, senderId: string): Promise<string | undefined> {
        const stats = await db.select({
            totalMessages: count(),
            lastSeen: max(messages.createdAt),
        })
        .from(messages)
        .where(and(
            eq(messages.pageId, pageId),
            eq(messages.senderId, senderId),
            eq(messages.direction, 'incoming'),
        ));

        const { totalMessages, lastSeen } = stats[0] || {};
        if (!totalMessages || totalMessages <= 1) return undefined;

        const pastIntents = await db.selectDistinct({ intent: messages.aiIntent })
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                isNotNull(messages.aiIntent),
            ))
            .limit(5);

        const intents = pastIntents.map(r => r.intent).filter(Boolean).join(', ');
        const daysSince = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000) : null;
        const daysAgo = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;

        return `Returning customer (${totalMessages} previous messages, last active ${daysAgo}${intents ? `, past topics: ${intents}` : ''}).`;
    }

    /**
     * Detect if the current message is a repeat question — customer asking
     * the same thing again shortly after receiving an AI reply.
     *
     * Returns true if:
     * 1. Last outgoing message was an AI reply, sent < 5 min ago
     * 2. Current message text is similar to the incoming message that
     *    preceded that AI reply (pg_trgm similarity ≥ 0.4)
     *
     * This is a strong signal that the AI reply failed.
     */
    async isRepeatQuestion(
        pageId: string,
        senderId: string,
        currentText: string,
    ): Promise<boolean> {
        try {
            // Get last 4 messages (should include: customer Q → AI reply → current Q)
            const recent = await db.query.messages.findMany({
                where: and(
                    eq(messages.pageId, pageId),
                    eq(messages.senderId, senderId),
                ),
                orderBy: [desc(messages.createdAt)],
                limit: 4,
                columns: { id: true, message: true, direction: true, replyMethod: true, createdAt: true },
            });

            if (recent.length < 2) return false;

            // Find the most recent outgoing AI reply
            const lastOutgoing = recent.find(m => m.direction === 'outgoing' && m.replyMethod === 'ai');
            if (!lastOutgoing?.createdAt) return false;

            // Must be within 5 minutes
            const ageMs = Date.now() - new Date(lastOutgoing.createdAt).getTime();
            if (ageMs > 5 * 60 * 1000) return false;

            // Find the incoming message that preceded the AI reply
            const outgoingIdx = recent.indexOf(lastOutgoing);
            const precedingIncoming = recent.slice(outgoingIdx + 1).find(m => m.direction === 'incoming');
            if (!precedingIncoming?.message) return false;

            // Compare current message with the preceding question using pg_trgm
            const result = await db.execute(
                sql`SELECT similarity(${currentText}, ${precedingIncoming.message}) as sim`
            );
            const sim = (result as unknown as Array<{ sim: number }>)?.[0]?.sim ?? 0;

            return sim >= 0.4;
        } catch {
            return false; // Never block the pipeline for detection failures
        }
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
            limit: 50,
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
     * Resolve all unresolved incoming messages in a conversation.
     * Returns the number of messages resolved.
     */
    async resolveConversation(pageId: string, senderId: string): Promise<number> {
        const result = await db.update(messages)
            .set({ resolved: true, updatedAt: new Date() })
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
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
        actionRequired: number;
        autoReplied: number;
        repliedToday: number;
        byMethod: { template: number; ai: number; manual: number };
        // Conversation-level counts (COUNT DISTINCT sender_id) for tab labels
        convTotal: number;
        convActionRequired: number;
        convAutoReplied: number;
        convHandled: number;
    }> {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const result = await db
            .select({
                // Message-level counts (for analytics, dashboard, billing)
                total:          sql<number>`count(*)`,
                replied:        sql<number>`count(*) FILTER (WHERE ${messages.replied} = true)`,
                resolved:       sql<number>`count(*) FILTER (WHERE ${messages.resolved} = true)`,
                needsAttention: sql<number>`count(*) FILTER (WHERE ${messages.needsAttention} = true AND ${messages.resolved} = false)`,
                actionRequired: sql<number>`count(*) FILTER (WHERE ${messages.resolved} = false AND (${messages.replied} = false OR ${messages.needsAttention} = true))`,
                repliedToday:   sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.repliedAt} >= ${todayStart})`,
                ai:             sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'ai')`,
                template:       sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'template')`,
                manual:         sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'manual')`,
                // Conversation-level counts (for tab labels — matches what the user sees in the list)
                convTotal:          sql<number>`count(DISTINCT ${messages.senderId})`,
                convActionRequired: sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.resolved} = false AND (${messages.replied} = false OR ${messages.needsAttention} = true))`,
                convAutoReplied:    sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.replied} = true)`,
                convHandled:        sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.resolved} = true)`,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                eq(pages.workspaceId, workspaceId),
                eq(messages.direction, 'incoming'),
                or(eq(pages.autoReplyEnabled, true), eq(pages.instagramAutoReplyEnabled, true)),
            ));

        const row = result[0];
        const total = Number(row?.total || 0);
        const emptyByMethod = { template: 0, ai: 0, manual: 0 };

        if (total === 0) {
            return { total: 0, replied: 0, pending: 0, resolved: 0, needsAttention: 0, actionRequired: 0, autoReplied: 0, repliedToday: 0, byMethod: emptyByMethod, convTotal: 0, convActionRequired: 0, convAutoReplied: 0, convHandled: 0 };
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
            actionRequired: Number(row?.actionRequired || 0),
            autoReplied: ai + template,
            repliedToday: Number(row?.repliedToday || 0),
            byMethod: {
                template,
                ai,
                manual: Number(row?.manual || 0),
            },
            convTotal: Number(row?.convTotal || 0),
            convActionRequired: Number(row?.convActionRequired || 0),
            convAutoReplied: Number(row?.convAutoReplied || 0),
            convHandled: Number(row?.convHandled || 0),
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
            platform: (result.platform || 'facebook') as 'facebook' | 'instagram',
        };
    }

    // ── Pause / resume — delegated to ConversationPauseService ──

    isPaused = conversationPauseService.isPaused.bind(conversationPauseService);
    getRemainingPauseMs = conversationPauseService.getRemainingPauseMs.bind(conversationPauseService);
    pauseConversation = conversationPauseService.pauseConversation.bind(conversationPauseService);
    resumeConversation = conversationPauseService.resumeConversation.bind(conversationPauseService);
    getPauseStatus = conversationPauseService.getPauseStatus.bind(conversationPauseService);

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
            aiOriginalReply: record.aiOriginalReply ?? null,
            resolved: record.resolved ?? false,
            platform: (record.platform || 'facebook') as 'facebook' | 'instagram',
        };
    }
}

export const messagesService = new MessagesService();


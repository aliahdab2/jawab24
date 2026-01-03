import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { messages, pages } from '../db/schema';
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
     * Get all messages for a user's pages
     */
    async getMessages(userId: string, limit: number = 50): Promise<Message[]> {
        const userPages = await db.query.pages.findMany({
            where: eq(pages.userId, userId),
        });

        if (userPages.length === 0) {
            return [];
        }

        const pageIds = userPages.map(p => p.id);

        const result = await db.query.messages.findMany({
            where: sql`${messages.pageId} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`,
            orderBy: [desc(messages.createdAt)],
            limit,
        });

        return result.map(this.mapToMessage);
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
        replyMethod: 'template' | 'ai' | 'manual'
    ): Promise<void> {
        await db.update(messages)
            .set({
                replied: true,
                replyText,
                replyMethod,
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
     * Get message statistics
     */
    async getStats(userId: string): Promise<{
        total: number;
        replied: number;
        pending: number;
    }> {
        const userPages = await db.query.pages.findMany({
            where: eq(pages.userId, userId),
        });

        if (userPages.length === 0) {
            return { total: 0, replied: 0, pending: 0 };
        }

        const pageIds = userPages.map(p => p.id);

        const allMessages = await db.query.messages.findMany({
            where: and(
                sql`${messages.pageId} IN (${sql.join(pageIds.map(id => sql`${id}`), sql`, `)})`,
                eq(messages.direction, 'incoming')
            ),
        });

        const total = allMessages.length;
        const replied = allMessages.filter(m => m.replied).length;
        const pending = total - replied;

        return { total, replied, pending };
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
        };
    }
}

export const messagesService = new MessagesService();


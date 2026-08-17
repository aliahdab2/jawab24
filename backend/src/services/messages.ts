import { eq, desc, asc, and, sql, ne, isNotNull, inArray, count, max } from 'drizzle-orm';
import { db } from '../db';
import { messages, pages, conversations } from '../db/schema';
import { ConversationMessage } from '../types';
import { Message } from '@jawab24/shared';
import { conversationPauseService } from './conversationPause';
import { conversationsService, type Platform } from './conversations';
import { ENDPOINT_STATS_CACHE_TTL, messagesStatsCacheKey, withStatsCache, statsEpochKey } from './statsCache';
import { isUniqueViolation } from '../utils/dbErrors';

/** DB connection or transaction — methods accepting this can participate in a transaction.
 * The tx side is derived from db.transaction's callback parameter rather than spelled out
 * (drizzle-orm 0.45 made PgTransaction structurally incompatible with the db type — $client). */
type DbConn = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MessageStats {
    total: number;
    replied: number;
    pending: number;
    resolved: number;
    needsAttention: number;
    actionRequired: number;
    autoReplied: number;
    repliedToday: number;
    byMethod: { template: number; ai: number; manual: number; postReply: number };
    // Today's replies split by method — feeds the dashboard's "Replied Today"
    // breakdown line (Smart vs Post Reply). Only the two methods the UI shows.
    repliedTodayByMethod: { ai: number; postReply: number };
    // Conversation-level counts (COUNT DISTINCT sender_id) for tab labels
    convTotal: number;
    convActionRequired: number;
    convAutoReplied: number;
    convHandled: number;
}

export interface CreateMessageDTO {
    pageId: string;
    workspaceId: string;
    platformMessageId: string;
    senderId: string;
    senderName?: string;
    message: string;
    direction?: 'incoming' | 'outgoing';
    platform?: string;
    attachmentType?: string;
    /** Store-then-enrich lifecycle marker. Only 'pending' is ever set at insert
     *  time (by nonTextHandler when an attachment will be enriched); everything
     *  else leaves it NULL. See messages schema + finalizeEnrichment. */
    enrichmentStatus?: 'pending';
}

export class MessagesService {
    /**
     * Scope predicates shared by list and stats — extracted so the two can never
     * disagree on what "the workspace's messages" means. Adding a new scope
     * dimension only needs editing here.
     */
    private scopeConditions(workspaceId: string, pageId?: string) {
        const conds = [
            eq(messages.workspaceId, workspaceId),
            // Any-channel gate: a WhatsApp-only page has both FB toggles false,
            // so omitting the whatsapp toggle here would hide its entire inbox.
            sql`(${pages.autoReplyEnabled} = true OR ${pages.instagramAutoReplyEnabled} = true OR ${pages.whatsappAutoReplyEnabled} = true)`,
        ];
        if (pageId) conds.push(eq(messages.pageId, pageId));
        return conds;
    }

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
        pageId?: string;  // Filter by specific page
    }): Promise<{
        data: Message[];
        pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
    }> {
        const limit = options?.limit || 50;

        // Filter on messages.workspace_id (denormalized) so the composite index
        // idx_messages_workspace_created_at drives the seek. The pages JOIN is still
        // required to enforce the per-page autoReplyEnabled gate, but it now reduces
        // a much smaller candidate set.
        const conditions = this.scopeConditions(workspaceId, options?.pageId);

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

        // LEFT JOIN conversations so we surface the canonical sender_name. COALESCE
        // against the legacy per-message column keeps things working during the Tier A
        // transition even if a row isn't yet linked (pre-backfill / partial migration).
        // INNER JOIN pages enforces the per-page autoReplyEnabled gate (filter is in conditions).
        const rows = await db
            .select({
                msg: messages,
                convSenderName: conversations.senderName,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .leftJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(and(...conditions))
            .orderBy(desc(messages.createdAt))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].msg.id : null;

        return {
            data: data.map(r => this.mapJoinedToMessage(r.msg, r.convSenderName)),
            pagination: { hasMore, nextCursor, limit }
        };
    }

    /**
     * Get messages for a specific page (with conversation sender_name hydrated)
     */
    async getMessagesByPage(pageId: string, limit: number = 50): Promise<Message[]> {
        const rows = await db
            .select({
                msg: messages,
                convSenderName: conversations.senderName,
            })
            .from(messages)
            .leftJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(eq(messages.pageId, pageId))
            .orderBy(desc(messages.createdAt))
            .limit(limit);

        return rows.map(r => this.mapJoinedToMessage(r.msg, r.convSenderName));
    }

    /**
     * Get conversation with a specific sender (with canonical sender_name)
     */
    async getConversation(pageId: string, senderId: string, limit: number = 50): Promise<Message[]> {
        // Sort by platform-reported send time (created_time) with DB insert time
        // (created_at) as a tiebreaker. Using created_at alone surfaced an
        // ordering bug where an image's auto-reply nudge appeared ABOVE the
        // image itself — the non-text handler's pre-store steps (Graph API
        // fetch_sender_name, etc.) sometimes delayed the image insert past the
        // outgoing nudge insert from a sibling event. created_time reflects the
        // moment FB/IG reports the customer hit send, so it can't be skewed by
        // our processing latency. Outgoing messages also set created_time
        // (= our send time), so the ordering is consistent across directions.
        const rows = await db
            .select({
                msg: messages,
                convSenderName: conversations.senderName,
            })
            .from(messages)
            .leftJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
            ))
            .orderBy(sql`COALESCE(${messages.createdTime}, ${messages.createdAt}) DESC, ${messages.createdAt} DESC`)
            .limit(limit);

        return rows.map(r => this.mapJoinedToMessage(r.msg, r.convSenderName));
    }

    /**
     * Create a new message record.
     *
     * Also upserts a conversation row for (pageId, senderId) and links the message
     * to it via conversation_id. The conversation is the canonical source of truth
     * for senderName — see docs/comment-and-message-handling.md → "Conversations".
     *
     * senderName is still written onto the message row as a legacy fallback during
     * the Tier A transition period; Tier B/C will drop that column.
     */
    async createMessage(data: CreateMessageDTO): Promise<Message> {
        const platform: Platform = (data.platform as Platform) || 'facebook';
        const conversation = await conversationsService.findOrCreate(
            data.pageId, data.senderId, platform, data.senderName,
        );

        const [newMessage] = await db.insert(messages)
            .values({
                pageId: data.pageId,
                workspaceId: data.workspaceId,
                conversationId: conversation.id,
                platformMessageId: data.platformMessageId,
                senderId: data.senderId,
                senderName: data.senderName,
                message: data.message,
                direction: data.direction || 'incoming',
                ...(data.platform ? { platform: data.platform } : {}),
                ...(data.attachmentType ? { attachmentType: data.attachmentType } : {}),
                ...(data.enrichmentStatus ? { enrichmentStatus: data.enrichmentStatus } : {}),
                createdTime: new Date(),
            })
            .returning();

        return this.mapToMessage(newMessage);
    }

    /**
     * Find or create a message from webhook.
     *
     * Idempotent against FB/IG webhook retries (which redeliver the same
     * platform_message_id on 5xx/timeout). Optimistic existence check returns
     * fast on retries; the unique constraint on platform_message_id is the
     * authoritative race guard for two concurrent first-time deliveries.
     */
    async findOrCreateFromWebhook(
        pageId: string,
        workspaceId: string,
        platformMessageId: string,
        senderId: string,
        messageText: string,
        senderName?: string,
        attachmentType?: string,
        platform?: string,
        enrichmentStatus?: 'pending',
    ): Promise<{ message: Message; isNew: boolean }> {
        const existing = await db.query.messages.findFirst({
            where: eq(messages.platformMessageId, platformMessageId),
        });

        if (existing) {
            if (senderName && !existing.senderName) {
                await db.update(messages)
                    .set({ senderName })
                    .where(eq(messages.id, existing.id));
                existing.senderName = senderName;
            }
            return { message: this.mapToMessage(existing), isNew: false };
        }

        try {
            const newMessage = await this.createMessage({
                pageId,
                workspaceId,
                platformMessageId,
                senderId,
                senderName,
                message: messageText,
                direction: 'incoming',
                platform,
                ...(attachmentType ? { attachmentType } : {}),
                ...(enrichmentStatus ? { enrichmentStatus } : {}),
            });
            return { message: newMessage, isNew: true };
        } catch (err) {
            // 23505 = unique_violation. Lost the race against a concurrent
            // webhook delivery of the same platform_message_id; the winner's
            // row is now visible — refetch and treat as already-seen.
            // NOT a bare `.code` read — drizzle wraps the driver error (see utils/dbErrors).
            if (isUniqueViolation(err)) {
                const winner = await db.query.messages.findFirst({
                    where: eq(messages.platformMessageId, platformMessageId),
                });
                if (winner) {
                    return { message: this.mapToMessage(winner), isNew: false };
                }
            }
            throw err;
        }
    }

    /**
     * Finalize a store-then-enrich attachment row: flip `enrichment_status` off
     * 'pending' and (on success) replace the placeholder `message` with the real
     * enriched content — atomically, in one UPDATE.
     *
     * Guarded on `enrichment_status = 'pending'` so a duplicate/late webhook
     * redelivery (or a retry) can never clobber an already-finalized row. Returns
     * false when nothing was updated (already finalized / not a pending row) so the
     * caller can log the anomaly. On 'failed' the `text` arg is omitted and the
     * placeholder text stands.
     */
    async finalizeEnrichment(
        messageId: string,
        status: 'done' | 'failed',
        text?: string,
    ): Promise<boolean> {
        const result = await db.update(messages)
            .set({
                enrichmentStatus: status,
                ...(text !== undefined ? { message: text } : {}),
                updatedAt: new Date(),
            })
            .where(and(
                eq(messages.id, messageId),
                eq(messages.enrichmentStatus, 'pending'),
            ))
            .returning({ id: messages.id });
        return result.length > 0;
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
     * True if the bot has already sent at least one outgoing message to this sender.
     *
     * Used to gate the opener-tap greeting: in dual/private comment-reply mode the
     * bot may have already DMed the customer the private reply to their comment
     * (stored as an OUTGOING row — see commentProcessor.storeOutgoingMessage). Those
     * customers are not fresh contacts and must not be greeted. Also makes the
     * greeting send idempotent across job retries (a re-run sees the prior outgoing
     * row).
     */
    async hasOutgoingMessage(pageId: string, senderId: string): Promise<boolean> {
        const rows = await db
            .select({ id: messages.id })
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'outgoing'),
            ))
            .limit(1);
        return rows.length > 0;
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
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        conn: DbConn = db,
        aiOriginalReply?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
    ): Promise<void> {
        await conn.update(messages)
            .set({
                replied: true,
                replyText,
                replyMethod,
                needsAttention: needsAttention ?? false,
                flagReason: flagReason ?? null,
                flagMeta: flagMeta ?? null,
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
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
    ): Promise<void> {
        await db.update(messages)
            .set({
                needsAttention: true,
                flagReason: flagReason ?? null,
                flagMeta: flagMeta ?? null,
                aiIntent: aiIntent ?? null,
                updatedAt: new Date(),
            })
            .where(eq(messages.id, messageId));
    }

    /**
     * Store outgoing reply as a message.
     *
     * Looks up (or creates) the conversation for (pageId, senderId) and links the
     * message to it via conversation_id. The conversation carries the canonical
     * senderName — we copy it onto the message row too for legacy-compat during
     * Tier A; Tier B/C drops that duplication.
     *
     * Without this, the UI's conversation grouping used to show "Unknown User" for
     * senders whose recent fetch page contained only outgoing messages.
     */
    /**
     * Look up an outgoing message previously stored under (pageId, clientMessageId).
     * Used by the manual-reply controller to dedupe retries from flaky-network clients
     * before re-hitting the FB/IG Graph API.
     */
    async findOutgoingByClientMessageId(pageId: string, clientMessageId: string): Promise<Message | null> {
        const row = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.clientMessageId, clientMessageId),
                eq(messages.direction, 'outgoing'),
            ),
        });
        return row ? this.mapToMessage(row) : null;
    }

    /**
     * Look up any message by the platform's own id, in either direction.
     *
     * `platform_message_id` is NOT NULL + UNIQUE, so this doubles as the
     * idempotency check for redelivered webhooks (Meta retries on 5xx/timeout)
     * and as a defensive guard that a WhatsApp Coexistence echo is not something
     * we sent ourselves. Meta documents that echoes exclude Cloud API messages,
     * so the second case should be unreachable — but treating one of our own
     * replies as a merchant reply would make the AI mute itself after every
     * message, which is severe enough to check for rather than trust.
     */
    async findByPlatformMessageId(platformMessageId: string): Promise<Message | null> {
        const row = await db.query.messages.findFirst({
            where: eq(messages.platformMessageId, platformMessageId),
        });
        return row ? this.mapToMessage(row) : null;
    }

    async storeOutgoingMessage(
        pageId: string,
        workspaceId: string,
        senderId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        conn: DbConn = db,
        senderName?: string,
        originContentId?: string,
        clientMessageId?: string,
        // Informational metadata for the outgoing bubble (e.g. reply_shortened —
        // the truncation-retry badge). Distinct from the incoming row's alarm
        // flagMeta set via markAsReplied; never implies needs_attention.
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
        // The platform's OWN id for this outgoing message (WhatsApp `wamid`), when
        // the channel returns one. Stored so an inbound echo of this same message
        // can be recognised as ours rather than as a human reply — the WhatsApp
        // Coexistence case, where Meta echoes API-sent messages back alongside the
        // merchant's phone-sent ones. Absent → the synthetic id below, unchanged.
        platformMessageId?: string,
    ): Promise<Message> {
        // Platform unknown in this call — inherit from existing conversation if present,
        // default to 'facebook' otherwise. This is safe because we never overwrite the
        // platform of an existing conversation via findOrCreate.
        //
        // Name resolution priority:
        //   1. Caller-supplied senderName (comment webhook's fromName) — freshest truth
        //   2. Existing conversation's senderName — previously-resolved
        //   3. Legacy scan of messages.sender_name — transitional fallback
        //
        // Without (1), comment-triggered DMs create conversations with null senderName
        // because there's no prior incoming message for this sender — the customer only
        // commented, never DM'd. That showed as "Unknown User" in the dashboard.
        //
        // `originContentId` records the post/media that triggered this DM (comment→DM).
        // First-write-wins at the conversation layer so follow-up DMs keep the post context.
        const existing = await conversationsService.findByPageAndSender(pageId, senderId);
        const platform: Platform = existing?.platform ?? 'facebook';
        const resolvedName = senderName ?? existing?.senderName ?? await this.getSenderNameBySenderId(pageId, senderId);
        const conversation = await conversationsService.findOrCreate(pageId, senderId, platform, resolvedName, originContentId);

        const [newMessage] = await conn.insert(messages)
            .values({
                pageId,
                workspaceId,
                conversationId: conversation.id,
                // Real platform id when the channel gave us one; otherwise a synthetic
                // unique value (the column is NOT NULL + UNIQUE and predates any channel
                // returning an id).
                platformMessageId: platformMessageId || `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                // Without this the column defaulted to 'facebook', mislabeling every
                // outgoing WhatsApp/Instagram reply (found in the 2026-07-08 pilot).
                platform: conversation.platform ?? platform,
                senderId,
                ...(conversation.senderName ?? resolvedName ? { senderName: conversation.senderName ?? resolvedName } : {}),
                message: replyText,
                direction: 'outgoing',
                replied: true,
                replyText,
                replyMethod,
                ...(clientMessageId ? { clientMessageId } : {}),
                ...(flagMeta ? { flagMeta } : {}),
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
        // Direct workspace_id filter — no separate page lookup or IN-clause expansion.
        const result = await db.query.messages.findMany({
            where: and(
                eq(messages.workspaceId, workspaceId),
                eq(messages.replied, false),
                eq(messages.direction, 'incoming'),
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
            where: eq(messages.platformMessageId, currentMessageId),
        });
        if (!currentMsg?.createdAt) return false;

        const newer = await db.query.messages.findFirst({
            where: and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
                eq(messages.replied, false),
                ne(messages.id, currentMsg.id),
                sql`${messages.createdAt} > ${currentMsg.createdAt}`,
                // Only defer to a newer message whose reply job is guaranteed to
                // exist: NULL (plain text — enqueued by the webhook) or 'done' (its
                // job is enqueued right after enrichment finalizes). A 'pending' stub
                // has no job yet and a 'failed' stub never gets one, so deferring to
                // either would strand this message with no reply. See store-then-enrich.
                sql`(${messages.enrichmentStatus} IS NULL OR ${messages.enrichmentStatus} = 'done')`
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
    ): Promise<{ id: string; message: string; platformMessageId: string; enrichmentStatus: string | null; createdAt: Date | null }[]> {
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
        // enrichmentStatus + createdAt are returned so messageProcessor can PARK
        // when a sibling attachment row is still 'pending' (store-then-enrich).
        return result.map(r => ({
            id: r.id,
            message: r.message,
            platformMessageId: r.platformMessageId,
            enrichmentStatus: r.enrichmentStatus ?? null,
            createdAt: r.createdAt ?? null,
        }));
    }

    /**
     * Mark the messages that were consolidated into a single reply as replied.
     *
     * Scoped to the EXACT ids seen at consolidation (step 11), not "everything
     * unreplied from this sender". This is load-bearing: a sibling attachment row
     * can land in the DB between consolidation and this UPDATE (its enrichment
     * finishing mid-AI-generation). The old blanket predicate swept that fresh row
     * `replied=true` under a reply that never saw it — a silent drop. Scoping to
     * `consolidatedIds` leaves the late row `replied=false`, so the orphan recheck
     * (or the attachment's own job) still answers it.
     *
     * `replied=false` is kept as an idempotency guard; the pageId/senderId/direction
     * predicates stay as defense-in-depth.
     */
    async markOlderMessagesAsReplied(
        pageId: string,
        senderId: string,
        consolidatedIds: string[],
        excludeMessageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        conn: DbConn = db
    ): Promise<number> {
        const targetIds = consolidatedIds.filter(id => id !== excludeMessageId);
        if (targetIds.length === 0) return 0;

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
                inArray(messages.id, targetIds)
            ))
            .returning({ id: messages.id });
        return result.length;
    }

    /**
     * Stamp a row's `created_time` with the platform-reported send time.
     *
     * The webhook controller calls this immediately after persisting a new
     * incoming message so the chat sorts by FB/IG send time, not DB insert
     * time. Without this, a slow non-text handler (e.g. blocked on a Graph
     * API fetch_sender_name call) could insert the image row AFTER the
     * outgoing nudge it triggered, rendering the nudge above the image.
     *
     * Kept as a small post-write update (instead of a parameter on
     * findOrCreateFromWebhook) to avoid bloating that function's already-long
     * positional signature and to keep the existing call-shape tests stable.
     */
    async setCreatedTime(messageId: string, createdTime: Date): Promise<void> {
        await db.update(messages)
            .set({ createdTime })
            .where(eq(messages.id, messageId));
    }

    /**
     * Mark a single message as resolved. Used by paths that store an incoming
     * message but intentionally do not reply (e.g. stickers / 👍 like-button),
     * so the escalation cron does not later flag it as "needs attention".
     */
    async markAsResolved(messageId: string): Promise<void> {
        await db.update(messages)
            .set({ resolved: true, updatedAt: new Date() })
            .where(eq(messages.id, messageId));
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
    async getStats(workspaceId: string, options?: { pageId?: string }): Promise<MessageStats> {
        // The aggregation below scans the workspace's full message history
        // (hundreds of thousands of rows for large workspaces), so the
        // workspace-wide variant is cached briefly. Page-filtered calls are
        // rare and skip the cache. Invalidation: see services/statsCache.ts.
        const cacheKey = options?.pageId ? null : messagesStatsCacheKey(workspaceId);
        return withStatsCache(
            cacheKey,
            ENDPOINT_STATS_CACHE_TTL,
            () => this.computeStats(workspaceId, options),
            // CAS-guard the write: this count drives a chip with no polling,
            // so a snapshot that lost its race must be dropped, not cached.
            statsEpochKey(workspaceId),
        );
    }

    private async computeStats(workspaceId: string, options?: { pageId?: string }): Promise<MessageStats> {
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
                aiToday:        sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.repliedAt} >= ${todayStart} AND ${messages.replyMethod} = 'ai')`,
                postReplyToday: sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.repliedAt} >= ${todayStart} AND ${messages.replyMethod} = 'post_reply')`,
                ai:             sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'ai')`,
                template:       sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'template')`,
                manual:         sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'manual')`,
                postReply:      sql<number>`count(*) FILTER (WHERE ${messages.replied} = true AND ${messages.replyMethod} = 'post_reply')`,
                // Conversation-level counts (for tab labels — matches what the user sees in the list)
                convTotal:          sql<number>`count(DISTINCT ${messages.senderId})`,
                convActionRequired: sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.resolved} = false AND (${messages.replied} = false OR ${messages.needsAttention} = true))`,
                convAutoReplied:    sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.replied} = true)`,
                convHandled:        sql<number>`count(DISTINCT ${messages.senderId}) FILTER (WHERE ${messages.resolved} = true)`,
            })
            .from(messages)
            .innerJoin(pages, eq(messages.pageId, pages.id))
            .where(and(
                ...this.scopeConditions(workspaceId, options?.pageId),
                eq(messages.direction, 'incoming'),
            ));

        const row = result[0];
        const total = Number(row?.total || 0);
        const emptyByMethod = { template: 0, ai: 0, manual: 0, postReply: 0 };

        if (total === 0) {
            return { total: 0, replied: 0, pending: 0, resolved: 0, needsAttention: 0, actionRequired: 0, autoReplied: 0, repliedToday: 0, byMethod: emptyByMethod, repliedTodayByMethod: { ai: 0, postReply: 0 }, convTotal: 0, convActionRequired: 0, convAutoReplied: 0, convHandled: 0 };
        }

        const replied = Number(row?.replied || 0);
        const resolved = Number(row?.resolved || 0);
        const ai = Number(row?.ai || 0);
        const template = Number(row?.template || 0);
        const postReply = Number(row?.postReply || 0);

        return {
            total,
            replied,
            pending: total - replied - resolved,
            resolved,
            needsAttention: Number(row?.needsAttention || 0),
            actionRequired: Number(row?.actionRequired || 0),
            autoReplied: ai + template + postReply,
            repliedToday: Number(row?.repliedToday || 0),
            byMethod: {
                template,
                ai,
                manual: Number(row?.manual || 0),
                postReply,
            },
            repliedTodayByMethod: {
                ai:        Number(row?.aiToday || 0),
                postReply: Number(row?.postReplyToday || 0),
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
            platform: (result.platform || 'facebook') as 'facebook' | 'instagram' | 'whatsapp',
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
    /**
     * Map a row that already carries a joined conversations.sender_name, preferring
     * that value (canonical source) and falling back to the denormalized message column.
     */
    private mapJoinedToMessage(record: typeof messages.$inferSelect, convSenderName: string | null): Message {
        return this.mapToMessage({ ...record, senderName: convSenderName ?? record.senderName });
    }

    private mapToMessage(record: typeof messages.$inferSelect): Message {
        return {
            id: record.id,
            pageId: record.pageId ?? '',
            platformMessageId: record.platformMessageId,
            senderId: record.senderId,
            senderName: record.senderName ?? null,
            message: record.message,
            direction: record.direction as 'incoming' | 'outgoing',
            replied: record.replied ?? false,
            replyText: record.replyText,
            replyMethod: record.replyMethod as 'template' | 'ai' | 'manual' | 'post_reply' | null,
            createdTime: record.createdTime,
            repliedAt: record.repliedAt,
            createdAt: record.createdAt,
            needsAttention: record.needsAttention ?? false,
            flagReason: record.flagReason ?? null,
            flagMeta: (record.flagMeta as import('@jawab24/shared').FlagMeta | null) ?? null,
            aiIntent: record.aiIntent ?? null,
            aiOriginalReply: record.aiOriginalReply ?? null,
            resolved: record.resolved ?? false,
            platform: (record.platform || 'facebook') as 'facebook' | 'instagram' | 'whatsapp',
            attachmentType: record.attachmentType ?? null,
            enrichmentStatus: record.enrichmentStatus ?? null,
        };
    }
}

export const messagesService = new MessagesService();


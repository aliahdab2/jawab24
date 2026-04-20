import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { conversations } from '../db/schema';

export type Platform = 'facebook' | 'instagram' | 'whatsapp';

export interface Conversation {
    id: string;
    pageId: string;
    senderId: string;
    platform: Platform;
    senderName: string | null;
    originContentId: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

function mapRow(row: typeof conversations.$inferSelect): Conversation {
    return {
        id: row.id,
        pageId: row.pageId,
        senderId: row.senderId,
        platform: row.platform as Platform,
        senderName: row.senderName ?? null,
        originContentId: row.originContentId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/**
 * Canonical source of truth for per-sender conversation state on a page.
 * See docs/comment-and-message-handling.md → "Conversations normalization".
 */
export class ConversationsService {
    /**
     * Upsert a conversation for (pageId, senderId). If it exists, keep it and
     * update `senderName` only when we have a non-empty name and the stored one
     * is null/empty — that way a profile rename flows through without ever
     * overwriting a known good name with an empty one.
     *
     * `originContentId` follows the same first-write-wins rule: filled in on create
     * or when the existing value is NULL, never overwritten. Stores the posts.id
     * (Facebook) or instagram_media.id (Instagram) that triggered the DM; resolved
     * via the conversation's platform. Preserves the earliest known comment→DM
     * origin so follow-up DMs stay linked to the post the customer was asking about.
     */
    async findOrCreate(
        pageId: string,
        senderId: string,
        platform: Platform,
        senderName?: string | null,
        originContentId?: string | null,
    ): Promise<Conversation> {
        const hasName = senderName !== undefined && senderName !== null && senderName !== '';
        const hasOrigin = originContentId !== undefined && originContentId !== null && originContentId !== '';
        // ON CONFLICT: always tick updatedAt; when we have a new name/origin and the stored
        // one is null/empty, fill it in (COALESCE + NULLIF). When we don't have a value,
        // leave the column out of the set clause so the existing value is preserved as-is.
        const setClause: Record<string, unknown> = { updatedAt: new Date() };
        if (hasName) {
            setClause.senderName = sql`COALESCE(NULLIF(${conversations.senderName}, ''), EXCLUDED.sender_name)`;
        }
        if (hasOrigin) {
            setClause.originContentId = sql`COALESCE(${conversations.originContentId}, EXCLUDED.origin_content_id)`;
        }
        const [row] = await db
            .insert(conversations)
            .values({
                pageId,
                senderId,
                platform,
                senderName: hasName ? senderName : null,
                originContentId: hasOrigin ? originContentId : null,
            })
            .onConflictDoUpdate({
                target: [conversations.pageId, conversations.senderId],
                set: setClause,
            })
            .returning();
        return mapRow(row);
    }

    /**
     * Idempotent setter. If the customer changed their Facebook display name and
     * we detect it, this writes the new value unconditionally (only when non-empty).
     * Distinct from findOrCreate which only fills in NULLs — use this when we trust
     * the new name (e.g. fresh /me API response).
     */
    async setSenderName(pageId: string, senderId: string, senderName: string): Promise<void> {
        if (!senderName) return;
        await db
            .update(conversations)
            .set({ senderName, updatedAt: new Date() })
            .where(and(
                eq(conversations.pageId, pageId),
                eq(conversations.senderId, senderId),
            ));
    }

    /** Look up the canonical senderName for a (pageId, senderId). Returns null if no conversation yet. */
    async getSenderName(pageId: string, senderId: string): Promise<string | null> {
        const row = await db.query.conversations.findFirst({
            where: and(
                eq(conversations.pageId, pageId),
                eq(conversations.senderId, senderId),
            ),
            columns: { senderName: true },
        });
        return row?.senderName ?? null;
    }

    /** Find a conversation by its (pageId, senderId) key. Returns null if not yet created. */
    async findByPageAndSender(pageId: string, senderId: string): Promise<Conversation | null> {
        const row = await db.query.conversations.findFirst({
            where: and(
                eq(conversations.pageId, pageId),
                eq(conversations.senderId, senderId),
            ),
        });
        return row ? mapRow(row) : null;
    }
}

export const conversationsService = new ConversationsService();

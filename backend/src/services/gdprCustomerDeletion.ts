/**
 * GDPR end-customer data purge — shared by the Meta data-deletion callback
 * (real-time, per-user) and scripts/gdpr-batch-delete.ts (batch ID file).
 *
 * End customers (people who DM'd or commented on a merchant page) are keyed by
 * their Meta platform IDs: `sender_id` on DM tables, `from_id` on comment
 * tables. They are NOT app users — the merchant-account path
 * (authService.deleteUser via users.facebook_id) never touches these rows, so
 * a deletion request from an end customer requires this purge or the data
 * silently survives (Platform Terms Section 3(d)(i)).
 */
import { inArray } from 'drizzle-orm';
import { db } from '../db';
import {
    conversations,
    messages,
    conversationPauses,
    leads,
    comments,
    instagramComments,
} from '../db/schema';

/** Every end-customer table and the column holding the Meta platform ID. */
export const CUSTOMER_ID_TARGETS = [
    { name: 'conversations', table: conversations, col: conversations.senderId },
    { name: 'messages', table: messages, col: messages.senderId },
    { name: 'conversation_pauses', table: conversationPauses, col: conversationPauses.senderId },
    { name: 'leads', table: leads, col: leads.senderId },
    { name: 'comments', table: comments, col: comments.fromId },
    { name: 'instagram_comments', table: instagramComments, col: instagramComments.fromId },
] as const;

// Children before conversations: deleting a conversation cascades its messages
// (messages.conversation_id ON DELETE CASCADE), which would make the per-table
// counts misleading. Deleting messages by sender_id first also catches legacy
// rows whose conversation_id is NULL.
const DELETE_ORDER = [
    'conversation_pauses',
    'leads',
    'comments',
    'instagram_comments',
    'messages',
    'conversations',
] as const;

const DELETE_SEQUENCE = DELETE_ORDER.map((name) => {
    const target = CUSTOMER_ID_TARGETS.find(t => t.name === name);
    if (!target) throw new Error(`gdprCustomerDeletion: unknown purge target '${name}'`);
    return target;
});

// Postgres caps bind parameters (~65535); keep IN-lists well under that.
const CHUNK = 1000;

export interface CustomerPurgeResult {
    /** Rows deleted per table (cascade-removed rows are not counted). */
    perTable: Record<string, number>;
    totalDeleted: number;
}

/**
 * Permanently delete every row keyed to the given Meta platform user IDs.
 * IDs with no data are silently skipped (Meta: "you can disregard these").
 */
export async function purgeCustomerData(platformUserIds: string[]): Promise<CustomerPurgeResult> {
    const perTable: Record<string, number> = {};
    let totalDeleted = 0;

    if (platformUserIds.length === 0) {
        return { perTable, totalDeleted };
    }

    for (const target of DELETE_SEQUENCE) {
        let deleted = 0;
        for (let i = 0; i < platformUserIds.length; i += CHUNK) {
            const batch = platformUserIds.slice(i, i + CHUNK);
            const removed = await db
                .delete(target.table)
                .where(inArray(target.col, batch))
                .returning({ id: target.table.id });
            deleted += removed.length;
        }
        perTable[target.name] = deleted;
        totalDeleted += deleted;
    }

    return { perTable, totalDeleted };
}

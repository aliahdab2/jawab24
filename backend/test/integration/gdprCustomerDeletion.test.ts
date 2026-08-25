/**
 * Integration tests for the GDPR end-customer purge (real Postgres).
 *
 * House pattern (see ecommerce-sync.test.ts): every DB operation is real.
 * These cover what unit mocks cannot — that the purge really removes rows in
 * every customer table, that the messages FK cascade wipes the page's own
 * replies inside a purged conversation, and that other customers' data on the
 * same page survives untouched.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
    createTestUser,
    createTestWorkspace,
    createTestPage,
    insertMessage,
    insertPause,
    insertPost,
    insertComment,
    insertInstagramMedia,
    insertInstagramComment,
    testDb,
} from './setup';
import * as schema from '../../src/db/schema';
import { purgeCustomerData } from '../../src/services/gdprCustomerDeletion';
import { uniq } from '../helpers/ecommerceFixtures';


async function countBySender(table: 'conversations' | 'messages' | 'conversationPauses' | 'leads', senderId: string) {
    const t = schema[table];
    const rows = await testDb.select({ id: t.id }).from(t).where(eq(t.senderId, senderId));
    return rows.length;
}

describe('purgeCustomerData (real Postgres)', () => {
    it('deletes every row of the requested customer and nothing else', async () => {
        const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('gdpr')}@test.com` });
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        const target = uniq('psid-target');
        const bystander = uniq('psid-bystander');

        // Target customer: DMs (incl. the page's own reply in the same thread),
        // a pause, a lead, an FB comment, and an IG comment.
        await insertMessage(page.id, target, { message: 'سؤال عن السعر' });
        await insertMessage(page.id, target, { message: 'متوفر؟' });
        const [targetConv] = await testDb.select().from(schema.conversations)
            .where(eq(schema.conversations.senderId, target));
        // Outgoing reply stored under the page's own sender id but inside the
        // target's conversation — must vanish via the FK cascade.
        const [pageReply] = await testDb.insert(schema.messages).values({
            pageId: page.id,
            workspaceId: workspace.id,
            conversationId: targetConv.id,
            senderId: page.facebookPageId!,
            platformMessageId: uniq('msg-out'),
            message: 'الرد',
            direction: 'outgoing',
            platform: 'facebook',
        }).returning();
        await insertPause(page.id, target, new Date(Date.now() + 60_000));
        await testDb.insert(schema.leads).values({
            pageId: page.id,
            senderId: target,
            phone: '0999999999',
        });
        const post = await insertPost(page.id);
        await insertComment(post.id, { fromId: target });
        const media = await insertInstagramMedia(page.id);
        await insertInstagramComment(media.id, { fromId: target });

        // Bystander customer on the same page: must survive.
        await insertMessage(page.id, bystander, { message: 'سؤال آخر' });
        await insertComment(post.id, { fromId: bystander });

        const result = await purgeCustomerData([target]);

        expect(result.perTable).toMatchObject({
            conversations: 1,
            // Only the target's own 2 messages are counted; the page reply goes
            // via cascade (not counted, asserted below).
            messages: 2,
            conversation_pauses: 1,
            leads: 1,
            comments: 1,
            instagram_comments: 1,
        });
        expect(result.totalDeleted).toBe(7);

        // Target fully gone — including the page's cascaded reply.
        expect(await countBySender('conversations', target)).toBe(0);
        expect(await countBySender('messages', target)).toBe(0);
        expect(await countBySender('conversationPauses', target)).toBe(0);
        expect(await countBySender('leads', target)).toBe(0);
        const cascaded = await testDb.select({ id: schema.messages.id }).from(schema.messages)
            .where(eq(schema.messages.id, pageReply.id));
        expect(cascaded.length).toBe(0);
        const fbComments = await testDb.select({ id: schema.comments.id }).from(schema.comments)
            .where(eq(schema.comments.fromId, target));
        expect(fbComments.length).toBe(0);
        const igComments = await testDb.select({ id: schema.instagramComments.id }).from(schema.instagramComments)
            .where(eq(schema.instagramComments.fromId, target));
        expect(igComments.length).toBe(0);

        // Bystander untouched.
        expect(await countBySender('conversations', bystander)).toBe(1);
        expect(await countBySender('messages', bystander)).toBe(1);
        const bystanderComments = await testDb.select({ id: schema.comments.id }).from(schema.comments)
            .where(eq(schema.comments.fromId, bystander));
        expect(bystanderComments.length).toBe(1);

        // Page and merchant intact.
        const [pageRow] = await testDb.select({ id: schema.pages.id }).from(schema.pages)
            .where(eq(schema.pages.id, page.id));
        expect(pageRow).toBeDefined();
    });

    it('returns zero counts for IDs with no data', async () => {
        const result = await purgeCustomerData([uniq('psid-unknown')]);
        expect(result.totalDeleted).toBe(0);
    });

    it('handles an empty ID list without touching the DB', async () => {
        const result = await purgeCustomerData([]);
        expect(result).toEqual({ perTable: {}, totalDeleted: 0 });
    });
});

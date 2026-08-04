/**
 * Meta ad referral attribution — DB semantics (real Postgres).
 *
 * Covers what the unit suite (src/__tests__/webhookReferral.test.ts) can't:
 *   - recordReferral creating the conversation row through the SAME findOrCreate
 *     upsert the message path uses (no second creation path);
 *   - FIRST-TOUCH precedence: a second referral never overwrites the first
 *     (the `referral_at IS NULL` guard);
 *   - the lead copy: maybeCaptureLead stamping conversations.referral_ad_id
 *     (fallback referral_ref) onto leads.source_ad_id, first-touch on the lead too;
 *   - the thread payload hydration: messagesService.getConversation surfacing
 *     the conversation's referral so the dashboard can read it.
 *
 * Only OpenAI is mocked (third-party external) — conversations, leads and
 * messages all hit the test DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// OpenAI is the sole external — stub it so lead AI-extraction is offline and
// deterministic (same pattern as leadExtractor.test.ts).
const openaiCreateMock = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));

import { randomUUID } from 'node:crypto';
import { conversationsService } from '../../src/services/conversations';
import { leadExtractorService } from '../../src/services/leadExtractor';
import { messagesService } from '../../src/services/messages';
import { createTestUser, createTestWorkspace, createTestPage, insertMessage, testDb } from './setup';
import { conversations, leads } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';

const FIRST_TOUCH = {
    source: 'ADS',
    ref: 'summer_sale',
    adId: '6045246247433',
    at: new Date('2026-08-01T10:00:00Z'),
};

describe('referral attribution (real Postgres)', () => {
    let userId: string;
    let workspaceId: string;
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const workspace = await createTestWorkspace(user.id);
        workspaceId = workspace.id;
        const page = await createTestPage(user.id, { workspaceId });
        pageId = page.id;
        openaiCreateMock.mockReset();
    });

    async function readConversation(senderId: string) {
        const [row] = await testDb
            .select()
            .from(conversations)
            .where(and(eq(conversations.pageId, pageId), eq(conversations.senderId, senderId)));
        return row;
    }

    describe('conversationsService.recordReferral', () => {
        it('creates the conversation row when the referral arrives before any message', async () => {
            const recorded = await conversationsService.recordReferral(pageId, 'psid-early', 'facebook', FIRST_TOUCH);
            expect(recorded).toBe(true);

            const row = await readConversation('psid-early');
            expect(row).toBeDefined();
            expect(row.platform).toBe('facebook');
            expect(row.referralSource).toBe('ADS');
            expect(row.referralRef).toBe('summer_sale');
            expect(row.referralAdId).toBe('6045246247433');
            expect(row.referralAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
        });

        it('FIRST-TOUCH: a second referral never overwrites the first', async () => {
            await conversationsService.recordReferral(pageId, 'psid-ft', 'facebook', FIRST_TOUCH);
            const second = await conversationsService.recordReferral(pageId, 'psid-ft', 'facebook', {
                source: 'SHORTLINK',
                ref: 'retargeting_wave2',
                adId: '111222333',
                at: new Date('2026-08-02T09:00:00Z'),
            });

            expect(second).toBe(false);
            const row = await readConversation('psid-ft');
            expect(row.referralSource).toBe('ADS');
            expect(row.referralRef).toBe('summer_sale');
            expect(row.referralAdId).toBe('6045246247433');
            expect(row.referralAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
        });

        it('attributes an EXISTING conversation without touching its senderName', async () => {
            await conversationsService.findOrCreate(pageId, 'psid-known', 'facebook', 'Known Customer');

            const recorded = await conversationsService.recordReferral(pageId, 'psid-known', 'facebook', FIRST_TOUCH);
            expect(recorded).toBe(true);

            const row = await readConversation('psid-known');
            expect(row.senderName).toBe('Known Customer');
            expect(row.referralAdId).toBe('6045246247433');
        });

        it('a partial referral (ref only, no ad) still claims the first touch', async () => {
            await conversationsService.recordReferral(pageId, 'psid-partial', 'facebook', {
                source: 'SHORTLINK', ref: 'qr_flyer', adId: null, at: new Date('2026-08-01T11:00:00Z'),
            });
            // A later, "richer" ad referral must NOT fill in on top — first touch
            // is a unit, not a per-column merge.
            const second = await conversationsService.recordReferral(pageId, 'psid-partial', 'facebook', FIRST_TOUCH);
            expect(second).toBe(false);

            const row = await readConversation('psid-partial');
            expect(row.referralSource).toBe('SHORTLINK');
            expect(row.referralAdId).toBeNull();
        });
    });

    describe('lead copy (maybeCaptureLead → leads.source_ad_id)', () => {
        function mockAiEmptyPhone() {
            openaiCreateMock.mockResolvedValue({
                choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'عميل مهتم', fields: [] }) } }],
                usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
            });
        }

        it('copies the conversation referral_ad_id onto a new lead', async () => {
            mockAiEmptyPhone();
            await conversationsService.recordReferral(pageId, 'cust-ad', 'facebook', FIRST_TOUCH);

            await leadExtractorService.maybeCaptureLead({
                pageId, userId, workspaceId,
                sourceId: randomUUID(), sourceType: 'message',
                senderId: 'cust-ad', senderName: 'Ad Customer',
                messageText: 'حابب أطلب، رقمي 0966554433',
            });

            const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
            expect(rows).toHaveLength(1);
            expect(rows[0].sourceAdId).toBe('6045246247433');
        });

        it('falls back to referral_ref for link campaigns that carry no ad id', async () => {
            mockAiEmptyPhone();
            await conversationsService.recordReferral(pageId, 'cust-ref', 'facebook', {
                source: 'SHORTLINK', ref: 'qr_flyer', adId: null, at: new Date(),
            });

            await leadExtractorService.maybeCaptureLead({
                pageId, userId, workspaceId,
                sourceId: randomUUID(), sourceType: 'message',
                senderId: 'cust-ref', senderName: 'Link Customer',
                messageText: 'رقمي 0966554434',
            });

            const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
            expect(rows).toHaveLength(1);
            expect(rows[0].sourceAdId).toBe('qr_flyer');
        });

        it('stays null when the conversation has no referral', async () => {
            mockAiEmptyPhone();

            await leadExtractorService.maybeCaptureLead({
                pageId, userId, workspaceId,
                sourceId: randomUUID(), sourceType: 'message',
                senderId: 'cust-organic', senderName: 'Organic Customer',
                messageText: 'رقمي 0966554435',
            });

            const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
            expect(rows).toHaveLength(1);
            expect(rows[0].sourceAdId).toBeNull();
        });

        it('FIRST-TOUCH on the lead: an existing attribution is never overwritten by a re-capture', async () => {
            mockAiEmptyPhone();
            // Lead already attributed to an earlier campaign…
            await testDb.insert(leads).values({
                pageId,
                sourceId: randomUUID(),
                sourceType: 'message',
                senderId: 'cust-return',
                senderName: 'Returning',
                phone: '+963966554436',
                extractedData: { fields: [] },
                status: 'new',
                extractionStatus: 'completed',
                sourceAdId: 'original-campaign-ad',
            });
            // …while the conversation now carries a different (first-touch) referral.
            await conversationsService.recordReferral(pageId, 'cust-return', 'facebook', FIRST_TOUCH);

            await leadExtractorService.maybeCaptureLead({
                pageId, userId, workspaceId,
                sourceId: randomUUID(), sourceType: 'message',
                senderId: 'cust-return', senderName: 'Returning',
                messageText: 'رقمي الجديد 0966554437',
            });

            const rows = await testDb.select().from(leads)
                .where(and(eq(leads.pageId, pageId), eq(leads.senderId, 'cust-return')));
            expect(rows).toHaveLength(1);
            expect(rows[0].sourceAdId).toBe('original-campaign-ad');
        });
    });

    describe('thread payload hydration (GET /messages/conversation/:senderId)', () => {
        it('surfaces the conversation referral on the thread messages', async () => {
            await insertMessage(pageId, 'cust-thread', { message: 'بكم السعر؟' });
            await conversationsService.recordReferral(pageId, 'cust-thread', 'facebook', FIRST_TOUCH);

            const thread = await messagesService.getConversation(pageId, 'cust-thread');
            expect(thread).toHaveLength(1);
            expect(thread[0].referral).toEqual({
                source: 'ADS',
                ref: 'summer_sale',
                adId: '6045246247433',
                at: new Date('2026-08-01T10:00:00Z'),
            });
        });

        it('omits the referral field entirely for unattributed conversations', async () => {
            await insertMessage(pageId, 'cust-noref', { message: 'مرحبا' });

            const thread = await messagesService.getConversation(pageId, 'cust-noref');
            expect(thread).toHaveLength(1);
            expect(thread[0].referral).toBeUndefined();
        });
    });
});

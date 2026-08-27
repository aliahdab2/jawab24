/**
 * A customer who proves an order is theirs is NOT a lead (real Postgres).
 *
 * Order tracking asks for identity: the Phase-2 verifiers take the name on the
 * order or the phone used when ordering, and `find_order_by_phone` (D-101)
 * REQUIRES phone + name in one call. Lead capture knew nothing about that
 * context, so every such answer created a "potential customer" card — with a
 * new-lead push behind it — for someone who had already bought. The merchant's
 * prospect list would fill with their own buyers the moment a real store
 * merchant arrived (found before launch: Zid in review, Salla submitting).
 *
 * The signal is same-turn and comes from the executed tool names
 * (`isIdentityVerificationTurn`), so it cannot mistake a phone typed for any
 * other reason — a Phase-1 `lookup_order` message is deliberately NOT covered.
 *
 * What is asserted here, at the READ path: no row is written, the AI extraction
 * never runs, the identical message WITHOUT the flag still captures (so the flag
 * is what decides, not the wording), and an ALREADY-EXISTING lead keeps being
 * enriched instead of being frozen or duplicated.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// OpenAI is the sole external — stub it so extraction is offline and deterministic.
const openaiCreateMock = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));

import { randomUUID } from 'node:crypto';
import { leadExtractorService } from '../../src/services/leadExtractor';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import { leads, messages } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

// The identity answer a Phase-2 verification produces: the name on the order and
// the phone used when ordering. Both halves are the customer's own — which is
// exactly why the phone gate accepts it and a lead used to be written.
const IDENTITY_ANSWER = 'اسمي أحمد ورقمي 0966554433';

const extractionReply = (summary: string, fields: Array<{ key: string; value: string }>) => ({
    choices: [{ message: { content: JSON.stringify({
        phone: '',
        summary,
        fields: fields.map(f => ({ key: f.key, label_en: f.key, label_ar: f.key, value: f.value })),
    }) } }],
    usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
});

describe('lead capture stays out of an order-verification turn (real Postgres)', () => {
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

    it('writes NO lead when the phone answered an identity challenge', async () => {
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-verify', senderName: 'أحمد',
            messageText: IDENTITY_ANSWER,
            identityVerificationTurn: true,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(0);
        // Suppression happens before extraction, so it costs no AI call either.
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('CONTROL: the identical message without the flag still creates a lead', async () => {
        // Same text, same sender, same page — only the turn context differs. This is
        // what proves the suppression is driven by the executed tool, not by anything
        // in the wording (and that the gate itself still works).
        openaiCreateMock.mockResolvedValue(extractionReply('العميل شارك رقمه', []));

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-verify', senderName: 'أحمد',
            messageText: IDENTITY_ANSWER,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('966554433');
    });

    it('an EXISTING lead is enriched, never duplicated, when that customer later verifies an order', async () => {
        // The prospect who went on to buy: they became a lead first, then came back
        // to track the order. Suppressing the second turn must not freeze their card —
        // re-extraction still merges what they said (it writes extractedData only,
        // never the phone, the status, or the follow-up flags).
        await testDb.insert(messages).values([
            {
                pageId, workspaceId, platformMessageId: `mid-${randomUUID()}`,
                senderId: 'cust-returning', senderName: 'أحمد',
                message: 'رقمي 0966554433', direction: 'incoming', createdAt: new Date(Date.now() - 60_000),
            },
            {
                pageId, workspaceId, platformMessageId: `mid-${randomUUID()}`,
                senderId: 'cust-returning', senderName: 'أحمد',
                message: IDENTITY_ANSWER, direction: 'incoming', createdAt: new Date(),
            },
        ]);

        openaiCreateMock.mockResolvedValueOnce(extractionReply('العميل يريد الطلب', [
            { key: 'name', value: 'أحمد' },
        ]));
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-returning', senderName: 'أحمد',
            messageText: 'رقمي 0966554433',
        });

        openaiCreateMock.mockResolvedValueOnce(extractionReply('العميل يتابع طلبه', [
            { key: 'order_number', value: '73285179' },
        ]));
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-returning', senderName: 'أحمد',
            messageText: IDENTITY_ANSWER,
            identityVerificationTurn: true,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('966554433');
        const card = rows[0].extractedData as { fields: Array<{ key: string; value: string }> };
        const byKey = Object.fromEntries(card.fields.map(f => [f.key, f.value]));
        expect(byKey.name).toBe('أحمد');            // kept
        expect(byKey.order_number).toBe('73285179'); // merged from the verification turn
        expect(rows[0].status).toBe('new');
    });

    it('a lead the merchant already HANDLED is not re-flagged as "came back" by an order check', async () => {
        // Without the suppression, upsertLead treats a re-shared phone on a handled
        // lead as re-engagement: needsFollowUp is set and an URGENT "this customer
        // came back" push fires. Someone asking where their parcel is did not come
        // back to buy, so the merchant must not be pulled to that card.
        openaiCreateMock.mockResolvedValue(extractionReply('العميل شارك رقمه', []));
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-handled', senderName: 'أحمد',
            messageText: 'رقمي 0966554433',
        });
        const [created] = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        await leadExtractorService.updateLeadStatus(created.id, pageId, 'contacted');

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-handled', senderName: 'أحمد',
            messageText: IDENTITY_ANSWER,
            identityVerificationTurn: true,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('contacted');
        expect(rows[0].needsFollowUp).toBe(false);
        expect(rows[0].followUpReason).toBeNull();
    });
});

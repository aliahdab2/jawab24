/**
 * Integration test for the business-number exclusion in lead capture (real Postgres).
 *
 * Covers the path the unit tests can't: getBusinessPhones reading the merchant's
 * own contact numbers from the real `pages.knowledge_base` column, and the gate
 * excluding them so a customer who pastes/forwards the business's own line never
 * becomes a bogus lead. The only mocked dependency is OpenAI (a third-party
 * external); the page read, the gate, and the leads upsert all hit the test DB.
 *
 * Region: workspaceSettingsService.getSettings defaults to Asia/Damascus (→ SY),
 * so national numbers like "0937549674" resolve to +963… on both sides.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// OpenAI is the sole external — stub it so the AI-extraction step is offline and
// deterministic. The no-lead case never reaches it (the gate returns first).
const openaiCreateMock = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));

import { randomUUID } from 'node:crypto';
import { leadExtractorService } from '../../src/services/leadExtractor';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import { leads } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

// The merchant lists their own contact lines in Business Info (the KB column).
const BUSINESS_KB =
    'معهد الفريق الدمشقي للتدريب. دورات ICDL والإسعافات الأولية بكلفة 25 ألف ل.س.\n' +
    'للتواصل والاستفسار على الأرقام: 0935924472 0112124472 0937549674';

// A Facebook "shared post" the customer FORWARDS into the DM — its body is the
// merchant's OWN ad text (we fetch it from the Graph API and wrap it). Real Nourva
// pattern: the ad ends with the merchant's contact number, which is NOT in the KB.
const SHARED_AD =
    '[Shared post: "🔴 الصور لا تكذب... نظام Nourva LiftFix للرفع والشد خلال 30 ثانية فقط. ' +
    'باقة المناسبات المتكاملة (1+1 مجاناً) السعر 160 دينار. شحن مجاني لكل ليبيا 🚚🇱🇾\n' +
    '📞 للحجز والاستفسار: 0929453011 👇"]';

describe('leadExtractor — business-number exclusion (real Postgres)', () => {
    let userId: string;
    let workspaceId: string;
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const workspace = await createTestWorkspace(user.id);
        workspaceId = workspace.id;
        const page = await createTestPage(user.id, { workspaceId, knowledgeBase: BUSINESS_KB });
        pageId = page.id;
        openaiCreateMock.mockReset();
    });

    it('does NOT create a lead when the only phone is the business\'s OWN number (from the KB)', async () => {
        // The customer forwarded our ad / pasted our reply — the one phone present
        // is +963937549674, which lives in pages.knowledge_base. No lead may be
        // written (its call/WhatsApp buttons would dial the merchant themselves).
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-biz', senderName: 'Pasted Ad',
            messageText: 'دورة ICDL تتكون من 8 جلسات. للتواصل 0937549674',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(0);
        // The gate returns before any AI extraction.
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('creates a lead with the customer\'s OWN number, never the business number', async () => {
        // AI returns an empty phone (its "not the sender's number" signal) so the
        // capture falls back to the validated customer gate phone.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'العميل شارك رقمه', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-real', senderName: 'Real Customer',
            messageText: 'مرحبا، حابب سجل بالدورة. رقمي 0966554433',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('966554433');
        expect(rows[0].phone).not.toContain('935924472');
        expect(rows[0].phone).not.toContain('937549674');
    });

    it('still excludes the business number even when the customer ALSO shares their own', async () => {
        // A message carrying BOTH the pasted business line and the customer's real
        // number must capture only the customer's.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'عميل', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-both', senderName: 'Both Numbers',
            messageText: 'شفت رقمكم 0937549674، رقمي أنا 0966554433',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('966554433');
        expect(rows[0].phone).not.toContain('937549674');
    });

    it('REGRESSION: a forwarded [Shared post] carrying the merchant number creates NO lead', async () => {
        // Real Nourva pattern: the customer forwards the merchant's own FB ad. The
        // ad body — which WE inject from the Graph API — ends with the merchant's
        // number (0929453011). It is NOT the customer's contact and is NOT in the KB,
        // so the only thing that catches it is stripping the shared-post block. The
        // customer hasn't shared their own number yet ("بكم" = how much), so no lead.
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-shared', senderName: 'zoob.a5',
            messageText: `${SHARED_AD}\nبكم`,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('captures the customer\'s OWN number even when they forward the ad in the same message', async () => {
        // Forwarded ad (merchant number) + the customer's own typed number → the lead
        // must be the CUSTOMER's number, never the merchant's from the shared post.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'عميل', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-shared-own', senderName: 'Real Plus Ad',
            messageText: `${SHARED_AD}\nرقمي 0915218888`,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('915218888');
        expect(rows[0].phone).not.toContain('929453011');
    });

    it('REGRESSION: an ad body containing a "]" is still fully stripped → no lead', async () => {
        // The strip regex must anchor to the closing "] so a stray ] inside the ad
        // body (e.g. "[خصم خاص]") can't truncate the match and leak the number after it.
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-bracket', senderName: 'Bracket Ad',
            messageText: '[Shared post: "عرض [خصم خاص] Nourva 160 دينار. للحجز والاستفسار: 0929453011 👇"]\nبكم',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('REGRESSION: AI cannot lift the merchant number out of a forwarded post', async () => {
        // Customer forwards the ad (merchant number) AND types their own number, so a
        // lead is created. Even if the AI returns the merchant number lifted from the
        // shared post in the conversation history, it must be rejected — the lead keeps
        // the customer's number.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '0929453011', summary: 'عميل', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-ai-lift', senderName: 'AI Lift',
            messageText: `${SHARED_AD}\nرقمي 0915218888`,
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('915218888');
        expect(rows[0].phone).not.toContain('929453011');
    });
});

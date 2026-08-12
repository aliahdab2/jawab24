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
import { leads, messages, factCollections, factRows } from '../../src/db/schema';
import { pagesService } from '../../src/services/pages';
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

describe('business-number exclusion — beyond the KB text (real Postgres)', () => {
    /**
     * The pre-2026-08-12 getBusinessPhones read pages.knowledge_base ONLY. When
     * the Business Surface migration moved a merchant's numbers out of prose
     * into fact rows (MES, 2026-08-08: «صالات الشركة» + «أرقام الأقسام»), their
     * own showroom/department lines silently left the exclusion set — a customer
     * pasting one back became capturable as a lead whose call button dialed the
     * merchant themselves. These tests pin the union sources: fact rows, the
     * structured Business Info phones, and WhatsApp — each with a KB that does
     * NOT contain the number, so only the new source can be doing the work.
     */
    let userId: string;
    let workspaceId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        userId = user.id;
        const workspace = await createTestWorkspace(user.id);
        workspaceId = workspace.id;
        openaiCreateMock.mockReset();
    });

    async function seedDepartmentList(pageId: string, phone: string): Promise<void> {
        const [collection] = await testDb
            .insert(factCollections)
            .values({ pageId, label: 'أرقام الأقسام', keyAttr: null, source: 'editor' })
            .returning();
        await testDb.insert(factRows).values({
            collectionId: collection.id,
            name: 'مبيعات الجملة للسادة التجار',
            attributes: [{ label: 'الهاتف', value: phone }],
            sortOrder: 0,
        });
    }

    it('a number living ONLY in fact rows is excluded (MES post-cleanup shape)', async () => {
        const page = await createTestPage(userId, {
            workspaceId,
            knowledgeBase: 'وكيل معتمد للأجهزة الكهربائية. الأسعار تؤخذ من الصالات.',
        });
        await seedDepartmentList(page.id, '0911000212');

        await leadExtractorService.maybeCaptureLead({
            pageId: page.id, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-factrow', senderName: 'Pasted Dept Line',
            messageText: 'هاد رقمكم صح؟ 0911000212',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, page.id));
        expect(rows).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('a number living ONLY in the structured Business Info fields is excluded', async () => {
        const page = await createTestPage(userId, {
            workspaceId,
            knowledgeBase: 'متجر أدوات منزلية. توصيل لكل المحافظات.',
            businessProfile: {
                merchant: { phones: ['0933301022'], channels: { whatsapp: ['0944402011'] } },
            },
        });

        for (const [sender, ownNumber] of [['cust-bp-phone', '0933301022'], ['cust-bp-wa', '0944402011']] as const) {
            await leadExtractorService.maybeCaptureLead({
                pageId: page.id, userId, workspaceId,
                sourceId: randomUUID(), sourceType: 'message',
                senderId: sender, senderName: 'Echoes Field Number',
                messageText: `بتردوا على هاد الرقم؟ ${ownNumber}`,
            });
        }

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, page.id));
        expect(rows).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('the customer STILL becomes a lead beside fact-row numbers (no overcorrection)', async () => {
        const page = await createTestPage(userId, {
            workspaceId,
            knowledgeBase: 'وكيل معتمد للأجهزة الكهربائية.',
        });
        await seedDepartmentList(page.id, '0911000212');
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'عميل', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId: page.id, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-genuine', senderName: 'Genuine Customer',
            messageText: 'جربت رقمكم 0911000212 وما حدا رد، رقمي 0966554433 دقولي',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, page.id));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('966554433');
        expect(rows[0].phone).not.toContain('911000212');
    });

    it('a fact-row number added AFTER a capture is picked up once the page caches bump', async () => {
        // The bizphones cache key carries kbVersion, so it self-invalidates on the
        // same discipline every fact/profile/KB write already rides
        // (invalidatePageCaches). Sequence: number not yet the business's → lead
        // captured; merchant adds it to a fact list (bump); the same number echoed
        // by another customer is now excluded.
        const page = await createTestPage(userId, {
            workspaceId,
            knowledgeBase: 'صالة عرض واحدة حاليًا.',
        });
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ phone: '', summary: 'عميل', fields: [] }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead({
            pageId: page.id, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-before', senderName: 'Before Bump',
            messageText: 'رقمي 0955667788',
        });
        expect(await testDb.select().from(leads).where(eq(leads.pageId, page.id))).toHaveLength(1);

        await seedDepartmentList(page.id, '0955667788');
        await pagesService.invalidatePageCaches(page.id);

        await leadExtractorService.maybeCaptureLead({
            pageId: page.id, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-after', senderName: 'After Bump',
            messageText: 'شفت الرقم 0955667788 عندكم بالصفحة',
        });

        // Still exactly the first lead: the echoed number is now the business's own.
        const rows = await testDb.select().from(leads).where(eq(leads.pageId, page.id));
        expect(rows).toHaveLength(1);
        expect(rows[0].senderId).toBe('cust-before');
    });
});

describe('getLeadsByPage — server-side search (real Postgres)', () => {
    let pageId: string;

    beforeEach(async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id, knowledgeBase: BUSINESS_KB });
        pageId = page.id;

        await testDb.insert(leads).values([
            {
                pageId, senderId: 'search-s1', senderName: 'Mona Albriki', phone: '+218910000001',
                sourceType: 'message', sourceId: randomUUID(),
                extractedData: { summary: 'طلب جديد', fields: [{ key: 'location', label_en: 'Location', label_ar: 'الموقع', value: 'صبراته' }] },
            },
            {
                pageId, senderId: 'search-s2', senderName: 'Grace Okafor', phone: '+218910000002',
                sourceType: 'message', sourceId: randomUUID(),
                extractedData: { summary: 'order', fields: [{ key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'A32' }] },
            },
            {
                pageId, senderId: 'search-s3', senderName: 'Quote Tester', phone: '+218910000003',
                sourceType: 'message', sourceId: randomUUID(),
                // A value containing a double-quote — must match exactly as shown
                // on the card (jsonb ->> unescapes; a raw ::text match would not).
                extractedData: { summary: 'measurement', fields: [{ key: 'height', label_en: 'Height', label_ar: 'الطول', value: `5'6"` }] },
            },
        ]);
    });

    it('matches by sender name', async () => {
        const { data, total } = await leadExtractorService.getLeadsByPage(pageId, { search: 'albriki' });
        expect(total).toBe(1);
        expect(data[0].senderName).toBe('Mona Albriki');
    });

    it('matches by phone fragment', async () => {
        const { data } = await leadExtractorService.getLeadsByPage(pageId, { search: '910000002' });
        expect(data).toHaveLength(1);
        expect(data[0].senderName).toBe('Grace Okafor');
    });

    it('matches inside the AI-extracted data (Arabic value + latin size)', async () => {
        const ar = await leadExtractorService.getLeadsByPage(pageId, { search: 'صبراته' });
        expect(ar.data.map(l => l.senderName)).toEqual(['Mona Albriki']);

        const en = await leadExtractorService.getLeadsByPage(pageId, { search: 'a32' });
        expect(en.data.map(l => l.senderName)).toEqual(['Grace Okafor']);
    });

    it('treats LIKE wildcards literally (a bare % matches nothing, not everything)', async () => {
        const { total } = await leadExtractorService.getLeadsByPage(pageId, { search: '%%%' });
        expect(total).toBe(0);
    });

    it('does NOT match JSON structure: field keys and bilingual labels are invisible to search', async () => {
        // "المقاس" is the label_ar on Grace's size field (and "size" its key) —
        // present in the stored JSON of the card but NOT a value. Matching labels
        // would return every lead for common words, making search useless.
        for (const structuralTerm of ['المقاس', 'size', 'label_en', 'summary']) {
            const { total } = await leadExtractorService.getLeadsByPage(pageId, { search: structuralTerm });
            expect(total, `structural term "${structuralTerm}" must not match`).toBe(0);
        }
    });

    it('matches a value containing a double-quote exactly as it appears on the card', async () => {
        const { data } = await leadExtractorService.getLeadsByPage(pageId, { search: `5'6"` });
        expect(data.map(l => l.senderName)).toEqual(['Quote Tester']);
    });

    it('no search term returns the full page list', async () => {
        const { total } = await leadExtractorService.getLeadsByPage(pageId, {});
        expect(total).toBe(3);
    });
});

describe('follow-up re-extraction end-to-end (real Postgres)', () => {
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

    it('phone message creates the lead; a later detail message merges into the card (prod A32 case)', async () => {
        // The re-extract path reads the REAL conversation history (in production
        // every processed message is stored before maybeCaptureLead fires), so
        // seed the messages table with the conversation.
        await testDb.insert(messages).values([
            {
                pageId, workspaceId, platformMessageId: `mid-${randomUUID()}`,
                senderId: 'cust-reextract', senderName: 'Souad K',
                message: 'رقمي 0915217777', direction: 'incoming', createdAt: new Date(Date.now() - 60_000),
            },
            {
                pageId, workspaceId, platformMessageId: `mid-${randomUUID()}`,
                senderId: 'cust-reextract', senderName: 'Souad K',
                message: 'A32', direction: 'incoming', createdAt: new Date(),
            },
        ]);

        // 1st extraction — at the phone message: vague size, no address yet.
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '', summary: 'العميلة تريد الطلب',
                fields: [
                    { key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'سعاد' },
                    { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'مقاس أصغر بكثير' },
                ],
            }) } }],
            usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } },
        });
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-reextract', senderName: 'Souad K',
            messageText: 'رقمي 0915217777',
        });

        // 2nd extraction — the no-phone follow-up: concrete size + address. The
        // fresh run "forgets" the name; the merge must keep it.
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '', summary: 'العميلة أكدت مقاس A32 وأعطت العنوان',
                fields: [
                    { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'A32' },
                    { key: 'address', label_en: 'Address', label_ar: 'العنوان', value: 'شارع الوادي' },
                ],
            }) } }],
            usage: { prompt_tokens: 60, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 0 } },
        });
        await leadExtractorService.maybeCaptureLead({
            pageId, userId, workspaceId,
            sourceId: randomUUID(), sourceType: 'message',
            senderId: 'cust-reextract', senderName: 'Souad K',
            messageText: 'A32',
        });

        const rows = await testDb.select().from(leads).where(eq(leads.pageId, pageId));
        expect(rows).toHaveLength(1);
        expect(rows[0].phone).toContain('915217777'); // phone untouched by re-extract
        const card = rows[0].extractedData as { summary?: string; fields: Array<{ key: string; value: string }> };
        const byKey = Object.fromEntries(card.fields.map(f => [f.key, f.value]));
        expect(byKey.size).toBe('A32');            // stale value replaced
        expect(byKey.name).toBe('سعاد');           // dropped-by-AI field kept
        expect(byKey.address).toBe('شارع الوادي'); // late detail added
        expect(rows[0].status).toBe('new');
    });
});

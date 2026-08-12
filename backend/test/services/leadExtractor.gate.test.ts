/**
 * Phone-gate behavior for leadExtractor.maybeCaptureLead — the regression guard
 * for the "spaced phone number drops the whole lead" production bug (2026-06-16).
 *
 * The bug: a customer typing their phone WITH SPACES ("+963 968 271 162",
 * "050 123 4567") produced no match at the gate, so maybeCaptureLead returned
 * early at the `if (!rawPhone) return` check and NO lead row was ever written —
 * silently losing the lead (name included). The unit tests on extractPhoneFromText
 * cover the regex; THIS test covers the integration that actually broke: a
 * conversation containing a spaced phone must result in an upserted lead whose
 * stored phone is the de-spaced digits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openaiCreateMock, capturedInserts, capturedConflicts, existingRows, capturedUpdates } = vi.hoisted(() => {
    return {
        openaiCreateMock: vi.fn(),
        capturedInserts: [] as Array<Record<string, unknown>>,
        // The SET clause passed to onConflictDoUpdate (the re-capture/upsert path).
        capturedConflicts: [] as Array<Record<string, unknown>>,
        // Rows the select() returns — empty = brand-new lead (isNew); non-empty =
        // an existing lead (re-capture path). Tests mutate this.
        existingRows: [] as Array<Record<string, unknown>>,
        // The SET clause passed to db.update() (e.g. updateLeadStatus).
        capturedUpdates: [] as Array<Record<string, unknown>>,
    };
});

vi.mock('../../src/services/aiUsageLog', () => ({ logAiUsage: vi.fn().mockResolvedValue(undefined) }));

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));

vi.mock('../../src/config', () => ({ config: { openai: { apiKey: 'test-key' } } }));

// Minimal fluent Drizzle stub. select() → no existing lead (isNew=true);
// insert().values() captures the persisted row; returning() echoes it back.
//
// select() is routed by its FIELDS argument (schema objects can't be referenced
// here — vi.mock factories hoist above imports):
//   - `kb` in fields         → the getBusinessPhones page read. A row must exist
//                              or the exclusion path bails out entirely (the
//                              2026-08-12 rework reads the page FIRST so the
//                              bizphones cache key can carry kbVersion).
//   - `attributes` in fields → the getBusinessPhones fact-rows read (awaited
//                              without .limit(), hence the thenable chain). Unit
//                              scope: always empty — fact-row exclusion is
//                              covered by test/integration/leadExtractor.test.ts.
//   - anything else          → the upsert's existing-lead lookup (existingRows).
vi.mock('../../src/db', () => {
    const PAGE_ROW = { kb: null, kbVersion: 1, businessProfile: null };
    const makeSelect = (fields?: Record<string, unknown>) => {
        const rows = () =>
            fields && 'kb' in fields ? [{ ...PAGE_ROW }]
                : fields && 'attributes' in fields ? []
                    : existingRows.slice();
        const chain: {
            from: () => typeof chain;
            innerJoin: () => typeof chain;
            where: () => typeof chain;
            limit: () => Promise<Array<Record<string, unknown>>>;
            then: (res: (v: Array<Record<string, unknown>>) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
        } = {
            from: () => chain,
            innerJoin: () => chain,
            where: () => chain,
            limit: () => Promise.resolve(rows()),
            then: (res, rej) => Promise.resolve(rows()).then(res, rej),
        };
        return chain;
    };
    const selectChain = makeSelect();
    const insertChain = {
        values: (v: Record<string, unknown>) => {
            capturedInserts.push(v);
            return insertChain;
        },
        onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
            capturedConflicts.push(arg.set);
            return insertChain;
        },
        // Upserted row: insert values, with the EXISTING lead's fields (e.g. status)
        // taking precedence so re-capture tests can simulate a contacted/new lead.
        returning: () =>
            Promise.resolve([{ id: 'lead-1', ...capturedInserts[capturedInserts.length - 1], ...(existingRows[0] ?? {}) }]),
    };
    const updateChain = {
        set: (v: Record<string, unknown>) => {
            capturedUpdates.push(v);
            return updateChain;
        },
        where: () => updateChain,
        returning: () => Promise.resolve([{ id: 'lead-1' }]),
    };
    return {
        db: {
            select: (fields?: Record<string, unknown>) => (fields ? makeSelect(fields) : selectChain),
            insert: () => insertChain,
            update: () => updateChain,
        },
    };
});

// Within the daily extraction limit (incr returns 1 ≤ 50). `set` NX backs the
// re-engagement notify dedup.
vi.mock('../../src/lib/redis', () => ({
    redis: {
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        // Default: no cached business-phone list (getBusinessPhones falls through
        // to the DB, which the generic db stub resolves to no KB rows → []).
        get: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock('../../src/lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../../src/services/messages', () => ({
    messagesService: { getConversationHistory: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined) },
}));
// Region inference: a Saudi merchant. Deterministic so the gate doesn't rely on
// an unmocked settings lookup throwing into the region-less catch.
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn().mockResolvedValue({ timezone: 'Asia/Riyadh' }) },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
    clearAiModelCache: vi.fn(),
}));

import { leadExtractorService } from '../../src/services/leadExtractor';
import { notificationService } from '../../src/services/notifications';
import { messagesService } from '../../src/services/messages';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { redis } from '../../src/lib/redis';

function baseParams(overrides: Record<string, unknown> = {}) {
    return {
        pageId: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        sourceId: 'src-1',
        sourceType: 'message' as const,
        senderId: 'sender-1',
        senderName: 'FB Name',
        messageText: '',
        ...overrides,
    };
}

beforeEach(() => {
    capturedInserts.length = 0;
    capturedConflicts.length = 0;
    capturedUpdates.length = 0;
    existingRows.length = 0;
    vi.mocked(notificationService.sendTemplateNotificationToWorkspace).mockClear();
    openaiCreateMock.mockReset();
    // Default: the AI echoes the gate's phone and extracts a name field.
    openaiCreateMock.mockResolvedValue({
        choices: [
            {
                message: {
                    content: JSON.stringify({
                        phone: '',
                        summary: 'Customer shared contact details',
                        fields: [{ key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'ضحى' }],
                    }),
                },
            },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    });
});

describe('maybeCaptureLead phone gate', () => {
    it('REGRESSION: captures a lead when the phone is written with spaces (international)', async () => {
        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'اسمي ضحى ايمن العمر +963 968 271 162' }),
        );

        expect(capturedInserts).toHaveLength(1);
        // De-spaced digits, not null, not a 3-digit fragment.
        expect(capturedInserts[0].phone).toBe('+963968271162');
    });

    it('REGRESSION: captures a lead for a space-grouped national number', async () => {
        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'رقمي 050 123 4567' }));

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0501234567');
    });

    it('still captures contiguous numbers (no regression)', async () => {
        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'تواصلوا 0934958473' }));

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0934958473');
    });

    it('persists the AI-extracted fields alongside the phone', async () => {
        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'اسمي ضحى +963 968 271 162' }),
        );

        const extracted = capturedInserts[0].extractedData as { fields: Array<{ key: string; value: string }> };
        expect(extracted.fields).toContainEqual(expect.objectContaining({ key: 'name', value: 'ضحى' }));
    });

    it('does NOT create a lead when the message has no phone number', async () => {
        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'شكراً جزيلاً، بتمنالكم التوفيق' }),
        );

        expect(capturedInserts).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });
});

describe('maybeCaptureLead — AI phone validation (price-as-phone guard)', () => {
    it('REGRESSION: a non-phone figure the AI puts in "phone" (a price) does NOT overwrite the gate phone', async () => {
        // Real bug: a customer asked about a course whose fee was 2,500,000; the
        // extraction model dropped "2500000" into the "phone" field, and the code
        // trusted it over the libphonenumber-validated gate phone — so the lead's
        // call/WhatsApp buttons dialled a price. "2500000" is 7 digits and matches
        // no numbering plan, so it must be rejected and the gate phone kept.
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '2500000', // the course fee, misclassified
                summary: 'العميل يستفسر عن دورة الإسعافات الأولية',
                fields: [{ key: 'course_of_interest', label_en: 'Course', label_ar: 'الدورة', value: 'دورة الإسعافات الأولية' }],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'سعر دورة الإسعافات 2500000، رقمي 0501234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0501234567');
        expect(capturedInserts[0].phone).not.toBe('2500000');
    });

    it('still trusts the AI phone when it IS a valid number (e.g. the canonical E.164)', async () => {
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '+966501234567', // valid, canonical form of the gate phone
                summary: 'Customer shared contact details',
                fields: [],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'رقمي 0501234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('+966501234567');
    });

    it('falls back to the gate phone when the AI returns an empty phone', async () => {
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '',
                summary: 'Customer shared contact details',
                fields: [],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'رقمي 0501234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0501234567');
    });
});

describe('maybeCaptureLead — business own number echoed back (June 2026 regression)', () => {
    it('REGRESSION: a customer pasting our reply (with the business line) creates NO lead', async () => {
        // Real prod case (page "الفريق الدمشقي للتدريب والتأهيل"): the customer
        // copy-pasted our ICDL auto-reply verbatim to ask for a translation. That
        // reply carries the business's OWN "+963937549674". The gate must recognise
        // it as OUR number — not a customer contact — and write no lead. Otherwise
        // the lead's call/WhatsApp buttons dial the merchant themselves, and the
        // fields get scraped from our own catalogue.
        const ourReply =
            'Awesome choice! The ICDL course is 8 sessions over a month, costing 35,000 L.S. ' +
            'You can reach us at +963937549674 for more details!';
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'assistant', content: ourReply },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: `${ourReply}\nترجمها للعربي` }),
        );

        expect(capturedInserts).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('captures the customer\'s OWN number while ignoring the business number in our history', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'assistant', content: 'تواصلوا معنا على أرقامنا: 0935924472 0937549674' },
            { role: 'user', content: 'رقمي 0991234567' },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'رقمي 0991234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0991234567');
    });

    it('REGRESSION: sharing the merchant\'s ad post (KB-listed business number) creates NO lead', async () => {
        // Real prod pattern (6 of 8 bogus leads on the institute page): the customer
        // forwarded the merchant's OWN ad post into the DM. The ad ends with the
        // business's published lines ("…للاستفسار والتواصل 0935924472 0112124472"),
        // which the merchant also lists in Business Info (KB). The number appears in NO
        // Agent turn of this conversation, so only the page-level KB exclusion catches it.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        // Page-level business numbers from the KB (Redis-cached list).
        vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(['0935924472', '0112124472', '0937549674']));
        // The conversation's Agent turn does NOT contain the number.
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'assistant', content: 'مرحباً! يبدو أنك مهتم بدوراتنا. كيف أقدر أساعدك؟' },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({
                messageText: '#دورات_اون_لاين #دورة_محاسبة_الامين للاستفسار والتواصل 0935924472 0112124472',
            }),
        );

        expect(capturedInserts).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('REGRESSION: an AI phone that is the business\'s own number falls back to the customer gate phone', async () => {
        // The extractor feeds "Agent:" turns for context; the model can lift our
        // published line out of them into "phone". That must be rejected — keep the
        // customer's validated gate number.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'assistant', content: 'أرقامنا: 0935924472 0937549674' },
            { role: 'user', content: 'رقمي 0991234567' },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '0937549674', // the business's own line, lifted from an Agent turn
                summary: 'العميل شارك رقمه',
                fields: [],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'رقمي 0991234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0991234567');
        expect(capturedInserts[0].phone).not.toBe('0937549674');
    });

    it('REGRESSION: a forwarded [Shared post] carrying the merchant number creates NO lead', async () => {
        // The customer forwards the merchant's own FB ad; its body (injected by the
        // reply pipeline from the Graph API) ends with the merchant's contact line.
        // That block is stripped before the gate, so no lead until the customer
        // shares THEIR own number ("بكم" = how much).
        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: '[Shared post: "عرض Nourva LiftFix 160 دينار. للحجز والاستفسار: 0929453011 👇"]\nبكم' }),
        );

        expect(capturedInserts).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('captures the customer own number typed alongside a forwarded post', async () => {
        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: '[Shared post: "عرض Nourva 160 دينار. للحجز: 0929453011 👇"] رقمي 0501234567' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0501234567');
    });
});

describe('maybeCaptureLead — our reply echoes the customer own number (July 2026 regression)', () => {
    it('REGRESSION: captures the lead even when our confirmation reply repeats the customer number back', async () => {
        // Real prod case (page "الفريق الدمشقي للتدريب والتأهيل", customer Majd Alsaleem):
        // the customer sent "مجد السليم 931874500 دوره اضافر"; the Smart Reply confirmed
        // registration and ECHOED her number ("…رح نتواصل معك على الرقم 931874500…"). That
        // reply is stored as an outgoing (assistant) row BEFORE this fire-and-forget
        // extraction runs, so it comes back in the history below. Before the fix it was
        // fed into the business-number exclusion, which then read the customer's OWN
        // number as the business's and wrote NO lead. The reply-to-this-message must be
        // ignored by the exclusion; the lead must be captured with her number.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'user', content: 'مجد السليم 931874500 دوره اضافر' },
            {
                role: 'assistant',
                content:
                    'تسجيلك لدورة الأظافر تم بنجاح! 🎉 رح نتواصل معك قريباً على الرقم 931874500 لتأكيد التفاصيل. نورتينا مجد!',
            },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'مجد السليم 931874500 دوره اضافر' }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('931874500');
    });

    it('still excludes a PRIOR assistant turn (paste-back protection is preserved)', async () => {
        // The discriminator is temporal: an assistant turn BEFORE the customer's latest
        // message is legitimate business context they may quote/paste (keep excluding it);
        // only the reply AFTER it is our echo. Here the business line is published in a
        // prior turn and the customer pastes it — no lead, exactly as before the fix.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        vi.mocked(messagesService.getConversationHistory).mockResolvedValueOnce([
            { role: 'assistant', content: 'للتواصل معنا على الرقم 0937549674' },
            { role: 'user', content: 'شكراً، 0937549674' },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'شكراً، 0937549674' }),
        );

        expect(capturedInserts).toHaveLength(0);
        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('REGRESSION (comment): captures the lead when our comment reply echoes the commenter number', async () => {
        // Same root cause on the comment→DM path: replyText is our reply to THIS comment
        // and echoes the commenter's own number, so it must not feed the business-number
        // exclusion. The post is still trusted as business context.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValueOnce({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);

        await leadExtractorService.maybeCaptureLead(
            baseParams({
                sourceType: 'comment',
                messageText: 'رقمي 0966554433',
                postMessage: 'دورة الأظافر متوفرة الآن، سجّلي بالتعليقات',
                replyText: 'يسعدنا تسجيلك! رح نتواصل معك على الرقم 0966554433',
            }),
        );

        expect(capturedInserts).toHaveLength(1);
        expect(capturedInserts[0].phone).toBe('0966554433');
    });
});

describe('maybeCaptureLead — second number must not erase the first (July 2026 regression)', () => {
    // Real prod case (page "الفريق الدمشقي للتدريب والتأهيل", 2026-07-25, lead
    // f66db763): a parent registered TWO daughters. She sent daughter A's name +
    // number first ("سيدرا محمد كوجك" / "جوال0953256248" → lead created), then
    // daughter B's in one message ("شهد حسن سلوم جوال 0965219910"). The second
    // capture's conflict-update silently overwrote leads.phone — the ONE
    // destructive field in an otherwise non-destructive upsert. Result on the
    // card: call/WhatsApp buttons dialled B's number while the fields showed A's
    // name, and 0953256248 survived only because the AI happened to emit it as a
    // field. The displaced number must be PRESERVED as a card field, always —
    // never by luck.
    const tabarakHistory = [
        { role: 'user', content: 'بنتي وبنت اختي بدي سجلون' },
        { role: 'assistant', content: 'تمام، عطيني أسماء البنات وأرقام تواصلهم مع تحديد دورة المحاسبة المبتدئة لكل وحدة، ونساعدكم بالتسجيل.' },
        { role: 'user', content: 'سيدرا محمد كوجك' },
        { role: 'user', content: 'جوال0953256248' },
        { role: 'assistant', content: 'تم، سجلنا جوال 0953256248 لدورة المحاسبة المبتدئين. 🌸' },
        { role: 'user', content: 'شهد حسن سلوم جوال 0965219910' },
    ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>;

    beforeEach(() => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            timezone: 'Asia/Damascus',
        } as Awaited<ReturnType<typeof workspaceSettingsService.getSettings>>);
        // The lead as daughter A's capture left it.
        existingRows.push({
            id: 'lead-1',
            status: 'new',
            phone: '0953256248',
            extractionStatus: 'completed',
            extractedData: {
                summary: 'العميل يريد تسجيل بنته في دورة المحاسبة للمبتدئين.',
                fields: [
                    { key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'سيدرا محمد كوجك' },
                    { key: 'course_of_interest', label_en: 'Course of Interest', label_ar: 'الدورة المهتم بها', value: 'محاسبة مبتدئين' },
                ],
            },
        });
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue(tabarakHistory);
    });

    it('REGRESSION: the displaced first number is preserved on the card when a different number arrives', async () => {
        // The AI does NOT re-emit the old number (worst case — preservation must
        // not depend on model behavior).
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '0965219910',
                summary: 'العميل يريد تسجيل بنتيه في دورة المحاسبة للمبتدئين.',
                fields: [{ key: 'name_2', label_en: 'Name (2)', label_ar: 'الاسم (2)', value: 'شهد حسن سلوم' }],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'شهد حسن سلوم جوال 0965219910' }),
        );

        expect(capturedConflicts).toHaveLength(1);
        const set = capturedConflicts[0];
        // Newest number wins the column (the buttons dial the latest share)…
        expect(set.phone).toBe('0965219910');
        // …but the displaced number must survive as a card field.
        const merged = set.extractedData as { fields: Array<{ key: string; value: string }> };
        const values = merged.fields.map(f => f.value);
        expect(values.some(v => v.includes('0953256248'))).toBe(true);
        // And nothing already on the card is lost.
        expect(values).toContain('سيدرا محمد كوجك');
        expect(values).toContain('شهد حسن سلوم');
    });

    it('re-sharing the SAME number adds no duplicate field', async () => {
        // History without our echo of the number: a prior assistant turn that
        // echoed it would (correctly) trip paste-back protection and route to
        // re-extraction instead — the accepted tradeoff from the July 2026
        // echo-drop fix. Here the capture path runs and must be a phone no-op.
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
            { role: 'user', content: 'سيدرا محمد كوجك' },
            { role: 'assistant', content: 'تمام، عطيني رقم التواصل ونساعدك بالتسجيل.' },
            { role: 'user', content: 'جوال0953256248' },
        ] as Awaited<ReturnType<typeof messagesService.getConversationHistory>>);
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '0953256248',
                summary: 'العميل أكد رقمه.',
                fields: [],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'جوال0953256248' }),
        );

        expect(capturedConflicts).toHaveLength(1);
        const set = capturedConflicts[0];
        expect(set.phone).toBe('0953256248');
        const merged = set.extractedData as { fields: Array<{ key: string; value: string }> };
        // No phantom "previous number" field when nothing was displaced.
        expect(merged.fields.filter(f => f.value.includes('0953256248'))).toHaveLength(0);
    });

    it('does not preserve the displaced number twice when the AI already emitted it as a field', async () => {
        // Prod reality for lead f66db763: the AI's card DID carry 0953256248 as a
        // "phone" field. Preservation must detect that and not append a duplicate.
        openaiCreateMock.mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify({
                phone: '0965219910',
                summary: 'العميل يريد تسجيل بنتيه في دورة المحاسبة للمبتدئين.',
                fields: [
                    { key: 'name_2', label_en: 'Name (2)', label_ar: 'الاسم (2)', value: 'شهد حسن سلوم' },
                    { key: 'phone', label_en: 'Phone', label_ar: 'رقم الهاتف', value: '0953256248' },
                ],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(
            baseParams({ messageText: 'شهد حسن سلوم جوال 0965219910' }),
        );

        const merged = capturedConflicts[0].extractedData as { fields: Array<{ key: string; value: string }> };
        expect(merged.fields.filter(f => f.value.includes('0953256248'))).toHaveLength(1);
    });
});

describe('lead re-engagement (re-shared number)', () => {
    it('upsert conflict clause flags follow-up WITHOUT regressing status (non-destructive)', async () => {
        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'رقمي 0934958473' }));

        // The conflict-update SET is what runs for an existing lead. It sets the
        // follow-up fields (status-gated in SQL) and must NEVER touch pipeline state.
        expect(capturedConflicts).toHaveLength(1);
        const set = capturedConflicts[0];
        expect(set).toHaveProperty('needsFollowUp');
        expect(set).toHaveProperty('followUpReason');
        expect(set).not.toHaveProperty('status');
        expect(set).not.toHaveProperty('subStage');
    });

    it('notifies "lead_reengaged" when a HANDLED lead (contacted) shares a number again', async () => {
        existingRows.push({ id: 'lead-1', status: 'contacted' }); // handled → genuine return

        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'رقمي 0934958473' }));

        const templates = vi.mocked(notificationService.sendTemplateNotificationToWorkspace).mock.calls.map((c) => c[1]);
        expect(templates).toContain('lead_reengaged');
        expect(templates).not.toContain('new_lead');
    });

    it('does NOT notify re-engaged while the lead is still "new" (initial-capture burst)', async () => {
        // Existing lead still in 'new' = mid initial conversation, not "returning".
        existingRows.push({ id: 'lead-1', status: 'new' });

        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'رقمي 0934958473' }));

        expect(vi.mocked(notificationService.sendTemplateNotificationToWorkspace)).not.toHaveBeenCalled();
    });

    it('sends "new_lead" (not re-engaged) for a brand-new lead', async () => {
        // existingRows empty → isNew = true
        await leadExtractorService.maybeCaptureLead(baseParams({ messageText: 'رقمي 0934958473' }));

        const templates = vi.mocked(notificationService.sendTemplateNotificationToWorkspace).mock.calls.map((c) => c[1]);
        expect(templates).toContain('new_lead');
        expect(templates).not.toContain('lead_reengaged');
    });

    it('clears the follow-up flag when the merchant changes status', async () => {
        await leadExtractorService.updateLeadStatus('lead-1', 'page-1', 'contacted');

        expect(capturedUpdates).toHaveLength(1);
        expect(capturedUpdates[0]).toMatchObject({
            status: 'contacted',
            needsFollowUp: false,
            followUpReason: null,
        });
    });
});

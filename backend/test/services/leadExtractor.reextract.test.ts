/**
 * Follow-up re-extraction for leadExtractor.maybeCaptureLead — regression guard
 * for the "order details sent after the phone never reach the lead card"
 * production bug (2026-07-02, Nourva).
 *
 * The bug: extraction ran exactly once, at the phone-bearing message. Details
 * the customer sent afterwards (final size "A32", recipient name, address)
 * were rejected by the no-phone pre-gate, so the card shipped stale/incomplete
 * and the shipping team could not fulfil the order. The fix: a no-phone
 * follow-up from a sender whose lead is still fresh (status 'new', within
 * LEAD_REEXTRACT_WINDOW_HOURS) re-runs the AI over the full history and MERGES
 * the result into the card — bounded by a per-lead cooldown + attempt cap and
 * a per-workspace daily budget separate from first-time capture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { openaiCreateMock, capturedInserts, capturedConflicts, existingRows, capturedUpdates } = vi.hoisted(() => {
    return {
        openaiCreateMock: vi.fn(),
        capturedInserts: [] as Array<Record<string, unknown>>,
        capturedConflicts: [] as Array<Record<string, unknown>>,
        // Rows the select() returns — the re-extract path's lead lookup.
        existingRows: [] as Array<Record<string, unknown>>,
        // The SET clause passed to db.update() — the merged-card write.
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

vi.mock('../../src/db', () => {
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => Promise.resolve(existingRows.slice()),
    };
    const insertChain = {
        values: (v: Record<string, unknown>) => {
            capturedInserts.push(v);
            return insertChain;
        },
        onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
            capturedConflicts.push(arg.set);
            return insertChain;
        },
        returning: () =>
            Promise.resolve([{ id: 'lead-1', ...capturedInserts[capturedInserts.length - 1], ...(existingRows[0] ?? {}) }]),
    };
    const updateChain = {
        set: (v: Record<string, unknown>) => {
            capturedUpdates.push(v);
            return updateChain;
        },
        where: () => Promise.resolve([]),
    };
    return {
        db: {
            select: () => selectChain,
            insert: () => insertChain,
            update: () => updateChain,
        },
    };
});

vi.mock('../../src/lib/redis', () => ({
    redis: {
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
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
vi.mock('../../src/services/workspaceSettings', () => ({
    workspaceSettingsService: { getSettings: vi.fn().mockResolvedValue({ timezone: 'Africa/Tripoli' }) },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
    clearAiModelCache: vi.fn(),
}));

import { leadExtractorService, mergeExtractedData, normalizeExtractedData } from '../../src/services/leadExtractor';
import { messagesService } from '../../src/services/messages';
import { captureError } from '../../src/utils/sentryHelpers';
import { redis } from '../../src/lib/redis';

/** A fresh 'new' lead as the re-extract lead lookup returns it. */
function freshLead(overrides: Record<string, unknown> = {}) {
    return {
        id: 'lead-1',
        status: 'new',
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min old
        extractionAttempts: 0,
        extractedData: {
            summary: 'العميلة تريد الطلب',
            fields: [
                { key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'سعاد' },
                { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'مقاس أصغر بكثير' },
            ],
        },
        ...overrides,
    };
}

function followUpParams(overrides: Record<string, unknown> = {}) {
    return {
        pageId: 'page-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        sourceId: 'src-2',
        sourceType: 'message' as const,
        senderId: 'sender-1',
        senderName: 'FB Name',
        messageText: 'A32', // no phone → the pre-gate routes to re-extraction
        ...overrides,
    };
}

const HISTORY = [
    { role: 'user' as const, content: 'رقمي 0910000017', timestamp: new Date() },
    { role: 'assistant' as const, content: 'أرسلي الاسم والمقاس', timestamp: new Date() },
    { role: 'user' as const, content: 'A32', timestamp: new Date() },
];

beforeEach(() => {
    capturedInserts.length = 0;
    capturedConflicts.length = 0;
    capturedUpdates.length = 0;
    existingRows.length = 0;
    delete process.env.LEAD_REEXTRACT_WINDOW_HOURS;
    vi.mocked(messagesService.getConversationHistory).mockResolvedValue(HISTORY);
    vi.mocked(captureError).mockClear();
    vi.mocked(redis.set).mockClear().mockResolvedValue('OK');
    vi.mocked(redis.incr).mockClear().mockResolvedValue(1);
    openaiCreateMock.mockReset();
    // Fresh extraction over the full history: concrete size + new address field.
    openaiCreateMock.mockResolvedValue({
        choices: [
            {
                message: {
                    content: JSON.stringify({
                        phone: '',
                        summary: 'العميلة أكدت مقاس A32 وأعطت العنوان',
                        fields: [
                            { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'A32' },
                            { key: 'address', label_en: 'Address', label_ar: 'العنوان', value: 'شارع الوادي' },
                        ],
                    }),
                },
            },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    });
});

afterEach(() => {
    delete process.env.LEAD_REEXTRACT_WINDOW_HOURS;
});

describe('maybeCaptureLead — follow-up re-extraction', () => {
    it('re-extracts and merges when a fresh new lead gets a no-phone detail message (prod A32 case)', async () => {
        existingRows.push(freshLead());

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(capturedUpdates).toHaveLength(1);
        const set = capturedUpdates[0] as { extractedData: { summary?: string; fields: Array<{ key: string; value: string }> } };
        const byKey = Object.fromEntries(set.extractedData.fields.map(f => [f.key, f.value]));
        expect(byKey.size).toBe('A32');            // stale vague value replaced
        expect(byKey.name).toBe('سعاد');           // field missing from fresh run is KEPT
        expect(byKey.address).toBe('شارع الوادي'); // late detail added
        expect(set.extractedData.summary).toBe('العميلة أكدت مقاس A32 وأعطت العنوان');
    });

    it('never writes phone, status, or follow-up flags from the re-extract path', async () => {
        existingRows.push(freshLead());

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(capturedUpdates).toHaveLength(1);
        const keys = Object.keys(capturedUpdates[0]);
        expect(keys.sort()).toEqual(['extractedData', 'extractionAttempts', 'extractionStatus', 'updatedAt'].sort());
    });

    it('does nothing when the sender has no lead', async () => {
        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
        expect(capturedUpdates).toHaveLength(0);
        expect(capturedInserts).toHaveLength(0);
    });

    it('never touches a lead the merchant already handled (status != new)', async () => {
        existingRows.push(freshLead({ status: 'contacted' }));

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
        expect(capturedUpdates).toHaveLength(0);
    });

    it('does nothing once the lead is older than the window', async () => {
        existingRows.push(freshLead({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) }));

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('respects the per-lead attempt cap (10 — sized so chatty order flows still converge)', async () => {
        existingRows.push(freshLead({ extractionAttempts: 10 }));

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('still re-extracts just under the attempt cap', async () => {
        existingRows.push(freshLead({ extractionAttempts: 9 }));

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(capturedUpdates).toHaveLength(1);
    });

    it('coalesces bursts via the cooldown key (second message inside cooldown is skipped)', async () => {
        existingRows.push(freshLead());
        vi.mocked(redis.set).mockResolvedValue(null); // NX: key already armed

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
        expect(capturedUpdates).toHaveLength(0);
    });

    it('stops at the daily re-extraction budget without consuming first-capture budget keys', async () => {
        existingRows.push(freshLead());
        vi.mocked(redis.incr).mockResolvedValue(151); // over DAILY_REEXTRACTION_LIMIT

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('is disabled entirely by LEAD_REEXTRACT_WINDOW_HOURS=0', async () => {
        process.env.LEAD_REEXTRACT_WINDOW_HOURS = '0';
        existingRows.push(freshLead());

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
        // Kill-switch short-circuits before any Redis/DB traffic beyond the lookup.
        expect(vi.mocked(redis.set)).not.toHaveBeenCalled();
    });

    it('ignores the comment path (single-turn context has no history to re-read)', async () => {
        existingRows.push(freshLead());

        await leadExtractorService.maybeCaptureLead(
            followUpParams({ sourceType: 'comment', postMessage: 'عرض اليوم', replyText: 'تم' }),
        );

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('ignores attachment-only messages (empty text)', async () => {
        existingRows.push(freshLead());

        await leadExtractorService.maybeCaptureLead(followUpParams({ messageText: '   ' }));

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('leaves the lead untouched when the AI call fails (no pending flip, error captured)', async () => {
        existingRows.push(freshLead());
        openaiCreateMock.mockRejectedValue(new Error('OpenAI 500'));

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(capturedUpdates).toHaveLength(0);
        expect(vi.mocked(captureError)).toHaveBeenCalled();
    });

    it('does nothing when the conversation history is empty', async () => {
        existingRows.push(freshLead());
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([]);

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('coerces non-string AI field values (numeric size) instead of crashing the re-extraction', async () => {
        existingRows.push(freshLead());
        // JSON-mode models routinely emit numeric-looking values as bare numbers.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({
                phone: '',
                summary: 'تم تأكيد المقاس',
                fields: [{ key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 38 }],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(followUpParams());

        expect(vi.mocked(captureError)).not.toHaveBeenCalled();
        expect(capturedUpdates).toHaveLength(1);
        const set = capturedUpdates[0] as { extractedData: { fields: Array<{ key: string; value: string }> } };
        expect(set.extractedData.fields.find(f => f.key === 'size')?.value).toBe('38');
    });

    it('still re-extracts when the follow-up quotes a NON-customer phone (gate-rejected number)', async () => {
        // The customer echoes the business's own line alongside real order details.
        // The phone pre-gate passes (a number is present), the customer-phone gate
        // rejects it — and the message must still continue the lead.
        existingRows.push(freshLead());
        vi.mocked(messagesService.getConversationHistory).mockResolvedValue([
            { role: 'user' as const, content: 'رقمي 0910000017', timestamp: new Date() },
            // Our own reply published the business line → it's in businessTexts.
            { role: 'assistant' as const, content: 'للاستفسار اتصلي على 0929453011', timestamp: new Date() },
            { role: 'user' as const, content: 'العنوان شارع الوادي، وهذا رقمكم 0929453011 صح؟', timestamp: new Date() },
        ]);

        await leadExtractorService.maybeCaptureLead(
            followUpParams({ messageText: 'العنوان شارع الوادي، وهذا رقمكم 0929453011 صح؟' }),
        );

        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(capturedUpdates).toHaveLength(1);
        // The gate-rejected business number must never become the lead's phone.
        expect(Object.keys(capturedUpdates[0])).not.toContain('phone');
    });
});

describe('maybeCaptureLead — phone-path merge (upsert never wipes a populated card)', () => {
    it('over-limit phone re-share keeps the existing card and completed status', async () => {
        // Existing populated lead; the customer re-shares their phone while the
        // 50/day first-capture budget is exhausted → the fresh capture arrives as
        // an EMPTY pending card. The conflict-update must merge (keep the card),
        // not replace it.
        existingRows.push(freshLead({ extractionStatus: 'completed' }));
        vi.mocked(redis.incr).mockResolvedValue(51); // over DAILY_EXTRACTION_LIMIT

        await leadExtractorService.maybeCaptureLead(followUpParams({ messageText: 'نفس الرقم 0910000017' }));

        expect(openaiCreateMock).not.toHaveBeenCalled(); // over limit → AI skipped
        expect(capturedConflicts).toHaveLength(1);
        const set = capturedConflicts[0] as { extractedData: { fields: Array<{ key: string }> }; extractionStatus: string };
        expect(set.extractedData.fields.map(f => f.key)).toEqual(['name', 'size']); // card preserved
        expect(set.extractionStatus).toBe('completed'); // never demoted to pending
    });

    it('phone re-share with a successful fresh extraction merges instead of replacing', async () => {
        existingRows.push(freshLead({ extractionStatus: 'completed' }));
        // Fresh run "forgets" the name but adds an address.
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({
                phone: '',
                summary: 'جديد',
                fields: [{ key: 'address', label_en: 'Address', label_ar: 'العنوان', value: 'زليتن' }],
            }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
        });

        await leadExtractorService.maybeCaptureLead(followUpParams({ messageText: 'رقمي 0910000017' }));

        expect(capturedConflicts).toHaveLength(1);
        const set = capturedConflicts[0] as { extractedData: { fields: Array<{ key: string }> } };
        expect(set.extractedData.fields.map(f => f.key).sort()).toEqual(['address', 'name', 'size']);
    });
});

describe('mergeExtractedData', () => {
    const existing = {
        summary: 'قديم',
        fields: [
            { key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'سعاد' },
            { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'مقاس أصغر بكثير' },
        ],
    };

    it('fresh value wins per key; missing keys are kept; new keys append', () => {
        const merged = mergeExtractedData(existing, {
            summary: 'جديد',
            fields: [
                { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'A32' },
                { key: 'address', label_en: 'Address', label_ar: 'العنوان', value: 'زليتن' },
            ],
        });
        expect(merged.fields).toEqual([
            { key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'سعاد' },
            { key: 'size', label_en: 'Size', label_ar: 'المقاس', value: 'A32' },
            { key: 'address', label_en: 'Address', label_ar: 'العنوان', value: 'زليتن' },
        ]);
        expect(merged.summary).toBe('جديد');
    });

    it('empty fresh values never overwrite, empty fresh summary keeps the old one', () => {
        const merged = mergeExtractedData(existing, {
            summary: '  ',
            fields: [{ key: 'size', label_en: 'Size', label_ar: 'المقاس', value: '' }],
        });
        expect(merged.fields).toEqual(existing.fields);
        expect(merged.summary).toBe('قديم');
    });

    it('handles an empty existing card (first re-extract after a pending capture)', () => {
        const merged = mergeExtractedData({ fields: [] }, {
            summary: 'ملخص',
            fields: [{ key: 'name', label_en: 'Name', label_ar: 'الاسم', value: 'ليلى' }],
        });
        expect(merged.fields).toHaveLength(1);
        expect(merged.summary).toBe('ملخص');
    });
});

describe('normalizeExtractedData', () => {
    it('passes a proper object through', () => {
        const data = { summary: 's', fields: [{ key: 'name', label_en: 'N', label_ar: 'ن', value: 'x' }] };
        expect(normalizeExtractedData(data)).toEqual(data);
    });

    it('unwraps a double-encoded jsonb string (legacy rows)', () => {
        const data = { summary: 's', fields: [{ key: 'name', label_en: 'N', label_ar: 'ن', value: 'x' }] };
        expect(normalizeExtractedData(JSON.stringify(data))).toEqual(data);
    });

    it('degrades garbage to an empty card', () => {
        expect(normalizeExtractedData('not json {')).toEqual({ fields: [] });
        expect(normalizeExtractedData(null)).toEqual({ fields: [] });
        expect(normalizeExtractedData([1, 2])).toEqual({ fields: [] });
        expect(normalizeExtractedData({ fields: 'nope' })).toEqual({ fields: [] });
    });
});

describe('reextractLeadNow (backfill / manual re-extraction)', () => {
    // A thin backfilled card: phone-only summary, empty fields — the echo-drop backfill shape.
    const THIN_CARD = { id: 'lead-1', extractedData: { summary: 'رقمي 0910000017', fields: [] } };

    it('re-runs extraction over the full history and writes the merged fields', async () => {
        existingRows.push(THIN_CARD);

        const res = await leadExtractorService.reextractLeadNow('page-1', 'sender-1', 'user-1');

        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(res.found).toBe(true);
        const byKey = Object.fromEntries((res.fields ?? []).map(f => [f.key, f.value]));
        expect(byKey.size).toBe('A32');
        expect(byKey.address).toBe('شارع الوادي');
        expect(capturedUpdates).toHaveLength(1);
        // Narrow blast radius (same contract as maybeReextractLead): extractedData only.
        const set = capturedUpdates[0];
        expect(set).toHaveProperty('extractedData');
        expect(set).not.toHaveProperty('phone');
        expect(set).not.toHaveProperty('status');
        expect(set).not.toHaveProperty('senderName');
    });

    it('dryRun returns the extraction WITHOUT writing', async () => {
        existingRows.push(THIN_CARD);

        const res = await leadExtractorService.reextractLeadNow('page-1', 'sender-1', 'user-1', { dryRun: true });

        expect(res.found).toBe(true);
        expect((res.fields ?? []).length).toBeGreaterThan(0);
        expect(capturedUpdates).toHaveLength(0);
    });

    it('bypasses the follow-up window guard (enriches a 30-day-old lead)', async () => {
        // maybeReextractLead would skip this on the window/attempt guards; reextractLeadNow must not.
        existingRows.push({ ...THIN_CARD, createdAt: new Date(Date.now() - 30 * 86400000), status: 'new', extractionAttempts: 99 });

        await leadExtractorService.reextractLeadNow('page-1', 'sender-1', 'user-1');

        expect(openaiCreateMock).toHaveBeenCalledTimes(1);
        expect(capturedUpdates).toHaveLength(1);
    });

    it('returns found=false and calls no AI when no lead exists', async () => {
        const res = await leadExtractorService.reextractLeadNow('page-1', 'sender-nope', 'user-1');

        expect(res.found).toBe(false);
        expect(openaiCreateMock).not.toHaveBeenCalled();
        expect(capturedUpdates).toHaveLength(0);
    });
});

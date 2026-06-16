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

const { openaiCreateMock, capturedInserts } = vi.hoisted(() => {
    return { openaiCreateMock: vi.fn(), capturedInserts: [] as Array<Record<string, unknown>> };
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
vi.mock('../../src/db', () => {
    const selectChain = {
        from: () => selectChain,
        where: () => selectChain,
        limit: () => Promise.resolve([] as unknown[]),
    };
    const insertChain = {
        values: (v: Record<string, unknown>) => {
            capturedInserts.push(v);
            return insertChain;
        },
        onConflictDoUpdate: () => insertChain,
        returning: () =>
            Promise.resolve([{ id: 'lead-1', ...capturedInserts[capturedInserts.length - 1] }]),
    };
    return {
        db: {
            select: () => selectChain,
            insert: () => insertChain,
        },
    };
});

// Within the daily extraction limit (incr returns 1 ≤ 50).
vi.mock('../../src/lib/redis', () => ({
    redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
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

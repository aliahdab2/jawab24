/**
 * New-lead notification firing in leadExtractor.maybeCaptureLead.
 *
 * Invariant: a new_lead push/bell notification fires exactly once, only when the
 * lead is genuinely new (isNew === true). Repeat messages from the same sender
 * (an existing lead) and phone-less messages must NOT notify. Without this test,
 * a refactor could re-introduce notification spam on every customer message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openaiCreateMock, sendWorkspaceMock, selectLimitMock, insertReturningMock } = vi.hoisted(() => ({
    openaiCreateMock: vi.fn(),
    sendWorkspaceMock: vi.fn().mockResolvedValue(undefined),
    selectLimitMock: vi.fn(),     // existing-lead lookup → drives isNew
    insertReturningMock: vi.fn(), // upserted lead row
}));

vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: openaiCreateMock } },
    })),
}));
vi.mock('../../src/config', () => ({ config: { openai: { apiKey: 'test-key' } } }));

// db: select→from→where→limit drives the existing-lead check;
//     insert→values→onConflictDoUpdate→returning drives the upsert result.
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({ limit: selectLimitMock })),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                onConflictDoUpdate: vi.fn(() => ({ returning: insertReturningMock })),
            })),
        })),
    },
}));

vi.mock('../../src/lib/redis', () => ({
    redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}));
vi.mock('../../src/lib/eventBus', () => ({ publishSSEEvent: vi.fn() }));
vi.mock('../../src/services/messages', () => ({
    messagesService: { getConversationHistory: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../src/services/aiUsageLog', () => ({ logAiUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/aiModelResolver', () => ({
    getModelForUser: vi.fn().mockResolvedValue('gpt-4.1-mini'),
    clearAiModelCache: vi.fn(),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({ captureError: vi.fn() }));
vi.mock('../../src/services/notifications', () => ({
    notificationService: { sendTemplateNotificationToWorkspace: sendWorkspaceMock },
}));

import { leadExtractorService } from '../../src/services/leadExtractor';

const PHONE = '+963935924472';
const baseParams = {
    pageId: 'page-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    sourceType: 'comment' as const, // comment path avoids messagesService history fetch
    senderId: 'sender-1',
    senderName: 'Ali',
    messageText: `Call ${PHONE} please`,
    postMessage: 'Nice product',
    replyText: 'Thanks!',
};

beforeEach(() => {
    vi.clearAllMocks();
    openaiCreateMock.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ phone: PHONE, summary: 's', fields: [] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    });
    insertReturningMock.mockResolvedValue([{ id: 'lead-1', phone: PHONE }]);
});

describe('leadExtractor — new_lead notification firing', () => {
    it('fires new_lead (push-gated) exactly once when the lead is new', async () => {
        selectLimitMock.mockResolvedValue([]); // no existing lead → isNew = true

        await leadExtractorService.maybeCaptureLead(baseParams);

        expect(sendWorkspaceMock).toHaveBeenCalledTimes(1);
        expect(sendWorkspaceMock).toHaveBeenCalledWith(
            'ws-1',
            'new_lead',
            expect.objectContaining({ senderName: 'Ali', phone: PHONE }),
            // Deep-link targets the exact lead so the bell opens that customer's card directly.
            expect.objectContaining({ leadId: 'lead-1', pageId: 'page-1', deepLink: '/leads?leadId=lead-1' }),
            { gatePushBySetting: 'newLeadAlertsEnabled' },
        );
    });

    it('does NOT fire for a repeat sender (existing lead → not new)', async () => {
        selectLimitMock.mockResolvedValue([{ id: 'lead-existing' }]); // existing → isNew = false

        await leadExtractorService.maybeCaptureLead(baseParams);

        expect(sendWorkspaceMock).not.toHaveBeenCalled();
    });

    it('does NOT fire (or even capture) when the message has no phone number', async () => {
        await leadExtractorService.maybeCaptureLead({ ...baseParams, messageText: 'just a question' });

        expect(sendWorkspaceMock).not.toHaveBeenCalled();
        expect(insertReturningMock).not.toHaveBeenCalled();
    });
});

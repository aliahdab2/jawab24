import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageProcessor } from '../../src/services/reply/messageProcessor';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { messagesService } from '../../src/services/messages';
import { conversationsService } from '../../src/services/conversations';
import { replyGenerator } from '../../src/services/reply/generator';
import { rateLimiter } from '../../src/services/protection';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { db } from '../../src/db';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../src/interfaces';

vi.mock('../../src/services/workspaceSettings');
vi.mock('../../src/services/messages');
vi.mock('../../src/services/conversations', () => ({
    conversationsService: {
        findByPageAndSender: vi.fn().mockResolvedValue(null),
        findOrCreate: vi.fn(),
        setSenderName: vi.fn(),
        getSenderName: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock('../../src/services/pages', () => ({
    pagesService: {},
    invalidateWorkspaceStatsCache: vi.fn(),
}));
vi.mock('../../src/services/reply/generator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/generator')>();
    return {
        ...actual,
        replyGenerator: {
            generateForMessage: vi.fn(),
            setLogger: vi.fn(),
        },
    };
});
vi.mock('../../src/services/protection', () => ({
    rateLimiter: {
        check: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
        setLogger: vi.fn(),
    },
}));
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue('notif-id'),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../src/utils/language', () => ({
    detectLanguageCode: vi.fn().mockReturnValue('en'),
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: vi.fn(), set: vi.fn(), quit: vi.fn(), incr: vi.fn(), expire: vi.fn() },
}));
vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true }),
        incrementAiReplies: vi.fn(),
    },
}));
vi.mock('../../src/db', () => ({
    db: {
        transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb({})),
        // select chain used by messageProcessor.resolveOriginPostMessage. Default:
        // returns empty array (row-not-found → origin post not resolved, no postMessage).
        // Individual tests can override via vi.mocked(db.select).mockReturnValueOnce(...).
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn().mockResolvedValue([]),
            })),
        })),
    },
}));
vi.mock('../../src/lib/eventBus', () => ({
    publishSSEEvent: vi.fn(),
}));

// --- Mock adapter factory ---
function createMockAdapter(overrides: Partial<MessagePlatformAdapter> = {}): MessagePlatformAdapter {
    const mockPage: PlatformPage = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'test_workspace_id',
        name: 'Test Page',
        accessToken: 'token-123',
        knowledgeBase: null,
        kbActiveVersion: null,
        autoReplyEnabled: true,
    };

    const mockMessage: StoredMessage = { id: 'msg-uuid', replied: false };

    return {
        platform: 'facebook',
        getPage: vi.fn().mockResolvedValue(mockPage),
        fetchSenderName: vi.fn().mockResolvedValue('Alice'),
        storeIncomingMessage: vi.fn().mockResolvedValue({ message: mockMessage, isNew: true }),
        getInternalMessageId: vi.fn((id: string) => id),
        sendReply: vi.fn().mockResolvedValue(undefined),
        sendAwayMessage: vi.fn().mockResolvedValue(undefined),
        markAsReplied: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('MessageProcessor — Business Profile Enrichment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'What are your hours?', createdTime: new Date() } as any,
        ]);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'We are open 9-6!',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    it('should append business profile to knowledgeBase when page has profile data', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'My Restaurant',
            accessToken: 'token-123',
            knowledgeBase: 'We serve Lebanese food.',
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {
                category: 'Restaurant',
                phone: '+961 1 234 567',
                website: 'https://myrestaurant.com',
                address: 'Downtown',
                city: 'Beirut',
                country: 'Lebanon',
                hours: {
                    mon: ['09:00-22:00'],
                    tue: ['09:00-22:00'],
                    wed: ['09:00-22:00'],
                    fri: ['09:00-23:00'],
                    sat: ['10:00-23:00'],
                },
            },
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
        });

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'What are your hours?', 'msg-1',
        );

        const generatorCall = vi.mocked(replyGenerator.generateForMessage).mock.calls[0];
        const contextArg = generatorCall[0];

        // Original KB preserved
        expect(contextArg.knowledgeBase).toContain('We serve Lebanese food.');
        // Business profile appended
        expect(contextArg.knowledgeBase).toContain('--- Business Info ---');
        expect(contextArg.knowledgeBase).toContain('Business type: Restaurant');
        expect(contextArg.knowledgeBase).toContain('Phone: +961 1 234 567');
        expect(contextArg.knowledgeBase).toContain('Website: https://myrestaurant.com');
        expect(contextArg.knowledgeBase).toContain('Location: Downtown, Beirut, Lebanon');
        expect(contextArg.knowledgeBase).toContain('Monday: 09:00-22:00');
        expect(contextArg.knowledgeBase).toContain('Friday: 09:00-23:00');
        expect(contextArg.knowledgeBase).toContain('Saturday: 10:00-23:00');
    });

    it('should use business profile as sole KB when no static KB exists', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {
                phone: '+44 20 7946 0958',
                hours: { mon: ['08:00-17:00'] },
            },
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
        });

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Are you open?', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.knowledgeBase).toContain('Phone: +44 20 7946 0958');
        expect(contextArg.knowledgeBase).toContain('Monday: 08:00-17:00');
        // No separator when profile is the only content
        expect(contextArg.knowledgeBase).not.toContain('--- Business Info ---');
    });

    it('should leave knowledgeBase unchanged when businessProfile is empty', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: 'Original KB text.',
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: {},
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
        });

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.knowledgeBase).toBe('Original KB text.');
    });

    it('should leave knowledgeBase undefined when both KB and profile are null', async () => {
        const adapter = createMockAdapter(); // default: knowledgeBase=null, no businessProfile

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.knowledgeBase).toBeUndefined();
    });

    it('should still succeed end-to-end with business profile enrichment', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Shop',
            accessToken: 'token-123',
            knowledgeBase: 'We sell electronics.',
            kbActiveVersion: null,
            autoReplyEnabled: true,
            businessProfile: { phone: '+1 800 123 4567' },
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
        });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Phone number?', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('We are open 9-6!');
        expect(adapter.sendReply).toHaveBeenCalled();
    });
});

describe('MessageProcessor — Handoff Re-enqueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
            handoffPauseDurationMinutes: 20,
        } as any);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
    });

    it('should return handoffDelayMs when handoff is active', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(true);
        vi.mocked(messagesService.getRemainingPauseMs).mockResolvedValue(300000); // 5 min remaining
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Handoff active');
        expect(result.handoffDelayMs).toBe(305000); // remaining + 5s buffer
        expect(messagesService.getRemainingPauseMs).toHaveBeenCalledWith('page-uuid', 'sender-1', 20);
    });

    it('should use full pause duration when remaining is 0', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(true);
        vi.mocked(messagesService.getRemainingPauseMs).mockResolvedValue(0);
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.handoffDelayMs).toBe(20 * 60 * 1000); // full 20 min
    });

    it('should not return handoffDelayMs when handoff is not active', async () => {
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'Hello', createdTime: new Date() } as any,
        ]);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Hi!',
            replyMethod: 'ai',
            needsAttention: false,
        });
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.handoffDelayMs).toBeUndefined();
    });
});

describe('MessageProcessor — Guard Conditions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
    });

    it('should return error when page has no user', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue({
                id: 'p', userId: null, workspaceId: 'test_workspace_id', name: 'N', accessToken: 't',
                knowledgeBase: null, kbActiveVersion: null, autoReplyEnabled: true,
            }),
        });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Page has no associated user');
    });

    it('should return error when page has no workspace', async () => {
        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue({
                id: 'p', userId: 'u', workspaceId: null, name: 'N', accessToken: 't',
                knowledgeBase: null, kbActiveVersion: null, autoReplyEnabled: true,
            }),
        });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Page has no associated workspace');
    });
});

describe('MessageProcessor — High-Stakes Notification Wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
    });

    it('should send urgent notification with enriched reason for cancellation_request', async () => {
        // AI flags reply as cancellation_request + needsAttention
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'نأسف لسماع ذلك! خليني أوصل طلبك لفريقنا.',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'cancellation_request',
            aiIntent: 'COMPLAINT',
            aiConfidence: 'high',
        });

        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'ابي الغي طلبي رقم 5678', createdTime: new Date() } as any,
        ]);

        const adapter = createMockAdapter();
        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'ابي الغي طلبي رقم 5678', 'msg-1',
        );

        // Import the mock to check calls
        const { notificationService } = await import('../../src/services/notifications');
        const sendMock = vi.mocked(notificationService.sendTemplateNotificationToWorkspace);

        expect(sendMock).toHaveBeenCalledWith(
            'test_workspace_id',
            'flagged_reply',
            expect.objectContaining({
                reason: expect.stringContaining('cancellation_request'),
            }),
            expect.objectContaining({
                urgent: true,
                type: 'message',
            }),
        );

        // Verify the enriched reason includes the order number
        const reasonArg = sendMock.mock.calls[0][2].reason;
        expect(reasonArg).toContain('5678');
    });

    it('should NOT set urgent for non-urgent flags like low_confidence', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Some reply',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'low_confidence',
            aiIntent: 'QUESTION',
            aiConfidence: 'low',
        });

        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'random question', createdTime: new Date() } as any,
        ]);

        const adapter = createMockAdapter();
        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'random question', 'msg-1',
        );

        const { notificationService } = await import('../../src/services/notifications');
        const sendMock = vi.mocked(notificationService.sendTemplateNotificationToWorkspace);

        expect(sendMock).toHaveBeenCalledWith(
            'test_workspace_id',
            'flagged_reply',
            expect.anything(),
            expect.not.objectContaining({ urgent: true }),
        );
    });

    it('should send urgent notification for refund_request', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'سنعالج طلبك فوراً',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'refund_request',
            aiIntent: 'COMPLAINT',
            aiConfidence: 'high',
        });

        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'I want a refund', createdTime: new Date() } as any,
        ]);

        const adapter = createMockAdapter();
        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'I want a refund', 'msg-1',
        );

        const { notificationService } = await import('../../src/services/notifications');
        const sendMock = vi.mocked(notificationService.sendTemplateNotificationToWorkspace);

        expect(sendMock).toHaveBeenCalledWith(
            'test_workspace_id',
            'flagged_reply',
            expect.objectContaining({
                reason: 'refund_request',
            }),
            expect.objectContaining({
                urgent: true,
            }),
        );
    });
});

describe('MessageProcessor — Page OFF behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
    });

    it('should fetch sender name and store message even when page auto-reply is OFF', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: false, // PAGE IS OFF
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            fetchSenderName: vi.fn().mockResolvedValue('Ahmad'),
            storeIncomingMessage: vi.fn().mockResolvedValue({ message: { id: 'msg-1', replied: false }, isNew: true }),
        });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        // Should return early with auto-reply disabled
        expect(result.success).toBe(false);
        expect(result.error).toContain('Auto-reply disabled');

        // But should have fetched name and stored the message first
        expect(adapter.fetchSenderName).toHaveBeenCalled();
        expect(adapter.storeIncomingMessage).toHaveBeenCalledWith(
            'page-uuid', 'test_workspace_id', 'msg-1', 'sender-1', 'Hello', 'Ahmad',
        );
    });

    it('should not send away message or reply when page is OFF', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: false,
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            storeIncomingMessage: vi.fn().mockResolvedValue({ message: { id: 'msg-1', replied: false }, isNew: true }),
        });

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        // No outbound communication when page is OFF
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(adapter.sendAwayMessage).not.toHaveBeenCalled();
    });

    it('should store message with name even if fetchSenderName fails when page is OFF', async () => {
        const mockPage: PlatformPage = {
            id: 'page-uuid',
            userId: 'user-uuid',
            workspaceId: 'test_workspace_id',
            name: 'Test Page',
            accessToken: 'token-123',
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: false,
        };

        const adapter = createMockAdapter({
            getPage: vi.fn().mockResolvedValue(mockPage),
            fetchSenderName: vi.fn().mockRejectedValue(new Error('API error')),
            storeIncomingMessage: vi.fn().mockResolvedValue({ message: { id: 'msg-1', replied: false }, isNew: true }),
        });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Auto-reply disabled');
        // Name fetch failed but message still stored (with undefined name)
        expect(adapter.storeIncomingMessage).toHaveBeenCalledWith(
            'page-uuid', 'test_workspace_id', 'msg-1', 'sender-1', 'Hello', undefined,
        );
    });
});

describe('MessageProcessor — subscription inactive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
        } as any);
    });

    it('should skip reply when subscription is inactive', async () => {
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(subscriptionsService.enforceAutoReplyGate).mockResolvedValue({ allowed: false, reason: 'Subscription is canceled' });

        const adapter = createMockAdapter();
        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بيشتغل بسوريا؟', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Subscription inactive');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(adapter.sendAwayMessage).not.toHaveBeenCalled();
    });
});

// Follow-up DMs on conversations that originated from a comment should carry the
// originating post text into the AI context — otherwise short/ambiguous follow-ups
// like "تكلفة" or "اوقات الدوام" are classified as SPAM_OR_IRRELEVANT and silently
// skipped. See commentProcessor for the producer side (sets origin_content_id).
describe('MessageProcessor — origin post context inheritance', () => {
    function stubOriginContentRow(row: { message: string; createdAt: Date } | null) {
        vi.mocked(db.select).mockReturnValueOnce({
            from: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(row ? [row] : []),
            })),
        } as any);
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        // Re-establish the default db.select mock cleared by vi.clearAllMocks.
        // Without this, resolveOriginPostMessage calls db.select() → undefined.from() → throw.
        vi.mocked(db.select).mockReturnValue({
            from: vi.fn(() => ({
                where: vi.fn().mockResolvedValue([]),
            })),
        } as any);

        // Prior describe blocks set enforceAutoReplyGate={allowed:false}; restore the default.
        const { subscriptionsService } = await import('../../src/services/subscriptions');
        vi.mocked(subscriptionsService.enforceAutoReplyGate).mockResolvedValue({ allowed: true });

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'تكلفة', createdTime: new Date() } as any,
        ]);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Thanks!',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    it('passes postMessage when conversation has a fresh originContentId', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-42',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({
            message: 'الفريق الدمشقي — دورة TOT الجديدة!',
            createdAt: new Date(), // today — well within staleness window
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'تكلفة', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBe('الفريق الدمشقي — دورة TOT الجديدة!');
    });

    it('does NOT pass postMessage when conversation has no originContentId (off-comment DM)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: null,
            createdAt: new Date(), updatedAt: new Date(),
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hello', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('does NOT pass postMessage when origin post is older than 60 days (staleness guard)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-old',
            createdAt: new Date(), updatedAt: new Date(),
        });
        // 90 days old — beyond the guard
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        stubOriginContentRow({
            message: 'الدورة تبدأ غدا!',
            createdAt: ninetyDaysAgo,
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'متى تبدأ', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('does NOT pass postMessage when origin row was deleted (graceful degrade)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-deleted',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow(null); // post row no longer exists

        const result = await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        expect(result.success).toBe(true); // no throw
        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('does NOT pass postMessage when origin post has null message (image-only post)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-image-only',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({ message: null as any, createdAt: new Date() });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('does NOT pass postMessage when origin post has null createdAt (can\'t age-check)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-no-date',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({ message: 'post body', createdAt: null as any });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        // Without a date we can't verify freshness; degrade to no context
        // rather than risk inheriting arbitrarily old copy.
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('staleness guard — boundary: post exactly 60 days old is treated as stale', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-boundary',
            createdAt: new Date(), updatedAt: new Date(),
        });
        const exactly60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        stubOriginContentRow({ message: 'old post body', createdAt: exactly60d });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        // Boundary is exclusive (`>=` excludes 60d exactly) — prefer safety.
        expect(contextArg.postMessage).toBeUndefined();
    });

    it('staleness guard — 59 days old is still fresh (inside the window)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-fresh-boundary',
            createdAt: new Date(), updatedAt: new Date(),
        });
        const fiftyNineD = new Date(Date.now() - 59 * 24 * 60 * 60 * 1000);
        stubOriginContentRow({ message: 'still-fresh post body', createdAt: fiftyNineD });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBe('still-fresh post body');
    });

    it('uses instagram_media table when the conversation platform is instagram', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'instagram', senderName: 'Alice',
            originContentId: 'media-99',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({
            message: 'Instagram reel caption',
            createdAt: new Date(),
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'كم', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toBe('Instagram reel caption');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Product Card Follow-up
// ─────────────────────────────────────────────────────────────────────────────
//
// When the AI reply carries `productCards`, the processor sends them as a
// follow-up attachment AFTER the text reply. Behavior contract:
//   - Card send must be fire-and-forget — failures don't invalidate the text reply
//   - Adapters without `sendProductCards` (e.g., WhatsApp) get text-only with no error
//   - When `productCards` is empty/undefined, no card send is attempted

describe('MessageProcessor — Product Card Follow-up', () => {
    const sampleCard = {
        title: 'Blue Cotton Shirt',
        subtitle: '120 SAR · In stock',
        imageUrl: 'https://cdn.test/shirt.jpg',
        productUrl: 'https://shop.test/p/blue-shirt',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'do you have the blue shirt?', createdTime: new Date() } as any,
        ]);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
    });

    it('sends product cards via the adapter after the text reply', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Yes, here it is!',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const adapter = createMockAdapter({ sendProductCards: vi.fn().mockResolvedValue(undefined) });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'do you have the blue shirt?', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalledWith(expect.anything(), 'sender-1', 'Yes, here it is!');
        expect(adapter.sendProductCards).toHaveBeenCalledWith(expect.anything(), 'sender-1', [sampleCard]);
    });

    it('does not call sendProductCards when reply has no cards', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Hi there!',
            replyMethod: 'ai',
            needsAttention: false,
        });
        const adapter = createMockAdapter({ sendProductCards: vi.fn() });

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'hi', 'msg-1',
        );

        expect(adapter.sendProductCards).not.toHaveBeenCalled();
    });

    it('treats card send failure as fire-and-forget (text reply still succeeds)', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Sure, take a look:',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const sendProductCards = vi.fn().mockRejectedValue(new Error('IG attachment 400'));
        const adapter = createMockAdapter({ sendProductCards });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'show me', 'msg-1',
        );

        // Text reply already sent → overall pipeline must report success.
        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalled();
        // Wait one tick so the fire-and-forget rejection settles before the assertion below.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(sendProductCards).toHaveBeenCalled();
    });

    it('skips card send entirely when adapter does not implement sendProductCards', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Sure!',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        // Adapter without the optional capability — pipeline must not throw.
        const adapter = createMockAdapter();
        delete (adapter as { sendProductCards?: unknown }).sendProductCards;

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'show me', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).toHaveBeenCalled();
    });
});

/**
 * Regression suite for the webhook-prestore / isNew interaction.
 *
 * Bug: the webhook controller calls `findOrCreateFromWebhook` to persist the
 * incoming message BEFORE enqueuing the worker job (see webhook.ts ~L336).
 * When the worker later calls `adapter.storeIncomingMessage`, the row already
 * exists, so `isNew` comes back false. Code paths that gated on
 * `isNew && ...` therefore never executed under the normal webhook flow,
 * silently dropping:
 *   - the Messenger "Get Started" / "بدء الاستخدام" greeting handoff (AI
 *     ended up answering the system phrase like a real customer question)
 *   - the merchant's configured greeting on first contact
 *   - the away-message auto-reply when messages auto-reply is disabled
 *
 * These tests pin the behavior with `isNew: false` (the real webhook flow)
 * so a future regression that re-adds an `isNew` gate fails loudly here.
 */
describe('MessageProcessor — Greeting & Away with pre-stored webhook message', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'hi', createdTime: new Date() } as any,
        ]);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'template', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'AI reply',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    /** Webhook flow: message already persisted before worker runs → isNew=false. */
    function webhookPreStoredAdapter(overrides: Partial<MessagePlatformAdapter> = {}) {
        return createMockAdapter({
            storeIncomingMessage: vi.fn().mockResolvedValue({
                message: { id: 'msg-uuid', replied: false } as StoredMessage,
                isNew: false,
            }),
            ...overrides,
        });
    }

    it('fires opener greeting for Arabic "بدء الاستخدام" even when isNew=false (webhook pre-stored)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', expect.any(String),
        );
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('fires opener greeting for English "Get Started" even when isNew=false', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('fires merchant-configured greeting on first incoming message when isNew=false', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome to our store!');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'what are your prices?', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'Welcome to our store!',
        );
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('does NOT fire greeting on a non-opener message past the first one (regression: must still respect isFirstIncomingMessage)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'what are your prices?', 'msg-1',
        );

        expect(adapter.sendReply).not.toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'Welcome!',
        );
        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
    });

    it('still fires opener greeting on a repeat "Get Started" tap even though it is not the first message (button is always a system phrase)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('sends the away message on first contact when auto-reply is off, even when isNew=false', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are away — back soon!');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'hello?', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Messages auto-reply disabled');
        expect(adapter.sendAwayMessage).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'We are away — back soon!',
        );
    });

    it('does NOT spam away message on subsequent messages from the same sender', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isFirstIncomingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are away — back soon!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'still there?', 'msg-2',
        );

        expect(adapter.sendAwayMessage).not.toHaveBeenCalled();
    });
});

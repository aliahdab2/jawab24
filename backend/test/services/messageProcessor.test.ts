import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageProcessor } from '../../src/services/reply/messageProcessor';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { messagesService } from '../../src/services/messages';
import { replyGenerator } from '../../src/services/reply/generator';
import { rateLimiter } from '../../src/services/protection';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../src/interfaces';

vi.mock('../../src/services/workspaceSettings');
vi.mock('../../src/services/messages');
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
        canUseAiReplies: vi.fn().mockResolvedValue({ allowed: true }),
        incrementAiReplies: vi.fn(),
    },
}));
vi.mock('../../src/db', () => ({
    db: {
        transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb({})),
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
            id: 'reply-uuid', pageId: 'page-uuid', facebookMessageId: 'reply_123',
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
            id: 'reply-uuid', pageId: 'page-uuid', facebookMessageId: 'reply_123',
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
            id: 'reply-uuid', pageId: 'page-uuid', facebookMessageId: 'reply_123',
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
        const sendMock = vi.mocked(notificationService.sendTemplateNotification);

        expect(sendMock).toHaveBeenCalledWith(
            'user-uuid',
            'flagged_reply',
            expect.objectContaining({
                reason: expect.stringContaining('Cancellation Request'),
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
        const sendMock = vi.mocked(notificationService.sendTemplateNotification);

        expect(sendMock).toHaveBeenCalledWith(
            'user-uuid',
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
        const sendMock = vi.mocked(notificationService.sendTemplateNotification);

        expect(sendMock).toHaveBeenCalledWith(
            'user-uuid',
            'flagged_reply',
            expect.objectContaining({
                reason: 'Refund Request',
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
            'page-uuid', 'msg-1', 'sender-1', 'Hello', 'Ahmad',
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
            'page-uuid', 'msg-1', 'sender-1', 'Hello', undefined,
        );
    });
});

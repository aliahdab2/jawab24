import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from '../../src/services/reply/messageProcessor';
import { messagesService } from '../../src/services/messages';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { createTestUser, createTestWorkspace, createTestPage, insertMessage, insertPause, testDb } from './setup';
import { eq, and } from 'drizzle-orm';
import { messages } from '../../src/db/schema';
import type { MessagePlatformAdapter, PlatformPage } from '../../src/interfaces';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock adapter that stubs external calls but delegates DB writes to real services */
function createMockAdapter(page: PlatformPage, overrides: Partial<MessagePlatformAdapter> = {}): MessagePlatformAdapter {
    return {
        platform: 'facebook',
        getPage: vi.fn().mockResolvedValue(page),
        fetchSenderName: vi.fn().mockResolvedValue('Test Sender'),
        storeIncomingMessage: vi.fn(async (pageId, msgId, senderId, text, senderName) => {
            const { message, isNew } = await messagesService.findOrCreateFromWebhook(
                pageId, msgId, senderId, text, senderName,
            );
            return { message: { id: message.id, replied: message.replied }, isNew };
        }),
        getInternalMessageId: vi.fn((id: string) => id),
        renderReply: vi.fn((text: string) => text),
        sendReply: vi.fn().mockResolvedValue(undefined),
        sendAwayMessage: vi.fn().mockResolvedValue(undefined),
        // Note: markAsReplied is required by the interface but the pipeline
        // calls messagesService.markAsReplied directly, so this is never invoked.
        markAsReplied: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Mocks: external services that the pipeline depends on but that need no DB
// ---------------------------------------------------------------------------

// vi.hoisted runs before vi.mock hoisting, so the fn is available in factories
const { mockGenerateForMessage } = vi.hoisted(() => ({
    mockGenerateForMessage: vi.fn().mockResolvedValue({
        replyText: 'Mocked AI reply',
        replyMethod: 'ai' as const,
        needsAttention: false,
        flagReason: undefined,
        aiIntent: 'GREETING',
    }),
}));

// Rate limiter (Redis-backed) — always allow
vi.mock('../../src/services/protection', () => ({
    rateLimiter: {
        check: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
        setLogger: vi.fn(),
    },
    commentDebounce: {
        isCoolingDown: vi.fn().mockResolvedValue(false),
        arm: vi.fn().mockResolvedValue(undefined),
        setLogger: vi.fn(),
    },
}));

// Reply generator (AI/template) — return a canned reply
vi.mock('../../src/services/reply/generator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/reply/generator')>();
    return {
        ...actual,
        replyGenerator: {
            generateForMessage: mockGenerateForMessage,
            setLogger: vi.fn(),
        },
    };
});

// Notification service — no-op
vi.mock('../../src/services/notifications', () => ({
    notificationService: {
        sendTemplateNotification: vi.fn().mockResolvedValue(undefined),
        sendTemplateNotificationToWorkspace: vi.fn().mockResolvedValue(undefined),
    },
}));

// Reply lock (Redis-backed) — always grant lock
vi.mock('../../src/lib/replyLock', () => ({
    acquireReplyLock: vi.fn().mockResolvedValue('mock-lock-token'),
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));

// Subscription check — always active (subscription logic tested elsewhere)
vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: {
        enforceAutoReplyGate: vi.fn().mockResolvedValue({ allowed: true }),
    },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Message Pipeline — Integration (real Postgres)', () => {
    let processor: MessageProcessor;
    let userId: string;
    let workspaceId: string;
    let pageId: string;
    let platformPage: PlatformPage;
    const senderId = 'sender-pipeline-test';

    beforeEach(async () => {
        processor = new MessageProcessor();
        pipelineMetrics.reset();
        mockGenerateForMessage.mockClear();

        const user = await createTestUser();
        userId = user.id;
        const workspace = await createTestWorkspace(userId);
        workspaceId = workspace.id;
        const page = await createTestPage(userId, { facebookPageId: 'page-fb-pipeline', workspaceId });
        pageId = page.id;

        platformPage = {
            id: page.id,
            userId: page.userId,
            workspaceId: page.workspaceId,
            name: page.name,
            accessToken: page.accessToken,
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
        };

        // Ensure workspace settings exist with messages auto-reply ON
        await workspaceSettingsService.updateSettings(workspaceId, { messagesAutoReply: true });
    });

    // =========================================================
    // 1. Happy path: new message → stored → replied
    // =========================================================
    it('processes a new message end-to-end: stores, replies, and marks as replied', async () => {
        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Hello!', 'fb-happy-001',
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('Mocked AI reply');
        expect(result.replyMethod).toBe('ai');

        // Verify message was stored in DB
        const [row] = await testDb
            .select()
            .from(messages)
            .where(eq(messages.platformMessageId, 'fb-happy-001'));
        expect(row).toBeDefined();
        expect(row.senderId).toBe(senderId);
        expect(row.message).toBe('Hello!');
        expect(row.replied).toBe(true);
        expect(row.replyText).toBe('Mocked AI reply');
        expect(row.replyMethod).toBe('ai');
        expect(row.repliedAt).toBeTruthy();

        // Verify outgoing message was stored
        const outgoing = await testDb
            .select()
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.direction, 'outgoing'),
                eq(messages.senderId, senderId),
            ));
        expect(outgoing.length).toBe(1);
        expect(outgoing[0].message).toBe('Mocked AI reply');

        // Verify adapter.sendReply was called
        expect(adapter.sendReply).toHaveBeenCalledOnce();

        // Verify pipeline metrics recorded success
        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters['facebook_message.success']).toBe(1);
    });

    // =========================================================
    // 2. Debounce: newer message skips older
    // =========================================================
    it('skips older message when a newer unreplied message exists (debounce)', async () => {
        // The debounce fast-path only runs when replyDelay === 0; with a non-zero
        // delay the reply delay doubles as a consolidation window instead (see
        // messageProcessor step 4). Pin it to 0 so this test exercises debounce
        // regardless of the default.
        await workspaceSettingsService.updateSettings(workspaceId, { replyDelay: 0 });

        // Pre-insert two messages: older (msg-1) and newer (msg-2)
        await insertMessage(pageId, senderId, {
            platformMessageId: 'fb-debounce-old',
            message: 'First',
            createdAt: new Date('2026-02-01T10:00:00Z'),
        });
        await insertMessage(pageId, senderId, {
            platformMessageId: 'fb-debounce-new',
            message: 'Second',
            createdAt: new Date('2026-02-01T10:00:01Z'),
        });

        // Process the OLDER message — should be debounced
        const adapter = createMockAdapter(platformPage, {
            storeIncomingMessage: vi.fn(async () => {
                // Return the already-existing older message
                const existing = await testDb.select().from(messages)
                    .where(eq(messages.platformMessageId, 'fb-debounce-old'));
                return {
                    message: { id: existing[0].id, replied: false },
                    isNew: false,
                };
            }),
            getInternalMessageId: vi.fn(() => 'fb-debounce-old'),
        });

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'First', 'fb-debounce-old',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('newer message pending');
        expect(adapter.sendReply).not.toHaveBeenCalled();
    });

    // =========================================================
    // 3. Consolidation: multiple unreplied → single reply
    // =========================================================
    it('consolidates multiple unreplied messages into a single AI prompt', async () => {
        // Pre-insert 3 unreplied messages
        await insertMessage(pageId, senderId, {
            platformMessageId: 'fb-cons-1',
            message: 'Hello',
            createdAt: new Date('2026-02-01T10:00:00Z'),
        });
        await insertMessage(pageId, senderId, {
            platformMessageId: 'fb-cons-2',
            message: 'Are you there?',
            createdAt: new Date('2026-02-01T10:00:01Z'),
        });
        await insertMessage(pageId, senderId, {
            platformMessageId: 'fb-cons-3',
            message: 'Please reply!',
            createdAt: new Date('2026-02-01T10:00:02Z'),
        });

        // Process the newest — it should consolidate all 3
        const adapter = createMockAdapter(platformPage, {
            getInternalMessageId: vi.fn(() => 'fb-cons-3'),
        });

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Please reply!', 'fb-cons-3',
        );

        expect(result.success).toBe(true);

        // Verify the AI was called with consolidated text
        expect(mockGenerateForMessage).toHaveBeenCalledOnce();
        const calledWith = mockGenerateForMessage.mock.calls[0][0];
        expect(calledWith.text).toContain('Hello');
        expect(calledWith.text).toContain('Are you there?');
        expect(calledWith.text).toContain('Please reply!');

        // Verify all 3 messages are now marked as replied
        const allMsgs = await testDb
            .select()
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.senderId, senderId),
                eq(messages.direction, 'incoming'),
            ));

        const unreplied = allMsgs.filter(m => !m.replied);
        expect(unreplied.length).toBe(0);
    });

    // =========================================================
    // 4. Paused conversation skips auto-reply
    // =========================================================
    it('skips auto-reply when conversation is paused', async () => {
        // Insert an active pause
        const futureDate = new Date(Date.now() + 30 * 60 * 1000);
        await insertPause(pageId, senderId, futureDate);

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Hello', 'fb-pause-001',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Handoff active');
        expect(adapter.sendReply).not.toHaveBeenCalled();

        // Message should still be stored but NOT replied
        const [row] = await testDb
            .select()
            .from(messages)
            .where(eq(messages.platformMessageId, 'fb-pause-001'));
        expect(row).toBeDefined();
        expect(row.replied).toBe(false);
    });

    // =========================================================
    // 5. needsAttention flag stored correctly
    // =========================================================
    it('stores needsAttention and flagReason when AI flags the reply', async () => {
        mockGenerateForMessage.mockResolvedValueOnce({
            replyText: 'Sorry about that',
            replyMethod: 'ai' as const,
            needsAttention: true,
            flagReason: 'angry_customer',
            aiIntent: 'COMPLAINT',
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'This is terrible!', 'fb-flag-001',
        );

        expect(result.success).toBe(true);

        const [row] = await testDb
            .select()
            .from(messages)
            .where(eq(messages.platformMessageId, 'fb-flag-001'));
        expect(row.needsAttention).toBe(true);
        expect(row.flagReason).toBe('angry_customer');
        expect(row.aiIntent).toBe('COMPLAINT');
    });

    // =========================================================
    // 6. Offensive message → skip reply, flag, notify
    // =========================================================
    it('skips reply for offensive message: stores, flags, but does NOT send reply', async () => {
        mockGenerateForMessage.mockResolvedValueOnce({
            replyText: 'Some generated reply',
            replyMethod: 'ai' as const,
            needsAttention: true,
            flagReason: 'offensive_or_abusive',
            aiIntent: 'OFFENSIVE',
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Go away!', 'fb-offensive-001',
        );

        expect(result.success).toBe(true);
        // Reply should NOT be sent
        expect(adapter.sendReply).not.toHaveBeenCalled();

        // Message should be stored but NOT replied
        const [row] = await testDb
            .select()
            .from(messages)
            .where(eq(messages.platformMessageId, 'fb-offensive-001'));
        expect(row).toBeDefined();
        expect(row.replied).toBe(false);
        expect(row.needsAttention).toBe(true);
        expect(row.flagReason).toBe('offensive_or_abusive');
        expect(row.aiIntent).toBe('OFFENSIVE');

        // No outgoing message should exist
        const outgoing = await testDb
            .select()
            .from(messages)
            .where(and(
                eq(messages.pageId, pageId),
                eq(messages.direction, 'outgoing'),
                eq(messages.senderId, senderId),
            ));
        expect(outgoing.length).toBe(0);

        // Pipeline metric recorded
        const metrics = await pipelineMetrics.getMetrics();
        expect(metrics.counters['facebook_message.skipped_risky']).toBe(1);
    });

    // =========================================================
    // 7. Price fallback → safe reply replaces AI text
    // =========================================================
    it('replaces hallucinated price with safe fallback text', async () => {
        mockGenerateForMessage.mockResolvedValueOnce({
            replyText: 'The price is $999!',
            replyMethod: 'ai' as const,
            needsAttention: true,
            flagReason: 'price_not_in_kb',
            aiIntent: 'PURCHASE_INTENT',
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'How much does it cost?', 'fb-price-001',
        );

        expect(result.success).toBe(true);
        // Reply IS sent, but NOT with the hallucinated price
        expect(adapter.sendReply).toHaveBeenCalledOnce();
        expect(result.replyText).not.toContain('$999');
        expect(result.replyText).toContain('Thank you for your interest');

        // Message should be marked as replied with fallback text
        const [row] = await testDb
            .select()
            .from(messages)
            .where(eq(messages.platformMessageId, 'fb-price-001'));
        expect(row.replied).toBe(true);
        expect(row.replyText).toContain('Thank you for your interest');
        expect(row.needsAttention).toBe(true);
        expect(row.flagReason).toBe('price_not_in_kb');
    });

    // =========================================================
    // 8. Auto-reply disabled → away message sent
    // =========================================================
    it('sends away message when messages auto-reply is disabled', async () => {
        await workspaceSettingsService.updateSettings(workspaceId, {
            messagesAutoReply: false,
            awayMessageMulti: { en: 'We are currently away.', ar: 'We are currently away.' },
        });

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Hello', 'fb-away-001',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Messages auto-reply disabled');
        expect(adapter.sendAwayMessage).toHaveBeenCalledWith(
            platformPage, senderId, 'We are currently away.',
        );
    });

    // =========================================================
    // 9. Settings-path: pipeline resolves settings via page.workspaceId
    // =========================================================
    it('resolves settings from page.workspaceId and applies them correctly', async () => {
        // Configure specific settings for this workspace
        await workspaceSettingsService.updateSettings(workspaceId, {
            messagesAutoReply: true,
            businessHoursOnly: false,
            replyDelay: 0,
        });

        // Spy on workspaceSettingsService.getSettings to verify the pipeline uses page.workspaceId
        const getSettingsSpy = vi.spyOn(workspaceSettingsService, 'getSettings');

        const adapter = createMockAdapter(platformPage);

        const result = await processor.processMessage(
            adapter, 'page-fb-pipeline', senderId, 'Settings path test', 'fb-settings-001',
        );

        expect(result.success).toBe(true);
        expect(result.replyText).toBe('Mocked AI reply');
        // KEY ASSERTION: pipeline resolved settings using page.workspaceId
        expect(getSettingsSpy).toHaveBeenCalledWith(workspaceId);

        getSettingsSpy.mockRestore();
    });

    it('uses correct workspace settings for different workspaces on different pages', async () => {
        // Create a second user with a separate workspace and different settings
        const user2 = await createTestUser({ facebookId: 'fb-user2-settings', email: 'user2-settings@test.com' });
        const workspace2 = await createTestWorkspace(user2.id, { name: 'Workspace 2' });
        await workspaceSettingsService.updateSettings(workspace2.id, {
            messagesAutoReply: false,
            awayMessageMulti: { en: 'User 2 is away', ar: 'User 2 is away' },
        });

        const page2 = await createTestPage(user2.id, { facebookPageId: 'page-fb-user2', workspaceId: workspace2.id });
        const platformPage2: PlatformPage = {
            id: page2.id,
            userId: page2.userId,
            workspaceId: page2.workspaceId,
            name: page2.name,
            accessToken: page2.accessToken,
            knowledgeBase: null,
            kbActiveVersion: null,
            autoReplyEnabled: true,
        };

        // Spy on settings to verify each pipeline call uses the correct workspaceId
        const getSettingsSpy = vi.spyOn(workspaceSettingsService, 'getSettings');

        // Workspace 1 (original): messagesAutoReply=true → should get reply
        const adapter1 = createMockAdapter(platformPage);
        const result1 = await processor.processMessage(
            adapter1, 'page-fb-pipeline', senderId, 'Hello user1', 'fb-iso-user1',
        );
        expect(result1.success).toBe(true);
        expect(result1.replyText).toBe('Mocked AI reply');

        // Workspace 2: messagesAutoReply=false → should get away message
        const adapter2 = createMockAdapter(platformPage2);
        const result2 = await processor.processMessage(
            adapter2, 'page-fb-user2', senderId, 'Hello user2', 'fb-iso-user2',
        );
        expect(result2.success).toBe(false);
        expect(result2.error).toContain('Messages auto-reply disabled');
        expect(adapter2.sendAwayMessage).toHaveBeenCalledWith(
            platformPage2, senderId, 'User 2 is away',
        );

        // KEY ASSERTION: each pipeline call resolved settings for the correct workspaceId
        expect(getSettingsSpy).toHaveBeenCalledWith(workspaceId);
        expect(getSettingsSpy).toHaveBeenCalledWith(workspace2.id);

        getSettingsSpy.mockRestore();
    });
});

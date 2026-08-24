import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { messageProcessor } from '../../src/services/reply/messageProcessor';
import { noopLogger } from '../../src/types';
import { workspaceSettingsService } from '../../src/services/workspaceSettings';
import { messagesService } from '../../src/services/messages';
import { invalidateWorkspaceStatsCache } from '../../src/services/pages';
import { conversationsService } from '../../src/services/conversations';
import { replyGenerator } from '../../src/services/reply/generator';
import { leadExtractorService } from '../../src/services/leadExtractor';
import { rateLimiter } from '../../src/services/protection';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';
import { redis } from '../../src/lib/redis';
import { db } from '../../src/db';
// Identity of these tables is what the origin-post lookup is matched on — see
// originContentRow in the 'origin post context inheritance' describe.
import { posts, instagramMedia } from '../../src/db/schema';
import type { MessagePlatformAdapter, PlatformPage, StoredMessage } from '../../src/interfaces';
import { DmSendError } from '../../src/utils/fbGraphErrors';
import { withPageTokenRetry } from '../../src/services/pageTokenRecovery';
import { WORST_CASE_ENRICHMENT_MS } from '../../src/services/imageUnderstanding';

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
    detectTemplateLanguage: vi.fn().mockReturnValue('en'),
    isLowSignalLatinToken: vi.fn().mockReturnValue(false),
}));
// Stateful fake, not per-test stubs. The typing indicator's contract spans get + set
// (an NX claim, then an upgrade to 'sent', then a read from a DIFFERENT process), so
// stubbing `set` alone let `wasShown` silently read undefined and hid a real bug.
// Supports the NX flag; everything else is a plain key/value store.
vi.mock('../../src/lib/redis', () => {
    const store = new Map<string, string>();
    return {
        redis: {
            __store: store,
            get: vi.fn(async (key: string) => store.get(key) ?? null),
            set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
                if (args.includes('NX') && store.has(key)) return null;
                store.set(key, value);
                return 'OK';
            }),
            // The product-card cooldown reads with MGET and writes with a pipeline
            // (see productCardBuilder). Backed by the same map so a card marked
            // sent in one call is really seen by the next.
            mget: vi.fn(async (...keys: string[]) => keys.map(k => store.get(k) ?? null)),
            pipeline: vi.fn(() => {
                const queued: [string, string][] = [];
                const chain = {
                    set: (key: string, value: string) => { queued.push([key, value]); return chain; },
                    exec: async () => { for (const [k, v] of queued) store.set(k, v); return []; },
                };
                return chain;
            }),
            quit: vi.fn(),
            incr: vi.fn(),
            expire: vi.fn(),
        },
    };
});
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

vi.mock('../../src/services/leadExtractor', () => ({
    leadExtractorService: { maybeCaptureLead: vi.fn().mockResolvedValue(undefined) },
}));

// Pass-through by default, so every other test in this file keeps exercising the
// real send exactly as before. The recovery behaviour itself is covered in
// pageTokenRecovery.test.ts; what needs pinning HERE is the WIRING — which
// platforms route their send through it and which must not.
vi.mock('../../src/services/pageTokenRecovery', () => ({
    withPageTokenRetry: vi.fn(async (page: { accessToken: string }, call: (token: string) => Promise<unknown>) => call(page.accessToken)),
    handlePageTokenFailure: vi.fn().mockResolvedValue(null),
}));

// --- Mock adapter factory ---
// Root-level, so it runs before every describe's own beforeEach.
//
// Two jobs: (1) clear the fake store — platformMessageId 'msg-1' is reused throughout the
// file, so a leftover typing-dedup claim would make every later show() a no-op; and
// (2) RE-ESTABLISH the stateful implementations, so a per-test override (the away-message
// cooldown tests deliberately force NX outcomes) cannot leak into the next test.
// `vi.clearAllMocks()` keeps implementations, so without this a single `mockReset` or
// `mockResolvedValue` would silently reshape Redis for the rest of the file.
beforeEach(() => {
    const store = (redis as unknown as { __store: Map<string, string> }).__store;
    store.clear();
    vi.mocked(redis.get).mockImplementation((async (key: string) => store.get(key) ?? null) as never);
    vi.mocked(redis.set).mockImplementation((async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
    }) as never);
});

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
        renderReply: vi.fn((text: string) => text),
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
        expect(contextArg.knowledgeBase).toContain('Website: https://myrestaurant.com');
        // Operational facts (phone/address/hours) are NOT in the narrative — they reach the
        // model only via the provenance-gated BUSINESS_INFO block (D-010), never the KB text.
        expect(contextArg.knowledgeBase).not.toContain('Phone:');
        expect(contextArg.knowledgeBase).not.toContain('Location:');
        expect(contextArg.knowledgeBase).not.toContain('Monday:');
        expect(contextArg.knowledgeBase).not.toContain('Friday:');
        expect(contextArg.knowledgeBase).not.toContain('Saturday:');
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
                about: 'Family-run print shop.',
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
        expect(contextArg.knowledgeBase).toContain('About: Family-run print shop.');
        // Operational facts (phone/hours) are gated to BUSINESS_INFO (D-010), not the narrative KB.
        expect(contextArg.knowledgeBase).not.toContain('Phone');
        expect(contextArg.knowledgeBase).not.toContain('Monday');
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

    // PROD 2026-08-23 (Salla page, Messenger): once real storefront links entered
    // the catalog block the model wrote `![فستان](<product page>)` and Messenger
    // showed it literally. Rendering is the ADAPTER's job (it knows its channel);
    // the pipeline must call it before sending AND persist the rendered text, so
    // the stored row is what the customer saw.
    it('renders the reply through the adapter before sending, and persists the rendered text', async () => {
        const { renderReplyForChannel } = await import('@jawab24/shared');
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'هذه صورة الفستان:\n![فستان](https://demostore.salla.sa/dev-x/فستان/p348732197)',
            replyMethod: 'ai',
            needsAttention: false,
        });
        const adapter = createMockAdapter({
            renderReply: vi.fn((text: string) => renderReplyForChannel(text, 'plain')),
        });

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'بدي صورة', 'msg-1');

        const rendered = 'هذه صورة الفستان:\nhttps://demostore.salla.sa/dev-x/فستان/p348732197';
        expect(adapter.renderReply).toHaveBeenCalledTimes(1);
        expect(adapter.sendReply).toHaveBeenCalledWith(expect.anything(), 'sender-1', rendered);
        expect(result.replyText).toBe(rendered);
        // The persisted outgoing row carries the rendered text, never the markdown.
        const stored = vi.mocked(messagesService.storeOutgoingMessage).mock.calls.at(-1) ?? [];
        expect(stored).toContain(rendered);
        expect(stored.some(a => typeof a === 'string' && a.includes(']('))).toBe(false);
    });

    // Rule 17.6: latency must be observable. The 16 stage laps existed for months
    // at debug level while prod runs at info — so the timings were dark exactly
    // where they matter. This pins that the reply_sent info line carries the
    // per-stage delta map, so a production log query can answer "which stage was
    // slow" without redeploying at debug level.
    it('carries per-stage timings on the reply_sent info line', async () => {
        const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
        messageProcessor.setLogger(logger as never);
        try {
            const adapter = createMockAdapter();
            const result = await messageProcessor.processMessage(
                adapter, 'page-1', 'sender-1', 'What are your hours?', 'msg-1',
            );
            expect(result.success).toBe(true);

            const replySent = logger.info.mock.calls.find(c => String(c[0]).includes('reply_sent'));
            expect(replySent).toBeDefined();
            const meta = replySent![1] as { durationMs: number; stages: Record<string, number> };
            // The stages that always run on a sent AI reply must be present, as
            // per-stage DELTAS (numbers), ending with the DONE marker.
            for (const stage of ['1-getPage', '3-storeMessage', '12-generateReply', '13-sendReply', 'DONE']) {
                expect(meta.stages[stage], stage).toBeTypeOf('number');
            }
            // Deltas, not cumulative clocks: their sum cannot exceed the total.
            const sum = Object.values(meta.stages).reduce((a, b) => a + b, 0);
            expect(sum).toBeLessThanOrEqual(meta.durationMs + 1);
        } finally {
            messageProcessor.setLogger(noopLogger as never);
        }
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

describe('MessageProcessor — webhook-supplied sender name', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
    });

    // Regression: WhatsApp has no profile API — the webhook's
    // contacts[].profile.name is the ONLY name source, but it was dropped
    // before reaching the pipeline, so every WhatsApp conversation showed
    // "Unknown User" (founder pilot, 2026-07-08).
    it('uses the webhook name and skips the adapter lookup when provided', async () => {
        const adapter = createMockAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'مرحبا', 'msg-1',
            undefined, undefined, false, 0, 'Pilot Customer',
        );

        expect(adapter.fetchSenderName).not.toHaveBeenCalled();
        // storeIncomingMessage(pageId, workspaceId, platformMessageId, senderId, text, senderName)
        expect(adapter.storeIncomingMessage).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), 'msg-1', 'sender-1', 'مرحبا', 'Pilot Customer',
        );
    });

    it('falls back to the adapter lookup when the webhook carries no name (FB/IG)', async () => {
        const adapter = createMockAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Hello', 'msg-1',
        );

        expect(adapter.fetchSenderName).toHaveBeenCalled();
        expect(adapter.storeIncomingMessage).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), 'msg-1', 'sender-1', 'Hello', 'Alice',
        );
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

    it('should send an urgent skipped_reply for an offensive DM', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'offensive',
            aiIntent: 'OFFENSIVE',
        } as any);

        const adapter = createMockAdapter();
        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'abusive text', 'msg-1',
        );

        const { notificationService } = await import('../../src/services/notifications');
        const sendMock = vi.mocked(notificationService.sendTemplateNotificationToWorkspace);

        expect(sendMock).toHaveBeenCalledWith(
            'test_workspace_id',
            'skipped_reply',
            expect.anything(),
            expect.objectContaining({ urgent: true }),
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
    /**
     * Row the origin-post lookup should return, consulted by the table-aware `db.select`
     * mock in `beforeEach`.
     *
     * This used to be a one-shot `mockReturnValueOnce`, which silently assumed
     * `resolveOriginPostMessage` issued the NEXT `db.select()` call. It no longer does:
     * step 11b-12 runs `resolveOriginPostMessage` and `enrichPageContext` concurrently,
     * and `resolveOriginPostMessage` awaits `findByPageAndSender` before its own
     * `db.select()` — so that yield let `enrichPageContext` consume the one-shot stub and
     * every assertion here read `undefined`. Keying on the TABLE tests the behaviour
     * (which query returns what) instead of the call ordering, so it stays correct however
     * the pipeline schedules these two reads.
     */
    let originContentRow: { message: string | null; createdAt: Date; triggerReply?: string | null } | null = null;
    function stubOriginContentRow(row: { message: string | null; createdAt: Date; triggerReply?: string | null } | null) {
        originContentRow = row;
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
        originContentRow = null;

        // Re-establish the default db.select mock cleared by vi.clearAllMocks.
        // Without this, resolveOriginPostMessage calls db.select() → undefined.from() → throw.
        //
        // Table-aware: only the origin-post lookup (posts / instagram_media) sees the
        // stubbed row; every other concurrent read in the pipeline gets []. See
        // originContentRow above for why call-order stubbing is not usable here.
        vi.mocked(db.select).mockImplementation(() => ({
            from: vi.fn((table: unknown) => ({
                where: vi.fn().mockResolvedValue(
                    originContentRow && (table === posts || table === instagramMedia)
                        ? [originContentRow]
                        : [],
                ),
            })),
        }) as any);

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

    // The merchant's Post Reply (trigger reply) is merchant-authored just like the post —
    // both must reach the AI as usable facts. The صيدلية زينب عباس incident (2026-07-19):
    // 93-char post caption with no price, 914-char Post Reply WITH the price → the AI
    // deflected a price question and the customer called it fraud.
    it('composes post text + the merchant Post Reply when the origin post has a trigger reply', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-42',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({
            message: 'كريم غو ريبير — منشور قصير',
            triggerReply: 'تفاصيل المنتج... السعر :38 ألف — متوفر في صيدلية زينب',
            createdAt: new Date(),
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'السعر لو سمحتي', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toContain('كريم غو ريبير — منشور قصير');
        expect(contextArg.postMessage).toContain("[The merchant's automatic reply already sent to this customer for this post]");
        expect(contextArg.postMessage).toContain('السعر :38 ألف');
    });

    it('passes the Post Reply alone when the origin post has no text (image-only post with a trigger)', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-image-only',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({
            message: null,
            triggerReply: 'العرض: قطعتان بسعر 50 ألف',
            createdAt: new Date(),
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'كم السعر', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(contextArg.postMessage).toContain('العرض: قطعتان بسعر 50 ألف');
        expect(contextArg.postMessage).toContain("[The merchant's automatic reply");
    });

    it('caps the post text at 500 chars in the composition so the Post Reply tail always survives', async () => {
        vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue({
            id: 'conv-1', pageId: 'page-uuid', senderId: 'sender-1',
            platform: 'facebook', senderName: 'Alice',
            originContentId: 'post-long',
            createdAt: new Date(), updatedAt: new Date(),
        });
        stubOriginContentRow({
            message: 'p'.repeat(600),
            triggerReply: 'r'.repeat(900) + ' السعر :38 ألف',
            createdAt: new Date(),
        });

        await messageProcessor.processMessage(
            createMockAdapter(), 'page-1', 'sender-1', 'السعر', 'msg-1',
        );

        const contextArg = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        // Post text truncated to 500…
        expect(contextArg.postMessage).toContain('p'.repeat(500));
        expect(contextArg.postMessage).not.toContain('p'.repeat(501));
        // …and the reply's tail (the price) is intact; total fits the ai-worker 1600 cap.
        expect(contextArg.postMessage).toContain('السعر :38 ألف');
        expect(contextArg.postMessage!.length).toBeLessThanOrEqual(1600);
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

    // ─────────────────────────────────────────────────────────────────────────
    // Step 11b-12 runs the typing indicator and the two pre-AI reads concurrently.
    //
    // The typing indicator is a Meta Graph round-trip (prod Sentry: Meta calls average
    // 295-1,088 ms) and it used to be awaited in front of two database reads that need
    // nothing from it. Concurrency hides the SHORT branches behind the long one, so the
    // saving is the DB time, not the Meta call — benchmarked at 320 ms → 303 ms with Meta
    // stubbed at 300 ms and one DB read at 15 ms. Tens of milliseconds per DM, not a third
    // of a second; see the comment at step 11b-12 for why, and for the separate change
    // that would remove the Meta wait itself.
    //
    // These two tests pin the behaviour and the hazard the change had to avoid — losing
    // the indicator-cleanup signal when a sibling rejects.
    // ─────────────────────────────────────────────────────────────────────────
    describe('pre-AI I/O runs concurrently', () => {
        // The stateful Redis fake (root beforeEach) already grants the typing-dedup NX
        // claim, so no `redis.set` stub is needed here.
        //
        // `vi.clearAllMocks()` in sibling describes clears CALLS but keeps implementations,
        // so the rejection stubbed below would otherwise leak forward and fail every later
        // test in this file. Restore the default from the `vi.mock('…/conversations')`
        // factory.
        afterEach(() => {
            vi.mocked(conversationsService.findByPageAndSender).mockResolvedValue(null);
        });

        it('starts the DB reads WITHOUT waiting for the Meta typing round-trip', async () => {
            const order: string[] = [];
            let releaseTyping!: () => void;
            const typingGate = new Promise<void>((resolve) => { releaseTyping = resolve; });

            const adapter = createMockAdapter({
                sendTypingIndicator: vi.fn(async () => {
                    order.push('typing:sent-to-meta');
                    await typingGate; // stand in for Meta's latency
                    order.push('typing:meta-acked');
                }),
                sendTypingOff: vi.fn().mockResolvedValue(undefined),
            });

            // resolveOriginPostMessage's first step, and a sibling of the typing call.
            vi.mocked(conversationsService.findByPageAndSender).mockImplementation(async () => {
                order.push('originPost:db-read');
                return null; // no origin content — irrelevant to the ordering assertion
            });

            const processing = messageProcessor.processMessage(
                adapter, 'page-1', 'sender-1', 'كم السعر', 'msg-1',
            );

            // Let the pipeline run up to the point where it is blocked on Meta only.
            for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

            // THE ASSERTION: the DB read already happened while Meta is still pending.
            // Serial code could only produce sent-to-meta → meta-acked → db-read.
            expect(order).toContain('typing:sent-to-meta');
            expect(order).toContain('originPost:db-read');
            expect(order).not.toContain('typing:meta-acked');

            releaseTyping();
            await processing;
            expect(order.indexOf('originPost:db-read')).toBeLessThan(order.indexOf('typing:meta-acked'));
        });

        it('still clears the indicator when a sibling read rejects before Meta answers', async () => {
            // The hazard of parallelising: assigning `typingShown` after `Promise.all`
            // means a sibling rejection skips the assignment entirely, and the `finally`
            // block then never clears the indicator — stranding "typing..." on the
            // customer's screen for ~20s. The cleanup reads the PROMISE for this reason.
            const sendTypingOff = vi.fn().mockResolvedValue(undefined);
            const adapter = createMockAdapter({
                // Resolves on a later tick than the rejection below.
                sendTypingIndicator: vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); }),
                sendTypingOff,
            });

            vi.mocked(conversationsService.findByPageAndSender).mockRejectedValue(
                new Error('DB connection lost mid-pipeline'),
            );

            await messageProcessor.processMessage(
                adapter, 'page-1', 'sender-1', 'كم السعر', 'msg-1',
            ).catch(() => { /* the rejection is the point; cleanup is what we assert */ });

            expect(sendTypingOff).toHaveBeenCalled();
        });
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

    // --- Cooldown ordering (the two Critical findings on PR #876) ------------

    it('never awaits the cooldown between the delivered reply and the mark-as-replied transaction', async () => {
        // BLAST RADIUS: this is the shared send path for every FB/IG/WhatsApp DM.
        // An await here widens the window in which a crash leaves a reply that is
        // already on the wire unmarked — and the retry then sends it TWICE.
        // A cooldown read that never settles must therefore not hold the pipeline.
        vi.mocked(redis.mget).mockReturnValueOnce(new Promise(() => { }) as never);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Sure, take a look:',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const adapter = createMockAdapter({ sendProductCards: vi.fn().mockResolvedValue(undefined) });

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'show me', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(messagesService.markAsReplied).toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).toHaveBeenCalled();
    });

    it('sends a card once per customer per day, then suppresses the repeat', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Yes, here it is!',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const sendProductCards = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendProductCards });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'the shirt?', 'msg-1');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'and the shirt again?', 'msg-2');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(sendProductCards).toHaveBeenCalledTimes(1);
    });

    it('does NOT burn the cooldown when the card send fails — the next turn tries again', async () => {
        // Claiming the window before the send meant a card the customer never saw
        // silenced itself for 24h, inverting the "fails open, never a missing
        // card" contract the cooldown documents.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Sure, take a look:',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const sendProductCards = vi.fn()
            .mockRejectedValueOnce(new Error('IG attachment 400'))
            .mockResolvedValueOnce(undefined);
        const adapter = createMockAdapter({ sendProductCards });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'show me', 'msg-1');
        await new Promise<void>((resolve) => setImmediate(resolve));
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'show me again', 'msg-2');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(sendProductCards).toHaveBeenCalledTimes(2);
    });

    it('does not touch the cooldown at all on a platform that cannot send cards', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Sure!',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [sampleCard],
        });
        const adapter = createMockAdapter();
        delete (adapter as { sendProductCards?: unknown }).sendProductCards;

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'show me', 'msg-1');
        await new Promise<void>((resolve) => setImmediate(resolve));

        // WhatsApp has no card support — writing a 24h key for a card that is
        // structurally impossible to deliver is pure waste, and a live suppression
        // the day it gains support.
        expect(redis.mget).not.toHaveBeenCalled();
        expect(redis.pipeline).not.toHaveBeenCalled();
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
 *   - the Messenger "Get Started" / "بدء الاستخدام" opener suppression (AI
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

    it('silently suppresses Arabic "بدء الاستخدام" opener when no custom greeting is configured', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
        expect(messagesService.markAsReplied).toHaveBeenCalledWith('msg-uuid', '', 'template');
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('silently suppresses English "Get Started" opener when no custom greeting is configured', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('fires the configured greeting on Arabic "بدء الاستخدام" opener when toggle is ON (industry-standard welcome flow)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'ar' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('مرحباً بك في متجرنا');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'مرحباً بك في متجرنا',
        );
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('fires the configured greeting on English "Get Started" opener when toggle is ON', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome to our store!');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'Welcome to our store!',
        );
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('silently suppresses opener when toggle is OFF, even if a greeting text is configured (never leaks system phrase to AI)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'ar' },
            greetingMessageEnabled: false,
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('مرحباً بك في متجرنا');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(messagesService.markAsReplied).toHaveBeenCalledWith('msg-uuid', '', 'template');
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('answers a first typed question directly — the welcome is NEVER prepended to an AI reply (opener-only greeting)', async () => {
        // Regression guard for the 2026-08-17 owner ruling: the configured welcome
        // fires ONLY on the "Get Started" opener tap. It used to also be prepended
        // to the AI answer on a customer's first typed message, with suppressGreeting
        // telling the model not to greet again — but when the first message IS a bare
        // greeting there is no question to "answer directly", so the model greeted
        // back and ~30% of first contacts got a visible double welcome (measured in
        // prod, 207 first contacts). A typed first message now goes straight to the
        // AI with no prefix and no suppressGreeting plumbing.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome to our store!');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'what are your prices?', 'msg-1',
        );

        expect(result.success).toBe(true);
        // The question is answered by the AI alone — no welcome prefix, one message.
        expect(adapter.sendReply).toHaveBeenCalledTimes(1);
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'AI reply',
        );
        // The greeting machinery is not even consulted for typed messages.
        expect(workspaceSettingsService.getGreetingMessage).not.toHaveBeenCalled();
        // The suppressGreeting plumbing is gone — a reintroduction must fail here.
        const generatorInput = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0] as Record<string, unknown>;
        expect('suppressGreeting' in generatorInput).toBe(false);
    });

    it('a typed bare greeting («مرحبا») is NOT an opener — the AI replies once, with no merchant-welcome prefix', async () => {
        // The exact prod scenario behind the double-greeting defect: a customer opens
        // with a hand-typed «مرحبا». That is not the "Get Started" system phrase, so
        // it must flow to the AI (which greets naturally) — NOT fire the configured
        // welcome, and NOT get the welcome prepended on top of the AI's greeting.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'ar' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(false);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('أهلا وسهلا كيف فيي ساعدك ؟');

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'مرحبا', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
        // Exactly one message: the AI reply, bare — the double welcome is impossible.
        expect(adapter.sendReply).toHaveBeenCalledTimes(1);
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'AI reply',
        );
        expect(workspaceSettingsService.getGreetingMessage).not.toHaveBeenCalled();
    });

    it('does NOT greet when the bot already DMed the customer (dual-mode private reply) — answers directly', async () => {
        // Dual-mode flow: the bot already sent the customer a detailed DM (the private
        // reply to their comment, stored as an outgoing row), so when they type their
        // first DM ("دورة محاسبة") they are NOT a fresh contact. Typed messages never
        // touch the greeting machinery — the question is answered directly, with no
        // incongruous "welcome, how can I help?" mid-conversation.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'ar' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(true); // bot already DMed
        vi.mocked(workspaceSettingsService.getGreetingMessage)
            .mockResolvedValue('الفريق الدمشقي للتدريب اهلا وسهلا بك , كيف فيني ساعدك');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'دورة محاسبة', 'msg-1',
        );

        // The answer is sent as-is, with no welcome prefix.
        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
        expect(adapter.sendReply).toHaveBeenCalledWith(expect.anything(), 'sender-1', 'AI reply');
        expect(adapter.sendReply).not.toHaveBeenCalledWith(
            expect.anything(), 'sender-1', expect.stringContaining('كيف فيني ساعدك'),
        );
    });

    it('does not re-send the greeting once the bot has already replied (idempotent across retries)', async () => {
        // A job retry after the welcome was already delivered must not greet again. The
        // prior outgoing row makes hasOutgoingMessage true, so the opener is suppressed.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(messagesService.hasOutgoingMessage).mockResolvedValue(true);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome to our store!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(adapter.sendReply).not.toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'Welcome to our store!',
        );
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('does NOT fire greeting on a mid-conversation typed message (greeting is opener-only)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
        } as any);
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

    it('silently suppresses opener when custom greeting is configured but lookup returns empty (does NOT leak system phrase to AI)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('silently suppresses opener when configured greeting send throws (does NOT leak system phrase to AI)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome!');

        const adapter = webhookPreStoredAdapter();
        vi.mocked(adapter.sendReply).mockRejectedValueOnce(new Error('FB API down'));

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'Get Started', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    // ── Emoji-only / punctuation-only mid-conversation skip ──────────────
    // Mirrors the sticker handler: 🥰 / 👍 / "..." sent after the bot is
    // already engaged must NOT regenerate through the AI (otherwise we get
    // a fresh "how can I help you?" that reads as a conversation restart).

    it('silently skips emoji-only mid-conversation message (no AI call, no reply)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: false,
        } as any);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: '🥰', createdTime: new Date() } as any,
        ]);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', '🥰', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
        expect(messagesService.markAsResolved).toHaveBeenCalledWith('msg-uuid');
    });

    it('silently skips punctuation-only mid-conversation message ("...")', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageEnabled: false,
        } as any);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: '...', createdTime: new Date() } as any,
        ]);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', '...', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('does NOT skip when emoji is mixed with real text ("ok 👍" reaches the AI)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageEnabled: false,
        } as any);
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'msg-uuid', message: 'ok 👍', createdTime: new Date() } as any,
        ]);

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'ok 👍', 'msg-1',
        );

        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
    });

    // ── greetingMessageEnabled toggle (Greeting on/off) ──────────────────
    // The toggle is the explicit gate: only when greetingMessageEnabled=true
    // AND a non-empty configured message exists does the greeting fire on
    // the "Get Started" opener tap. Typed messages always go to the AI.

    it('does NOT fire greeting when toggle is OFF, even if a greeting is configured (AI takes over)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: false,
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('Welcome to our store!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'what are your prices?', 'msg-1',
        );

        expect(adapter.sendReply).not.toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'Welcome to our store!',
        );
        expect(workspaceSettingsService.getGreetingMessage).not.toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
    });

    it('does NOT fire greeting when toggle is ON but configured message is empty (safety net falls through to AI)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'en' },
            greetingMessageEnabled: true,
        } as any);
        // Empty/cleared greeting: the greeting machinery is opener-only, so a typed
        // message flows straight to the AI which sends "AI reply".
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'what are your prices?', 'msg-1',
        );

        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
        // AI sent its own reply; the greeting was not sent.
        expect(adapter.sendReply).toHaveBeenCalledTimes(1);
        expect(adapter.sendReply).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'AI reply',
        );
    });

    it('does NOT re-fire the greeting on the customer’s real message after the opener already greeted (no double-greeting)', async () => {
        // When the greeting fires on an opener tap, the customer's NEXT typed
        // message must fall through to the AI — typed messages never touch the
        // greeting machinery, so a second welcome is impossible.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'ar' },
            greetingMessageEnabled: true,
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue('مرحبتين، نورتنا في Nourva');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بكم السعر؟', 'msg-real',
        );

        expect(adapter.sendReply).not.toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'مرحبتين، نورتنا في Nourva',
        );
        expect(replyGenerator.generateForMessage).toHaveBeenCalled();
    });

    it('still silently suppresses a repeat opener tap even though it is not the first message (button is always a system phrase)', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
            greetingMessageMulti: { sourceLang: 'default' },
        } as any);
        vi.mocked(workspaceSettingsService.getGreetingMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'بدء الاستخدام', 'msg-1',
        );

        expect(result.success).toBe(true);
        expect(result.replyMethod).toBe('template');
        expect(adapter.sendReply).not.toHaveBeenCalled();
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
    });

    it('sends the away message on first contact when auto-reply is off, even when isNew=false', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        vi.mocked(redis.set).mockResolvedValue('OK');
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

    // messagesAutoReply=false is a standing merchant choice, not a schedule. The
    // shipped default away text must never fire on this branch — off means off.
    // (2026-08-01: a pharmacy with DMs off and no business hours told 37 customers
    // «خارج أوقات العمل» — at 09:05, in copy the merchant never saw or wrote.)
    it('stays SILENT when DM auto-reply is off and no away message was authored', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        vi.mocked(redis.set).mockResolvedValue('OK');
        // allowDefault:false → nothing authored → null (pinned by workspaceSettings tests)
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue(null);

        const adapter = webhookPreStoredAdapter();

        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'hello?', 'msg-1',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Messages auto-reply disabled');
        // The permanent-off branch must ask for authored-text-only…
        expect(workspaceSettingsService.getAwayMessage).toHaveBeenCalledWith(
            'test_workspace_id', expect.anything(), { allowDefault: false },
        );
        // …and with none configured, the customer hears nothing at all.
        expect(adapter.sendAwayMessage).not.toHaveBeenCalled();
        expect(messagesService.storeOutgoingMessage).not.toHaveBeenCalled();
    });

    it('allows the default away text on the business-hours branch (temporary closure)', async () => {
        // Toggle ON but outside the configured hours — the folded check is false
        // while messagesAutoReply stays true. Here the default notice is accurate.
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, businessHoursOnly: true, replyDelay: 0,
        } as any);
        vi.mocked(redis.set).mockResolvedValue('OK');
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('نحن حالياً خارج أوقات العمل');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'مرحبا', 'msg-1',
        );

        expect(workspaceSettingsService.getAwayMessage).toHaveBeenCalledWith(
            'test_workspace_id', expect.anything(), { allowDefault: true },
        );
        expect(adapter.sendAwayMessage).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'نحن حالياً خارج أوقات العمل',
        );
    });

    it('does NOT spam the away message while the 24h cooldown is still held', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        // SET NX returns null when the key exists → already acknowledged this window.
        vi.mocked(redis.set).mockResolvedValue(null);
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are away — back soon!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'still there?', 'msg-2',
        );

        expect(adapter.sendAwayMessage).not.toHaveBeenCalled();
    });

    // The bug this replaces: the gate was `isFirstIncomingMessage`, i.e. once per
    // LIFETIME. A customer who had written before got no smart reply (schedule off)
    // AND no acknowledgment — total silence, every night after the first.
    it('acknowledges a RETURNING customer once the 24h window has expired', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        // Not their first message ever — under the old gate this sent nothing.
        vi.mocked(redis.set).mockResolvedValue('OK');
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are away — back soon!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'are you open?', 'msg-3',
        );

        expect(adapter.sendAwayMessage).toHaveBeenCalledWith(
            expect.anything(), 'sender-1', 'We are away — back soon!',
        );
    });

    it('still acknowledges when Redis is unavailable (a duplicate beats silence)', async () => {
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(false);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: false, replyDelay: 0,
        } as any);
        vi.mocked(redis.set).mockRejectedValue(new Error('redis down'));
        vi.mocked(workspaceSettingsService.getAwayMessage).mockResolvedValue('We are away — back soon!');

        const adapter = webhookPreStoredAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'hello?', 'msg-4',
        );

        expect(adapter.sendAwayMessage).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────
// Orphan recheck — race condition fix
// Complements eb7bda92: catches messages that arrived AFTER step 11
// fetched unreplied but BEFORE the lock was released. Without this,
// such messages bail at step 4b ('Lock held') and stay unreplied forever.
// ─────────────────────────────────────────────────────────────
describe('MessageProcessor — Orphan recheck (post-release safety net)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset getUnrepliedFromSender to empty default so leftover persistent
        // implementations from prior describe blocks don't cause runaway recursion.
        vi.mocked(messagesService.getUnrepliedFromSender).mockReset().mockResolvedValue([]);
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true,
            messagesAutoReply: true, replyDelay: 0,
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
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'first reply',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    function flushSetImmediate(): Promise<void> {
        return new Promise(resolve => setImmediate(resolve));
    }

    it('re-triggers processing when a message arrived during AI generation (Ola race)', async () => {
        // First call (msg1): only msg1 is unreplied (consolidation snapshot).
        // Second call (after lock release): msg2 arrived during generation and is now orphaned.
        // Third call (recursive re-trigger for msg2): nothing orphaned, recursion ends.
        vi.mocked(messagesService.getUnrepliedFromSender)
            .mockResolvedValueOnce([
                { id: 'db-msg-1', message: 'تمام يعني بقدر اجي سجل فورا واحضر', platformMessageId: 'fb-msg-1' },
            ])
            .mockResolvedValueOnce([
                { id: 'db-msg-2', message: 'العنوان', platformMessageId: 'fb-msg-2' },
            ])
            .mockResolvedValueOnce([
                { id: 'db-msg-2', message: 'العنوان', platformMessageId: 'fb-msg-2' },
            ])
            .mockResolvedValueOnce([]);

        const adapter = createMockAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'تمام يعني بقدر اجي سجل فورا واحضر', 'fb-msg-1',
        );

        // setImmediate is scheduled in finally — flush it so the recheck completes.
        await flushSetImmediate();
        await flushSetImmediate();

        // Two replies generated: one for msg1, one for the orphan msg2.
        expect(replyGenerator.generateForMessage).toHaveBeenCalledTimes(2);
        const secondCallText = vi.mocked(replyGenerator.generateForMessage).mock.calls[1][0].text;
        expect(secondCallText).toBe('العنوان');
    });

    it('does NOT re-trigger when no orphaned messages remain', async () => {
        // First call: msg1 only. Second call (post-release recheck): nothing.
        vi.mocked(messagesService.getUnrepliedFromSender)
            .mockResolvedValueOnce([
                { id: 'db-msg-1', message: 'hello', platformMessageId: 'fb-msg-1' },
            ])
            .mockResolvedValueOnce([]);

        const adapter = createMockAdapter();

        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'hello', 'fb-msg-1',
        );

        await flushSetImmediate();
        await flushSetImmediate();

        // Only one AI generation — recheck found nothing.
        expect(replyGenerator.generateForMessage).toHaveBeenCalledTimes(1);
    });
});

describe('MessageProcessor — transient error retry behavior', () => {
    it('transient DM error rethrows so BullMQ retries — does NOT swallow as success:false', async () => {
        // Mirror of the commentProcessor regression guard. DM-flow has the same outer
        // catch that previously swallowed transient throws from sender.ts, defeating
        // BullMQ retry. Without this, FB transient errors silently abandon DMs too.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Hi!',
            replyMethod: 'ai',
            needsAttention: false,
        });
        const transientError = new DmSendError(
            'Facebook API error: (#-1) Unexpected internal error',
            { code: -1, subcode: 2018012, type: 'OAuthException' },
        );
        const adapter = createMockAdapter({
            sendReply: vi.fn().mockRejectedValue(transientError),
        });

        await expect(
            messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1'),
        ).rejects.toBe(transientError);
    });

    it('transient AI error rethrows so BullMQ retries — no fake fallback mid-conversation', async () => {
        // Regression guard for the deploy-outage bug. When the ai-worker is briefly
        // unreachable during a rolling deploy, aiService.generateReply throws and the
        // error propagates through generateForMessage. The outer catch MUST rethrow
        // so BullMQ retries the job — never substitute a canned "شكراً لرسالتك!"
        // reply mid-conversation. After retries exhaust, flagStuckJobOnFinalFailure
        // marks the row needs_attention.
        const transientAiError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3002'), {
            code: 'ECONNREFUSED',
        });
        vi.mocked(replyGenerator.generateForMessage).mockRejectedValue(transientAiError);

        const adapter = createMockAdapter();

        await expect(
            messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1'),
        ).rejects.toBe(transientAiError);
        // Adapter.sendReply must not have been invoked — we never reached the send step.
        expect(adapter.sendReply).not.toHaveBeenCalled();
    });

    it('AiUnavailableError (AI_ENABLED=false misdeploy) rethrows so the row ends up flagged', async () => {
        // AI_ENABLED=false is a permanent config decision, but we still treat the
        // resulting AiUnavailableError as retry-worthy so flagStuckJobOnFinalFailure
        // surfaces the row in needs_attention after retries exhaust. The alternative
        // (return success:false here) would leave messages invisible to the merchant.
        const { AiUnavailableError } = await import('../../src/utils/fbGraphErrors');
        const aiUnavailable = new AiUnavailableError('AI_ENABLED is false');
        vi.mocked(replyGenerator.generateForMessage).mockRejectedValue(aiUnavailable);

        const adapter = createMockAdapter();

        await expect(
            messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1'),
        ).rejects.toBe(aiUnavailable);
        expect(adapter.sendReply).not.toHaveBeenCalled();
    });

});

// ─────────────────────────────────────────────────────────────
// Page-token recovery wiring.
//
// A revoked page credential is re-mintable in one Graph call, so the customer in
// front of us must not pay for it. Recovering only in `recordSendFailure` helps
// message N+1 while the message that EXPOSED the dead token still goes
// unanswered — which is the 2026-08-14 outage in miniature.
//
// The counterpart matters just as much: WhatsApp sits on the same page row but
// carries `whatsapp_access_token`, a separate credential on Meta's forced 60-day
// clock with its own health cron and its own reconnect notice. Meta answers an
// expired WABA token with the same code 190, so routing WhatsApp through Facebook
// page-token recovery would clear `pages.access_token` — and mail the merchant
// "reconnect your Facebook page" to explain a WhatsApp outage.
// ─────────────────────────────────────────────────────────────
describe('MessageProcessor — page-token recovery wiring', () => {
    beforeEach(() => {
        // Required: this file has no global call-count reset, so `not.toHaveBeenCalled()`
        // in the WhatsApp case below would otherwise be asserting against every
        // Facebook send earlier in the file and fail for the wrong reason.
        vi.clearAllMocks();
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Hi!',
            replyMethod: 'ai',
            needsAttention: false,
        });
    });

    it('routes a Facebook send through token recovery, with the page and its token', async () => {
        const adapter = createMockAdapter();

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1');

        expect(withPageTokenRetry).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'page-uuid', accessToken: 'token-123' }),
            expect.any(Function),
        );
        // Still exactly one send on the happy path — the wrapper retries only on a
        // token-revoked code, and the pass-through above proves the reply flows.
        expect(adapter.sendReply).toHaveBeenCalledTimes(1);
    });

    it('routes an Instagram send through it too — same credential as Facebook', async () => {
        const adapter = createMockAdapter({ platform: 'instagram' });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1');

        expect(withPageTokenRetry).toHaveBeenCalled();
    });

    it('routes a WhatsApp send AROUND it — separate credential, separate reconnect path', async () => {
        const adapter = createMockAdapter({ platform: 'whatsapp' });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1');

        expect(withPageTokenRetry).not.toHaveBeenCalled();
        // …and the reply still went out. Skipping recovery must not skip the send.
        expect(adapter.sendReply).toHaveBeenCalledTimes(1);
    });

    it('hands the re-minted token to the follow-up card send, not the credential it replaced', async () => {
        // The pipeline must ADOPT the fresh token, not borrow it for one call. Steps
        // after the send read `page.accessToken` directly — `sendProductCards` is the
        // one that would otherwise fire with the exact credential recovery just
        // proved dead, losing the cards silently on the path that had already healed.
        //
        // The retry is simulated at the wrapper boundary on purpose; the wrapper's own
        // re-mint/retry behaviour is pinned in pageTokenRecovery.test.ts.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'Hi!',
            replyMethod: 'ai',
            needsAttention: false,
            productCards: [{
                title: 'Blue Cotton Shirt',
                subtitle: '120 SAR · In stock',
                imageUrl: 'https://cdn.test/shirt.jpg',
                productUrl: 'https://shop.test/p/blue-shirt',
            }],
        });
        vi.mocked(withPageTokenRetry).mockImplementationOnce(
            async (_page, call) => call('re-minted-token') as never,
        );
        const sendProductCards = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendProductCards });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'show me', 'msg-1');
        // Cards are fire-and-forget — let the rejection/resolution settle.
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(sendProductCards).toHaveBeenCalledWith(
            expect.objectContaining({ accessToken: 're-minted-token' }),
            'sender-1',
            expect.anything(),
        );
    });
});

// ─────────────────────────────────────────────────────────────
// Typing indicator leak guards
// Regression suite for the "typing forever" DM bug: typing_on must
// only fire on the path where the bot will actually send a reply.
// If typing fires on a skip/hold/no-reply path, Facebook keeps the
// indicator on for ~20s with no message arriving — and BullMQ retries
// can keep extending it. Each test below pins one early-return path.
// ─────────────────────────────────────────────────────────────
describe('MessageProcessor — typing indicator must not leak on skip paths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(messagesService.getUnrepliedFromSender).mockReset().mockResolvedValue([
            { id: 'msg-uuid', message: 'hello', platformMessageId: 'msg-1', createdTime: new Date() } as any,
        ]);
        pipelineMetrics.reset();

        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
            holdLowConfidence: false,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.flagMessage).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);

        // Redis is the stateful fake from the root beforeEach: it grants the typing-dedup
        // NX claim on first use and rejects the second, and — critically for these tests —
        // it also SERVES the read that typingIndicator.wasShown does when deciding whether
        // to clear. A `set`-only stub left that read returning undefined.
    });

    it('fires typing_on before AI generation and does NOT call typing_off on the happy path', async () => {
        // Typing exists to mask AI generation latency, so it must fire BEFORE the
        // generator runs. On success, the outgoing message itself dismisses the
        // indicator, so an explicit typing_off would be a redundant API call.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'sure, here are our hours',
            replyMethod: 'ai',
            needsAttention: false,
        });

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hours?', 'msg-1');

        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendReply).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).not.toHaveBeenCalled();

        const typingOrder = sendTypingIndicator.mock.invocationCallOrder[0];
        const generatorOrder = vi.mocked(replyGenerator.generateForMessage).mock.invocationCallOrder[0];
        const replyOrder = sendReply.mock.invocationCallOrder[0];
        expect(typingOrder).toBeLessThan(generatorOrder);
        expect(generatorOrder).toBeLessThan(replyOrder);
    });

    it('clears typing_on with typing_off when reply is silently skipped (SPAM_OR_IRRELEVANT)', async () => {
        // Typing was shown before AI gen; AI classified as spam → no reply sent.
        // Without typing_off the customer sees "typing…" for ~20s with nothing
        // arriving. With typing_off it clears immediately.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'SPAM_OR_IRRELEVANT',
        } as any);

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        // Must contain letters so it bypasses the emoji/punctuation-only short-circuit
        // (step 11a) and actually reaches the AI, which is what this test exercises.
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'follow @bestdeals21', 'msg-1');

        expect(sendReply).not.toHaveBeenCalled();
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('resolves the message when silently skipped as spam (no false "will reply soon" badge)', async () => {
        // Regression: SPAM_OR_IRRELEVANT / conversation-closers ("no thank you") were
        // returned as success but left replied=false/resolved=false, so the inbox
        // showed "سيتم الرد قريباً" forever. The silent-skip path must mark the message
        // resolved (mirroring the emoji/punctuation drop) and refresh the cached stats.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: false,
            aiIntent: 'SPAM_OR_IRRELEVANT',
        } as any);

        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendReply });

        // Letters bypass the emoji/punctuation short-circuit so it reaches the AI skip path.
        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'no thank you', 'msg-1');

        expect(result.success).toBe(true);
        expect(sendReply).not.toHaveBeenCalled();
        expect(messagesService.markAsResolved).toHaveBeenCalledWith('msg-uuid');
        expect(invalidateWorkspaceStatsCache).toHaveBeenCalled();
    });

    it('clears typing_on with typing_off when reply is flagged offensive', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'offensive',
            aiIntent: 'OFFENSIVE',
        } as any);

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'abusive text', 'msg-1');

        expect(sendReply).not.toHaveBeenCalled();
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('clears typing_on with typing_off when reply is held for low-confidence review', async () => {
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
            holdLowConfidence: true,
        } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'tentative answer',
            replyMethod: 'ai',
            needsAttention: false,
            confidence: 'low',
        } as any);

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'ambiguous question', 'msg-1');

        expect(sendReply).not.toHaveBeenCalled();
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('still captures the customer lead when the reply is held for low-confidence review', async () => {
        // Same rule as the self-identification hold below: withholding OUR reply
        // must not discard THEIR data. The shared maybeCaptureLead sits downstream
        // of the 12d return, so without an explicit capture here a held message's
        // volunteered phone is lost outright. Measured in prod 2026-08-19: 3 held
        // messages carried a number, none became a lead — one a pharmacy's
        // wholesale enquiry on a pharma distributor's page.
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid',
            userId: 'user-uuid',
            aiEnabled: true,
            messagesAutoReply: true,
            replyDelay: 0,
            holdLowConfidence: true,
        } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'ما عندي السعر، تواصل معنا',
            replyMethod: 'ai',
            needsAttention: false,
            confidence: 'low',
            aiIntent: 'QUESTION',
        } as any);

        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendReply });
        await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'صيدلية الساحل البريقة 0913823491', 'msg-1',
        );

        // The hold itself is unchanged: nothing is sent, the row is marked held.
        expect(sendReply).not.toHaveBeenCalled();
        expect(messagesService.markAsReplied).toHaveBeenCalledWith(
            'msg-uuid', '', 'ai', true, 'held_low_confidence',
            expect.anything(), expect.anything(), expect.anything(),
        );
        // ...but the customer's own details survive it.
        expect(leadExtractorService.maybeCaptureLead).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceId: 'msg-uuid',
                sourceType: 'message',
                messageText: 'صيدلية الساحل البريقة 0913823491',
            }),
        );
    });

    it('withholds an exhausted self-identification strip — nothing sent, no retry, typing cleared', async () => {
        // Check 6 strip-to-empty: the ai-worker returns an EMPTY reply with the
        // exhausted flag instead of a canned SELF_ID_FALLBACKS identity line
        // (which answered "who are you?" whatever the customer asked — prod,
        // Jawab24 page, 2026-08-01). flagReason carries the joined ai flags
        // verbatim (generator contract); the processor must flag the row and
        // stop — NOT fall through to the "No reply generated" error path, whose
        // success:false would re-enqueue and re-bill the same doomed generation.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'self_identification_stripped,self_identification_exhausted',
            aiIntent: 'QUESTION',
        } as any);

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'موقعكم الالكتروني', 'msg-1');

        expect(result.success).toBe(true);
        expect(sendReply).not.toHaveBeenCalled();
        // Flagged for review under the specific reason — NOT markAsReplied('').
        // Nothing was sent, so a replied/repliedAt row would report a response
        // time for a customer who never got an answer; and the only draft
        // available is the automation reveal itself, which must never become a
        // one-tap send in the merchant's composer.
        expect(messagesService.flagMessage).toHaveBeenCalledWith(
            'msg-uuid', 'held_self_identification', 'QUESTION',
        );
        expect(messagesService.markAsReplied).not.toHaveBeenCalled();
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('still captures the customer lead when the reply is withheld', async () => {
        // Withholding OUR reply must not discard THEIR data. The shared
        // maybeCaptureLead call sits on the send path, downstream of the
        // withhold return — so a customer who volunteers a phone number in the
        // same message that trips Check 6 would otherwise be lost outright.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: true,
            flagReason: 'self_identification_stripped,self_identification_exhausted',
            aiIntent: 'QUESTION',
        } as any);

        const adapter = createMockAdapter({});
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'رقمي 0912345678', 'msg-1');

        expect(leadExtractorService.maybeCaptureLead).toHaveBeenCalledWith(
            expect.objectContaining({ sourceId: 'msg-uuid', sourceType: 'message', messageText: 'رقمي 0912345678' }),
        );
    });

    it('clears typing_on with typing_off when the generator returns an empty reply', async () => {
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: '',
            replyMethod: 'ai',
            needsAttention: false,
        });

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1');

        expect(sendReply).not.toHaveBeenCalled();
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('clears typing_on with typing_off when sendReply fails non-transiently (delivery_failed)', async () => {
        // sendReply throws a non-transient error → pipeline marks delivery_failed
        // and returns success:false without retrying. Typing was already shown
        // before AI gen, so the abort path must clear it.
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'a fine reply',
            replyMethod: 'ai',
            needsAttention: false,
        });

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        // Permanent error (not transient) — DmSendError with a 400 won't retry.
        const nonTransient = new DmSendError(
            'permanent send failure',
            400,
            { error: { code: 100 } },
        );
        const sendReply = vi.fn().mockRejectedValue(nonTransient);
        const adapter = createMockAdapter({ sendTypingIndicator, sendTypingOff, sendReply });

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-1');

        expect(result.success).toBe(false);
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
        expect(sendTypingOff).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-fire typing_on across BullMQ retries of the same messageId', async () => {
        // BullMQ retries reuse the same platformMessageId. Each typing_on resets
        // Facebook's 20s auto-clear timer; without dedup, 3 retries spaced 2/4/8s
        // would extend the indicator past 30s ("typing forever" across attempts).
        // Simulate NX semantics: first SET succeeds (returns 'OK'), subsequent
        // SETs on the same key return null (already held).
        const heldKeys = new Set<string>();
        vi.mocked(redis.set).mockImplementation(async (...args: any[]) => {
            const [key, , , , flag] = args;
            if (flag === 'NX' && heldKeys.has(key)) return null;
            if (flag === 'NX') heldKeys.add(key);
            return 'OK';
        });

        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'reply',
            replyMethod: 'ai',
            needsAttention: false,
        });

        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const adapter = createMockAdapter({ sendTypingIndicator, sendReply });

        // Three attempts of the same messageId (BullMQ retry).
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-retry-1');
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-retry-1');
        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'hello', 'msg-retry-1');

        // Typing fires exactly once across all three attempts.
        expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
    });
});

describe('MessageProcessor — attachment-enrichment park (store-then-enrich)', () => {
    const recentPendingRow = () => ({
        id: 'img-stub-uuid',
        message: '[صورة]',
        platformMessageId: 'msg-img',
        enrichmentStatus: 'pending',
        createdAt: new Date(), // fresh — inside PENDING_ENRICHMENT_MAX_AGE_MS
    });

    beforeEach(() => {
        vi.clearAllMocks();
        pipelineMetrics.reset();
        vi.mocked(workspaceSettingsService.isAutoReplyEnabledFromSettings).mockReturnValue(true);
        vi.mocked(workspaceSettingsService.getSettings).mockResolvedValue({
            id: 'settings-uuid', userId: 'user-uuid', aiEnabled: true, messagesAutoReply: true, replyDelay: 0,
        } as any);
        vi.mocked(messagesService.isPaused).mockResolvedValue(false);
        vi.mocked(messagesService.hasNewerUnrepliedMessage).mockResolvedValue(false);
        vi.mocked(messagesService.markAsReplied).mockResolvedValue(undefined as any);
        vi.mocked(messagesService.markOlderMessagesAsReplied).mockResolvedValue(0);
        vi.mocked(messagesService.storeOutgoingMessage).mockResolvedValue({
            id: 'reply-uuid', pageId: 'page-uuid', platformMessageId: 'reply_123',
            senderId: 'sender-1', senderName: null, message: '', direction: 'outgoing',
            replied: true, replyText: '', replyMethod: 'ai', createdAt: new Date(),
            createdTime: new Date(), repliedAt: new Date(),
        } as any);
        vi.mocked(rateLimiter.check).mockResolvedValue({ allowed: true, count: 1 } as any);
        vi.mocked(replyGenerator.generateForMessage).mockResolvedValue({
            replyText: 'reply', replyMethod: 'ai', needsAttention: false,
        });
    });

    it('parks (returns attachmentPendingDelayMs, no generation) when a sibling stub is pending', async () => {
        // Text row + a still-pending image stub from the same sender.
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'text-uuid', message: 'شو محتويات الدورة', platformMessageId: 'msg-text', enrichmentStatus: null, createdAt: new Date() } as any,
            recentPendingRow() as any,
        ]);
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'شو محتويات الدورة', 'msg-text');

        expect(result.success).toBe(false);
        expect(result.attachmentPendingDelayMs).toBeGreaterThan(0);
        expect(replyGenerator.generateForMessage).not.toHaveBeenCalled();
        expect(adapter.sendReply).not.toHaveBeenCalled();
        // Lock is released on the park path.
        const { releaseReplyLock } = await import('../../src/lib/replyLock');
        expect(releaseReplyLock).toHaveBeenCalled();
    });

    it('does NOT park a stub older than the crash cutoff — replies (enricher presumed dead)', async () => {
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'text-uuid', message: 'q', platformMessageId: 'msg-text', enrichmentStatus: null, createdAt: new Date() } as any,
            { id: 'img-stub', message: '[صورة]', platformMessageId: 'msg-img', enrichmentStatus: 'pending', createdAt: new Date(Date.now() - 120_000) } as any,
        ]);
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'q', 'msg-text');

        expect(result.attachmentPendingDelayMs).toBeUndefined();
        expect(adapter.sendReply).toHaveBeenCalled();
    });

    it('at the retry cap, replies WITHOUT the pending row (never a permanent no-reply)', async () => {
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'text-uuid', message: 'شو محتويات الدورة', platformMessageId: 'msg-text', enrichmentStatus: null, createdAt: new Date() } as any,
            recentPendingRow() as any,
        ]);
        const adapter = createMockAdapter();

        // At the retry cap → falls through. DERIVED from the real budget, not the
        // literal 8 this used to hardcode: that number was sized against a 20s
        // vision deadline, and when the deadline moved to 35s the test kept
        // asserting a cap the code no longer had.
        const atCap = Math.ceil(WORST_CASE_ENRICHMENT_MS / 5_000) + 1;
        const result = await messageProcessor.processMessage(
            adapter, 'page-1', 'sender-1', 'شو محتويات الدورة', 'msg-text', undefined, undefined, false, atCap,
        );

        expect(result.attachmentPendingDelayMs).toBeUndefined();
        expect(adapter.sendReply).toHaveBeenCalled();
        // The still-pending row is excluded from the consolidated ids passed to the sweep.
        const call = vi.mocked(messagesService.markOlderMessagesAsReplied).mock.calls[0];
        if (call) {
            const consolidatedIds = call[2] as string[];
            expect(consolidatedIds).not.toContain('img-stub-uuid');
        }
    });

    it("does NOT park when the only sibling is 'done' (enrichment already finished)", async () => {
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'text-uuid', message: 'q', platformMessageId: 'msg-text', enrichmentStatus: null, createdAt: new Date() } as any,
            { id: 'img-done', message: '[صورة: وصف]', platformMessageId: 'msg-img', enrichmentStatus: 'done', createdAt: new Date() } as any,
        ]);
        const adapter = createMockAdapter();

        const result = await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'q', 'msg-text');

        expect(result.attachmentPendingDelayMs).toBeUndefined();
        expect(adapter.sendReply).toHaveBeenCalled();
        // Both rows consolidated (text + done image) into one reply.
        const generatorCall = vi.mocked(replyGenerator.generateForMessage).mock.calls[0][0];
        expect(generatorCall.text).toContain('[صورة: وصف]');
    });

    it('scopes markOlderMessagesAsReplied to the consolidated ids (silent-drop guard)', async () => {
        vi.mocked(messagesService.getUnrepliedFromSender).mockResolvedValue([
            { id: 'a-uuid', message: 'first', platformMessageId: 'msg-a', enrichmentStatus: null, createdAt: new Date() } as any,
            { id: 'msg-uuid', message: 'second', platformMessageId: 'msg-text', enrichmentStatus: null, createdAt: new Date() } as any,
        ]);
        const adapter = createMockAdapter();

        await messageProcessor.processMessage(adapter, 'page-1', 'sender-1', 'second', 'msg-text');

        const call = vi.mocked(messagesService.markOlderMessagesAsReplied).mock.calls[0];
        expect(call).toBeTruthy();
        // 3rd arg is the explicit id list (not a blanket page/sender sweep).
        expect(call[2]).toEqual(['a-uuid', 'msg-uuid']);
    });
});

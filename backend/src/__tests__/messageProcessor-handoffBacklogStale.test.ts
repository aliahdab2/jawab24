/**
 * Regression guard for handoff backlog suppression.
 *
 * When a re-enqueued job (originally held by a handoff pause) comes back AFTER
 * the pause has lifted, anything older than one pause window is dropped — the
 * conversational moment has passed and a 20-min-late bot reply looks broken.
 *
 * Two invariants this test protects:
 *   1. The check ONLY fires when `wasHandoffPaused` is true (passed by the
 *      worker when handoffRetries > 0). If we ever drop that guard, queue lag
 *      and restart-driven delays would silently lose customer messages.
 *   2. A fresh message (age < pauseMinutes) passes through even when
 *      wasHandoffPaused is true — only backlog gets dropped, not the most
 *      recent message that arrived right before pause expiry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockAcquireReplyLock, mockEnforceAutoReplyGate, mockPublishSSE,
    mockInvalidateWorkspaceStats, mockPipelineRecord,
    mockIsPaused, mockGetSettings,
} = vi.hoisted(() => ({
    mockAcquireReplyLock: vi.fn(),
    mockEnforceAutoReplyGate: vi.fn(),
    mockPublishSSE: vi.fn(),
    mockInvalidateWorkspaceStats: vi.fn(),
    mockPipelineRecord: vi.fn(),
    mockIsPaused: vi.fn(),
    mockGetSettings: vi.fn(),
}));

vi.mock('../lib/replyLock', () => ({
    acquireReplyLock: mockAcquireReplyLock,
    releaseReplyLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/subscriptions', () => ({
    subscriptionsService: { enforceAutoReplyGate: mockEnforceAutoReplyGate },
}));
vi.mock('../lib/eventBus', () => ({ publishSSEEvent: mockPublishSSE }));
vi.mock('../services/pages', () => ({
    invalidateWorkspaceStatsCache: mockInvalidateWorkspaceStats,
}));
vi.mock('../lib/pipelineMetrics', () => ({
    pipelineMetrics: { record: mockPipelineRecord },
}));
vi.mock('../services/messages', () => ({
    messagesService: {
        isPaused: mockIsPaused,
        getRemainingPauseMs: vi.fn().mockResolvedValue(0),
        hasNewerUnrepliedMessage: vi.fn().mockResolvedValue(false),
    },
}));
vi.mock('../services/workspaceSettings', () => ({
    workspaceSettingsService: {
        getSettings: mockGetSettings,
        isAutoReplyEnabledFromSettings: vi.fn().mockReturnValue(true),
        autoReplyStateFromSettings: vi.fn().mockReturnValue('on'),
    },
}));
vi.mock('../services/protection', () => ({
    rateLimiter: {
        check: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
        setLogger: vi.fn(),
    },
}));

import { MessageProcessor } from '../services/reply/messageProcessor';
import type { MessagePlatformAdapter } from '../interfaces';

function buildAdapter(messageCreatedAt: Date): MessagePlatformAdapter {
    const page = {
        id: 'page-uuid',
        userId: 'user-uuid',
        workspaceId: 'workspace-uuid',
        autoReplyEnabled: true,
        accessToken: 'token',
        platformAccountId: 'fb-page-123',
    };
    return {
        platform: 'facebook',
        getPage: vi.fn().mockResolvedValue(page),
        fetchSenderName: vi.fn().mockResolvedValue('Customer Name'),
        storeIncomingMessage: vi.fn().mockResolvedValue({
            message: { id: 'msg-uuid', replied: false, needsAttention: false, createdAt: messageCreatedAt },
            isNew: true,
        }),
        getInternalMessageId: vi.fn().mockReturnValue('msg-uuid'),
        sendReply: vi.fn(),
        sendAwayMessage: vi.fn(),
        sendGreeting: vi.fn(),
        markRead: vi.fn(),
    } as unknown as MessagePlatformAdapter;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceAutoReplyGate.mockResolvedValue({ allowed: true });
    mockAcquireReplyLock.mockResolvedValue('lock-token');
    mockIsPaused.mockResolvedValue(false); // pause has lifted in all these scenarios
    mockGetSettings.mockResolvedValue({
        replyDelay: 0,
        handoffPauseDurationMinutes: 15,
    });
});

describe('MessageProcessor — handoff backlog suppression', () => {
    it('drops a re-enqueued message older than one pause window', async () => {
        // 20-min-old message, pause window is 15 min, this job was held by a pause.
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        const result = await new MessageProcessor().processMessage(
            buildAdapter(twentyMinAgo),
            'fb-page-123', 'sender-id-1', 'hello', 'platform-msg-1',
            undefined, undefined,
            /* wasHandoffPaused */ true,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Handoff backlog stale');
        expect(mockPipelineRecord).toHaveBeenCalledWith('facebook_message', 'handoff_backlog_stale');
    });

    it('does NOT drop the same old message when wasHandoffPaused is false', async () => {
        // Same 20-min-old message — but this lateness came from queue lag, not
        // from our pause logic. Dropping here would silently lose customer
        // messages during incidents. Must pass through.
        const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
        const result = await new MessageProcessor().processMessage(
            buildAdapter(twentyMinAgo),
            'fb-page-123', 'sender-id-1', 'hello', 'platform-msg-1',
            undefined, undefined,
            /* wasHandoffPaused */ false,
        );

        // Either succeeds or fails for an unrelated downstream reason — but
        // crucially, NOT because of our stale-backlog gate.
        expect(result.error).not.toBe('Handoff backlog stale');
        const staleCalls = mockPipelineRecord.mock.calls.filter(
            ([, outcome]) => outcome === 'handoff_backlog_stale',
        );
        expect(staleCalls).toHaveLength(0);
    });

    it('does NOT drop a fresh re-enqueued message (age < pause window)', async () => {
        // Customer's most recent message arrived right before pause expiry —
        // even though the job is wasHandoffPaused=true, it's within the window
        // so it should process normally.
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const result = await new MessageProcessor().processMessage(
            buildAdapter(twoMinAgo),
            'fb-page-123', 'sender-id-1', 'hello', 'platform-msg-1',
            undefined, undefined,
            /* wasHandoffPaused */ true,
        );

        expect(result.error).not.toBe('Handoff backlog stale');
        const staleCalls = mockPipelineRecord.mock.calls.filter(
            ([, outcome]) => outcome === 'handoff_backlog_stale',
        );
        expect(staleCalls).toHaveLength(0);
    });
});

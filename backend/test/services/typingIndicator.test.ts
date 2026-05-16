import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as typingIndicator from '../../src/services/reply/typingIndicator';
import { redis } from '../../src/lib/redis';
import type { MessagePlatformAdapter, PlatformPage } from '../../src/interfaces';

vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: vi.fn(),
    },
}));

const mockPage: PlatformPage = {
    id: 'page-uuid',
    userId: 'user-uuid',
    workspaceId: 'ws-uuid',
    name: 'Test Page',
    accessToken: 'token-123',
    knowledgeBase: null,
    kbActiveVersion: null,
    autoReplyEnabled: true,
};

function makeAdapter(overrides: Partial<MessagePlatformAdapter> = {}): MessagePlatformAdapter {
    return {
        platform: 'facebook',
        getPage: vi.fn(),
        fetchSenderName: vi.fn(),
        storeIncomingMessage: vi.fn(),
        getInternalMessageId: vi.fn(),
        sendReply: vi.fn(),
        sendAwayMessage: vi.fn(),
        markAsReplied: vi.fn(),
        ...overrides,
    };
}

describe('typingIndicator.show', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redis.set).mockResolvedValue('OK' as any);
    });

    it('returns true and calls adapter.sendTypingIndicator on first attempt', async () => {
        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const adapter = makeAdapter({ sendTypingIndicator });

        const result = await typingIndicator.show(adapter, mockPage, 'sender-1', 'msg-1');

        expect(result).toBe(true);
        expect(sendTypingIndicator).toHaveBeenCalledWith(mockPage, 'sender-1');
        // NX dedup key scoped by pageId + platformMessageId
        expect(redis.set).toHaveBeenCalledWith(
            'typing:page-uuid:msg-1',
            '1',
            'EX',
            expect.any(Number),
            'NX',
        );
    });

    it('returns false and does NOT call adapter when redis NX rejects (retry)', async () => {
        // SET NX returns null when the key already exists (previous attempt held it).
        vi.mocked(redis.set).mockResolvedValue(null as any);
        const sendTypingIndicator = vi.fn().mockResolvedValue(undefined);
        const adapter = makeAdapter({ sendTypingIndicator });

        const result = await typingIndicator.show(adapter, mockPage, 'sender-1', 'msg-1');

        expect(result).toBe(false);
        expect(sendTypingIndicator).not.toHaveBeenCalled();
    });

    it('returns false when the adapter does not support sendTypingIndicator', async () => {
        const adapter = makeAdapter(); // no sendTypingIndicator

        const result = await typingIndicator.show(adapter, mockPage, 'sender-1', 'msg-1');

        expect(result).toBe(false);
        // No NX call wasted if the adapter can't show typing.
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns false when sendTypingIndicator throws (swallowed, cosmetic)', async () => {
        const sendTypingIndicator = vi.fn().mockRejectedValue(new Error('graph 500'));
        const adapter = makeAdapter({ sendTypingIndicator });

        const result = await typingIndicator.show(adapter, mockPage, 'sender-1', 'msg-1');

        expect(result).toBe(false);
        expect(sendTypingIndicator).toHaveBeenCalled();
    });

    it('returns false when redis itself rejects (treat as cosmetic failure)', async () => {
        vi.mocked(redis.set).mockRejectedValue(new Error('redis down'));
        const sendTypingIndicator = vi.fn();
        const adapter = makeAdapter({ sendTypingIndicator });

        const result = await typingIndicator.show(adapter, mockPage, 'sender-1', 'msg-1');

        expect(result).toBe(false);
        expect(sendTypingIndicator).not.toHaveBeenCalled();
    });
});

describe('typingIndicator.clear', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls adapter.sendTypingOff when supported', () => {
        const sendTypingOff = vi.fn().mockResolvedValue(undefined);
        const adapter = makeAdapter({ sendTypingOff });

        typingIndicator.clear(adapter, mockPage, 'sender-1');

        expect(sendTypingOff).toHaveBeenCalledWith(mockPage, 'sender-1');
    });

    it('is a no-op when the adapter does not support sendTypingOff', () => {
        const adapter = makeAdapter(); // no sendTypingOff
        // Must not throw.
        expect(() => typingIndicator.clear(adapter, mockPage, 'sender-1')).not.toThrow();
    });

    it('swallows errors from sendTypingOff (cosmetic, fire-and-forget)', async () => {
        const sendTypingOff = vi.fn().mockRejectedValue(new Error('graph 500'));
        const adapter = makeAdapter({ sendTypingOff });

        // Must not throw even though the underlying call rejects.
        typingIndicator.clear(adapter, mockPage, 'sender-1');
        // Give the swallowed rejection a tick to settle, otherwise vitest may
        // flag an unhandled rejection.
        await new Promise(r => setImmediate(r));

        expect(sendTypingOff).toHaveBeenCalled();
    });
});

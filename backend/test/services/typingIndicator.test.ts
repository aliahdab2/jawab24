import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as typingIndicator from '../../src/services/reply/typingIndicator';
import { redis } from '../../src/lib/redis';
import type { MessagePlatformAdapter, PlatformPage } from '../../src/interfaces';

vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: vi.fn(),
        get: vi.fn(),
    },
}));

/**
 * Stateful Redis fake for the cross-call-site contract below: the dedup claim is written
 * by one caller and read by another, so a stub that only answers `set` cannot express it.
 * Supports the NX flag; everything else is a plain key/value store.
 */
function statefulRedis(): Map<string, string> {
    const store = new Map<string, string>();
    vi.mocked(redis.set).mockImplementation((async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
    }) as never);
    vi.mocked(redis.get).mockImplementation((async (key: string) => store.get(key) ?? null) as never);
    return store;
}

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
        renderReply: vi.fn((text: string) => text),
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

/**
 * The Messenger fix (2026-07-29). The indicator used to be claimed deep in the reply
 * pipeline, AFTER the merchant's reply delay (0-60s), so a Messenger customer
 * saw dead air for the whole delay and "typing…" only in the final moment. WhatsApp never
 * had the bug because it claims at webhook receipt.
 *
 * Messenger now claims at receipt too, which means TWO call sites share one indicator —
 * the webhook and the reply pipeline, in different processes. These tests pin that
 * contract: exactly one send, and a cleanup decision that survives the process boundary.
 */
describe('typingIndicator — one indicator, two call sites', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('claims once: a receipt-time claim makes the later pipeline call a no-op', async () => {
        statefulRedis();
        const atReceipt = vi.fn().mockResolvedValue(undefined);
        const inPipeline = vi.fn().mockResolvedValue(undefined);

        // Webhook process.
        expect(await typingIndicator.showOnce('page-uuid', 'mid-1', atReceipt)).toBe(true);
        // Reply worker, later — must NOT re-arm Messenger's ~20s timer.
        expect(await typingIndicator.showOnce('page-uuid', 'mid-1', inPipeline)).toBe(false);

        expect(atReceipt).toHaveBeenCalledTimes(1);
        expect(inPipeline).not.toHaveBeenCalled();
    });

    it('reports delivery ACROSS the process boundary, so the reply worker can clean up', async () => {
        statefulRedis();
        // Claimed and delivered by the webhook; the worker holds no in-process flag.
        await typingIndicator.showOnce('page-uuid', 'mid-1', vi.fn().mockResolvedValue(undefined));

        expect(await typingIndicator.wasShown('page-uuid', 'mid-1')).toBe(true);
        expect(await typingIndicator.wasShown('page-uuid', 'other-mid')).toBe(false);
    });

    it('does NOT report delivery when the platform rejected the call', async () => {
        statefulRedis();
        const failing = vi.fn().mockRejectedValue(new Error('Graph 400'));

        expect(await typingIndicator.showOnce('page-uuid', 'mid-1', failing)).toBe(false);
        // The claim was taken (so retries stay deduped) but nothing is showing, so an
        // abort path must not waste a typing_off call.
        expect(await typingIndicator.wasShown('page-uuid', 'mid-1')).toBe(false);
    });

    it('wasShown never throws — it runs inside the reply pipeline\'s finally block', async () => {
        // A throw there would REPLACE the error being propagated and silently cost BullMQ
        // its retries. This exact mistake shipped once during development.
        vi.mocked(redis.get).mockRejectedValue(new Error('redis down'));
        await expect(typingIndicator.wasShown('page-uuid', 'mid-1')).resolves.toBe(false);

        vi.mocked(redis.get).mockReturnValue(undefined as never); // not even a promise
        await expect(typingIndicator.wasShown('page-uuid', 'mid-1')).resolves.toBe(false);
    });

    it('the adapter form is a no-op when the platform has no typing support (WhatsApp)', async () => {
        const store = statefulRedis();
        const adapter = makeAdapter(); // no sendTypingIndicator
        expect(await typingIndicator.show(adapter, mockPage, 'sender-1', 'mid-1')).toBe(false);
        // Must not even claim, or it would block a real claim from elsewhere.
        expect(store.size).toBe(0);
    });
});

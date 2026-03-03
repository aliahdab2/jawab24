import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply } from 'fastify';

// Mock eventBus
const mockSubscribe = vi.fn().mockResolvedValue(undefined);
const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const mockSubscriber = { subscribe: mockSubscribe, unsubscribe: mockUnsubscribe, on: mockOn };

vi.mock('../../src/lib/eventBus', () => ({
    getSubscriber: vi.fn(() => mockSubscriber),
    userChannel: vi.fn((userId: string) => `sse:user:${userId}`),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// Must import AFTER mocks are set up
import { sseManager } from '../../src/lib/sseManager';

function createMockReply(): FastifyReply {
    return {
        raw: {
            write: vi.fn(),
            end: vi.fn(),
        },
    } as unknown as FastifyReply;
}

describe('SSEManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await sseManager.shutdown();
    });

    describe('addConnection / removeConnection', () => {
        it('should track a connection and report counts', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-1', reply);

            expect(sseManager.getTotalConnectionCount()).toBe(1);
            expect(sseManager.getUniqueUserCount()).toBe(1);
        });

        it('should subscribe to Redis channel on first connection', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-2', reply);

            expect(mockSubscribe).toHaveBeenCalledWith('sse:user:user-2');
            expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should handle multiple connections for the same user', async () => {
            const r1 = createMockReply();
            const r2 = createMockReply();
            await sseManager.addConnection('user-3', r1);
            await sseManager.addConnection('user-3', r2);

            expect(sseManager.getTotalConnectionCount()).toBe(2);
            expect(sseManager.getUniqueUserCount()).toBe(1);
        });

        it('should remove a specific connection', async () => {
            const r1 = createMockReply();
            const r2 = createMockReply();
            await sseManager.addConnection('user-4', r1);
            await sseManager.addConnection('user-4', r2);

            await sseManager.removeConnection('user-4', r1);
            expect(sseManager.getTotalConnectionCount()).toBe(1);
        });

        it('should unsubscribe from Redis when last connection for user removed', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-5', reply);
            await sseManager.removeConnection('user-5', reply);

            expect(mockUnsubscribe).toHaveBeenCalledWith('sse:user:user-5');
            expect(sseManager.getUniqueUserCount()).toBe(0);
        });

        it('should be a no-op when removing from unknown user', async () => {
            await sseManager.removeConnection('nonexistent', createMockReply());
            expect(sseManager.getTotalConnectionCount()).toBe(0);
        });

        it('should handle Redis subscribe failure gracefully', async () => {
            const { captureError } = await import('../../src/utils/sentryHelpers');
            mockSubscribe.mockRejectedValueOnce(new Error('Redis down'));

            const reply = createMockReply();
            await sseManager.addConnection('user-err', reply);

            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                'SSE Redis subscribe failed',
                expect.objectContaining({ tags: expect.objectContaining({ service: 'sse-manager' }) }),
            );
        });

        it('should handle Redis unsubscribe failure gracefully', async () => {
            const { captureError } = await import('../../src/utils/sentryHelpers');
            const reply = createMockReply();
            await sseManager.addConnection('user-unsub-err', reply);

            mockUnsubscribe.mockRejectedValueOnce(new Error('Redis down'));
            await sseManager.removeConnection('user-unsub-err', reply);

            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                'SSE Redis unsubscribe failed',
                expect.objectContaining({ tags: expect.objectContaining({ service: 'sse-manager' }) }),
            );
        });
    });

    describe('start (heartbeats)', () => {
        it('should start heartbeat interval', () => {
            vi.useFakeTimers();
            sseManager.start();
            // calling start again should be a no-op (no duplicate intervals)
            sseManager.start();
            vi.useRealTimers();
        });
    });

    describe('onRedisMessage (via handler)', () => {
        it('should forward Redis message to connected clients', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-msg', reply);

            // Get the message handler registered via subscriber.on('message', ...)
            const messageHandler = mockOn.mock.calls.find(
                (c: unknown[]) => c[0] === 'message',
            )?.[1] as (ch: string, msg: string) => void;
            expect(messageHandler).toBeDefined();

            const payload = JSON.stringify({ type: 'comment:received', data: { id: '1' } });
            messageHandler('sse:user:user-msg', payload);

            expect((reply.raw.write as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
                expect.stringContaining('event: comment:received'),
            );
        });

        it('should ignore messages for users with no connections', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-exist', reply);

            const messageHandler = mockOn.mock.calls.find(
                (c: unknown[]) => c[0] === 'message',
            )?.[1] as (ch: string, msg: string) => void;

            // Message for a different user — should not throw
            messageHandler('sse:user:no-one', JSON.stringify({ type: 'test', data: {} }));
            expect((reply.raw.write as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith(
                expect.stringContaining('event: test'),
            );
        });

        it('should skip malformed JSON messages', async () => {
            const reply = createMockReply();
            await sseManager.addConnection('user-bad', reply);

            const messageHandler = mockOn.mock.calls.find(
                (c: unknown[]) => c[0] === 'message',
            )?.[1] as (ch: string, msg: string) => void;

            // Should not throw
            messageHandler('sse:user:user-bad', 'not-json{{{');
            expect((reply.raw.write as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
        });
    });

    describe('sendHeartbeats (via timer)', () => {
        it('should send heartbeat to all connections and clean up dead ones', async () => {
            vi.useFakeTimers();

            const goodReply = createMockReply();
            const deadReply = createMockReply();
            (deadReply.raw.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Connection closed');
            });

            await sseManager.addConnection('user-hb', goodReply);
            await sseManager.addConnection('user-dead', deadReply);

            sseManager.start();
            vi.advanceTimersByTime(30_000);

            // Good reply got heartbeat
            expect((goodReply.raw.write as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
                expect.stringContaining('event: heartbeat'),
            );

            // Dead connection should be cleaned up
            expect(sseManager.getTotalConnectionCount()).toBe(1);

            vi.useRealTimers();
        });
    });

    describe('shutdown', () => {
        it('should close all connections and clear state', async () => {
            const r1 = createMockReply();
            const r2 = createMockReply();
            await sseManager.addConnection('u1', r1);
            await sseManager.addConnection('u2', r2);

            await sseManager.shutdown();

            expect((r1.raw.end as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
            expect((r2.raw.end as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
            expect(sseManager.getTotalConnectionCount()).toBe(0);
            expect(sseManager.getUniqueUserCount()).toBe(0);
        });

        it('should handle already-closed connections gracefully', async () => {
            const reply = createMockReply();
            (reply.raw.end as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Already closed');
            });
            await sseManager.addConnection('u-closed', reply);

            // Should not throw
            await sseManager.shutdown();
            expect(sseManager.getTotalConnectionCount()).toBe(0);
        });
    });

    describe('writeEvent', () => {
        it('should handle write failures silently', async () => {
            const reply = createMockReply();
            (reply.raw.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Broken pipe');
            });
            await sseManager.addConnection('user-write-err', reply);

            // Trigger a message to this user (will call writeEvent internally)
            const messageHandler = mockOn.mock.calls.find(
                (c: unknown[]) => c[0] === 'message',
            )?.[1] as (ch: string, msg: string) => void;

            // Should not throw
            messageHandler('sse:user:user-write-err', JSON.stringify({ type: 'test', data: {} }));
        });
    });
});

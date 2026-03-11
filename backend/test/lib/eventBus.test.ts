import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userChannel, publishSSEEvent, shutdownEventBus } from '../../src/lib/eventBus';

// Mock Redis publish
vi.mock('../../src/lib/redis', () => ({
    redis: {
        publish: vi.fn().mockResolvedValue(1),
    },
}));

// Mock Sentry
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

describe('eventBus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('userChannel', () => {
        it('builds a channel name with user ID', () => {
            expect(userChannel('user-123')).toBe('sse:user:user-123');
        });

        it('handles empty string', () => {
            expect(userChannel('')).toBe('sse:user:');
        });
    });

    describe('publishSSEEvent', () => {
        it('publishes event to user channel', async () => {
            const { redis } = await import('../../src/lib/redis');
            await publishSSEEvent('user-123', 'message_received', {
                pageId: 'page-1',
                senderId: 'sender-1',
                messageId: 'msg-1',
            });
            expect(redis.publish).toHaveBeenCalledWith(
                'sse:user:user-123',
                expect.stringContaining('"type":"message_received"'),
            );
        });

        it('swallows publish errors without throwing', async () => {
            const { redis } = await import('../../src/lib/redis');
            (redis.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Redis down'));
            await expect(
                publishSSEEvent('user-123', 'message_received', {
                    pageId: 'p', senderId: 's', messageId: 'm',
                }),
            ).resolves.toBeUndefined();
        });
    });

    describe('shutdownEventBus', () => {
        it('does not throw when no subscriber exists', async () => {
            await expect(shutdownEventBus()).resolves.toBeUndefined();
        });
    });
});

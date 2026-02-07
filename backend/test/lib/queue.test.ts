import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueue = vi.fn(() => ({}));
vi.mock('bullmq', () => ({
    Queue: mockQueue,
}));

vi.mock('../../src/config', () => ({
    config: {
        redis: { host: 'localhost', port: 6379, password: 'secret' },
    },
}));

vi.mock('@jawab24/shared', () => ({
    AI_QUEUE_NAME: 'ai-generate',
}));

describe('queue', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('should create a BullMQ Queue with correct name', async () => {
        await import('../../src/lib/queue');

        expect(mockQueue).toHaveBeenCalledWith('ai-generate', expect.any(Object));
    });

    it('should use Redis connection from config', async () => {
        await import('../../src/lib/queue');

        const opts = mockQueue.mock.calls[0][1];
        expect(opts.connection).toEqual({
            host: 'localhost',
            port: 6379,
            password: 'secret',
        });
    });

    it('should set default job options with retries', async () => {
        await import('../../src/lib/queue');

        const opts = mockQueue.mock.calls[0][1];
        expect(opts.defaultJobOptions.attempts).toBe(3);
        expect(opts.defaultJobOptions.backoff).toEqual({
            type: 'exponential',
            delay: 1000,
        });
    });

    it('should export AI_QUEUE_NAME', async () => {
        const mod = await import('../../src/lib/queue');
        expect(mod.AI_QUEUE_NAME).toBe('ai-generate');
    });
});

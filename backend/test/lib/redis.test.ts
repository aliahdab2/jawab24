import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOn = vi.fn();
const MockRedis = vi.fn(() => ({ on: mockOn }));

vi.mock('ioredis', () => ({
    default: MockRedis,
}));

vi.mock('../../src/config', () => ({
    config: {
        redis: { host: 'redis-host', port: 6380, password: 'pass123' },
    },
}));

describe('redis', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('should create a Redis instance with config values', async () => {
        await import('../../src/lib/redis');

        expect(MockRedis).toHaveBeenCalledWith(expect.objectContaining({
            host: 'redis-host',
            port: 6380,
            password: 'pass123',
            lazyConnect: true,
        }));
    });

    it('should register error and connect event handlers', async () => {
        await import('../../src/lib/redis');

        const eventNames = mockOn.mock.calls.map((c: unknown[]) => c[0]);
        expect(eventNames).toContain('error');
        expect(eventNames).toContain('connect');
    });

    it('should have a retryStrategy that increases delay', async () => {
        await import('../../src/lib/redis');

        const opts = MockRedis.mock.calls[0][0];
        expect(opts.retryStrategy(1)).toBe(50);
        expect(opts.retryStrategy(10)).toBe(500);
        expect(opts.retryStrategy(100)).toBe(2000); // capped at 2000
    });
});

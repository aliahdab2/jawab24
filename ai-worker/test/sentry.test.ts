import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInit = vi.fn();
vi.mock('@sentry/node', () => ({
    init: mockInit,
    captureException: vi.fn(),
    default: {
        init: mockInit,
    },
}));

describe('Sentry', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        mockInit.mockClear();
        // Re-mock sentry for each test since we resetModules
        vi.doMock('@sentry/node', () => ({
            init: mockInit,
            captureException: vi.fn(),
        }));
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('should not call Sentry.init when SENTRY_DSN is not set', async () => {
        delete process.env.SENTRY_DSN;
        process.env.NODE_ENV = 'development';
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        expect(mockInit).not.toHaveBeenCalled();
    });

    it('should warn in production when SENTRY_DSN is not set', async () => {
        delete process.env.SENTRY_DSN;
        process.env.NODE_ENV = 'production';
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SENTRY_DSN not set'));
        warnSpy.mockRestore();
    });

    it('should call Sentry.init with DSN when provided', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        expect(mockInit).toHaveBeenCalledWith(
            expect.objectContaining({
                dsn: 'https://test@sentry.io/123',
            })
        );
        logSpy.mockRestore();
    });

    it('should use 0.1 tracesSampleRate in production', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        expect(mockInit).toHaveBeenCalledWith(
            expect.objectContaining({
                tracesSampleRate: 0.1,
            })
        );
        logSpy.mockRestore();
    });

    it('should use 1.0 tracesSampleRate in development', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'development';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        expect(mockInit).toHaveBeenCalledWith(
            expect.objectContaining({
                tracesSampleRate: 1.0,
            })
        );
        logSpy.mockRestore();
    });

    it('should filter noisy errors with ignoreErrors', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        const initCall = mockInit.mock.calls[0][0];
        expect(initCall.ignoreErrors).toContain('Rate limit exceeded');
        expect(initCall.ignoreErrors).toContain('ECONNREFUSED');
        expect(initCall.ignoreErrors).toContain('ETIMEDOUT');
        logSpy.mockRestore();
    });

    it('should have beforeSend that filters dev events when SENTRY_DEV_ENABLED is not set', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'development';
        delete process.env.SENTRY_DEV_ENABLED;
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { initSentry } = await import('../src/lib/sentry');
        initSentry();
        const initCall = mockInit.mock.calls[0][0];
        const fakeEvent = { message: 'test error' };
        expect(initCall.beforeSend(fakeEvent)).toBeNull();
        logSpy.mockRestore();
    });

    it('should export Sentry module', async () => {
        const { Sentry } = await import('../src/lib/sentry');
        expect(Sentry).toBeDefined();
    });
});

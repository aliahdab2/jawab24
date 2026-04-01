import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSentryInit = vi.fn();
const mockSetTag = vi.fn();
vi.mock('@sentry/node', () => ({
    init: mockSentryInit,
    setTag: mockSetTag,
}));

describe('sentry', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should not call Sentry.init when SENTRY_DSN is not set', async () => {
        delete process.env.SENTRY_DSN;
        process.env.NODE_ENV = 'development';

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSentryInit).not.toHaveBeenCalled();
    });

    it('should warn in production when SENTRY_DSN is not set', async () => {
        delete process.env.SENTRY_DSN;
        process.env.NODE_ENV = 'production';
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SENTRY_DSN not set'));
        expect(mockSentryInit).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('should call Sentry.init with DSN when provided', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
            dsn: 'https://test@sentry.io/123',
            environment: 'production',
        }));
        logSpy.mockRestore();
    });

    it('should use 0.1 tracesSampleRate in production', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
            tracesSampleRate: 0.1,
        }));
        logSpy.mockRestore();
    });

    it('should use 1.0 tracesSampleRate in development', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'development';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
            tracesSampleRate: 1.0,
        }));
        logSpy.mockRestore();
    });

    it('should filter errors with ignoreErrors', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        const sentryConfig = mockSentryInit.mock.calls[0][0];
        expect(sentryConfig.ignoreErrors).toContain('Rate limit exceeded');
        expect(sentryConfig.ignoreErrors).toContain('ECONNREFUSED');
        logSpy.mockRestore();
    });

    it('should have a beforeSend that filters dev events', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'development';
        delete process.env.SENTRY_DEV_ENABLED;
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        const sentryConfig = mockSentryInit.mock.calls[0][0];
        const mockEvent = { message: 'test' };
        expect(sentryConfig.beforeSend(mockEvent)).toBeNull();
        logSpy.mockRestore();
    });

    it('should set service tag after init', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSetTag).toHaveBeenCalledWith('service', 'backend');
        logSpy.mockRestore();
    });

    it('should use GIT_COMMIT as release when available', async () => {
        process.env.SENTRY_DSN = 'https://test@sentry.io/123';
        process.env.NODE_ENV = 'production';
        process.env.GIT_COMMIT = 'abc123def';
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { initSentry } = await import('../../src/lib/sentry');
        initSentry();

        expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({
            release: 'abc123def',
        }));
        logSpy.mockRestore();
    });

    it('should export Sentry module', async () => {
        const mod = await import('../../src/lib/sentry');
        expect(mod.Sentry).toBeDefined();
    });
});

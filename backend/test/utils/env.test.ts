import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * env.ts calls validateEnv() at module level (line 79: export const env = validateEnv()),
 * so for invalid-env tests, the import itself will throw. We catch the import error.
 * For valid-env tests, the import succeeds and we can call validateEnv() again.
 */
describe('validateEnv', () => {
    const originalEnv = process.env;

    // Minimal valid environment
    const validEnv: Record<string, string> = {
        NODE_ENV: 'test',
        PORT: '3000',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
        FACEBOOK_APP_ID: 'fb-app-id',
        FACEBOOK_APP_SECRET: 'fb-app-secret',
        FACEBOOK_REDIRECT_URI: 'http://localhost:3001/callback',
        FACEBOOK_WEBHOOK_VERIFY_TOKEN: 'webhook-verify-token',
        COOKIE_SECRET: 'a'.repeat(32),
        JWT_SECRET: 'b'.repeat(32),
        AI_SERVICE_URL: 'http://localhost:3002',
        FRONTEND_URL: 'http://localhost:3001',
        // OPENAI_API_KEY is now optional - translation uses AI worker
    };

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should parse valid environment variables', async () => {
        process.env = { ...validEnv };

        const mod = await import('../../src/utils/env');
        // The module-level env export should have been set
        expect(mod.env.NODE_ENV).toBe('test');
        expect(mod.env.PORT).toBe(3000);
        expect(mod.env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
        expect(mod.env.REDIS_PORT).toBe(6379);
    });

    it('should transform AI_ENABLED string to boolean', async () => {
        process.env = { ...validEnv, AI_ENABLED: 'true' };

        const mod = await import('../../src/utils/env');
        expect(mod.env.AI_ENABLED).toBe(true);
    });

    it('should default AI_ENABLED to false', async () => {
        process.env = { ...validEnv };

        const mod = await import('../../src/utils/env');
        expect(mod.env.AI_ENABLED).toBe(false);
    });

    it('should default TOPUP_ENABLED to false (card top-up off unless explicitly enabled)', async () => {
        process.env = { ...validEnv };

        const mod = await import('../../src/utils/env');
        expect(mod.env.TOPUP_ENABLED).toBe(false);
    });

    it('should transform TOPUP_ENABLED string "true" to boolean', async () => {
        process.env = { ...validEnv, TOPUP_ENABLED: 'true' };

        const mod = await import('../../src/utils/env');
        expect(mod.env.TOPUP_ENABLED).toBe(true);
    });

    it('should throw with clear message when DATABASE_URL is missing', async () => {
        const { DATABASE_URL, ...envWithout } = validEnv;
        process.env = { ...envWithout };

        // Import itself will throw because of module-level validateEnv()
        await expect(import('../../src/utils/env')).rejects.toThrow('Environment variable validation failed');
    });

    it('should throw when JWT_SECRET is too short', async () => {
        process.env = { ...validEnv, JWT_SECRET: 'short' };

        await expect(import('../../src/utils/env')).rejects.toThrow('JWT_SECRET');
    });

    it('should throw when COOKIE_SECRET is too short', async () => {
        process.env = { ...validEnv, COOKIE_SECRET: 'tiny' };

        await expect(import('../../src/utils/env')).rejects.toThrow('COOKIE_SECRET');
    });

    it('should accept optional Stripe keys', async () => {
        process.env = { ...validEnv, STRIPE_SECRET_KEY: 'sk_test_123' };

        const mod = await import('../../src/utils/env');
        expect(mod.env.STRIPE_SECRET_KEY).toBe('sk_test_123');
        expect(mod.env.STRIPE_PUBLISHABLE_KEY).toBeUndefined();
    });

    // A production env that satisfies the other prod refines (so these tests
    // isolate the STRIPE_WEBHOOK_SECRET guard).
    const prodEnv: Record<string, string> = {
        ...validEnv,
        NODE_ENV: 'production',
        REDIS_PASSWORD: 'a-strong-redis-password',
        RESEND_API_KEY: 're_test_key',
    };

    it('should throw in production when Stripe is configured but STRIPE_WEBHOOK_SECRET is missing', async () => {
        process.env = { ...prodEnv, STRIPE_SECRET_KEY: 'sk_live_123' };

        await expect(import('../../src/utils/env')).rejects.toThrow('STRIPE_WEBHOOK_SECRET');
    });

    it('should accept production when both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set', async () => {
        process.env = { ...prodEnv, STRIPE_SECRET_KEY: 'sk_live_123', STRIPE_WEBHOOK_SECRET: 'whsec_123' };

        const mod = await import('../../src/utils/env');
        expect(mod.env.STRIPE_WEBHOOK_SECRET).toBe('whsec_123');
    });

    it('should accept production without Stripe configured (no secret key, no webhook secret)', async () => {
        process.env = { ...prodEnv };

        const mod = await import('../../src/utils/env');
        expect(mod.env.NODE_ENV).toBe('production');
        expect(mod.env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    });

    it('should default NODE_ENV to development', async () => {
        const { NODE_ENV, ...envWithout } = validEnv;
        process.env = { ...envWithout };

        const mod = await import('../../src/utils/env');
        expect(mod.env.NODE_ENV).toBe('development');
    });
});

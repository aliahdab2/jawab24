import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        // Mock dotenv to prevent loading .env files
        vi.doMock('dotenv', () => ({ default: { config: vi.fn() } }));
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('should use default port 3002 when PORT is not set', async () => {
        delete process.env.PORT;
        const { config } = await import('../src/config');
        expect(config.port).toBe(3002);
    });

    it('should parse PORT from environment', async () => {
        process.env.PORT = '4000';
        const { config } = await import('../src/config');
        expect(config.port).toBe(4000);
    });

    it('should use default redis host localhost', async () => {
        delete process.env.REDIS_HOST;
        const { config } = await import('../src/config');
        expect(config.redis.host).toBe('localhost');
    });

    it('should parse REDIS_PORT as integer', async () => {
        process.env.REDIS_PORT = '6380';
        const { config } = await import('../src/config');
        expect(config.redis.port).toBe(6380);
    });

    it('should set redis password to undefined when not set', async () => {
        delete process.env.REDIS_PASSWORD;
        const { config } = await import('../src/config');
        expect(config.redis.password).toBeUndefined();
    });

    it('should always use gpt-4.1-mini model', async () => {
        const { config } = await import('../src/config');
        expect(config.openai.model).toBe('gpt-4.1-mini');
    });

    it('should parse OPENAI_MAX_TOKENS with default 500', async () => {
        delete process.env.OPENAI_MAX_TOKENS;
        const { config } = await import('../src/config');
        expect(config.openai.maxTokens).toBe(500);
    });

    it('should parse OPENAI_TEMPERATURE as float with default 0.5', async () => {
        delete process.env.OPENAI_TEMPERATURE;
        const { config } = await import('../src/config');
        expect(config.openai.temperature).toBe(0.5);
    });

    it('should parse OPENAI_TOP_P as float with default 0.9', async () => {
        delete process.env.OPENAI_TOP_P;
        const { config } = await import('../src/config');
        expect(config.openai.topP).toBe(0.9);
    });

    it('should parse OPENAI_FREQUENCY_PENALTY as float with default 0.3', async () => {
        delete process.env.OPENAI_FREQUENCY_PENALTY;
        const { config } = await import('../src/config');
        expect(config.openai.frequencyPenalty).toBe(0.3);
    });

    it('should parse OPENAI_PRESENCE_PENALTY as float with default 0.2', async () => {
        delete process.env.OPENAI_PRESENCE_PENALTY;
        const { config } = await import('../src/config');
        expect(config.openai.presencePenalty).toBe(0.2);
    });
});

import dotenv from 'dotenv';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';

dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3002', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Redis (for future queue-based processing)
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
    },

    // OpenAI - Always use gpt-4.1-mini for cost efficiency
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        // Fixed model - not configurable for cost control
        model: DEFAULT_AI_MODEL,
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '300', 10),
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
        timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10),
    },

    // Queue settings
    queue: {
        name: process.env.QUEUE_NAME || 'ai:pending',
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    },
};

/**
 * Validate config values at startup.
 * Catches misconfigured env vars (e.g. PORT=abc) before they cause runtime failures.
 */
export function validateConfig(): void {
    const errors: string[] = [];

    if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
        errors.push(`PORT must be 1-65535, got: ${process.env.PORT}`);
    }
    if (isNaN(config.openai.maxTokens) || config.openai.maxTokens < 1) {
        errors.push(`OPENAI_MAX_TOKENS must be a positive integer, got: ${process.env.OPENAI_MAX_TOKENS}`);
    }
    if (isNaN(config.openai.temperature) || config.openai.temperature < 0 || config.openai.temperature > 2) {
        errors.push(`OPENAI_TEMPERATURE must be 0-2, got: ${process.env.OPENAI_TEMPERATURE}`);
    }
    if (isNaN(config.openai.timeoutMs) || config.openai.timeoutMs < 1000) {
        errors.push(`OPENAI_TIMEOUT_MS must be >= 1000, got: ${process.env.OPENAI_TIMEOUT_MS}`);
    }
    if (isNaN(config.queue.concurrency) || config.queue.concurrency < 1) {
        errors.push(`QUEUE_CONCURRENCY must be a positive integer, got: ${process.env.QUEUE_CONCURRENCY}`);
    }

    if (errors.length > 0) {
        throw new Error(`AI Worker config validation failed:\n  - ${errors.join('\n  - ')}`);
    }
}


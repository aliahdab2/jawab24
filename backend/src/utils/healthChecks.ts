/**
 * Shared health-check probes used by both /health and /analytics/system-health.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { redis, isRedisAuthFailed } from '../lib/redis';
import { aiWorkerCircuit } from '../lib/circuitBreaker';

export interface ServiceProbe {
    status: 'up' | 'down';
    latencyMs: number;
    message?: string;
}

export async function probeDatabase(): Promise<ServiceProbe> {
    const start = Date.now();
    try {
        await db.execute(sql`SELECT 1`);
        return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
        return { status: 'down', latencyMs: -1, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function probeRedis(): Promise<ServiceProbe> {
    if (isRedisAuthFailed()) {
        return { status: 'down', latencyMs: -1, message: 'Redis auth failed — check REDIS_PASSWORD' };
    }
    const start = Date.now();
    try {
        await redis.ping();
        return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
        return { status: 'down', latencyMs: -1, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function probeAiWorkerCircuit(): Promise<'closed' | 'open' | 'half-open' | 'unknown'> {
    try {
        return await aiWorkerCircuit.getState();
    } catch {
        return 'unknown';
    }
}

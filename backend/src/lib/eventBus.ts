import Redis from 'ioredis';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import type { SSEEventType, SSEEventDataMap } from '@jawab24/shared';

// Re-use the existing shared Redis connection for publishing
import { redis as publisher } from './redis';

/** Channel prefix for user-scoped SSE events */
const CHANNEL_PREFIX = 'sse:user:';

/** Build the Redis channel name for a given userId */
export function userChannel(userId: string): string {
    return `${CHANNEL_PREFIX}${userId}`;
}

// Subscriber: needs a dedicated connection (ioredis blocks all commands
// except (P)(UN)SUBSCRIBE when in subscribe mode)
let subscriber: Redis | null = null;

export function getSubscriber(): Redis {
    if (!subscriber) {
        subscriber = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            lazyConnect: false,
            retryStrategy(times) {
                return Math.min(times * 50, 2000);
            },
        });
        subscriber.on('error', (err) => {
            console.error('Redis SSE Subscriber Error:', err);
            captureError(err, 'Redis SSE subscriber error', { tags: { service: 'sse-subscriber' } });
        });
    }
    return subscriber;
}

/**
 * Publish an SSE event for a specific user.
 * Called from processors after key actions (message stored, reply sent, etc.)
 *
 * Fire-and-forget: errors are captured but never thrown.
 * The reply pipeline must never fail because of SSE.
 */
export async function publishSSEEvent<T extends SSEEventType>(
    userId: string,
    type: T,
    data: SSEEventDataMap[T],
): Promise<void> {
    const payload = JSON.stringify({
        type,
        timestamp: new Date().toISOString(),
        data,
    });
    try {
        await publisher.publish(userChannel(userId), payload);
    } catch (err) {
        captureError(err, 'SSE publish failed', {
            tags: { service: 'event-bus', eventType: type },
        });
    }
}

/** Graceful shutdown: disconnect the subscriber connection. */
export async function shutdownEventBus(): Promise<void> {
    if (subscriber) {
        try {
            await subscriber.quit();
        } catch {
            // Ignore errors during shutdown
        }
        subscriber = null;
    }
}

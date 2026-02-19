import Redis from 'ioredis';
import { config } from '../config';
import * as Sentry from '@sentry/node';

// Create a shared Redis instance
// We use lazy connection or just global connection from config
export const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    lazyConnect: true, // Don't connect immediately on import
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

redis.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('Redis Client Error:', err);
    Sentry.captureException(err, { tags: { service: 'redis' } });
});

// eslint-disable-next-line no-console
redis.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('✅ Redis Client Connected');
});

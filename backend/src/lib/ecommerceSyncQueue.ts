import { Queue } from 'bullmq';
import { config } from '../config';
import { EcommerceSyncJobData, ECOMMERCE_SYNC_QUEUE_NAME } from '@jawab24/shared';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const ecommerceSyncQueue = new Queue<EcommerceSyncJobData>(ECOMMERCE_SYNC_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 3000, // 3s, 6s, 12s between retries
        },
        removeOnComplete: 50,
        removeOnFail: 200,
    },
});

/**
 * Enqueue a full product sync for an e-commerce store
 */
export async function enqueueSyncJob(storeId: string, platform: 'shopify' | 'salla' | 'zid' = 'shopify'): Promise<void> {
    await ecommerceSyncQueue.add('full_sync', {
        ecommerceStoreId: storeId,
        platform,
        jobType: 'full_sync',
    });
}

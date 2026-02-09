import { Queue } from 'bullmq';
import { config } from '../config';
import { ShopifySyncJobData, SHOPIFY_SYNC_QUEUE_NAME } from '@jawab24/shared';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const shopifySyncQueue = new Queue<ShopifySyncJobData>(SHOPIFY_SYNC_QUEUE_NAME, {
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
 * Enqueue a full product sync for a Shopify store
 */
export async function enqueueSyncJob(storeId: string): Promise<void> {
    await shopifySyncQueue.add('full_sync', {
        shopifyStoreId: storeId,
        jobType: 'full_sync',
    });
}

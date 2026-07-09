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
 * Enqueue a sync for an e-commerce store.
 *
 * `full_sync` (default) refreshes store info + the whole catalog — right for
 * install/claim and the 6h scheduler. Product webhooks should pass
 * `product_update` instead: it re-syncs the catalog WITHOUT the store-info
 * round-trip (Salla/Zid product payloads are too sparse for an in-place upsert,
 * so a catalog re-fetch is still needed — but touching store info on every
 * product edit is redundant API load).
 */
export async function enqueueSyncJob(
    storeId: string,
    platform: 'shopify' | 'salla' | 'zid' = 'shopify',
    jobType: 'full_sync' | 'product_update' = 'full_sync',
): Promise<void> {
    await ecommerceSyncQueue.add(jobType, {
        ecommerceStoreId: storeId,
        platform,
        jobType,
    });
}

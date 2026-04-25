import { Queue } from 'bullmq';
import { config } from '../config';

export const WEBHOOK_RETRY_QUEUE = 'ecommerce-webhook-retry';

export interface WebhookRetryJobData {
    storeId: string;
    platform: 'shopify' | 'salla' | 'zid';
}

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const webhookRetryQueue = new Queue<WebhookRetryJobData>(WEBHOOK_RETRY_QUEUE, {
    connection,
    defaultJobOptions: {
        // 3 attempts, exponential 30s/2min/8min — covers the 30-min window from
        // the production-readiness plan without retrying so often that a flaky
        // Shopify upstream burns the whole queue.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: 200,
    },
});

export async function enqueueWebhookRetry(data: WebhookRetryJobData): Promise<void> {
    await webhookRetryQueue.add('retry', data);
}

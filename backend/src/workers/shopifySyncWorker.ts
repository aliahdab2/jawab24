import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { ShopifySyncJobData, SHOPIFY_SYNC_QUEUE_NAME } from '@jawab24/shared';
import * as shopifyService from '../services/shopify';
import { Logger, noopLogger } from '../types';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

let logger: Logger = noopLogger;

export function setSyncWorkerLogger(newLogger: Logger): void {
    logger = newLogger;
}

async function processJob(job: Job<ShopifySyncJobData>) {
    const { shopifyStoreId, jobType } = job.data;
    logger.info('[ShopifySync] Processing', { shopifyStoreId, jobType });

    switch (jobType) {
        case 'full_sync':
            return shopifyService.fullSync(shopifyStoreId);
        case 'product_update':
            return shopifyService.syncProducts(shopifyStoreId);
        default:
            throw new Error(`[ShopifySync] Unknown job type: ${jobType}`);
    }
}

let worker: Worker | null = null;

export function startShopifySyncWorker(): Worker {
    worker = new Worker<ShopifySyncJobData>(
        SHOPIFY_SYNC_QUEUE_NAME,
        processJob,
        {
            connection,
            concurrency: 2,
            limiter: { max: 5, duration: 60_000 }, // Max 5 syncs per minute
        }
    );

    worker.on('completed', (job) => {
        logger.info('[ShopifySync] Job completed', { jobId: job.id, storeId: job.data.shopifyStoreId });
    });

    worker.on('failed', (job, err) => {
        logger.error('[ShopifySync] Job failed', {
            jobId: job?.id,
            storeId: job?.data.shopifyStoreId,
            error: err.message,
        });
    });

    logger.info('[ShopifySync] Worker started');
    return worker;
}

export function stopShopifySyncWorker(): Promise<void> {
    if (worker) return worker.close();
    return Promise.resolve();
}

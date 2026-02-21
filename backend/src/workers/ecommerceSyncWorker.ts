import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { EcommerceSyncJobData, ECOMMERCE_SYNC_QUEUE_NAME } from '@jawab24/shared';
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

async function processJob(job: Job<EcommerceSyncJobData>) {
    const { ecommerceStoreId, jobType } = job.data;
    logger.info('[EcommerceSync] Processing', { ecommerceStoreId, jobType });

    switch (jobType) {
        case 'full_sync':
            return shopifyService.fullSync(ecommerceStoreId);
        case 'product_update':
            return shopifyService.syncProducts(ecommerceStoreId);
        default:
            throw new Error(`[EcommerceSync] Unknown job type: ${jobType}`);
    }
}

let worker: Worker | null = null;

export function startEcommerceSyncWorker(): Worker {
    worker = new Worker<EcommerceSyncJobData>(
        ECOMMERCE_SYNC_QUEUE_NAME,
        processJob,
        {
            connection,
            concurrency: 2,
            limiter: { max: 5, duration: 60_000 }, // Max 5 syncs per minute
        }
    );

    worker.on('completed', (job) => {
        logger.info('[EcommerceSync] Job completed', { jobId: job.id, storeId: job.data.ecommerceStoreId });
    });

    worker.on('failed', (job, err) => {
        logger.error('[EcommerceSync] Job failed', {
            jobId: job?.id,
            storeId: job?.data.ecommerceStoreId,
            error: err.message,
        });
    });

    logger.info('[EcommerceSync] Worker started');
    return worker;
}

export function stopEcommerceSyncWorker(): Promise<void> {
    if (worker) return worker.close();
    return Promise.resolve();
}

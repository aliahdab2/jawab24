import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { WEBHOOK_RETRY_QUEUE, WebhookRetryJobData } from '../lib/webhookRetryQueue';
import { getStoreById, saveWebhookStatus } from '../services/ecommerce';
import { isDemoStore } from '../services/demoStore';
import { integrationRegistry, toStoreForWebhooks } from '../integrations/registry';
import { captureError } from '../utils/sentryHelpers';
import { Logger, noopLogger } from '../types';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

let logger: Logger = noopLogger;

export function setWebhookRetryWorkerLogger(newLogger: Logger): void {
    logger = newLogger;
}

async function processJob(job: Job<WebhookRetryJobData>): Promise<void> {
    const { storeId, platform } = job.data;
    logger.info('[WebhookRetry] Processing job', { jobId: job.id, storeId, platform });

    const store = await getStoreById(storeId);
    if (!store || !store.isActive) {
        logger.info('[WebhookRetry] Store missing or inactive — skipping', { storeId });
        return;
    }
    if (isDemoStore(store)) {
        // Placeholder token can't be decrypted — retrying would only burn
        // attempts and fire a webhook-retry-exhausted Sentry alert.
        logger.info('[WebhookRetry] Demo store — skipping', { storeId });
        return;
    }

    const adapter = integrationRegistry.get(platform);
    if (!adapter) {
        logger.warn('[WebhookRetry] No adapter registered for platform', { platform });
        return;
    }

    const status = await adapter.registerWebhooks(toStoreForWebhooks(store));
    await saveWebhookStatus(storeId, status);
    if (status.failed.length > 0) {
        // Throw so BullMQ schedules the next attempt with exponential backoff.
        throw new Error(`${platform} webhook retry: ${status.failed.length} topic(s) still failing`);
    }
}

let worker: Worker | null = null;

export function startWebhookRetryWorker(): Worker {
    if (worker) return worker;

    worker = new Worker<WebhookRetryJobData>(
        WEBHOOK_RETRY_QUEUE,
        processJob,
        { connection, concurrency: 5 },
    );

    worker.on('completed', (job) => {
        logger.info('[WebhookRetry] Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        logger.error('[WebhookRetry] Job failed', { jobId: job?.id, error: err.message });
        if (job?.attemptsMade && job.attemptsMade >= (job.opts.attempts || 3)) {
            // Persist a merchant-visible "exhausted" marker so the integrations
            // card can render a "Re-register webhooks" CTA. Without this, an
            // exhausted retry queue is silently invisible to the merchant.
            void markWebhookStatusExhausted(job.data.storeId, err.message)
                .catch(persistErr => {
                    captureError(persistErr, 'Failed to persist webhook exhaustion marker', {
                        tags: { service: job.data.platform, stage: 'webhook-retry-exhausted-persist' },
                        extra: { storeId: job.data.storeId },
                    });
                });

            captureError(err, 'Webhook retry exhausted', {
                tags: { service: job.data.platform, stage: 'webhook-retry-exhausted' },
                extra: { storeId: job.data.storeId, attempts: job.attemptsMade },
            });
        }
    });

    logger.info('[WebhookRetry] Worker started');
    return worker;
}

async function markWebhookStatusExhausted(storeId: string, errorMessage: string): Promise<void> {
    const store = await getStoreById(storeId);
    const platformData = (store?.platformData as Record<string, unknown> | null) ?? {};
    const existing = (platformData.webhookStatus as {
        registered?: string[];
        failed?: unknown[];
        alreadyRegistered?: Array<{ topic: string; status: number }>;
    } | undefined) ?? null;
    await saveWebhookStatus(storeId, {
        registered: existing?.registered ?? [],
        failed: (existing?.failed as Array<{ topic: string; status?: number; error?: string }>) ?? [{ topic: 'unknown', error: errorMessage }],
        lastAttempt: new Date().toISOString(),
        exhausted: true,
        // Carry the last attempt's per-topic duplicate statuses through. This
        // marker is written right after the attempt that produced them, and
        // dropping them here would erase the diagnostic exactly when the store
        // is stuck and it is most needed.
        ...(existing?.alreadyRegistered ? { alreadyRegistered: existing.alreadyRegistered } : {}),
    });
}

export async function stopWebhookRetryWorker(): Promise<void> {
    if (worker) {
        await worker.close();
        worker = null;
    }
}

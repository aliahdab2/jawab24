import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { CUSTOMER_NOTIFICATION_QUEUE, CustomerNotificationJobData } from '../lib/customerNotificationQueue';
import { customerNotificationService } from '../services/customerNotifications';
import { Logger, noopLogger } from '../types';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

let logger: Logger = noopLogger;

export function setCustomerNotificationWorkerLogger(newLogger: Logger): void {
    logger = newLogger;
}

async function processJob(job: Job<CustomerNotificationJobData>): Promise<void> {
    const { notificationLogId } = job.data;
    logger.info('[CustomerNotif] Processing job', { jobId: job.id, notificationLogId });
    await customerNotificationService.send(notificationLogId);
}

let worker: Worker | null = null;

export function startCustomerNotificationWorker(): Worker {
    if (worker) return worker;

    worker = new Worker<CustomerNotificationJobData>(
        CUSTOMER_NOTIFICATION_QUEUE,
        processJob,
        {
            connection,
            concurrency: 10,
            limiter: { max: 50, duration: 60_000 }, // max 50 sends/min — retry policy lives on the Queue (customerNotificationQueue.ts)
        },
    );

    worker.on('completed', (job) => {
        logger.info('[CustomerNotif] Job completed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
        logger.error('[CustomerNotif] Job failed', { jobId: job?.id, error: err.message });
    });

    logger.info('[CustomerNotif] Worker started');
    return worker;
}

export function stopCustomerNotificationWorker(): Promise<void> {
    if (worker) return worker.close();
    return Promise.resolve();
}

import { Worker } from 'bullmq';
import { AI_QUEUE_NAME } from '@jawab24/shared';
import { config } from './config';
import { openaiService } from './services/openai';
import { Sentry } from './lib/sentry';

let worker: Worker | null = null;

export function startWorker(logger?: { info: Function; error: Function }) {
    const log = logger || console;

    const connection = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
    };

    worker = new Worker(AI_QUEUE_NAME, async (job) => {
        log.info({ jobId: job.id }, 'Processing job');
        const { comment, language, context } = job.data;
        try {
            const result = await openaiService.generateReply({ comment, language, context });
            return result;
        } catch (error) {
            log.error({ jobId: job.id, error }, 'Job failed');
            Sentry.captureException(error, { extra: { jobId: job.id, comment, language } });
            throw error;
        }
    }, {
        connection,
        concurrency: config.queue.concurrency,
    });

    worker.on('completed', (job) => {
        log.info({ jobId: job.id }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
        log.error({ jobId: job?.id, err }, 'Job failed');
    });

    return worker;
}

export function stopWorker(): Promise<void> {
    if (worker) {
        const w = worker;
        worker = null;
        return w.close();
    }
    return Promise.resolve();
}

export function getWorker(): Worker | null {
    return worker;
}

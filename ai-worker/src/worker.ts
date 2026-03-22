import { Worker } from 'bullmq';
import { AI_QUEUE_NAME } from '@jawab24/shared';
import { config } from './config';
import { openaiService } from './services/openai';
import { Sentry } from './lib/sentry';
import { Semaphore } from './lib/semaphore';

// Limit concurrent OpenAI API calls to avoid rate limits.
// Queue concurrency may be higher (e.g. 10) to handle job scheduling,
// but actual API calls are capped here.
const openaiSemaphore = new Semaphore(
    parseInt(process.env.OPENAI_MAX_CONCURRENT || '5', 10),
);

let worker: Worker | null = null;

interface WorkerLogger {
    info(obj: Record<string, unknown>, msg?: string): void;
    error(obj: Record<string, unknown>, msg?: string): void;
}

export function startWorker(logger?: WorkerLogger) {
    const log: WorkerLogger = logger || {
        info: (obj, msg) => console.log(msg, obj),
        error: (obj, msg) => console.error(msg, obj),
    };

    const connection = {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
    };

    worker = new Worker(AI_QUEUE_NAME, async (job) => {
        log.info({ jobId: job.id }, 'Processing job');
        const { comment, language, context } = job.data;
        try {
            const result = await openaiSemaphore.run(() =>
                openaiService.generateReply({ comment, language, context }),
            );
            return result;
        } catch (error) {
            log.error({ jobId: job.id, error }, 'Job failed');
            Sentry.captureException(error, { extra: { jobId: job.id, comment, language } });
            throw error;
        }
    }, {
        connection,
        concurrency: config.queue.concurrency,
        autorun: true,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
    });

    worker.on('completed', (job) => {
        log.info({ jobId: job.id }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
        log.error({ jobId: job?.id, err: String(err) }, 'Job failed');
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

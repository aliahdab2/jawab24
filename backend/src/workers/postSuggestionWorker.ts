import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { PostSuggestionJobData, POST_SUGGESTION_QUEUE_NAME } from '@jawab24/shared';
import { postSuggestionsService } from '../services/postSuggestions';
import { Logger, noopLogger } from '../types';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

let logger: Logger = noopLogger;

export function setPostSuggestionWorkerLogger(newLogger: Logger): void {
    logger = newLogger;
}

async function processJob(job: Job<PostSuggestionJobData>) {
    const { suggestionId, pageId, includeContact } = job.data;
    logger.info('[PostSuggestions] Fulfilling', { suggestionId, pageId });
    // The service owns the terminal state: it writes 'ready' or 'failed' and
    // never leaves the row pending, so a merchant's spent slot always resolves
    // into something they can see.
    return postSuggestionsService.fulfilSuggestion(suggestionId, { includeContact });
}

let worker: Worker | null = null;

export function startPostSuggestionWorker(): Worker {
    if (worker) return worker; // Idempotent — safe to call from several entry points

    worker = new Worker<PostSuggestionJobData>(
        POST_SUGGESTION_QUEUE_NAME,
        processJob,
        {
            connection,
            // Two at a time: each job holds an OpenAI image call for ~22s, and
            // the point of moving off the request path was to stop stacking
            // those against a proxy timeout — not to stack them against each
            // other. The daily cap bounds total volume regardless.
            concurrency: 2,
        },
    );

    worker.on('completed', (job) => {
        logger.info('[PostSuggestions] Fulfilled', { jobId: job.id, suggestionId: job.data.suggestionId });
    });

    worker.on('failed', (job, err) => {
        logger.error('[PostSuggestions] Fulfilment failed', {
            jobId: job?.id,
            suggestionId: job?.data.suggestionId,
            error: err.message,
        });
        // LAST CHANCE to resolve the row. The service marks its own failures,
        // so reaching here means it threw before it could — a DB blip on the
        // very first read, an OOM, a killed process. With `attempts: 1` there
        // is no retry behind us, and a row left 'pending' is the one outcome
        // the merchant can never recover from: their slot is spent and the UI
        // waits on work that already died. Best-effort by nature (if the
        // database is what broke, this cannot land either) — never throw out
        // of an event handler.
        if (job?.data.suggestionId) {
            void postSuggestionsService.markFulfilmentAbandoned(job.data.suggestionId)
                .catch((markErr: unknown) => logger.error('[PostSuggestions] Could not mark abandoned row failed', {
                    suggestionId: job.data.suggestionId,
                    error: markErr instanceof Error ? markErr.message : String(markErr),
                }));
        }
    });

    logger.info('[PostSuggestions] Worker started');
    return worker;
}

export function stopPostSuggestionWorker(): Promise<void> {
    if (worker) return worker.close();
    return Promise.resolve();
}

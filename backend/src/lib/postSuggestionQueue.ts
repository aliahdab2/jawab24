import { Queue } from 'bullmq';
import { config } from '../config';
import { PostSuggestionJobData, POST_SUGGESTION_QUEUE_NAME } from '@jawab24/shared';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const postSuggestionQueue = new Queue<PostSuggestionJobData>(POST_SUGGESTION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        /**
         * ⛔ ONE attempt. Every sibling queue in this repo retries three times;
         * this one must not, and the difference is money.
         *
         * A retry here re-runs a PAID OpenAI text call and a PAID image call.
         * The daily cap already charged the merchant exactly one slot for this
         * request, so a silent third attempt would spend three times what they
         * were charged, and — worse — a job that failed AFTER the image landed
         * would redo it and orphan the first file.
         *
         * The generation is not idempotent, so the only safe retry is the one
         * the MERCHANT chooses, with a slot charged for it.
         */
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 200,
    },
});

/**
 * Queue the fulfilment of a suggestion row that already exists in `pending`.
 *
 * The row is created first, inside the same request that claimed the cap slot,
 * so a queue that is down loses a JOB, never the merchant's place in the
 * ledger: the row stays pending and is visible as such, rather than a slot
 * silently spent on nothing.
 */
export async function enqueuePostSuggestion(data: PostSuggestionJobData): Promise<void> {
    await postSuggestionQueue.add('generate', data, {
        // The row id is the natural idempotency key: a duplicated enqueue (a
        // retried HTTP request, a redeployed worker) collapses onto the same
        // job instead of generating — and paying — twice.
        jobId: data.suggestionId,
    });
}

import OpenAI from 'openai';
import * as Sentry from '@sentry/node';
import type { EmbeddingProvider, EmbeddingLogContext } from './interfaces';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';
import { logAiUsage } from '../aiUsageLog';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../../lib/aiMetrics';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
/** text-embedding-3-small has an 8192 token limit (~4 chars/token). Stay safely under. */
const MAX_INPUT_CHARS = 28000;

function truncateForEmbedding(text: string, logger: Logger): string {
    if (text.length <= MAX_INPUT_CHARS) return text;
    logger.warn('Truncating text for embedding API', { originalLength: text.length, truncatedTo: MAX_INPUT_CHARS });
    return text.slice(0, MAX_INPUT_CHARS);
}

/** Retry with exponential backoff for transient API failures */
async function withRetry<T>(fn: () => Promise<T>, logger: Logger, retries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            const isLastAttempt = attempt === retries;
            const status = (error as { status?: number }).status;
            const isRetryable = status === 429 || (status !== undefined && status >= 500);
            if (isLastAttempt || !isRetryable) throw error;

            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            logger.warn('Embedding API call failed, retrying', { attempt, status, delay });
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Unreachable');
}

/**
 * OpenAI embedding provider using text-embedding-3-small (512 dimensions).
 * Includes retry with exponential backoff for rate limits and server errors.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private client: OpenAI;
    private logger: Logger = noopLogger;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    getDimensions(): number {
        return EMBEDDING_DIMENSIONS;
    }

    async embed(text: string, logCtx?: EmbeddingLogContext): Promise<number[]> {
        const safeText = truncateForEmbedding(text, this.logger);
        const pipeline = logCtx?.pipeline;
        recordAiAttempt(pipeline, EMBEDDING_MODEL);
        let response;
        try {
            response = await withRetry(() =>
                this.client.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: safeText,
                    dimensions: EMBEDDING_DIMENSIONS,
                }),
                this.logger,
            );
        } catch (err) {
            recordAiFailedBeforeLog(pipeline, EMBEDDING_MODEL, 'OpenAIApiError');
            throw err;
        }
        recordAiReturn(pipeline, EMBEDDING_MODEL);
        if (logCtx && response.usage) {
            logEmbeddingUsage(logCtx, response.usage.prompt_tokens ?? 0);
        } else if (!logCtx) {
            warnUnattributedEmbedding('embed', response.usage?.prompt_tokens ?? 0);
            recordAiFailedBeforeLog(pipeline, EMBEDDING_MODEL, 'MissingUserId');
        }
        return response.data[0].embedding;
    }

    async embedBatch(texts: string[], logCtx?: EmbeddingLogContext): Promise<number[][]> {
        if (texts.length === 0) return [];

        const results: number[][] = [];
        const pipeline = logCtx?.pipeline;
        for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
            const batch = texts.slice(i, i + MAX_BATCH_SIZE).map(t => truncateForEmbedding(t, this.logger));
            this.logger.debug('Embedding batch', { batchStart: i, batchSize: batch.length, totalTexts: texts.length });
            recordAiAttempt(pipeline, EMBEDDING_MODEL);
            let response;
            try {
                response = await withRetry(() =>
                    this.client.embeddings.create({
                        model: EMBEDDING_MODEL,
                        input: batch,
                        dimensions: EMBEDDING_DIMENSIONS,
                    }),
                    this.logger,
                );
            } catch (err) {
                recordAiFailedBeforeLog(pipeline, EMBEDDING_MODEL, 'OpenAIApiError');
                throw err;
            }
            recordAiReturn(pipeline, EMBEDDING_MODEL);
            if (logCtx && response.usage) {
                logEmbeddingUsage(logCtx, response.usage.prompt_tokens ?? 0);
            } else if (!logCtx) {
                warnUnattributedEmbedding('embedBatch', response.usage?.prompt_tokens ?? 0);
                recordAiFailedBeforeLog(pipeline, EMBEDDING_MODEL, 'MissingUserId');
            }
            const sorted = response.data.sort((a, b) => a.index - b.index);
            results.push(...sorted.map(d => d.embedding));
        }
        return results;
    }
}

/**
 * Surface embedding calls made without a logCtx as a Sentry breadcrumb.
 * Callers conditionally drop the context when userId is missing (e.g.
 * unauthenticated cache lookups, ingestion for pages with no owner row);
 * those tokens still cost real money, and this trail makes any new
 * unattributed code path visible without breaking the call.
 */
function warnUnattributedEmbedding(method: 'embed' | 'embedBatch', tokensIn: number): void {
    Sentry.addBreadcrumb({
        category: 'ai_usage_log',
        level: 'warning',
        message: `embedding usage skipped: no logCtx (${method})`,
        data: { tokensIn, model: EMBEDDING_MODEL },
    });
}

function logEmbeddingUsage(ctx: EmbeddingLogContext, tokensIn: number): void {
    logAiUsage({
        userId: ctx.userId,
        pageId: ctx.pageId,
        model: EMBEDDING_MODEL,
        tokensIn,
        tokensOut: 0,
        cached: false,
        pipeline: ctx.pipeline,
    }).catch(() => { /* Sentry breadcrumb emitted inside logAiUsage on failure */ });
}

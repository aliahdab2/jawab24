import OpenAI from 'openai';
import type { EmbeddingProvider } from './interfaces';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';

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

    async embed(text: string): Promise<number[]> {
        const safeText = truncateForEmbedding(text, this.logger);
        const response = await withRetry(() =>
            this.client.embeddings.create({
                model: EMBEDDING_MODEL,
                input: safeText,
                dimensions: EMBEDDING_DIMENSIONS,
            }),
            this.logger,
        );
        return response.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const results: number[][] = [];
        for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
            const batch = texts.slice(i, i + MAX_BATCH_SIZE).map(t => truncateForEmbedding(t, this.logger));
            this.logger.debug('Embedding batch', { batchStart: i, batchSize: batch.length, totalTexts: texts.length });
            const response = await withRetry(() =>
                this.client.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: batch,
                    dimensions: EMBEDDING_DIMENSIONS,
                }),
                this.logger,
            );
            const sorted = response.data.sort((a, b) => a.index - b.index);
            results.push(...sorted.map(d => d.embedding));
        }
        return results;
    }
}

import OpenAI from 'openai';
import type { EmbeddingProvider } from './interfaces';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Retry with exponential backoff for transient API failures */
async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            const isLastAttempt = attempt === retries;
            const status = (error as { status?: number }).status;
            const isRetryable = status === 429 || (status !== undefined && status >= 500);
            if (isLastAttempt || !isRetryable) throw error;

            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
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

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    getDimensions(): number {
        return EMBEDDING_DIMENSIONS;
    }

    async embed(text: string): Promise<number[]> {
        const response = await withRetry(() =>
            this.client.embeddings.create({
                model: EMBEDDING_MODEL,
                input: text,
                dimensions: EMBEDDING_DIMENSIONS,
            })
        );
        return response.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const results: number[][] = [];
        for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
            const batch = texts.slice(i, i + MAX_BATCH_SIZE);
            const response = await withRetry(() =>
                this.client.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: batch,
                    dimensions: EMBEDDING_DIMENSIONS,
                })
            );
            const sorted = response.data.sort((a, b) => a.index - b.index);
            results.push(...sorted.map(d => d.embedding));
        }
        return results;
    }
}

import { randomUUID } from 'crypto';
import { db } from '../../db';
import { kbChunks } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { VectorStore, ChunkWithEmbedding, ScoredChunk } from './interfaces';

/** Validate that a vector is an array of finite numbers */
function validateVector(vec: number[], expectedDim: number): void {
    if (!Array.isArray(vec) || vec.length !== expectedDim) {
        throw new Error(`Invalid embedding: expected ${expectedDim} dimensions, got ${vec.length}`);
    }
    for (let i = 0; i < vec.length; i++) {
        if (!Number.isFinite(vec[i])) {
            throw new Error(`Invalid embedding: non-finite value at index ${i}`);
        }
    }
}

const EMBEDDING_DIMENSIONS = 512;

/**
 * pgvector-backed vector store.
 * Uses raw SQL for vector operations (Drizzle doesn't support vector type natively).
 */
export class PgVectorStore implements VectorStore {

    async upsertChunks(pageId: string, chunks: ChunkWithEmbedding[]): Promise<void> {
        if (chunks.length === 0) return;

        for (const chunk of chunks) {
            validateVector(chunk.embedding, EMBEDDING_DIMENSIONS);
        }

        // Use a transaction so partial failures don't leave orphaned rows
        await db.transaction(async (tx) => {
            // Delete existing chunks for this page+version to prevent duplicates
            const kbVersion = chunks[0].kbVersion;
            await tx.delete(kbChunks).where(
                and(eq(kbChunks.pageId, pageId), eq(kbChunks.kbVersion, kbVersion))
            );

            // Pre-generate ids client-side so INSERT and UPDATE can reference
            // the same id set without depending on RETURNING row order
            // (PostgreSQL's spec leaves RETURNING order unspecified).
            const rows = chunks.map((chunk) => ({ id: randomUUID(), chunk }));

            // Single multi-row INSERT instead of one statement per chunk.
            // Drizzle doesn't support the pgvector type, so embeddings are set
            // in a separate pass below.
            await tx
                .insert(kbChunks)
                .values(rows.map(({ id, chunk }) => ({
                    id,
                    pageId: chunk.pageId,
                    type: chunk.type,
                    language: chunk.language,
                    title: chunk.title,
                    contentOriginal: chunk.contentOriginal,
                    contentNormalized: chunk.contentNormalized,
                    titleNormalized: chunk.titleNormalized,
                    tokenCount: chunk.tokenCount,
                    metadata: chunk.metadata,
                    kbVersion: chunk.kbVersion,
                })));

            // Single UPDATE ... FROM (VALUES ...) sets every embedding in one
            // round trip.
            const pairs = sql.join(
                rows.map(({ id, chunk }) => {
                    const vectorStr = `[${chunk.embedding.join(',')}]`;
                    return sql`(${id}::uuid, ${vectorStr}::vector)`;
                }),
                sql`, `,
            );
            await tx.execute(sql`
                UPDATE kb_chunks SET embedding = v.emb
                FROM (VALUES ${pairs}) AS v(id, emb)
                WHERE kb_chunks.id = v.id
            `);
        });
    }

    async searchSimilar(
        pageId: string,
        queryVector: number[],
        topK: number,
        kbIndexedVersion: number,
    ): Promise<ScoredChunk[]> {
        validateVector(queryVector, EMBEDDING_DIMENSIONS);
        const vectorStr = `[${queryVector.join(',')}]`;

        // Vector-only search via HNSW index.
        // Full hybrid scoring (vector + trigram) is done in retrieval.ts (PR5).
        const results = await db.execute(sql`
            SELECT
                id,
                type,
                language,
                title,
                content_original,
                1 - (embedding <=> ${vectorStr}::vector) as vec_score
            FROM kb_chunks
            WHERE page_id = ${pageId}
              AND kb_version = ${kbIndexedVersion}
              AND embedding IS NOT NULL
              AND (valid_until IS NULL OR valid_until > NOW())
              AND source_tier < 5
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT ${topK}
        `);
        return (results as unknown as Array<Record<string, unknown>>).map(row => ({
            id: row.id as string,
            type: row.type as string,
            language: (row.language as string) || null,
            title: (row.title as string) || null,
            contentOriginal: row.content_original as string,
            vectorScore: Number(row.vec_score),
            textScore: 0,
            finalScore: Number(row.vec_score),
        }));
    }

    async deleteByPage(pageId: string): Promise<void> {
        await db.delete(kbChunks).where(eq(kbChunks.pageId, pageId));
    }

    async deleteByPageVersion(pageId: string, kbVersion: number): Promise<void> {
        await db.delete(kbChunks).where(
            and(eq(kbChunks.pageId, pageId), eq(kbChunks.kbVersion, kbVersion))
        );
    }
}

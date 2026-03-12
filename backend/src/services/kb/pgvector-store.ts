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

        // Use a transaction so partial failures don't leave orphaned rows
        await db.transaction(async (tx) => {
            // Delete existing chunks for this page+version to prevent duplicates
            const kbVersion = chunks[0].kbVersion;
            await tx.delete(kbChunks).where(
                and(eq(kbChunks.pageId, pageId), eq(kbChunks.kbVersion, kbVersion))
            );

            for (const chunk of chunks) {
                validateVector(chunk.embedding, EMBEDDING_DIMENSIONS);

                const [inserted] = await tx
                    .insert(kbChunks)
                    .values({
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
                    })
                    .returning({ id: kbChunks.id });

                // Set the embedding via raw SQL (Drizzle doesn't support vector type)
                if (inserted) {
                    const vectorStr = `[${chunk.embedding.join(',')}]`;
                    await tx.execute(
                        sql`UPDATE kb_chunks SET embedding = ${vectorStr}::vector WHERE id = ${inserted.id}`
                    );
                }
            }
        });
    }

    async searchSimilar(
        pageId: string,
        queryVector: number[],
        topK: number,
        kbActiveVersion: number,
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
              AND kb_version = ${kbActiveVersion}
              AND embedding IS NOT NULL
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

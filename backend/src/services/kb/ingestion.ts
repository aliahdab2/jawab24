import { db } from '../../db';
import { pages } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { EmbeddingProvider, VectorStore, ChunkWithEmbedding } from './interfaces';
import { chunkKnowledgeBase, chunkBusinessProfile } from './chunker';
import type { KbChunk } from './chunker';

/**
 * KB Ingestion Pipeline.
 *
 * Flow: raw text → chunk → normalize → embed → store → activate version
 *
 * Version-based swap guarantees zero empty windows:
 * 1. New chunks are inserted with the new kbVersion
 * 2. kbActiveVersion is updated only after ALL chunks are stored
 * 3. Retrieval always filters by kbActiveVersion (previous complete set)
 * 4. Old version chunks are cleaned up separately
 */
export class KbIngestionService {
    constructor(
        private embeddingProvider: EmbeddingProvider,
        private vectorStore: VectorStore,
    ) {}

    /**
     * Full KB re-ingestion from raw text.
     * Called when a merchant updates their knowledge base.
     */
    async ingestKnowledgeBase(pageId: string, rawText: string, kbVersion: number): Promise<void> {
        // 1. Chunk the raw text
        const chunks = chunkKnowledgeBase(rawText);
        if (chunks.length === 0) return;

        // 2. Embed all chunks
        const chunksWithEmbeddings = await this.embedChunks(pageId, chunks, kbVersion);

        // 3. Store in vector DB
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);

        // 4. Activate the new version (atomic — retrieval now uses new chunks)
        await db.update(pages)
            .set({ kbActiveVersion: kbVersion })
            .where(eq(pages.id, pageId));
    }

    /**
     * Ingest chunks from business profile (hours, location, contact).
     * These supplement KB chunks even if the merchant hasn't written any KB text.
     */
    async ingestBusinessProfile(pageId: string, profile: Record<string, unknown>, kbVersion: number): Promise<void> {
        const chunks = chunkBusinessProfile(profile);
        if (chunks.length === 0) return;

        const chunksWithEmbeddings = await this.embedChunks(pageId, chunks, kbVersion);
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);
    }

    /**
     * Clean up chunks from old versions.
     * Call after confirming the new version is active and working.
     */
    async cleanupOldVersions(pageId: string, keepVersion: number): Promise<void> {
        // Delete all chunks that are NOT the active version
        await db.execute(
            sql`DELETE FROM kb_chunks WHERE page_id = ${pageId} AND kb_version != ${keepVersion}`
        );
    }

    /**
     * Embed a batch of chunks, returning ChunkWithEmbedding[] ready for storage.
     */
    private async embedChunks(
        pageId: string,
        chunks: KbChunk[],
        kbVersion: number,
    ): Promise<ChunkWithEmbedding[]> {
        // Combine title + content for embedding (title gives extra context)
        const textsToEmbed = chunks.map(c =>
            c.title ? `${c.title}\n${c.contentNormalized}` : c.contentNormalized
        );

        const embeddings = await this.embeddingProvider.embedBatch(textsToEmbed);

        return chunks.map((chunk, i) => ({
            pageId,
            type: chunk.type,
            language: chunk.language,
            title: chunk.title,
            contentOriginal: chunk.contentOriginal,
            contentNormalized: chunk.contentNormalized,
            titleNormalized: chunk.titleNormalized,
            tokenCount: chunk.tokenCount,
            metadata: chunk.metadata,
            embedding: embeddings[i],
            kbVersion,
        }));
    }
}

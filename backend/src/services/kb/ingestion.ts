import { db } from '../../db';
import { pages } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { EmbeddingProvider, VectorStore, ChunkWithEmbedding } from './interfaces';
import { chunkKnowledgeBase, chunkBusinessProfile, chunkProducts } from './chunker';
import type { KbChunk, ProductData } from './chunker';
import { gapDetectorService } from './gap-detector';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';

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
    private logger: Logger = noopLogger;

    constructor(
        private embeddingProvider: EmbeddingProvider,
        private vectorStore: VectorStore,
    ) {}

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Full KB re-ingestion from raw text.
     * Called when a merchant updates their knowledge base.
     */
    async ingestKnowledgeBase(pageId: string, rawText: string, kbVersion: number): Promise<void> {
        // 1. Chunk the raw text
        const chunks = chunkKnowledgeBase(rawText);
        if (chunks.length === 0) {
            this.logger.debug('KB ingestion skipped: no chunks from text', { pageId, kbVersion });
            return;
        }

        this.logger.info('KB ingestion started', { pageId, kbVersion, chunkCount: chunks.length });

        // 2. Embed all chunks
        const chunksWithEmbeddings = await this.embedChunks(pageId, chunks, kbVersion);

        // 3. Store in vector DB
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);

        // 4. Activate the new version (atomic — retrieval now uses new chunks)
        await db.update(pages)
            .set({ kbActiveVersion: kbVersion })
            .where(eq(pages.id, pageId));

        // 5. Resolve all existing KB gaps — the merchant just updated their KB,
        //    so previous gaps may now be covered by the new content.
        //    Non-critical: failure here should not break the ingestion success path.
        try {
            gapDetectorService.setLogger(this.logger);
            await gapDetectorService.resolveAllForPage(pageId);
        } catch (error) {
            this.logger.error('Failed to resolve KB gaps after ingestion', {
                error: error instanceof Error ? error.message : String(error),
                pageId,
            });
        }

        this.logger.info('KB ingestion completed, version activated', { pageId, kbVersion, chunkCount: chunks.length });
    }

    /**
     * Ingest chunks from business profile (hours, location, contact).
     * These supplement KB chunks even if the merchant hasn't written any KB text.
     *
     * Note: Does NOT activate kbActiveVersion — profile chunks are supplementary.
     * Call ingestKnowledgeBase() to activate the version after all chunks are stored.
     */
    async ingestBusinessProfile(pageId: string, profile: Record<string, unknown>, kbVersion: number): Promise<void> {
        const chunks = chunkBusinessProfile(profile);
        if (chunks.length === 0) return;

        this.logger.info('Business profile ingestion started', { pageId, kbVersion, chunkCount: chunks.length });
        const chunksWithEmbeddings = await this.embedChunks(pageId, chunks, kbVersion);
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);
    }

    /**
     * Full page re-ingestion: KB text + e-commerce products.
     * Atomically activates the version only after ALL chunks are embedded and stored.
     *
     * Called from:
     * - invalidateCachesForStore() when products sync
     * - pages.updatePage() when merchant updates KB text
     */
    async ingestFullPage(
        pageId: string,
        rawKBText: string | undefined,
        products: ProductData[],
        kbVersion: number,
    ): Promise<void> {
        const kbChunks = rawKBText?.trim() ? chunkKnowledgeBase(rawKBText) : [];
        const productChunks = chunkProducts(products);
        const allChunks = [...kbChunks, ...productChunks];

        if (allChunks.length === 0) {
            this.logger.debug('Full page ingestion skipped: no chunks', { pageId, kbVersion });
            return;
        }

        this.logger.info('Full page ingestion started', {
            pageId, kbVersion,
            kbChunks: kbChunks.length,
            productChunks: productChunks.length,
        });

        const chunksWithEmbeddings = await this.embedChunks(pageId, allChunks, kbVersion);
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);

        await db.update(pages)
            .set({ kbActiveVersion: kbVersion })
            .where(eq(pages.id, pageId));

        try {
            gapDetectorService.setLogger(this.logger);
            await gapDetectorService.resolveAllForPage(pageId);
        } catch (error) {
            this.logger.error('Failed to resolve KB gaps after full page ingestion', {
                error: error instanceof Error ? error.message : String(error),
                pageId,
            });
        }

        this.logger.info('Full page ingestion completed, version activated', {
            pageId, kbVersion,
            totalChunks: allChunks.length,
        });
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

        // Resolve userId from pageId so the embedding cost is attributed to the merchant.
        // Ingestion is rare (KB updates), so the extra round-trip is acceptable.
        const [pageRow] = await db.select({ userId: pages.userId }).from(pages).where(eq(pages.id, pageId)).limit(1);
        const logCtx = pageRow?.userId ? { userId: pageRow.userId, pageId, pipeline: 'embedding_ingestion' as const } : undefined;

        const embeddings = await this.embeddingProvider.embedBatch(textsToEmbed, logCtx);

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

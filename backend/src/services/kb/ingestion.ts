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
 * 2. kbActiveVersion AND kbIndexedVersion are updated only after ALL chunks are stored
 * 3. Retrieval always filters by kbIndexedVersion (previous complete set)
 * 4. Old version chunks are cleaned up separately
 *
 * INVARIANT (D-106): this file is the ONLY writer of `kbIndexedVersion` that sets it to a
 * version — the single exception is `updatePage`, which clears it to NULL the moment the KB
 * text changes so no reader can be served chunks built from text the merchant just edited.
 * Never set it from a cache-invalidation path: `kbActiveVersion` is the cache token and is
 * bumped by every prompt-injected write (business_profile, catalog_items, fact_collections),
 * and letting those bumps move the retrieval filter is what orphaned 16 of 57 live pages'
 * chunk indexes before this split.
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
            // Activate the empty version anyway — same reason as ingestFullPage
            // below: a cleared KB must stop serving its old chunks. Profile chunks
            // stored under this version by ingestBusinessProfile become active
            // too, which is what that method's doc promises. No gap resolution:
            // nothing was answered.
            await db.update(pages)
                .set({ kbActiveVersion: kbVersion, kbIndexedVersion: kbVersion })
                .where(eq(pages.id, pageId));
            this.logger.info('KB ingestion activated an empty version: no chunks from text', { pageId, kbVersion });
            return;
        }

        this.logger.info('KB ingestion started', { pageId, kbVersion, chunkCount: chunks.length });

        // 2. Embed all chunks
        const chunksWithEmbeddings = await this.embedChunks(pageId, chunks, kbVersion);

        // 3. Store in vector DB
        await this.vectorStore.upsertChunks(pageId, chunksWithEmbeddings);

        // 4. Activate the new version (atomic — retrieval now uses new chunks)
        await db.update(pages)
            .set({ kbActiveVersion: kbVersion, kbIndexedVersion: kbVersion })
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
        opts?: { resolveGaps?: boolean },
    ): Promise<void> {
        const kbChunks = rawKBText?.trim() ? chunkKnowledgeBase(rawKBText) : [];
        const productChunks = chunkProducts(products);
        const allChunks = [...kbChunks, ...productChunks];

        if (allChunks.length === 0) {
            // An EMPTY version must still be activated. Returning early here left
            // the previous version active, so a page whose Business Info was
            // cleared (and has no sellable products) kept serving its old chunks
            // indefinitely — and `reingestDriftedPages` retried it every cycle,
            // since kbVersion stayed ahead of kbActiveVersion forever. Retrieval
            // filters on the active version, so activating an empty one is what
            // makes the deleted facts disappear. Nothing is stored, nothing is
            // embedded, and no gap is resolved (nothing was answered).
            await db.update(pages)
                .set({ kbActiveVersion: kbVersion, kbIndexedVersion: kbVersion })
                .where(eq(pages.id, pageId));
            this.logger.info('Full page ingestion activated an empty version: no chunks', { pageId, kbVersion });
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
            .set({ kbActiveVersion: kbVersion, kbIndexedVersion: kbVersion })
            .where(eq(pages.id, pageId));

        // Resolving gaps means "the merchant just answered the open customer
        // questions by editing their KB" — true for a normal KB edit, FALSE for
        // a Phase-C cleanup save, which only REMOVES product lines that moved to
        // the catalog and answers nothing. A cleanup passes resolveGaps:false so
        // the «سألها N عملاء» backlog survives (it anchors the /business page).
        if (opts?.resolveGaps !== false) {
            try {
                gapDetectorService.setLogger(this.logger);
                await gapDetectorService.resolveAllForPage(pageId);
            } catch (error) {
                this.logger.error('Failed to resolve KB gaps after full page ingestion', {
                    error: error instanceof Error ? error.message : String(error),
                    pageId,
                });
            }
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
     *
     * Embeddings are reused from the page's ACTIVE version for every chunk whose
     * embed text is byte-identical, and only the misses go to the provider. A
     * product webhook re-ingests the whole catalog + KB for every linked page
     * (ecommerce.invalidateCachesForStore), and the 6-hourly scheduled sync does
     * the same with nothing changed — without reuse, each of those paid for every
     * chunk again. Reuse is an optimisation only: a lookup failure embeds everything.
     */
    private async embedChunks(
        pageId: string,
        chunks: KbChunk[],
        kbVersion: number,
    ): Promise<ChunkWithEmbedding[]> {
        // Combine title + content for embedding (title gives extra context)
        const textsToEmbed = chunks.map(c => embedTextFor(c));

        // Resolve userId from pageId so the embedding cost is attributed to the merchant.
        // Ingestion is rare (KB updates), so the extra round-trip is acceptable.
        //
        // Reuse takes NO pointer (D-106 review). Both were wrong here: the cache token
        // (`kb_active_version`) names a generation holding no rows whenever a prompt-injected
        // write has bumped it, and `kb_indexed_version` is deliberately NULL on the most
        // common trigger of all — `updatePage` clears it before firing this very ingest — so
        // keying on either silently re-embedded every chunk on the page, including a store's
        // whole catalogue, which is the exact cost this path exists to avoid. The previous
        // COMPLETE generation is a property of `kb_chunks`, so it is read from there.
        const [pageRow] = await db.select({ userId: pages.userId })
            .from(pages).where(eq(pages.id, pageId)).limit(1);
        const logCtx = pageRow?.userId ? { userId: pageRow.userId, pageId, pipeline: 'embedding_ingestion' as const } : undefined;

        const reusable = await this.loadReusableEmbeddings(pageId, kbVersion);
        const embeddings: Array<number[] | undefined> = textsToEmbed.map(text => reusable.get(text));
        const missIndexes = embeddings.flatMap((e, i) => (e ? [] : [i]));

        if (missIndexes.length > 0) {
            const fresh = await this.embeddingProvider.embedBatch(missIndexes.map(i => textsToEmbed[i]), logCtx);
            missIndexes.forEach((chunkIndex, j) => { embeddings[chunkIndex] = fresh[j]; });
        }

        this.logger.info('Chunk embeddings resolved', {
            pageId, kbVersion,
            reused: chunks.length - missIndexes.length,
            embedded: missIndexes.length,
        });

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
            embedding: embeddings[i] as number[],
            kbVersion,
        }));
    }

    /**
     * Embeddings of the newest generation stored BELOW `newVersion`, keyed by the exact text
     * that was embedded — the same `embedTextFor` the caller uses, so a key hit means the
     * vector is valid for the new chunk as-is. Empty when the page has no earlier generation
     * or the read fails (then everything is embedded afresh).
     *
     * Deliberately derived from `kb_chunks` rather than from any pointer on `pages`: the
     * question "which stored generation can I reuse?" is answered by the rows themselves, and
     * every pointer answer got it wrong in at least one real case (see embedChunks).
     */
    private async loadReusableEmbeddings(pageId: string, newVersion: number): Promise<Map<string, number[]>> {
        const reusable = new Map<string, number[]>();

        try {
            const result = await db.execute(sql`
                SELECT title, content_normalized, embedding::text AS embedding
                FROM kb_chunks
                WHERE page_id = ${pageId}
                  AND embedding IS NOT NULL
                  AND kb_version = (
                      SELECT max(kb_version) FROM kb_chunks
                      WHERE page_id = ${pageId} AND kb_version < ${newVersion}
                  )
            `);
            type Row = { title: string | null; content_normalized: string; embedding: string };
            const rows = (result as unknown as { rows?: Row[] }).rows ?? (result as unknown as Row[]);
            if (!Array.isArray(rows)) return reusable;

            for (const row of rows) {
                const key = embedTextFor({ title: row.title, contentNormalized: row.content_normalized });
                // pgvector's text form is `[0.1,0.2,...]`, which is valid JSON.
                reusable.set(key, JSON.parse(row.embedding) as number[]);
            }
        } catch (error) {
            this.logger.warn('Embedding reuse lookup failed — embedding every chunk', {
                pageId, newVersion, error: error instanceof Error ? error.message : String(error),
            });
        }

        return reusable;
    }
}

/** The exact text a chunk is embedded as; reuse keys on this, so it must stay the single definition. */
function embedTextFor(c: { title: string | null; contentNormalized: string }): string {
    return c.title ? `${c.title}\n${c.contentNormalized}` : c.contentNormalized;
}

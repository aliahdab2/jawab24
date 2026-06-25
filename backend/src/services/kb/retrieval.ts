import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { normalizeArabic } from '@jawab24/shared';
import type { EmbeddingProvider } from './interfaces';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';

export interface RetrievedChunk {
    id: string;
    type: string;
    language: string | null;
    title: string | null;
    content: string;
    /** Authority tier (1 = most authoritative … 4 = raw narrative). Tier 5 is filtered out before reaching this object. */
    sourceTier: number;
    vectorScore: number;
    textScore: number;
    finalScore: number;
}

export interface RetrievalResult {
    chunks: RetrievedChunk[];
    queryEmbedding: number[];
}

/** Minimum final score to include a chunk in results */
const MIN_SCORE_THRESHOLD = 0.3;
/** Default number of chunks to return (env-overridable; raised 5→10). 5 was too small for
 *  multi-course asks ("امين icdl انكليزي" — the 3rd course's chunk ranked #7, outside top-5 →
 *  false denial). The candidate pool is re-ranked first, so this only widens what reaches the model. */
const DEFAULT_TOP_K = Math.max(1, parseInt(process.env.RAG_TOP_K || '10', 10) || 10);
/** Weight for vector score in hybrid fusion */
const VECTOR_WEIGHT = 0.7;
/** Weight for text (trigram) score in hybrid fusion */
const TEXT_WEIGHT = 0.3;
/** Language match bonus */
const LANGUAGE_BOOST = 0.02;
/**
 * Per-tier-level boost added to final_score. Tier 1 chunks get +0.45 over tier 4 baseline,
 * tier 2 get +0.30, tier 3 get +0.15. Calibrated as a starting point; tune via eval.
 */
const SOURCE_TIER_BOOST_PER_LEVEL = 0.15;
/** source_tier values >= this are excluded from retrieval (auto-extracted suggestions awaiting review). */
const SOURCE_TIER_EXCLUDED = 5;

/** Detect language by Arabic character ratio */
function detectQueryLanguage(text: string): string {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    return arabicChars / Math.max(text.length, 1) > 0.3 ? 'ar' : 'en';
}

/**
 * Hybrid retrieval service: vector similarity (HNSW) + trigram keyword search (pg_trgm).
 *
 * Strategy:
 * 1. Normalize + embed the query
 * 2. Vector search: top-20 candidates via HNSW index (fast); skip chunks past valid_until or tier 5+
 * 3. Trigram re-rank: score title + content trigram similarity on candidates only
 * 4. Fuse scores: 0.7 * vecScore + 0.3 * textScore + language boost + source-tier boost
 *    where source-tier boost = (4 - LEAST(source_tier, 4)) * 0.15
 *    (tier 1 → +0.45, tier 2 → +0.30, tier 3 → +0.15, tier 4 → 0)
 * 5. Filter by threshold + return top-K
 */
export class RetrievalService {
    private logger: Logger = noopLogger;

    constructor(private embeddingProvider: EmbeddingProvider) {}

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Retrieve relevant KB chunks for a query.
     * Returns chunks + the computed query embedding (reusable by semantic cache).
     */
    async retrieve(
        pageId: string,
        query: string,
        kbActiveVersion: number,
        topK: number = DEFAULT_TOP_K,
        userId?: string,
    ): Promise<RetrievalResult> {
        // 1. Normalize + embed
        const normalizedQuery = normalizeArabic(query);
        const queryLanguage = detectQueryLanguage(query);

        this.logger.debug('Retrieval started', { pageId, queryLanguage, kbActiveVersion });

        const embedLogCtx = userId ? { userId, pageId, pipeline: 'embedding_rag' as const } : undefined;
        const queryEmbedding = await this.embeddingProvider.embed(normalizedQuery, embedLogCtx);
        const vectorStr = `[${queryEmbedding.join(',')}]`;

        // 2+3. Hybrid search: vector candidates → trigram re-rank in a single query
        const results = await db.execute(sql`
            WITH vector_candidates AS (
                SELECT
                    id,
                    type,
                    language,
                    title,
                    title_normalized,
                    content_original,
                    content_normalized,
                    source_tier,
                    1 - (embedding <=> ${vectorStr}::vector) as vec_score
                FROM kb_chunks
                WHERE page_id = ${pageId}
                  AND kb_version = ${kbActiveVersion}
                  AND embedding IS NOT NULL
                  AND (valid_until IS NULL OR valid_until > NOW())
                  AND source_tier < ${sql.raw(String(SOURCE_TIER_EXCLUDED))}
                ORDER BY embedding <=> ${vectorStr}::vector
                LIMIT 20
            )
            SELECT
                id,
                type,
                language,
                title,
                content_original,
                source_tier,
                vec_score,
                COALESCE(
                    0.6 * similarity(title_normalized, ${normalizedQuery})
                    + 0.4 * similarity(content_normalized, ${normalizedQuery}),
                    0
                ) as text_score,
                ${sql.raw(String(VECTOR_WEIGHT))} * vec_score
                + ${sql.raw(String(TEXT_WEIGHT))} * COALESCE(
                    0.6 * similarity(title_normalized, ${normalizedQuery})
                    + 0.4 * similarity(content_normalized, ${normalizedQuery}),
                    0
                )
                + CASE WHEN language = ${queryLanguage} THEN ${sql.raw(String(LANGUAGE_BOOST))} ELSE 0 END
                + (4 - LEAST(source_tier, 4)) * ${sql.raw(String(SOURCE_TIER_BOOST_PER_LEVEL))}
                as final_score
            FROM vector_candidates
            WHERE vec_score >= ${sql.raw(String(MIN_SCORE_THRESHOLD))}
            ORDER BY final_score DESC
            LIMIT ${topK}
        `);

        const chunks = (results as unknown as Array<Record<string, unknown>>).map(row => ({
            id: row.id as string,
            type: row.type as string,
            language: (row.language as string) || null,
            title: (row.title as string) || null,
            content: (row.content_original as string) || '',
            sourceTier: Number(row.source_tier),
            vectorScore: Number(row.vec_score),
            textScore: Number(row.text_score),
            finalScore: Number(row.final_score),
        }));

        this.logger.info('Retrieval completed', {
            pageId,
            kbActiveVersion,
            candidatesReturned: chunks.length,
            topScore: chunks[0]?.finalScore ?? 0,
        });

        return { chunks, queryEmbedding };
    }
}

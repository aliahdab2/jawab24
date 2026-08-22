import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { normalizeArabic } from '@jawab24/shared';
import { config } from '../../config';
import { OpenAIEmbeddingProvider } from './embedding';
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
     * Embed an already-normalized query for the product resolver's semantic
     * stage. Only reached when the caller had no reply embedding to reuse
     * (e.g. a by-name check outside the reply path); the common path never
     * calls this (Rule 17.2). Attributed to the merchant when a userId is known.
     */
    embedForResolver(normalizedQuery: string, userId?: string): Promise<number[]> {
        const logCtx = userId ? { userId, pipeline: 'embedding_rag' as const } : undefined;
        return this.embeddingProvider.embed(normalizedQuery, logCtx);
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

    /**
     * Dual/multi-query retrieval: run each query through `retrieve`, then UNION the
     * candidates by chunk id (keeping the higher finalScore), re-rank by finalScore,
     * and return the top-K. Used to combine a RAW follow-up query with its
     * conversation-ENRICHED variant: the enriched query helps vague pronoun
     * follow-ups, while the raw query guarantees a self-contained question still
     * pulls its own chunk back even when enrichment poisons the embedding with an
     * off-topic prior turn (the misspelled-topic-after-location-turn deflection).
     *
     * The fusion weights, MIN_SCORE_THRESHOLD, language/tier boosts, and top-K are
     * all unchanged — this only widens the candidate pool before the final cut.
     *
     * `primaryEmbeddingIndex` selects which query's embedding is returned for the
     * semantic-cache key (default 0); pass the raw-query index so the cache stays
     * keyed on the customer's actual words.
     */
    async retrieveMulti(
        pageId: string,
        queries: string[],
        kbActiveVersion: number,
        topK: number = DEFAULT_TOP_K,
        userId?: string,
        primaryEmbeddingIndex = 0,
    ): Promise<RetrievalResult> {
        const uniqueQueries = [...new Set(queries.map(q => (q || '').trim()).filter(Boolean))];
        if (uniqueQueries.length <= 1) {
            return this.retrieve(pageId, uniqueQueries[0] ?? (queries[0] || ''), kbActiveVersion, topK, userId);
        }

        const results = await Promise.all(
            uniqueQueries.map(q => this.retrieve(pageId, q, kbActiveVersion, topK, userId)),
        );

        const bestById = new Map<string, RetrievedChunk>();
        for (const r of results) {
            for (const c of r.chunks) {
                const prev = bestById.get(c.id);
                if (!prev || c.finalScore > prev.finalScore) bestById.set(c.id, c);
            }
        }
        const merged = [...bestById.values()]
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, topK);

        // Return the requested query's embedding for cache keying (raw query by convention).
        const primaryQuery = (queries[primaryEmbeddingIndex] || '').trim();
        const primaryIdx = Math.max(0, uniqueQueries.indexOf(primaryQuery));

        this.logger.info('Multi-query retrieval completed', {
            pageId, kbActiveVersion, queries: uniqueQueries.length,
            merged: merged.length, topScore: merged[0]?.finalScore ?? 0,
        });

        return { chunks: merged, queryEmbedding: results[primaryIdx].queryEmbedding };
    }
}

// ---------------------------------------------------------------------------
// Product resolution (D-092)
// ---------------------------------------------------------------------------

/** One product of a page's index, scored against a customer's words. */
export interface ProductHit {
    platformProductId: string;
    title: string;
    /** Cosine similarity of the page's best chunk for this product; null when no embedding was supplied. */
    vecScore: number | null;
    /** 0.6·similarity(title) + 0.4·similarity(content), pg_trgm, on the best chunk. */
    triScore: number;
}

/**
 * Score every product chunk of a page against a query — the candidate set
 * `resolveProduct` decides over (D-092).
 *
 * Deliberately NOT `retrieve()`:
 *   - exact scan of `type = 'product'` at the active version, no HNSW top-20
 *     pre-filter — at ≤ 5,000 product rows a product that ranks low on cosine
 *     but high on trigram must still be in the set, and the HNSW candidate
 *     cut would drop it before the trigram stage ever saw it;
 *   - no LANGUAGE_BOOST, no tier boost — product chunks are all one tier and
 *     the boosts would add a constant to every row;
 *   - grouped by `metadata->>'platformProductId'` taking the MAX of each score,
 *     because a long product becomes several chunks (chunker.ts splitLongText)
 *     and a product must be one candidate, not three;
 *   - the embedding is OPTIONAL: the trigram stage runs without one, and the
 *     reply's own `queryEmbedding` is reused when the caller has it, so the
 *     common path costs no embedding call (Rule 17.2).
 *
 * Thresholds live in productResolver.ts; this only scores.
 */
export async function retrieveProducts(
    pageId: string,
    kbActiveVersion: number,
    normalizedQuery: string,
    queryEmbedding: number[] | null,
    limit = 20,
): Promise<ProductHit[]> {
    const vectorStr = queryEmbedding ? `[${queryEmbedding.join(',')}]` : null;
    const vecExpr = vectorStr
        ? sql`1 - (embedding <=> ${vectorStr}::vector)`
        : sql`NULL::float8`;

    const results = await db.execute(sql`
        WITH scored AS (
            SELECT
                metadata->>'platformProductId' AS platform_product_id,
                title,
                ${vecExpr} AS vec_score,
                COALESCE(
                    0.6 * similarity(title_normalized, ${normalizedQuery})
                    + 0.4 * similarity(content_normalized, ${normalizedQuery}),
                    0
                ) AS tri_score
            FROM kb_chunks
            WHERE page_id = ${pageId}
              AND kb_version = ${kbActiveVersion}
              AND type = 'product'
              AND embedding IS NOT NULL
              AND metadata->>'platformProductId' IS NOT NULL
        )
        SELECT
            platform_product_id,
            MIN(title) AS title,
            MAX(vec_score) AS vec_score,
            MAX(tri_score) AS tri_score
        FROM scored
        GROUP BY platform_product_id
        ORDER BY GREATEST(COALESCE(MAX(vec_score), 0), MAX(tri_score)) DESC
        LIMIT ${limit}
    `);

    return (results as unknown as Array<Record<string, unknown>>).map(row => ({
        platformProductId: String(row.platform_product_id),
        // A split product's chunk titles read "Title (1/3)"; MIN() picks a stable one
        // and the resolver re-reads the real title from the product row anyway.
        title: String(row.title ?? ''),
        vecScore: row.vec_score === null || row.vec_score === undefined ? null : Number(row.vec_score),
        triScore: Number(row.tri_score ?? 0),
    }));
}

/**
 * Lazy singleton — the ONE RetrievalService both the reply generator and the
 * product resolver use (moved here from generator.ts so the resolver does not
 * import the generator). Null when RAG is off or there is no OpenAI key.
 */
let _retrievalService: RetrievalService | null = null;
export function getRetrievalService(): RetrievalService | null {
    if (!config.ragMode || config.ragMode === 'off') return null;
    if (!config.openai?.apiKey) return null;
    if (!_retrievalService) {
        _retrievalService = new RetrievalService(new OpenAIEmbeddingProvider(config.openai.apiKey));
    }
    return _retrievalService;
}

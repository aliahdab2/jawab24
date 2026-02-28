import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';
import { PROMPT_VERSION } from '@jawab24/shared';

/** Intent-aware cosine similarity thresholds for semantic cache hits.
 * Lower thresholds for formulaic intents (greetings), higher for nuanced ones (complaints). */
const INTENT_THRESHOLDS: Record<string, number> = {
    GREETING: 0.88,
    COMPLIMENT: 0.90,
    PRICE: 0.91,
    HOURS: 0.91,
    LOCATION: 0.91,
    BOOKING: 0.92,
    OFFERING_INFO: 0.92,
    PURCHASE_INTENT: 0.92,
    POLICY: 0.93,
    QUESTION: 0.93,
    BUSINESS_INQUIRY: 0.94,
    COMPLAINT: 0.95,
};
const DEFAULT_SIMILARITY_THRESHOLD = 0.93;

export interface SemanticCacheHit {
    reply: string;
    intent: string;
    confidence?: string;
    flags?: string[];
}

export interface SemanticCacheSaveParams {
    pageId: string;
    queryText: string;
    queryEmbedding: number[];
    intent: string;
    replyText: string;
    kbActiveVersion: number;
    channel?: string;
    replyStyle?: string;
    metadata?: { confidence?: string; flags?: string[]; intent?: string };
}

/**
 * Semantic cache service — stores and retrieves AI replies
 * using vector similarity on query embeddings.
 *
 * Cache entries are scoped by:
 * - pageId (no cross-page leaks)
 * - intent (PRICE queries don't match HOURS queries even if words overlap)
 * - kbActiveVersion (stale entries auto-invalidate when KB is re-ingested)
 * - promptVersion (stale entries auto-invalidate when prompt is updated)
 * - channel + replyStyle (stored in metadata JSONB, filtered application-side)
 * - 7-day TTL (eventual expiration)
 */
export class SemanticCacheService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Check for a semantically similar cached reply.
     * Returns null on miss.
     */
    async check(
        pageId: string,
        queryEmbedding: number[],
        intent: string,
        kbActiveVersion: number,
        channel?: string,
        replyStyle?: string,
    ): Promise<SemanticCacheHit | null> {
        try {
            const vectorStr = `[${queryEmbedding.join(',')}]`;
            const threshold = INTENT_THRESHOLDS[intent] ?? DEFAULT_SIMILARITY_THRESHOLD;

            // Fetch top 5 candidates — application-level filtering by channel/replyStyle below
            const results = await db.execute(sql`
                SELECT
                    id,
                    reply_text,
                    intent,
                    metadata,
                    1 - (query_embedding <=> ${vectorStr}::vector) as similarity
                FROM semantic_cache
                WHERE page_id = ${pageId}
                  AND intent = ${intent}
                  AND kb_active_version_at_creation = ${kbActiveVersion}
                  AND prompt_version = ${PROMPT_VERSION}
                  AND created_at > NOW() - INTERVAL '7 days'
                  AND 1 - (query_embedding <=> ${vectorStr}::vector) >= ${threshold}
                ORDER BY 1 - (query_embedding <=> ${vectorStr}::vector) DESC
                LIMIT 5
            `);

            const rows = results as unknown as Array<Record<string, unknown>>;
            if (rows.length === 0) {
                this.logger.debug('[SemanticCache] miss', { pageId, intent });
                return null;
            }

            // Application-level filter: match channel and replyStyle from metadata
            const matched = rows.find(row => {
                const meta = (row.metadata || {}) as Record<string, unknown>;
                if (channel && meta.channel && meta.channel !== channel) return false;
                if (replyStyle && meta.replyStyle && meta.replyStyle !== replyStyle) return false;
                return true;
            });

            if (!matched) {
                this.logger.debug('[SemanticCache] miss (channel/style mismatch)', { pageId, intent, channel, replyStyle });
                return null;
            }

            const row = matched;
            const similarity = Number(row.similarity);
            const meta = (row.metadata || {}) as { confidence?: string; flags?: string[]; intent?: string };

            this.logger.info('[SemanticCache] hit', {
                pageId, intent, similarity: similarity.toFixed(4),
            });

            // Update hit count asynchronously (fire-and-forget)
            this.incrementHitCount(row.id as string).catch(err => {
                this.logger.debug('[SemanticCache] hit count update failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });

            return {
                reply: row.reply_text as string,
                // Prefer AI-classified intent (stored in metadata) over pre-GPT keyword intent
                intent: meta.intent || (row.intent as string),
                confidence: meta.confidence,
                flags: meta.flags,
            };
        } catch (error) {
            this.logger.error('[SemanticCache] check failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Save a new entry to the semantic cache.
     */
    async save(params: SemanticCacheSaveParams): Promise<void> {
        try {
            const vectorStr = `[${params.queryEmbedding.join(',')}]`;
            const metadata = {
                ...(params.metadata || {}),
                ...(params.channel ? { channel: params.channel } : {}),
                ...(params.replyStyle ? { replyStyle: params.replyStyle } : {}),
            };

            await db.execute(sql`
                INSERT INTO semantic_cache (
                    page_id, query_text, query_embedding, intent,
                    reply_text, metadata, kb_active_version_at_creation, prompt_version
                ) VALUES (
                    ${params.pageId},
                    ${params.queryText},
                    ${vectorStr}::vector,
                    ${params.intent},
                    ${params.replyText},
                    ${JSON.stringify(metadata)}::jsonb,
                    ${params.kbActiveVersion},
                    ${PROMPT_VERSION}
                )
            `);

            this.logger.debug('[SemanticCache] saved', {
                pageId: params.pageId, intent: params.intent,
            });
        } catch (error) {
            this.logger.error('[SemanticCache] save failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Invalidate all cache entries for a page (e.g., when KB changes).
     * Usually not needed because version-scoping handles this,
     * but useful for explicit cleanup.
     */
    async invalidateByPage(pageId: string): Promise<void> {
        await db.execute(sql`
            DELETE FROM semantic_cache WHERE page_id = ${pageId}
        `);
    }

    private async incrementHitCount(id: string): Promise<void> {
        await db.execute(sql`
            UPDATE semantic_cache
            SET hit_count = COALESCE(hit_count, 0) + 1
            WHERE id = ${id}::uuid
        `);
    }
}

export const semanticCacheService = new SemanticCacheService();

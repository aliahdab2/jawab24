import axios from 'axios';
import crypto from 'crypto';
import { db } from '../db';
import { aiCache } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { config } from '../config';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';
import { redis } from '../lib/redis';
import { normalizeArabic } from '@jawab24/shared';
import { detectIntent } from './kb/intent-detector';
import { semanticCacheService } from './kb/semantic-cache';
import { OpenAIEmbeddingProvider } from './kb/embedding';

/** Lazy-init embedding provider for semantic cache (only when OPENAI_API_KEY exists) */
let _embeddingProvider: OpenAIEmbeddingProvider | null = null;
function getEmbeddingProvider(): OpenAIEmbeddingProvider | null {
    if (!config.openai?.apiKey) return null;
    if (!_embeddingProvider) {
        _embeddingProvider = new OpenAIEmbeddingProvider(config.openai.apiKey);
    }
    return _embeddingProvider;
}

export class AiService {
    private logger: Logger = noopLogger;

    /** Set logger for this service instance */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Generate a hash for a comment to use as cache key
     * Includes pageId to prevent cross-page cache collisions
     */
    private hashComment(comment: string, language?: string, pageId?: string): string {
        // Remove punctuation, emojis, and extra whitespace to increase cache hits
        const normalized = comment
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, '') // Keep letters, numbers, whitespace
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();

        const key = `${normalized}:${language || 'auto'}:${pageId || 'global'}`;
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /**
     * Check cache for existing reply (returns full AI metadata when available)
     */
    async checkCache(comment: string, language?: string, pageId?: string): Promise<{ reply: string; intent?: string; confidence?: string; flags?: string[] } | null> {
        if (!config.ai.cacheEnabled) {
            return null;
        }

        const hash = this.hashComment(comment, language, pageId);
        const cacheKey = `cache:ai_reply:${hash}`;

        try {
            // Try Redis first (fast path) — stores JSON with metadata
            const cachedData = await redis.get(cacheKey);
            if (cachedData) {
                try {
                    const parsed = JSON.parse(cachedData);
                    if (parsed && typeof parsed === 'object' && parsed.reply) {
                        this.logger.info('ai_cache_hit_with_metadata', { hash });
                        return parsed;
                    }
                } catch {
                    // Old format (plain text) — discard; fresh AI call will save with metadata
                    this.logger.info('ai_cache_miss_legacy_discarded', { hash });
                }
            }
        } catch (error) {
            this.logger.error('Redis cache error', { error });
        }

        // Fallback to Postgres (slow path / persistent)
        const cached = await db
            .select()
            .from(aiCache)
            .where(eq(aiCache.commentHash, hash));

        if (cached.length > 0) {
            const meta = cached[0].metadata as { intent?: string; confidence?: string; flags?: string[] } | null;

            // Skip entries without metadata — fresh AI call will save with full flagging data
            if (!meta) {
                this.logger.info('ai_cache_miss_postgres_no_metadata', { hash });
                return null;
            }

            const reply = cached[0].replyText;
            const result = { reply, intent: meta.intent, confidence: meta.confidence, flags: meta.flags };
            this.logger.info('ai_cache_hit_postgres', { hash });

            // Populate Redis for next time (JSON format with metadata)
            try {
                await redis.set(cacheKey, JSON.stringify(result), 'EX', 30 * 24 * 60 * 60);
            } catch {
                // Ignore redis set error
            }

            // Update DB hit count
            await db
                .update(aiCache)
                .set({
                    hitCount: (cached[0].hitCount || 0) + 1,
                    lastUsedAt: new Date(),
                })
                .where(eq(aiCache.id, cached[0].id));

            return result;
        }

        this.logger.info('ai_cache_miss', { hash });
        return null;
    }

    /**
     * Save reply to cache (includes AI metadata for correct flagging on cache hits)
     */
    async saveToCache(
        comment: string,
        reply: string,
        language?: string,
        pageId?: string,
        metadata?: { intent?: string; confidence?: string; flags?: string[] }
    ): Promise<void> {
        if (!config.ai.cacheEnabled) {
            return;
        }

        const hash = this.hashComment(comment, language, pageId);
        const cacheKey = `cache:ai_reply:${hash}`;
        const cacheData = JSON.stringify({ reply, intent: metadata?.intent, confidence: metadata?.confidence, flags: metadata?.flags });

        // Save to Redis (30 days TTL) — JSON with metadata
        try {
            await redis.set(cacheKey, cacheData, 'EX', 30 * 24 * 60 * 60);
        } catch (error) {
            this.logger.error('Failed to save to Redis', { error });
        }

        // Save to Postgres (Persistent)
        await db
            .insert(aiCache)
            .values({
                commentHash: hash,
                replyText: reply,
                language: language || null,
                metadata: metadata || null,
            })
            .onConflictDoUpdate({
                target: aiCache.commentHash,
                set: {
                    replyText: reply,
                    metadata: metadata || null,
                    hitCount: sql`COALESCE(${aiCache.hitCount}, 0) + 1`,
                    lastUsedAt: new Date(),
                },
            });
    }

    /**
     * Generate AI reply for a comment.
     *
     * Cache hierarchy:
     *   1. Exact cache (hash lookup — free)
     *   2. Semantic cache (embedding similarity — 1 embedding call, no GPT)
     *   3. Full AI worker call (GPT)
     */
    async generateReply(request: AiGenerateRequest): Promise<AiGenerateResponse> {
        const pageId = request.context?.pageId;

        // Layer 1: Exact cache (scoped per page to avoid cross-page collisions)
        const cachedData = await this.checkCache(request.comment, request.language, pageId);
        if (cachedData) {
            return {
                reply: cachedData.reply,
                language: request.language || 'auto',
                cached: true,
                intent: cachedData.intent,
                confidence: cachedData.confidence,
                flags: cachedData.flags,
            };
        }

        // If AI is disabled, return a default message
        if (!config.ai.enabled) {
            return {
                reply: 'Thank you for your comment! We will get back to you soon.',
                language: request.language || 'en',
                cached: false,
                model: 'disabled',
            };
        }

        // Layer 2: Semantic cache (only when we have pageId + kbActiveVersion + embedding provider)
        const kbActiveVersion = request.context?.kbActiveVersion;
        const embeddingProvider = getEmbeddingProvider();
        let queryEmbedding: number[] | null = null;
        let detectedPreGptIntent: string | null = null;

        if (pageId && embeddingProvider && kbActiveVersion !== null && kbActiveVersion !== undefined) {
            try {
                const normalized = normalizeArabic(request.comment);
                detectedPreGptIntent = detectIntent(request.comment);

                embeddingProvider.setLogger(this.logger);
                queryEmbedding = await embeddingProvider.embed(normalized);

                semanticCacheService.setLogger(this.logger);
                const semanticHit = await semanticCacheService.check(
                    pageId, queryEmbedding, detectedPreGptIntent, kbActiveVersion,
                );

                if (semanticHit) {
                    return {
                        reply: semanticHit.reply,
                        language: request.language || 'auto',
                        cached: true,
                        intent: semanticHit.intent,
                        confidence: semanticHit.confidence,
                        flags: semanticHit.flags,
                    };
                }
            } catch (error) {
                this.logger.error('Semantic cache check failed, continuing to AI', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Layer 3: Full AI worker call
        try {
            const response = await axios.post<{
                reply: string;
                language: string;
                intent?: string;
                confidence?: string;
                flags?: string[];
                tokensUsed?: number;
            }>(
                `${config.ai.serviceUrl}/generate`,
                {
                    comment: request.comment,
                    language: request.language,
                    context: request.context,
                },
                {
                    timeout: 30000,
                }
            );

            const aiReply = response.data.reply;
            const detectedLanguage = response.data.language || request.language || 'en';
            const aiMetadata = {
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
            };

            // Save to exact cache
            await this.saveToCache(request.comment, aiReply, detectedLanguage, pageId, aiMetadata);

            // Save to semantic cache (fire-and-forget, non-blocking)
            if (pageId && queryEmbedding && detectedPreGptIntent && kbActiveVersion !== null && kbActiveVersion !== undefined) {
                semanticCacheService.save({
                    pageId,
                    queryText: request.comment,
                    queryEmbedding,
                    intent: response.data.intent || detectedPreGptIntent,
                    replyText: aiReply,
                    kbActiveVersion,
                    metadata: { confidence: response.data.confidence, flags: response.data.flags },
                }).catch(err => {
                    this.logger.error('Semantic cache save failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            }

            return {
                reply: aiReply,
                language: detectedLanguage,
                cached: false,
                model: config.ai.model,
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
                tokensUsed: response.data.tokensUsed,
            };
        } catch (error) {
            this.logger.error('AI Service error', {
                error: error instanceof Error ? error.message : String(error)
            });

            // Return fallback response
            return {
                reply: 'Thank you for your comment!',
                language: request.language || 'en',
                cached: false,
                model: 'fallback',
            };
        }
    }

    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{ totalEntries: number; totalHits: number }> {
        const entries = await db.select().from(aiCache);

        const totalHits = entries.reduce((sum, entry) => sum + (entry.hitCount || 0), 0);

        return {
            totalEntries: entries.length,
            totalHits,
        };
    }

    /**
     * Clear cache (admin function)
     */
    async clearCache(): Promise<void> {
        await db.delete(aiCache);
    }
    async enqueueReply(request: AiGenerateRequest): Promise<{ jobId: string; status: string }> {
        const { aiQueue } = await import('../lib/queue');

        const job = await aiQueue.add('generate-reply', {
            comment: request.comment,
            language: request.language,
            context: request.context,
            type: 'reply'
        });

        return {
            jobId: job.id || 'unknown',
            status: 'queued'
        };
    }

    /**
     * Get the status of an async AI generation job
     */
    async getJobStatus(jobId: string): Promise<{ 
        jobId: string; 
        status: 'queued' | 'active' | 'completed' | 'failed' | 'not_found';
        result?: { reply: string };
        error?: string;
    }> {
        const { aiQueue } = await import('../lib/queue');
        
        const job = await aiQueue.getJob(jobId);
        
        if (!job) {
            return { jobId, status: 'not_found' };
        }

        const state = await job.getState();
        
        if (state === 'completed') {
            const returnValue = job.returnvalue as { reply: string } | undefined;
            return {
                jobId,
                status: 'completed',
                result: returnValue
            };
        }
        
        if (state === 'failed') {
            return {
                jobId,
                status: 'failed',
                error: job.failedReason || 'Unknown error'
            };
        }
        
        if (state === 'active') {
            return { jobId, status: 'active' };
        }
        
        // waiting, delayed, etc. -> treat as queued
        return { jobId, status: 'queued' };
    }
}

export const aiService = new AiService();


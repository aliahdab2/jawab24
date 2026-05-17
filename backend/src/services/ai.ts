import axios from 'axios';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { db } from '../db';
import { aiCache, semanticCache } from '../db/schema';
import { eq, sql, count } from 'drizzle-orm';
import { config } from '../config';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';
import { redis, redisScanDelete } from '../lib/redis';
import { recordAiAttempt, recordAiReturn } from '../lib/aiMetrics';
import { normalizeArabic, DEFAULT_AI_MODEL, PROMPT_VERSION } from '@jawab24/shared';
import { detectIntent } from './kb/intent-detector';
import { semanticCacheService } from './kb/semantic-cache';
import { OpenAIEmbeddingProvider } from './kb/embedding';
import { aiWorkerCircuit, CircuitOpenError } from '../lib/circuitBreaker';
import { captureError } from '../utils/sentryHelpers';
import { classifyFallbackIntent } from './reply/fallbackClassifier';
import { AiUnavailableError, AiTimeoutError, AiRefusalError, AiEmptyReplyError } from '../utils/fbGraphErrors';
import { notificationService } from './notifications';
import type { AiPipeline } from '../types/aiPipeline';

/** Context used to scope exact-cache lookups and writes. */
interface CacheContext {
    language?: string;
    pageId?: string;
    kbActiveVersion?: number | null;
    postMessage?: string;
    storePolicies?: string;
    replyStyle?: string;
    customerContext?: string;
}

/** Shape returned by a successful exact-cache hit. */
interface CacheHit {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
}

/**
 * Response shape from the ai-worker `/generate` endpoint. Used by both the
 * primary path and the failover path so the wire contract lives in one place.
 */
interface WorkerGenerateResponse {
    reply: string;
    language: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    tokensUsed?: number;
    tokensIn?: number;
    /** Subset of `tokensIn` that hit OpenAI's prompt cache (billed at the model's cached rate — see aiPricing.ts). */
    tokensInCached?: number;
    tokensOut?: number;
}

// logAiUsage moved to ./aiUsageLog so callers outside ai.ts can import it
// statically without forming a circular dependency. Re-exported for back-compat
// (existing tests and callers import from './ai').
import { logAiUsage } from './aiUsageLog';
export { logAiUsage, type LogAiUsageOptions } from './aiUsageLog';

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
     * Build a Redis/Postgres cache key from comment + context.
     * Scoped by pageId, kbActiveVersion, and postMessage to prevent
     * cross-page, stale-KB, and cross-post cache collisions.
     */
    private buildCacheKey(comment: string, ctx: CacheContext): string {
        const normalized = comment
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();

        const key = [
            normalized,
            ctx.language || 'auto',
            ctx.pageId || 'global',
            `kbv:${ctx.kbActiveVersion ?? 0}`,
            `p:${ctx.postMessage || ''}`,
            `sp:${ctx.storePolicies ? crypto.createHash('md5').update(ctx.storePolicies).digest('hex').slice(0, 8) : ''}`,
            `rs:${ctx.replyStyle || 'professional'}`,
            // customerContext = substantive history/summary only (senderName is excluded).
            // This prevents fragmentation by commenter name while still scoping by real customer state.
            `cc:${ctx.customerContext ? crypto.createHash('md5').update(ctx.customerContext).digest('hex').slice(0, 8) : ''}`,
            `pv:${PROMPT_VERSION}`,
        ].join(':');

        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /**
     * Check cache for existing reply (returns full AI metadata when available)
     */
    async checkCache(comment: string, ctx: CacheContext): Promise<CacheHit | null> {
        if (!config.ai.cacheEnabled) {
            return null;
        }

        return Sentry.startSpan({ name: 'ai.cache.exact', op: 'cache.get' }, async () => {
            const hash = this.buildCacheKey(comment, ctx);
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
                } catch (error) {
                    this.logger.warn('Failed to populate Redis from Postgres cache hit', { hash, error });
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
        });
    }

    /**
     * Save reply to cache (includes AI metadata for correct flagging on cache hits)
     */
    async saveToCache(
        comment: string,
        reply: string,
        ctx: CacheContext,
        metadata?: { intent?: string; confidence?: string; flags?: string[] },
    ): Promise<void> {
        if (!config.ai.cacheEnabled) {
            return;
        }

        const hash = this.buildCacheKey(comment, ctx);
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
                language: ctx.language || null,
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
     *   1. Exact cache (hash lookup — free, version-scoped)
     *   2. Semantic cache (embedding similarity — 1 embedding call, no GPT)
     *   3. Full AI worker call (GPT)
     */
    async generateReply(request: AiGenerateRequest): Promise<AiGenerateResponse> {
        const pageId = request.context?.pageId;
        const kbActiveVersion = request.context?.kbActiveVersion;
        const postMessage = request.context?.postMessage;

        const userId = request.context?.userId;
        // Untagged callers surface as 'unknown' in the dashboard rather than being
        // misattributed to a real pipeline. This makes missing tags visible instead
        // of silent — the original "always NULL" failure mode is what we are fixing.
        const pipeline: AiPipeline = request.context?.pipeline ?? 'unknown';

        const cacheCtx: CacheContext = {
            language: request.language,
            pageId,
            kbActiveVersion,
            postMessage,
            storePolicies: request.context?.storePolicies,
            replyStyle: request.context?.replyStyle,
            customerContext: request.context?.customerContext,
        };

        // Non-default model (playground A/B) → skip all caches (different models produce different replies)
        const isNonDefaultModel = !!request.model && request.model !== DEFAULT_AI_MODEL;

        // DM conversations with history → skip all caches.
        // The right answer depends on what was said earlier; a cached reply generated
        // without conversation context would ignore prior exchanges and cause hallucinations.
        const hasConversationHistory = (request.context?.conversationHistory?.length ?? 0) > 0;

        // Layer 1: Exact cache (scoped per page + KB version + post context)
        if (!isNonDefaultModel && !hasConversationHistory) {
            const cachedData = await this.checkCache(request.comment, cacheCtx);
            if (cachedData) {
                // Fire-and-forget: log zero-cost cache hit
                if (userId) {
                    logAiUsage({ userId, pageId, model: config.ai.model || DEFAULT_AI_MODEL, tokensIn: 0, tokensOut: 0, cached: true, pipeline, intent: cachedData.intent ?? null }).catch(() => {});
                }
                return {
                    reply: cachedData.reply,
                    language: request.language || 'auto',
                    cached: true,
                    intent: cachedData.intent,
                    confidence: cachedData.confidence,
                    flags: cachedData.flags,
                };
            }
        }

        // AI globally disabled (AI_ENABLED=false). Throw rather than return a
        // hardcoded "Thank you" — that would land mid-conversation as if the
        // bot intentionally sent a useless reply. The processor's outer catch
        // rethrows for BullMQ retry; after retries exhaust, the row is flagged
        // needs_attention so the merchant handles the message manually.
        if (!config.ai.enabled) {
            throw new AiUnavailableError('AI_ENABLED is false');
        }

        // Layer 2: Semantic cache (only when we have pageId + kbActiveVersion)
        let queryEmbedding: number[] | null = request.context?.queryEmbedding || null;
        let detectedPreGptIntent: string | null = null;

        if (!isNonDefaultModel && pageId && kbActiveVersion !== null && kbActiveVersion !== undefined) {
            try {
                // Use full fallback classifier (covers COMPLIMENT, SPAM, BUSINESS_INQUIRY etc.)
                // instead of basic detectIntent() which only handles GREETING/PRICE/HOURS/etc.
                detectedPreGptIntent = classifyFallbackIntent(request.comment) || detectIntent(request.comment);

                // Reuse pre-computed embedding from retrieval if available, else compute
                if (!queryEmbedding) {
                    const embeddingProvider = getEmbeddingProvider();
                    if (embeddingProvider) {
                        embeddingProvider.setLogger(this.logger);
                        const embedLogCtx = userId ? { userId, pageId, pipeline: 'embedding_cache' as const } : undefined;
                        queryEmbedding = await embeddingProvider.embed(normalizeArabic(request.comment), embedLogCtx);
                    }
                }

                if (!queryEmbedding) {
                    // No embedding available (no API key configured) — skip semantic cache
                    throw new Error('No embedding provider available');
                }

                // Skip semantic cache for OTHER intent — too heterogeneous to cluster safely.
                // These queries still benefit from exact cache; only skip vector similarity.
                if (detectedPreGptIntent === 'OTHER') {
                    this.logger.debug('Skipping semantic cache for OTHER intent', { pageId });
                } else if (request.context?.customerContext) {
                    this.logger.debug('Skipping semantic cache for personalized customer context', { pageId });
                } else if (hasConversationHistory) {
                    this.logger.debug('Skipping semantic cache for DM conversation with history', { pageId });
                } else {
                    semanticCacheService.setLogger(this.logger);
                    const semanticHit = await Sentry.startSpan(
                        { name: 'ai.cache.semantic', op: 'cache.get' },
                        () => semanticCacheService.check(
                            pageId, queryEmbedding as number[], detectedPreGptIntent ?? '', kbActiveVersion,
                            request.context?.channel, request.context?.replyStyle,
                        ),
                    );

                    if (semanticHit) {
                        // Fire-and-forget: log zero-cost semantic cache hit
                        if (userId) {
                            logAiUsage({ userId, pageId, model: config.ai.model || DEFAULT_AI_MODEL, tokensIn: 0, tokensOut: 0, cached: true, pipeline, intent: semanticHit.intent ?? null }).catch((err) => captureError(err, 'semantic cache usage log failed'));
                        }
                        return {
                            reply: semanticHit.reply,
                            language: request.language || 'auto',
                            cached: true,
                            intent: semanticHit.intent,
                            confidence: semanticHit.confidence,
                            flags: semanticHit.flags,
                        };
                    }
                }
            } catch (error) {
                this.logger.error('Semantic cache check failed, continuing to AI', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Layer 3: Full AI worker call (protected by circuit breaker)
        const primaryModel = isNonDefaultModel ? (request.model as string) : (config.ai.model || DEFAULT_AI_MODEL);
        try {
            recordAiAttempt(pipeline, primaryModel);
            const response = await aiWorkerCircuit.execute(() =>
                Sentry.startSpan(
                    { name: 'ai.worker.http', op: 'http.client' },
                    () => axios.post<WorkerGenerateResponse>(
                        `${config.ai.serviceUrl}/generate`,
                        {
                            comment: request.comment,
                            language: request.language,
                            context: request.context,
                            ...(isNonDefaultModel ? { model: request.model } : {}),
                        },
                        {
                            timeout: 30000,
                            headers: pageId ? { 'X-Workspace-Id': pageId } : undefined,
                        }
                    ),
                )
            );
            recordAiReturn(pipeline, primaryModel);

            const aiReply = response.data.reply;
            const detectedLanguage = response.data.language || request.language || 'en';
            const aiMetadata = {
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
            };

            // Belt-and-suspenders: the ai-worker's internal `getFallbackReply` returns a
            // templated "Thanks, we'll get back to you" string as a *successful* 200 with
            // `flags: ['fallback_reply']`. That string used to ship to customers as if it
            // were a real AI reply (and got cached, perpetuating the bug). Reject it here
            // BEFORE the cache write so the existing #137 catch / rethrow path takes over:
            // BullMQ retries; on exhaustion, `flagStuckJobOnFinalFailure` flags the row
            // needs_attention. Stays in code forever — defense-in-depth even after the
            // ai-worker fallback path is deleted.
            if (aiMetadata.flags?.includes('fallback_reply')) {
                throw new AiUnavailableError('ai-worker returned fallback_reply flag');
            }

            // Save to exact cache (scoped by KB version + post context)
            // Skip for non-default models — different models produce different replies
            if (!isNonDefaultModel) {
                const saveCacheCtx: CacheContext = { ...cacheCtx, language: detectedLanguage };
                await this.saveToCache(request.comment, aiReply, saveCacheCtx, aiMetadata);
            }

            // Fire-and-forget: log real token usage
            if (userId) {
                const tokensIn = response.data.tokensIn ?? 0;
                const tokensOut = response.data.tokensOut ?? 0;
                const cachedInputTokens = response.data.tokensInCached ?? 0;
                logAiUsage({ userId, pageId, model: config.ai.model || DEFAULT_AI_MODEL, tokensIn, cachedInputTokens, tokensOut, cached: false, pipeline, intent: aiMetadata.intent ?? null }).catch(() => {});
            }

            // Save to semantic cache (fire-and-forget, non-blocking) — skip OTHER intent and non-default models
            if (!isNonDefaultModel && pageId && queryEmbedding && detectedPreGptIntent && detectedPreGptIntent !== 'OTHER' && kbActiveVersion !== null && kbActiveVersion !== undefined) {
                semanticCacheService.save({
                    pageId,
                    queryText: request.comment,
                    queryEmbedding,
                    intent: detectedPreGptIntent,
                    replyText: aiReply,
                    kbActiveVersion,
                    channel: request.context?.channel,
                    replyStyle: request.context?.replyStyle,
                    metadata: { confidence: response.data.confidence, flags: response.data.flags, intent: response.data.intent },
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
                model: isNonDefaultModel ? request.model : config.ai.model,
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
                tokensUsed: response.data.tokensUsed,
            };
        } catch (error) {
            if (error instanceof CircuitOpenError) {
                this.logger.warn('AI circuit breaker open — attempting provider failover');

                // Bypass circuit breaker: call ai-worker directly via axios.post()
                // The circuit wraps ALL HTTP calls to ai-worker, but ai-worker itself is fine —
                // it's OpenAI that's down. The fallback uses Claude (different API key, different provider).
                try {
                    const fallbackModel = config.ai.fallbackModel;
                    recordAiAttempt('failover', fallbackModel);
                    const failoverResponse = await Sentry.startSpan(
                        { name: 'ai.failover.http', op: 'http.client', attributes: { 'ai.model': fallbackModel } },
                        () => axios.post<WorkerGenerateResponse>(
                            `${config.ai.serviceUrl}/generate`,
                            {
                                comment: request.comment,
                                language: request.language,
                                context: request.context,
                                model: fallbackModel,
                            },
                            {
                                timeout: 30000,
                                headers: pageId ? { 'X-Workspace-Id': pageId } : undefined,
                            },
                        ),
                    );
                    recordAiReturn('failover', fallbackModel);

                    this.logger.info('Provider failover succeeded', { model: fallbackModel });
                    Sentry.captureMessage('AI provider failover active', {
                        level: 'warning',
                        tags: { fallbackModel },
                    });

                    // Send deduplicated push notification to admin
                    // Redis key with 1-hour TTL prevents notification storms during outage
                    if (userId) {
                        const dedupKey = `failover:notified:${userId}`;
                        try {
                            const alreadyNotified = await redis.get(dedupKey);
                            if (!alreadyNotified) {
                                await redis.set(dedupKey, '1', 'EX', 3600);
                                notificationService.sendTemplateNotification(
                                    userId,
                                    'provider_failover',
                                    { fallbackModel },
                                    { urgent: true },
                                ).catch(() => {}); // fire-and-forget
                            }
                        } catch {
                            // Redis unavailable — skip dedup, still return the reply
                        }
                    }

                    // Fire-and-forget: log token usage for failover model
                    if (userId) {
                        const tokensIn = failoverResponse.data.tokensIn ?? 0;
                        const tokensOut = failoverResponse.data.tokensOut ?? 0;
                        const cachedInputTokens = failoverResponse.data.tokensInCached ?? 0;
                        logAiUsage({ userId, pageId, model: fallbackModel, tokensIn, cachedInputTokens, tokensOut, cached: false, pipeline: 'failover', intent: failoverResponse.data.intent ?? null }).catch(() => {});
                    }

                    // Cache write intentionally SKIPPED:
                    // We're in the catch block (outside the try block's cache-write logic).
                    // Different model = different quality characteristics; we don't want
                    // fallback model responses cached under the primary model's cache keys.

                    const failoverFlags = [...(failoverResponse.data.flags || []), 'provider_failover'];

                    return {
                        reply: failoverResponse.data.reply,
                        language: failoverResponse.data.language || request.language || 'en',
                        cached: false,
                        model: fallbackModel,
                        intent: failoverResponse.data.intent,
                        confidence: failoverResponse.data.confidence,
                        flags: failoverFlags,
                        tokensUsed: failoverResponse.data.tokensUsed,
                    };
                } catch (failoverError) {
                    this.logger.error('Provider failover also failed', {
                        error: failoverError instanceof Error ? failoverError.message : String(failoverError),
                    });
                    // Fall through to static fallback below
                }
            } else {
                this.logger.error('AI Service error', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            // Reconstruct typed AI errors from the ai-worker's 500 response body
            // so the processor's outer catch can branch correctly:
            //   - AiRefusalError / AiEmptyReplyError → immediate needs_attention (no retry)
            //   - AiTimeoutError / AiUnavailableError → BullMQ retry → exhaustion flag
            // Reconstruction is by error.name (matches the existing CircuitOpenError
            // convention) so we avoid coupling to ai-worker's class identity.
            if (axios.isAxiosError(error) && error.response?.data?.error) {
                const wireError = error.response.data.error as { name?: unknown; message?: unknown; refusalReason?: unknown };
                const name = typeof wireError.name === 'string' ? wireError.name : undefined;
                const message = typeof wireError.message === 'string' ? wireError.message : undefined;
                const refusalReason = typeof wireError.refusalReason === 'string' ? wireError.refusalReason : undefined;

                if (name) {
                    Sentry.setTag('aiErrorClass', name);
                    switch (name) {
                        case 'AiRefusalError':
                            throw new AiRefusalError(refusalReason ?? 'unknown', message);
                        case 'AiTimeoutError':
                            throw new AiTimeoutError(undefined, message);
                        case 'AiEmptyReplyError':
                            throw new AiEmptyReplyError(message);
                        case 'AiClientNotConfiguredError':
                            // ai-worker's "no client" maps to backend's AiUnavailableError
                            // (same semantics: permanent-but-flag-via-retry-exhaustion).
                            throw new AiUnavailableError(message);
                    }
                    // Unknown name: fall through to generic rethrow below — don't
                    // over-classify by inventing a typed error we don't recognize.
                }
            }

            // Primary AI failed and (either there was no failover, or the
            // failover provider also failed). Rethrow so the reply pipeline
            // catches `isTransientAiError` and BullMQ retries the job —
            // a deploy-window blip should not become a permanent fake
            // "Thank you" reply mid-conversation. After retries exhaust,
            // `flagStuckJobOnFinalFailure` flags the row needs_attention.
            throw error;
        }
    }


    /**
     * Get cache statistics
     */
    async getCacheStats(): Promise<{
        exactCache: { totalEntries: number; totalHits: number };
        semanticCache: { totalEntries: number; totalHits: number };
    }> {
        const [exactStats] = await db
            .select({
                totalEntries: count(),
                totalHits: sql<number>`coalesce(sum(hit_count), 0)`,
            })
            .from(aiCache);

        const [semanticStats] = await db
            .select({
                totalEntries: count(),
                totalHits: sql<number>`coalesce(sum(hit_count), 0)`,
            })
            .from(semanticCache);

        return {
            exactCache: {
                totalEntries: Number(exactStats?.totalEntries ?? 0),
                totalHits: Number(exactStats?.totalHits ?? 0),
            },
            semanticCache: {
                totalEntries: Number(semanticStats?.totalEntries ?? 0),
                totalHits: Number(semanticStats?.totalHits ?? 0),
            },
        };
    }

    /**
     * Clear cache (admin function)
     */
    async clearCache(): Promise<void> {
        await Promise.all([
            db.delete(aiCache),
            db.delete(semanticCache),
        ]);
        // Also flush Redis keys — Postgres-only delete leaves Redis stale.
        await redisScanDelete('cache:ai_reply:*');
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

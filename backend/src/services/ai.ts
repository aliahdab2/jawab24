import axios from 'axios';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { db } from '../db';
import { aiCache, semanticCache } from '../db/schema';
import { eq, sql, count } from 'drizzle-orm';
import { config } from '../config';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';
import { redis, redisScanDelete } from '../lib/redis';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { normalizeArabic, DEFAULT_AI_MODEL, PROMPT_VERSION } from '@jawab24/shared';
import { detectIntent } from './kb/intent-detector';
import { semanticCacheService } from './kb/semantic-cache';
import { OpenAIEmbeddingProvider } from './kb/embedding';
import { aiWorkerCircuit, CircuitOpenError } from '../lib/circuitBreaker';
import { captureError } from '../utils/sentryHelpers';
import { classifyFallbackIntent } from './reply/fallbackClassifier';
import { getModelForUser } from './aiModelResolver';
import { AiUnavailableError, AiTimeoutError, AiRefusalError, AiEmptyReplyError, AiQuotaExhaustedError } from '../utils/fbGraphErrors';
import { notificationService } from './notifications';
import { emailService } from './email';
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
    /**
     * Model resolved for the request. Included in the cache key so workspaces
     * on a per-customer override (e.g. gpt-4o) don't read replies generated
     * by the default model (gpt-4.1-mini). Omitted/undefined means "default".
     */
    model?: string;
    /**
     * hashBrandVoice() of the language-resolved brand voice notes
     * (contextEnricher). Brand voice is prompt-injected, so it must scope both
     * caches: settings saves don't bump kbActiveVersion, and without key scoping
     * a merchant who rewrites their brand voice keeps getting old-voice cached
     * replies until TTL expiry. Read-side scoping (like storePolicies) instead
     * of writer-side invalidation — writers can't forget it. Computed once per
     * request in generateReply and shared with the semantic cache.
     */
    brandVoiceHash?: string;
    /**
     * First-contact greeting suppression (see messageProcessor). When true the AI
     * is told NOT to greet because the backend prepends the merchant welcome. This
     * changes the generated reply, so it MUST scope the cache: without it a
     * suppressed (greeting-less) reply and an ordinary reply share a bucket — and a
     * first contact (empty history, undefined customerContext) would otherwise read
     * an ordinary cached reply that greeted, then get the merchant welcome prepended
     * on top → double greeting. Only `true` alters the key (see buildCacheKey), so
     * existing cache entries stay valid.
     */
    suppressGreeting?: boolean;
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

/**
 * Short content hash of the brand voice notes, shared by the exact-cache key
 * (`bv:` component) and the semantic cache (`brandVoiceHash` metadata filter).
 * Returns undefined for empty/absent notes so no-brand-voice traffic keeps
 * byte-identical cache keys and legacy semantic rows stay matchable.
 */
function hashBrandVoice(notes?: string): string | undefined {
    if (!notes) return undefined;
    return crypto.createHash('md5').update(notes).digest('hex').slice(0, 8);
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
        // normalizeArabic unifies alef variants (أ/إ/آ → ا), strips tatweel, and
        // converts Arabic-Indic digits (٠-٩ → 0-9) so trivially-different Arabic
        // spellings share one bucket — same normalization the embedding path uses
        // for the semantic cache. Diacritics are \p{M}, so the symbol strip below
        // already removes them.
        const normalized = normalizeArabic(comment)
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
            // Different models can produce materially different replies for the same input
            // (verbosity, refusal patterns, JSON adherence). Scope cache by model so a
            // workspace overridden to gpt-4o never reads a gpt-4.1-mini-generated reply.
            `m:${ctx.model || DEFAULT_AI_MODEL}`,
            `pv:${PROMPT_VERSION}`,
        ];

        // Only a true value alters the key — appended conditionally so the vast
        // majority of traffic (suppressGreeting falsy) keeps byte-identical keys and
        // existing cache entries stay valid. A suppressed reply (greeting-less, the
        // merchant welcome is prepended by the backend) gets its own bucket so it can
        // never collide with an ordinary reply that greeted on its own.
        if (ctx.suppressGreeting) key.push('sg:1');

        // Brand voice is prompt-injected but settings saves never bump
        // kbActiveVersion, so it must live in the key (same read-side scoping as
        // storePolicies). Conditional append: workspaces without brand voice keep
        // byte-identical keys, so only voice-having entries re-warm on rollout.
        if (ctx.brandVoiceHash) key.push(`bv:${ctx.brandVoiceHash}`);

        return crypto.createHash('sha256').update(key.join(':')).digest('hex');
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

        // Model resolution. Caller may pin the model explicitly (playground A/B,
        // failover) — that wins. Otherwise look up the workspace's configured
        // override from settings.ai_model (cached, falls back to DEFAULT on miss
        // or invalid value). Centralizing this here means generateForComment /
        // generateForMessage / tool-loop callers don't each need to repeat the
        // resolution; they just pass `userId` in context.
        const resolvedModel = request.model
            ? request.model
            : await getModelForUser(userId);
        // The semantic cache stores `undefined` (not the model name) for
        // default-model rows — see the save() call below. Reads MUST use the same
        // normalization: passing the resolved name for a default workspace fails
        // the strict-equality metadata filter against every stored row, silently
        // disabling semantic hits for the entire default fleet (shipped in #164,
        // found 2026-06-11).
        const isNonDefaultModel = resolvedModel !== DEFAULT_AI_MODEL;
        const modelCacheScope = isNonDefaultModel ? resolvedModel : undefined;
        // Computed once; scopes the exact-cache key and the semantic cache reads/writes.
        const brandVoiceHash = hashBrandVoice(request.context?.brandVoiceNotes);

        const cacheCtx: CacheContext = {
            language: request.language,
            pageId,
            kbActiveVersion,
            postMessage,
            storePolicies: request.context?.storePolicies,
            replyStyle: request.context?.replyStyle,
            customerContext: request.context?.customerContext,
            model: resolvedModel,
            suppressGreeting: request.context?.suppressGreeting,
            brandVoiceHash,
        };

        // DM conversations with history → skip all caches.
        // The right answer depends on what was said earlier; a cached reply generated
        // without conversation context would ignore prior exchanges and cause hallucinations.
        const hasConversationHistory = (request.context?.conversationHistory?.length ?? 0) > 0;

        // Eval-suite requests (pipeline === 'eval') bypass ALL caches in BOTH
        // directions: no reads, no writes. The eval suite intentionally reuses
        // the same demo workspace + same demo pages across hundreds of tests,
        // which would otherwise create cache-key collisions between tests with
        // different flag expectations — exactly the contamination that masked
        // the real #190 regression and inflated noise by ~10 pts. Real
        // customers don't collide that way, so bypassing here changes nothing
        // for prod traffic. Note: source-tagging happens in playgroundContext.ts
        // (source === 'eval' → pipeline === 'eval'); the admin playground UI
        // surfaces a different pipeline tag and continues to exercise caching.
        const bypassAllCaches = pipeline === 'eval';

        // Layer 1: Exact cache (scoped per page + KB version + post context + model)
        if (!hasConversationHistory && !bypassAllCaches) {
            const cachedData = await this.checkCache(request.comment, cacheCtx);
            if (cachedData) {
                // Fire-and-forget: log zero-cost cache hit under the workspace's resolved model.
                if (userId) {
                    logAiUsage({ userId, pageId, model: resolvedModel, tokensIn: 0, tokensOut: 0, cached: true, pipeline, intent: cachedData.intent ?? null }).catch(() => {});
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

        if (pageId && kbActiveVersion !== null && kbActiveVersion !== undefined && !bypassAllCaches) {
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
                            {
                                channel: request.context?.channel,
                                replyStyle: request.context?.replyStyle,
                                model: modelCacheScope,
                                brandVoiceHash,
                            },
                        ),
                    );

                    if (semanticHit) {
                        // Fire-and-forget: log zero-cost semantic cache hit
                        if (userId) {
                            logAiUsage({ userId, pageId, model: resolvedModel, tokensIn: 0, tokensOut: 0, cached: true, pipeline, intent: semanticHit.intent ?? null }).catch((err) => captureError(err, 'semantic cache usage log failed'));
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
        //
        // No `recordAiAttempt`/`recordAiReturn` here — those are emitted at the
        // ai-worker's own OpenAI call site (ai-worker/src/services/openai.ts).
        // The axios hop is internal HTTP, not an OpenAI API call, so counting
        // it here would double-count `attempts` (and the math would diverge
        // from the OpenAI dashboard request count by ~2×). The hop's *failure*
        // mode is still tracked — see the catch block below.
        const primaryModel = resolvedModel;
        try {
            const response = await aiWorkerCircuit.execute(() =>
                Sentry.startSpan(
                    { name: 'ai.worker.http', op: 'http.client' },
                    () => axios.post<WorkerGenerateResponse>(
                        `${config.ai.serviceUrl}/generate`,
                        {
                            comment: request.comment,
                            language: request.language,
                            context: request.context,
                            // Only forward `model` when non-default so the ai-worker's `/generate`
                            // route keeps using its unchanged production path for default-model
                            // workspaces. The provider-abstraction path is taken only when
                            // an explicit non-default model is set on the request.
                            ...(isNonDefaultModel ? { model: resolvedModel } : {}),
                        },
                        {
                            timeout: 30000,
                            headers: pageId ? { 'X-Workspace-Id': pageId } : undefined,
                        }
                    ),
                )
            );

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

            // Save to exact cache (scoped by KB version + post context + model).
            // All models cache to their own bucket now — no more skip-when-non-default.
            // Eval pipeline never writes to cache (see `bypassAllCaches` above).
            const saveCacheCtx: CacheContext = { ...cacheCtx, language: detectedLanguage };
            if (!bypassAllCaches) {
                await this.saveToCache(request.comment, aiReply, saveCacheCtx, aiMetadata);
            }

            // Fire-and-forget: log real token usage under the workspace's resolved model
            // so per-customer cost tracking reflects the actual model billed.
            if (userId) {
                const tokensIn = response.data.tokensIn ?? 0;
                const tokensOut = response.data.tokensOut ?? 0;
                const cachedInputTokens = response.data.tokensInCached ?? 0;
                logAiUsage({ userId, pageId, model: resolvedModel, tokensIn, cachedInputTokens, tokensOut, cached: false, pipeline, intent: aiMetadata.intent ?? null }).catch(() => {});
            }

            // Save to semantic cache (fire-and-forget, non-blocking) — skip OTHER intent.
            // Model is stored in metadata so check-time can filter to same-model entries.
            // Eval pipeline never writes (see `bypassAllCaches` above).
            if (!bypassAllCaches && pageId && queryEmbedding && detectedPreGptIntent && detectedPreGptIntent !== 'OTHER' && kbActiveVersion !== null && kbActiveVersion !== undefined) {
                semanticCacheService.save({
                    pageId,
                    queryText: request.comment,
                    queryEmbedding,
                    intent: detectedPreGptIntent,
                    replyText: aiReply,
                    kbActiveVersion,
                    channel: request.context?.channel,
                    replyStyle: request.context?.replyStyle,
                    model: modelCacheScope,
                    brandVoiceHash,
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
                model: resolvedModel,
                intent: response.data.intent,
                confidence: response.data.confidence,
                flags: response.data.flags,
                tokensUsed: response.data.tokensUsed,
            };
        } catch (error) {
            // Surface hop-level failure (axios error, timeout, circuit-open) as a
            // distinct error_class so the script can separate worker-hop failures
            // from OpenAI-call failures. Without this, a backend → ai-worker
            // outage looks like missing instrumentation in the breakdown.
            recordAiFailedBeforeLog(pipeline, primaryModel, 'AiWorkerUnreachable');

            if (error instanceof CircuitOpenError) {
                this.logger.warn('AI circuit breaker open — attempting provider failover');

                // Bypass circuit breaker: call ai-worker directly via axios.post()
                // The circuit wraps ALL HTTP calls to ai-worker, but ai-worker itself is fine —
                // it's OpenAI that's down. The fallback uses Claude (different API key, different provider).
                try {
                    const fallbackModel = config.ai.fallbackModel;
                    // Failover hop: same rule as primary — no `attempts`/`returns`
                    // here (ai-worker emits them at the actual OpenAI call site).
                    // Only the hop's *failure* mode is tracked, in the inner catch.
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
                    // Hop-level failure on the failover route too — same signal
                    // semantics as the primary catch above.
                    recordAiFailedBeforeLog('failover', config.ai.fallbackModel, 'AiWorkerUnreachable');
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
                        case 'AiQuotaExhaustedError':
                            // OpenAI out of credit. Fire a throttled "top up" alert,
                            // then rethrow the typed error so the worker PARKS the job
                            // (re-enqueue with long delay) instead of flagging it.
                            await this.alertQuotaExhausted(pipeline, message).catch(() => {});
                            throw new AiQuotaExhaustedError(message);
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
     * Fire a throttled, high-severity alert that OpenAI is out of quota. This is
     * the actionable signal — billing must be topped up; until then every reply
     * parks and retries. Deduplicated via a Redis key (default 10 min TTL) so a
     * sustained outage doesn't flood Sentry with one event per failed call. Never
     * throws — alerting must not affect the reply path.
     */
    private async alertQuotaExhausted(pipeline: AiPipeline, message?: string): Promise<void> {
        // Always bump the metric (cheap, useful for the breakdown / a metrics alert).
        recordAiFailedBeforeLog(pipeline, config.ai.model, 'AiQuotaError');

        const dedupKey = 'alert:openai_quota_exhausted';
        let shouldAlert = true;
        try {
            // SET NX with TTL — only the first caller in the window gets the alert.
            const acquired = await redis.set(dedupKey, '1', 'EX', config.ai.quotaAlertCooldownSeconds, 'NX');
            shouldAlert = acquired === 'OK';
        } catch {
            // Redis unavailable — still alert (better a duplicate than silence).
        }
        if (!shouldAlert) return;

        this.logger.error('OpenAI quota exhausted — replies are parking until billing is topped up', {
            pipeline,
            detail: message,
        });
        Sentry.captureMessage('OpenAI quota exhausted (insufficient_quota) — top up billing', {
            level: 'error',
            tags: { alert: 'openai_quota_exhausted' },
            extra: { pipeline, detail: message },
        });

        // Self-contained operator alert (does NOT depend on a Sentry alert rule
        // being configured). Goes to the platform admins — they control OpenAI
        // billing; merchants can't act on this. Fire-and-forget, already throttled
        // by the dedup above. `message` is our own error text, but escape it
        // defensively before embedding in HTML.
        const admins = config.adminEmails;
        if (admins.length > 0) {
            const safeDetail = (message ?? 'n/a').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
            const html = `<p><b>OpenAI returned <code>insufficient_quota</code></b> — Jawab24 auto-replies are now <b>parking</b> and will not send until the OpenAI balance is topped up.</p>`
                + `<p>Pipeline: <b>${pipeline}</b><br/>Detail: ${safeDetail}</p>`
                + `<p><b>Action:</b> add credit / raise the usage limit in the OpenAI billing dashboard. Parked replies resume automatically once credit returns.</p>`;
            await Promise.all(admins.map((to) =>
                emailService.send({
                    to,
                    subject: '🚨 Jawab24: OpenAI quota exhausted — top up billing',
                    html,
                    type: 'transactional',
                }).catch(() => { /* fire-and-forget — never block the reply path */ }),
            ));
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

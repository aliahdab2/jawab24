import axios from 'axios';
import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { db } from '../db';
import { aiCache, semanticCache } from '../db/schema';
import { eq, sql, count } from 'drizzle-orm';
import { config } from '../config';
import { aiWorkerHeaders } from './aiWorkerAuth';
import { AiGenerateRequest, AiGenerateResponse, Logger, noopLogger } from '../types';
import { redis, redisScanDelete } from '../lib/redis';
import { recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { normalizeArabic, DEFAULT_AI_MODEL, PROMPT_VERSION } from '@jawab24/shared';
import { detectIntent } from './kb/intent-detector';
import { semanticCacheService } from './kb/semantic-cache';
import { OpenAIEmbeddingProvider } from './kb/embedding';
import { aiWorkerCircuit, CircuitOpenError } from '../lib/circuitBreaker';
import { captureError, tagError } from '../utils/sentryHelpers';
import { classifyFallbackIntent } from './reply/fallbackClassifier';
import { getModelForUser } from './aiModelResolver';
import { getConfidentGender, recordGenderObservation } from './genderMap';
import { senderNameKeyHash, replyMentionsName } from '../utils/senderName';
import { cacheRejectReason } from './cacheQualityGate';
import { normalizeForExactCacheKey } from '../utils/exactCacheNormalize';
import { generateGenderVariant } from './genderVariantTransform';
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
    /**
     * Effective reply mode ('sales' | 'info'). 'info' renders the INFO-DESK
     * prompt block, so it must scope both caches — settings/pages saves don't
     * bump kbActiveVersion (same read-side scoping rationale as brandVoiceHash).
     * Conditional key append: sales traffic keeps byte-identical keys.
     */
    replyMode?: string;
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
    /**
     * Reply channel. Only the DM path personalizes gendered Arabic addressing
     * (comments stay neutral), so it drives the two gender-cache guards: the exact
     * key is bucketed by `senderName` for DMs (below), and the semantic cache is
     * bypassed for DMs (see generateReply). Absent → treated as non-DM.
     */
    channel?: 'comment' | 'dm';
    /**
     * Customer's display name (DM only). Gendered Arabic replies vary by the
     * customer's gender, which the model infers largely from this name — so a reply
     * cached for one customer must NOT be served to another with a different name.
     * buildCacheKey appends a hashed first-name bucket for DMs so identical-message
     * first-DMs from different customers get separate buckets. Excluded for comments
     * (neutral, and name-bucketing would fragment the high-volume comment cache).
     */
    senderName?: string;
    /**
     * v53: consensus gender for `senderName` from the fleet-learned map
     * (genderMap.getConfidentGender), resolved ONCE per request in generateReply
     * BEFORE the cache read and inherited by the save context — never re-resolved
     * at save time, so the bucket can't flip mid-request while the model call is
     * in flight. When set, buildCacheKey buckets the DM by gender (`g:m`/`g:f`)
     * instead of by name hash, restoring cross-sender sharing. null/undefined →
     * per-name bucket (unknown/ambiguous name, kill-switch off, or Redis down).
     */
    genderBucket?: 'm' | 'f' | null;
    /**
     * Neutral shared DM bucket (g:n). Set on a READ to probe the shared bucket
     * (after the specific gender/name probe misses), and on a SAVE when the
     * reply's own labels certify it is genderless AND name-free (see the
     * neutral-eligibility guard in generateReply) — such a reply is safe to
     * serve to ANY sender, so it shares one bucket across all names with zero
     * map warm-up. Takes precedence over genderBucket in buildCacheKey. A
     * distinct segment (not the bare nameless-DM key) so uncertified legacy
     * nameless entries can never leak to named senders.
     */
    neutralBucket?: boolean;
    /**
     * Dual-variant shared DM bucket (g:d) — the entry stores BOTH addressee
     * renderings ({m,f} in metadata.variants), so ONE key is shared across
     * ALL named senders; the reader's map-known gender picks the rendering at
     * serve time. Highest precedence in buildCacheKey. A distinct segment so
     * single-rendering legacy entries (per-name/g:m/g:f/g:n) can never be
     * misread as dual. Only ever set when config.ai.dualVariantEnabled.
     */
    dualVariant?: boolean;
}

/** Shape returned by a successful exact-cache hit. */
interface CacheHit {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    /** Dual-variant (g:d) entries only: both addressee renderings. The read
     *  path serves variants[readerGender]; `reply` holds the as-generated
     *  primary rendering for legacy/inspection paths. */
    variants?: { m?: string; f?: string };
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
    /**
     * v53 gender self-report (see ai-worker systemPrompt): the grammatical gender
     * the reply's address forms use, what that decision was based on, and whether
     * the reply embeds the customer's name in any script. Drives the name→gender
     * learning map and the save-side cache-bucket guard. Absent on older workers
     * and non-emitting paths → treated as "not reported" (per-name bucket).
     */
    gender?: 'm' | 'f' | 'unknown';
    genderBasis?: 'self' | 'name' | 'unclear';
    usedName?: boolean;
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
        // Shared normalization (utils/exactCacheNormalize.ts) — the warm-cache
        // ranking groups by the same function, so warmed entries always land
        // under keys this read path produces.
        const normalized = normalizeForExactCacheKey(comment);

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

        // Reply mode renders a different prompt shape (INFO-DESK block), so info
        // pages get their own bucket. Conditional append like sg:/bv: — the sales
        // fleet (everyone today) keeps byte-identical keys, and a page toggled
        // back to sales immediately re-uses its still-valid sales entries.
        if (ctx.replyMode === 'info') key.push('rm:i');

        // DM only: bucket by gender when the sender's first name is confidently known
        // (v53 fleet-learned map — resolved once per request into ctx.genderBucket),
        // else by the customer's first name. DM Arabic replies are gendered and the
        // model infers gender largely from the name, so two customers whose names imply
        // different genders sending an identical history-less first message must NOT
        // share a cached reply — but two confident-masculine names CAN share one
        // (gendered self-references live in the message text, which is part of this
        // key, so bucket + exact text pins the gender decision deterministically).
        // First whitespace token, hashed. Comments and nameless DMs skip this, so
        // their keys — and the high-volume comment cache — stay byte-identical.
        // Precedence: dual-variant shared bucket (g:d, entry carries both
        // renderings) → neutral shared bucket (g:n, reply certified genderless +
        // name-free) → gender bucket (g:m/g:f) → per-name hash.
        if (ctx.channel === 'dm' && ctx.senderName) {
            if (ctx.dualVariant) {
                key.push('g:d');
            } else if (ctx.neutralBucket) {
                key.push('g:n');
            } else if (ctx.genderBucket) {
                key.push(`g:${ctx.genderBucket}`);
            } else {
                // WHOLE normalized name, not the first token (2026-07-25). First-token
                // keying collapsed every «أبو …» / «عبد …» customer into ONE bucket, so a
                // reply that addressed «أبو حسان» by name could be served to «أبو خالد» —
                // and the model now sees the full name, so name-bearing replies are more
                // likely, not less. Costs a little sharing on this fallback tier only
                // («أحمد علي» no longer shares with «أحمد محمد»); the g:d / g:n / g:m|f
                // tiers above, which carry the volume, are untouched.
                const nameHash = senderNameKeyHash(ctx.senderName);
                if (nameHash) key.push(`n:${nameHash}`);
            }
        }

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
                const meta = cached[0].metadata as { intent?: string; confidence?: string; flags?: string[]; variants?: { m?: string; f?: string } } | null;

                // Skip entries without metadata — fresh AI call will save with full flagging data
                if (!meta) {
                    this.logger.info('ai_cache_miss_postgres_no_metadata', { hash });
                    return null;
                }

                const reply = cached[0].replyText;
                const result = { reply, intent: meta.intent, confidence: meta.confidence, flags: meta.flags, variants: meta.variants };
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
        metadata?: { intent?: string; confidence?: string; flags?: string[]; variants?: { m?: string; f?: string } },
    ): Promise<void> {
        if (!config.ai.cacheEnabled) {
            return;
        }

        const hash = this.buildCacheKey(comment, ctx);
        const cacheKey = `cache:ai_reply:${hash}`;
        const cacheData = JSON.stringify({ reply, intent: metadata?.intent, confidence: metadata?.confidence, flags: metadata?.flags, variants: metadata?.variants });

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
            replyMode: request.context?.replyMode,
            customerContext: request.context?.customerContext,
            model: resolvedModel,
            suppressGreeting: request.context?.suppressGreeting,
            brandVoiceHash,
            channel: request.context?.channel,
            senderName: request.context?.senderName,
        };

        // v53: resolve the DM gender bucket ONCE, before any cache read. The save
        // context inherits this value (spread below), never re-resolves — the map
        // may cross its confidence threshold during the ~seconds the GPT call is
        // in flight, and a read/save bucket flip would strand entries. Failure or
        // unknown name → undefined → per-name bucket (v51 behavior, always safe).
        // The dual-variant read path needs the same resolution (it picks WHICH
        // rendering to serve), so it participates even with the bucket flag off.
        if ((config.ai.genderBucketEnabled || config.ai.dualVariantEnabled) && cacheCtx.channel === 'dm' && cacheCtx.senderName) {
            cacheCtx.genderBucket = await getConfidentGender(cacheCtx.senderName);
            if (cacheCtx.genderBucket) {
                this.logger.debug('ai_cache_gender_bucket', { pageId, bucket: cacheCtx.genderBucket });
                // Prod-visible adoption counter (prod logs at info — debug lines never
                // land there). Same fire-and-forget pattern as the §13c AI counters.
                redis.incr('metrics:cache:gender_bucket:read').catch(() => {});
            }
        }

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
            // Dual-variant shared bucket first (g:d): one entry serves ALL named
            // senders whose gender the map knows — the entry carries both
            // renderings and the reader's gender picks one. Unknown-gender
            // readers skip this probe (no way to choose a rendering) and fall
            // through to the legacy chain, ending at g:n / fresh generation.
            let cachedData: CacheHit | null = null;
            if (config.ai.dualVariantEnabled && cacheCtx.channel === 'dm' && cacheCtx.senderName && cacheCtx.genderBucket) {
                const dualEntry = await this.checkCache(request.comment, { ...cacheCtx, dualVariant: true });
                const rendering = dualEntry?.variants?.[cacheCtx.genderBucket];
                if (rendering) {
                    cachedData = { ...dualEntry, reply: rendering };
                    redis.incr(`metrics:cache:dual_variant:hit:${cacheCtx.genderBucket}`).catch(() => {});
                }
            }
            // Most-specific probe next (gender/name bucket — a warmer, personalized
            // entry wins over a blander shared one), then the g:n neutral shared
            // bucket for named DMs. Comments and nameless DMs keep a single probe
            // (their key has no gender/name segment).
            if (!cachedData) cachedData = await this.checkCache(request.comment, cacheCtx);
            if (!cachedData && config.ai.neutralBucketEnabled && cacheCtx.channel === 'dm' && cacheCtx.senderName) {
                cachedData = await this.checkCache(request.comment, { ...cacheCtx, neutralBucket: true });
                // Prod-visible adoption counter (same fire-and-forget pattern as the
                // gender-bucket counters). Counts served hits, not probes.
                if (cachedData) redis.incr('metrics:cache:neutral_bucket:hit').catch(() => {});
            }
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

        // DMs bypass the semantic cache entirely (channel !== 'dm' below): DM Arabic replies are
        // gender-personalized but the semantic cache has no gender/name dimension, so a fuzzy match
        // would serve one customer's gendered reply to another. Only history-less first-DMs would
        // reach it anyway (history/customerContext are skipped below), and it yields ~0 real hits —
        // gating here (not inside the block) also skips the throwaway embedding call for those DMs.
        // The exact cache still serves DMs, name-bucketed (see buildCacheKey).
        // G1 stage L2 (review finding C1): a reply whose <business_lists> rows were
        // filtered to THIS message must not be served to a similar-but-different
        // question. «وين نلقاكم في تلة الريح؟» and «… في عين الدالية؟» sit far inside
        // the 0.91 LOCATION threshold, and a hit would hand back one area's real
        // outlets under another area's name — precisely the fabrication the gating
        // exists to make impossible. Skipped on BOTH sides: the write so we never
        // poison the store, the read so entries written before this guard (or by a
        // page whose collections arrived later) cannot be served either. The
        // exact-text cache keeps working — identical text matches identical rows.
        //
        // Do NOT try to win the hit-rate back by scoping entries to the matched
        // set (or a hash of the rendered block) instead of skipping: the no-match
        // class defeats it. «وين نلقاكم في العجيلات؟» and «وين نلقاكم في زوارة؟»
        // both match NOTHING — identical matched set, identical gated block — yet
        // each needs a reply naming ITS city; serving one for the other puts the
        // wrong city's name in the customer's thread. The distinguishing
        // information is in the question text the embedding deliberately blurs,
        // so any scoping finer than "skip" re-opens the defect for exactly the
        // questions gating exists to protect. (D-051's cache rule, re-derived in
        // the #528 review when matched-set scoping was proposed and rejected.)
        const factListsGated = request.context?.factCollectionsGated === true;
        if (factListsGated && config.ai.semanticCacheEnabled && pageId && kbActiveVersion !== null && kbActiveVersion !== undefined && !bypassAllCaches && request.context?.channel !== 'dm') {
            // Gating retires the semantic cache for most traffic on keyed-collection
            // pages (any message that doesn't name a listed value is gated). Count the
            // skips that would otherwise have been eligible reads, so a hit-rate drop
            // on a collection page is attributable from the metrics instead of reading
            // as a cache regression (the Nourva cache=0 diagnosis cost a day for want
            // of exactly this attribution). Same fire-and-forget pattern as §13c.
            redis.incr('metrics:cache:semantic_skip:fact_gated').catch(() => {});
        }
        if (config.ai.semanticCacheEnabled && !factListsGated && pageId && kbActiveVersion !== null && kbActiveVersion !== undefined && !bypassAllCaches && request.context?.channel !== 'dm') {
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
                                replyMode: request.context?.replyMode,
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
                            headers: aiWorkerHeaders(pageId ? { 'X-Workspace-Id': pageId } : undefined),
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

            // Save-side quality gate: ONE decision governing BOTH cache saves below
            // (exact + semantic — computed here so the two layers can never diverge).
            // A weak reply (confidence 'low', or info_not_in_kb / price_not_in_kb /
            // language_mismatch) is still returned to the customer but never cached —
            // cached, it would repeat for 30 days. Silent skip, deliberately NOT a
            // throw (contrast fallback_reply above: that reply is unusable; this one
            // is merely not worth repeating). Counters only when a save was actually
            // in play (eval bypasses); save_ok keeps counting when the kill-switch is
            // off (cacheReject stays null) so the reject-rate denominator survives a
            // flag flip.
            const cacheReject = config.ai.qualityGateEnabled
                ? cacheRejectReason(response.data.confidence, response.data.flags)
                : null;
            // Pipeline-suffixed (like the §13c AI counters): the rollout threshold
            // ("reject share >~25-30% → investigate") is only meaningful per
            // pipeline — cache_warm replays and dm_reply must not blend.
            if (!bypassAllCaches) {
                if (cacheReject) {
                    redis.incr(`metrics:cache:quality_gate:save_reject:${cacheReject}:${pipeline}`).catch(() => {});
                } else {
                    redis.incr(`metrics:cache:quality_gate:save_ok:${pipeline}`).catch(() => {});
                }
            }

            // v53 learning: feed the model's gender judgment into the fleet name→gender
            // map. Only pure NAME-based judgments on real Arabic DM traffic count —
            // `gender_basis === 'self'` is a self-reference override (فاطمة writing
            // "أنا مهتم") that would poison her name's entry, and eval/playground/
            // failover pipelines must not teach the map. Fire-and-forget.
            const senderName = request.context?.senderName;
            if (
                pipeline === 'dm_reply' &&
                request.context?.channel === 'dm' &&
                senderName &&
                response.data.language === 'ar' &&
                response.data.genderBasis === 'name' &&
                (response.data.gender === 'm' || response.data.gender === 'f')
            ) {
                recordGenderObservation(senderName, response.data.gender).catch(() => {});
            }

            // Save to exact cache (scoped by KB version + post context + model).
            // All models cache to their own bucket now — no more skip-when-non-default.
            // Eval pipeline never writes to cache (see `bypassAllCaches` above).
            const saveCacheCtx: CacheContext = { ...cacheCtx, language: detectedLanguage };

            // Shared by both save guards below: does the reply literally embed ANY part
            // of the customer's name (normalized, any alef variant)? Belt-and-braces on
            // top of the model-reported `usedName` — "أهلاً فاطمة" must never reach
            // another sender. Any-token, not first-token (2026-07-25): the model is
            // handed the whole display name and shortens it itself, so the part it
            // actually used is often not the leading one.
            const replyEmbedsName = senderName ? replyMentionsName(aiReply, senderName) : false;

            // Neutral (g:n) save guard — evaluated BEFORE the gender-bucket guard and
            // independent of it (no map needed, works even with the gender bucket
            // off). A reply may enter the fully-shared bucket ONLY when its own
            // labels certify it: the model reports it used NO gendered forms
            // (`gender: 'unknown'` — the high-volume «كم السعر / متوفر؟» inventory
            // answers) and no name (strict `usedName === false`, so old-worker /
            // failover responses without the v53 fields fail closed), plus the
            // name-substring belt above. The labels are the certification (D-030's
            // trust model — same labels the g:m/g:f guard already relies on); no
            // reply-text gender inspection, which D-030 ruled cannot certify
            // neutrality (masculine Arabic is unmarked). The reject-reason split vs
            // save_ok sizes the genderless slice — THE metric that decides how much
            // sharing this bucket can ever recover.
            let neutralEligible = false;
            if (config.ai.neutralBucketEnabled && cacheCtx.channel === 'dm' && senderName) {
                neutralEligible =
                    response.data.gender === 'unknown' &&
                    response.data.usedName === false &&
                    !replyEmbedsName;
                if (neutralEligible) {
                    saveCacheCtx.neutralBucket = true;
                    redis.incr('metrics:cache:neutral_bucket:save_ok').catch(() => {});
                } else {
                    // One reason label, first tripped guard wins (mirrors the
                    // gender-bucket downgrade counters).
                    const reason = response.data.gender === undefined ? 'not_reported'
                        : response.data.gender !== 'unknown' ? 'gendered'
                            : response.data.usedName !== false ? 'used_name'
                                : 'name_substring';
                    redis.incr(`metrics:cache:neutral_bucket:save_reject:${reason}`).catch(() => {});
                }
            }

            // v53 save guard: a reply may land in the shared gender bucket ONLY when
            // the reply's OWN labels prove it's safe there — never the map alone:
            //   1. it does not embed the customer's name in any script (model-reported
            //      `usedName`, plus the normalized-substring check above —
            //      "أهلاً فاطمة" must never reach another sender), and
            //   2. the gender it addresses matches the bucket, or it used no gendered
            //      forms at all (`unknown` — though that case now takes the g:n
            //      neutral bucket above when enabled, which wins in buildCacheKey).
            // Anything else downgrades the SAVE to the per-name bucket; the read side
            // keeps using the gender bucket, so a downgraded entry just means one
            // regeneration next time instead of a wrong reply ever being shared.
            if (!neutralEligible && saveCacheCtx.genderBucket && senderName) {
                const genderSafe = response.data.gender === saveCacheCtx.genderBucket
                    || response.data.gender === 'unknown';
                if (response.data.usedName !== false || replyEmbedsName || !genderSafe) {
                    this.logger.debug('ai_cache_gender_bucket_save_downgrade', {
                        pageId,
                        bucket: saveCacheCtx.genderBucket,
                        usedName: response.data.usedName,
                        replyEmbedsName,
                        reportedGender: response.data.gender,
                    });
                    // Prod-visible: the downgrade rate vs save_ok is THE metric that
                    // decides how much sharing the gender bucket actually recovers
                    // (high used_name rate = model name-drops too often to share).
                    // One reason label, first tripped guard wins.
                    const reason = response.data.usedName !== false ? 'used_name'
                        : replyEmbedsName ? 'name_substring'
                            : 'gender_mismatch';
                    redis.incr(`metrics:cache:gender_bucket:save_downgrade:${reason}`).catch(() => {});
                    saveCacheCtx.genderBucket = null;
                } else {
                    redis.incr('metrics:cache:gender_bucket:save_ok').catch(() => {});
                }
            }

            // Save eligibility, shared by BOTH save shapes below:
            // - History gate: the READ path only probes for history-less messages,
            //   but the save must be gated too — a reply generated WITH history can
            //   reference it ("the product you asked about earlier") while
            //   `customerContext` (the cc: key segment) is legitimately empty,
            //   landing it under the key a brand-new customer's first message
            //   probes. One customer's context served to another = wrong-CONTENT
            //   leak, strictly worse than any wrong-form issue.
            // - Quality gate (cacheReject): a weak reply must not repeat — and that
            //   applies to the dual-variant entry MORE, not less (it is the most
            //   widely shared entry of all).
            const mayCache = !bypassAllCaches && !cacheReject && !hasConversationHistory;

            // Dual-variant save (g:d): a gendered, name-free reply becomes ONE
            // shared entry carrying both addressee renderings. The transform runs
            // FIRE-AND-FORGET — the customer's reply has already been produced;
            // only the cache entry lands a few seconds later. Certification is
            // the same trust model as the g:m/g:f guard: the reply's own labels
            // (gender m/f + strict usedName === false) plus the literal
            // name-substring belt. Any transform failure falls back to exactly
            // the legacy save below — never a worse outcome than today.
            const dualEligible = config.ai.dualVariantEnabled
                && saveCacheCtx.channel === 'dm'
                && !!senderName
                && !!userId
                && (response.data.gender === 'm' || response.data.gender === 'f')
                && response.data.usedName === false
                && !replyEmbedsName;

            if (mayCache && dualEligible) {
                const sourceGender = response.data.gender as 'm' | 'f';
                void generateGenderVariant({ userId: userId as string, reply: aiReply, sourceGender })
                    .then(async (variant) => {
                        if (variant) {
                            const variants = sourceGender === 'm'
                                ? { m: aiReply, f: variant }
                                : { m: variant, f: aiReply };
                            redis.incr('metrics:cache:dual_variant:save_ok').catch(() => {});
                            await this.saveToCache(request.comment, aiReply, { ...saveCacheCtx, dualVariant: true }, { ...aiMetadata, variants });
                        } else {
                            // Rejection reason already counted inside the transform
                            // module; keep this reply cached the legacy way.
                            await this.saveToCache(request.comment, aiReply, saveCacheCtx, aiMetadata);
                        }
                    })
                    .catch(() => { /* cache warm-up loss only — never surfaces */ });
            } else if (mayCache) {
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
            if (config.ai.semanticCacheEnabled && !factListsGated && !bypassAllCaches && !cacheReject && !hasConversationHistory && pageId && queryEmbedding && detectedPreGptIntent && detectedPreGptIntent !== 'OTHER' && kbActiveVersion !== null && kbActiveVersion !== undefined && request.context?.channel !== 'dm') {
                semanticCacheService.save({
                    pageId,
                    queryText: request.comment,
                    queryEmbedding,
                    intent: detectedPreGptIntent,
                    replyText: aiReply,
                    kbActiveVersion,
                    channel: request.context?.channel,
                    replyStyle: request.context?.replyStyle,
                    replyMode: request.context?.replyMode,
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
                                headers: aiWorkerHeaders(pageId ? { 'X-Workspace-Id': pageId } : undefined),
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
                    // Build the typed error FIRST so the class can be attached to it.
                    // This used to call `Sentry.setTag('aiErrorClass', name)` on the
                    // ambient scope — but this runs in the BullMQ reply worker, not an
                    // HTTP request, so there is no per-request isolation scope and the
                    // tag landed on the PROCESS-WIDE scope. It then rode along on every
                    // unrelated event afterwards: observed in production tagging a
                    // POST /pages/:id/connect-whatsapp stream error with
                    // `aiErrorClass: AiRefusalError` (Sentry JAWAB24-BACKEND-1H).
                    let aiError: Error | undefined;
                    switch (name) {
                        case 'AiRefusalError':
                            aiError = new AiRefusalError(refusalReason ?? 'unknown', message);
                            break;
                        case 'AiTimeoutError':
                            aiError = new AiTimeoutError(undefined, message);
                            break;
                        case 'AiEmptyReplyError':
                            aiError = new AiEmptyReplyError(message);
                            break;
                        case 'AiClientNotConfiguredError':
                            // ai-worker's "no client" maps to backend's AiUnavailableError
                            // (same semantics: permanent-but-flag-via-retry-exhaustion).
                            aiError = new AiUnavailableError(message);
                            break;
                        case 'AiQuotaExhaustedError':
                            // OpenAI out of credit. Fire a throttled "top up" alert,
                            // then rethrow the typed error so the worker PARKS the job
                            // (re-enqueue with long delay) instead of flagging it.
                            await this.alertQuotaExhausted(pipeline, message).catch(() => {});
                            aiError = new AiQuotaExhaustedError(message);
                            break;
                    }
                    if (aiError) throw tagError(aiError, { aiErrorClass: name });
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
     * sustained outage doesn't flood Sentry/email with one alert per failed call.
     * Never throws — alerting must not affect the reply path.
     *
     * No `recordAiFailedBeforeLog('AiQuotaError')` here on purpose: per the
     * one-canonical-emit-site rule (AI_INSTRUCTIONS §13c), the ai-worker already
     * emits the `AiQuotaError` failed_before_log at its OpenAI call site; the
     * backend's only metric role on this hop is `AiWorkerUnreachable` (emitted in
     * the generateReply catch). Emitting here too would double-count.
     *
     * Note on the circuit breaker: once a sustained quota outage trips the
     * ai-worker circuit (after failureThreshold typed-500s), generateReply takes
     * the failover branch and CircuitOpenError — not AiQuotaExhaustedError —
     * reaches the worker, so this alert only fires for the pre-open window (the
     * throttle means one alert is enough) and those jobs then park on the shorter
     * circuit delay. That's acceptable: the operator has already been alerted.
     */
    private async alertQuotaExhausted(pipeline: AiPipeline, message?: string): Promise<void> {
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
            // Fire each send WITHOUT awaiting: emailService.send hits Resend
            // (rate-limited, network I/O) and this runs inside the reply worker's
            // failure path — awaiting it could add latency or, on a hung send,
            // stall the job. Alerting is best-effort; each send swallows its own
            // error. The dedup above already bounds this to one burst per window.
            for (const to of admins) {
                void emailService.send({
                    to,
                    subject: '🚨 Jawab24: OpenAI quota exhausted — top up billing',
                    html,
                    type: 'transactional',
                }).catch(() => { /* never block the reply path */ });
            }
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

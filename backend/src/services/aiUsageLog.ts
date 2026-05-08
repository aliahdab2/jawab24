/**
 * Single writer for ai_usage_log. Lives in its own module so callers outside
 * ai.ts (embedding provider, lead extractor, e-commerce tool loop) can import
 * statically — ai.ts itself depends on those modules, so importing from ai.ts
 * would form a circular dependency.
 */
import * as Sentry from '@sentry/node';
import { db } from '../db';
import { aiUsageLog } from '../db/schema';
import { redis } from '../lib/redis';
import { estimateCostUsd } from '../config/aiPricing';
import type { AiPipeline } from '../types/aiPipeline';

/**
 * Options for logAiUsage. Tagging `pipeline` is required so per-source cost
 * stays queryable; the schema's `pipeline` column was historically NULL on
 * every row, which made attribution impossible.
 */
export interface LogAiUsageOptions {
    userId: string;
    pageId?: string;
    model: string;
    tokensIn: number;
    /** Subset of `tokensIn` that hit OpenAI's prompt cache (billed at 50%). */
    cachedInputTokens?: number;
    tokensOut: number;
    cached: boolean;
    pipeline: AiPipeline;
    /** Classified intent (GREETING, COMPLAINT, …) — null when not applicable (e.g. embeddings). */
    intent?: string | null;
}

/**
 * Write one row to ai_usage_log. Fire-and-forget — on failure increments a
 * Redis drop counter and emits a Sentry breadcrumb so we can alert without
 * blocking the reply pipeline.
 *
 * Single writer: every OpenAI call site in backend/ funnels through here.
 * Embeddings pass tokensOut=0; chat completions pass real token counts.
 */
export async function logAiUsage(opts: LogAiUsageOptions): Promise<void> {
    const cachedInputTokens = opts.cachedInputTokens ?? 0;
    const costUsd = estimateCostUsd(opts.model, opts.tokensIn, opts.tokensOut, cachedInputTokens);
    try {
        await db.insert(aiUsageLog).values({
            userId: opts.userId,
            pageId: opts.pageId ?? null,
            model: opts.model,
            tokensIn: opts.tokensIn,
            cachedInputTokens,
            tokensOut: opts.tokensOut,
            costUsd,
            cached: opts.cached,
            pipeline: opts.pipeline,
            intent: opts.intent ?? null,
        });
    } catch (err) {
        Sentry.addBreadcrumb({
            category: 'ai_usage_log',
            level: 'warning',
            message: 'ai_usage_log insert failed',
            data: { pipeline: opts.pipeline, model: opts.model, error: err instanceof Error ? err.message : String(err) },
        });
        try {
            await redis.incr('metrics:pipeline:ai_usage_log.dropped');
        } catch {
            // Redis also unavailable — silently discard
        }
    }
}

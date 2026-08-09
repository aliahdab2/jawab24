/**
 * AI model pricing constants for cost tracking.
 * Input/output prices are per 1,000 tokens in USD.
 *
 * `cachedInputPer1K` reflects the actual per-model OpenAI prompt-cache rate
 * (4.1 family: 75% off input; 4o family: 50% off input). Models without a
 * `cachedInputPer1K` field do not support prompt caching for our use; cached
 * tokens for those models fall back to the full input rate.
 */
export const AI_PRICING = {
    'gpt-4o-mini': { inputPer1K: 0.00015, cachedInputPer1K: 0.000075, outputPer1K: 0.0006 },
    // Dated snapshot alias — same price as the rolling 'gpt-4o-mini'. This is the
    // name OpenAI returns for the VISION calls the catalog posts-scan makes
    // (file-extractor OCR), and its absence here meant every one of them was
    // recorded at cost 0: 42 calls / 1.24M input tokens over the 30 days to
    // 2026-07-27, i.e. the whole image-OCR pipeline was invisible to /admin/ai-cost.
    // Image OCR is token-heavy (~25–37k input per image), so a missing alias here
    // understates the feature's cost by far more than a chat call would.
    'gpt-4o-mini-2024-07-18': { inputPer1K: 0.00015, cachedInputPer1K: 0.000075, outputPer1K: 0.0006 },
    'gpt-4.1-mini': { inputPer1K: 0.0004, cachedInputPer1K: 0.0001, outputPer1K: 0.0016 },
    // Dated snapshot alias — OpenAI sometimes returns this name in `response.model`
    // even when the request used the rolling 'gpt-4.1-mini' alias. Same price.
    'gpt-4.1-mini-2025-04-14': { inputPer1K: 0.0004, cachedInputPer1K: 0.0001, outputPer1K: 0.0016 },
    'gpt-4.1-nano': { inputPer1K: 0.0001, cachedInputPer1K: 0.000025, outputPer1K: 0.0004 },
    'gpt-4.1': { inputPer1K: 0.002, cachedInputPer1K: 0.0005, outputPer1K: 0.008 },
    // Dated snapshot alias — OpenAI returns this in `response.model` even when the
    // request used the rolling 'gpt-4.1' alias (e.g. the operational-facts backfill). Same price.
    'gpt-4.1-2025-04-14': { inputPer1K: 0.002, cachedInputPer1K: 0.0005, outputPer1K: 0.008 },
    'gpt-5-mini': { inputPer1K: 0.00025, cachedInputPer1K: 0.000025, outputPer1K: 0.002 },
    'gpt-5-nano': { inputPer1K: 0.00005, cachedInputPer1K: 0.000005, outputPer1K: 0.0004 },
    // gpt-5.4 family — short-context prices (OpenAI's pricing page lists "-" for the
    // long-context column on both mini and nano, so only the short-context rates exist).
    'gpt-5.4-mini': { inputPer1K: 0.00075, cachedInputPer1K: 0.000075, outputPer1K: 0.0045 },
    'gpt-5.4-nano': { inputPer1K: 0.0002, cachedInputPer1K: 0.00002, outputPer1K: 0.00125 },
    // gpt-image family — token-based like everything else: `usage.input_tokens`
    // (prompt text; generate-only calls carry no image input) priced as input,
    // `usage.output_tokens` (image tokens) as output. Rates from OpenAI's pricing
    // page 2026-08-09: gpt-image-2 text-in $5/1M, image-out $30/1M (≈$0.05 per
    // medium 1024×1024); gpt-image-1-mini text-in $2/1M, image-out $8/1M. The
    // image-INPUT rate ($8/1M on gpt-image-2) applies only to edits, which no
    // caller uses — add a distinct row if an edit path ever ships.
    'gpt-image-2': { inputPer1K: 0.005, outputPer1K: 0.03 },
    'gpt-image-1-mini': { inputPer1K: 0.002, outputPer1K: 0.008 },
    'gpt-4o-mini-transcribe': { inputPer1K: 0.00125, outputPer1K: 0.005 },
    'text-embedding-3-small': { inputPer1K: 0.00002, outputPer1K: 0 },
    'claude-haiku-4-5-20251001': { inputPer1K: 0.0008, outputPer1K: 0.004 },
    'claude-sonnet-4-20250514': { inputPer1K: 0.003, outputPer1K: 0.015 },
} as const;

export type ModelName = keyof typeof AI_PRICING;

/**
 * Pricing schema version written to ai_usage_log.pricing_version on every
 * new row. Bump when AI_PRICING values change so historical totals can be
 * filtered by version for apples-to-apples comparison.
 */
export const PRICING_VERSION = 'v3';

const warnedUnknownModels = new Set<string>();
const warnedSnapshotFallbacks = new Set<string>();

/** `gpt-4o-mini-2024-07-18` → `gpt-4o-mini`. */
const SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Price a model, falling back to its rolling alias when OpenAI hands back a
 * DATED SNAPSHOT we have no explicit row for.
 *
 * We request rolling aliases ('gpt-4o-mini'), but `response.model` — which is
 * what `ai_usage_log` records — often carries the snapshot instead. Each time
 * that happened the row was simply missing and the call booked at $0: first for
 * the 4.1 family, then again for 4o-mini's vision calls (42 calls / 1.24M input
 * tokens invisible to /admin/ai-cost by 2026-07-27). Adding one more alias each
 * time only fixes the instance; this fixes the class.
 *
 * It still WARNS, because the assumption is "same price", and that is not
 * guaranteed — OpenAI has priced two snapshots of one family differently before
 * (gpt-4o-2024-05-13 vs -2024-08-06). An approximate cost at the base rate beats
 * a confident $0, and the warning is how the exact row gets added.
 */
function lookupPricing(model: string) {
    const exact = AI_PRICING[model as ModelName];
    if (exact) return exact;

    const base = model.replace(SNAPSHOT_SUFFIX, '');
    if (base === model) return undefined;

    const viaBase = AI_PRICING[base as ModelName];
    if (viaBase && !warnedSnapshotFallbacks.has(model)) {
        warnedSnapshotFallbacks.add(model);
        console.warn(
            `[aiPricing] "${model}" priced at "${base}" rates (snapshot fallback). `
            + 'Verify the snapshot shares its base price and add an explicit row.',
        );
    }
    return viaBase;
}

/**
 * Calculate estimated cost in USD for a given model and token counts.
 *
 * `tokensIn` is the *total* prompt tokens (matches OpenAI's `prompt_tokens`).
 * `cachedTokensIn` is the subset of `tokensIn` that hit the prompt cache;
 * those tokens are billed at the model's `cachedInputPer1K` rate (or the
 * full input rate if the model has no cached pricing entry).
 */
export function estimateCostUsd(
    model: string,
    tokensIn: number,
    tokensOut: number,
    cachedTokensIn: number = 0,
): number {
    const pricing = lookupPricing(model);
    if (!pricing) {
        if (!warnedUnknownModels.has(model)) {
            warnedUnknownModels.add(model);
            console.warn(`[aiPricing] Unknown model "${model}" — cost recorded as 0. Add it to AI_PRICING.`);
        }
        return 0;
    }
    const cached = Math.min(Math.max(cachedTokensIn, 0), tokensIn);
    const fresh = tokensIn - cached;
    const cachedRate = 'cachedInputPer1K' in pricing ? pricing.cachedInputPer1K : pricing.inputPer1K;
    const inputCost = (fresh / 1000) * pricing.inputPer1K
        + (cached / 1000) * cachedRate;
    const outputCost = (tokensOut / 1000) * pricing.outputPer1K;
    return inputCost + outputCost;
}

/**
 * USD saved by OpenAI prompt caching for a given model and cached-token count:
 * the cached input tokens are billed at the model's discounted `cachedInputPer1K`
 * instead of the full `inputPer1K`, so savings = cachedTokens × (full − cached) rate.
 * Returns 0 for unknown models or models without a cached rate.
 */
export function cacheSavingsUsd(model: string, cachedTokensIn: number): number {
    const pricing = lookupPricing(model);
    if (!pricing || !('cachedInputPer1K' in pricing)) return 0;
    const cached = Math.max(cachedTokensIn, 0);
    return (cached / 1000) * (pricing.inputPer1K - pricing.cachedInputPer1K);
}

/** Whisper speech-to-text pricing: $0.006 per minute of audio */
const WHISPER_COST_PER_MINUTE = 0.006;

export function estimateWhisperCostUsd(durationSeconds: number): number {
    return (durationSeconds / 60) * WHISPER_COST_PER_MINUTE;
}

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
    'gpt-4.1-mini': { inputPer1K: 0.0004, cachedInputPer1K: 0.0001, outputPer1K: 0.0016 },
    // Dated snapshot alias — OpenAI sometimes returns this name in `response.model`
    // even when the request used the rolling 'gpt-4.1-mini' alias. Same price.
    'gpt-4.1-mini-2025-04-14': { inputPer1K: 0.0004, cachedInputPer1K: 0.0001, outputPer1K: 0.0016 },
    'gpt-4.1-nano': { inputPer1K: 0.0001, cachedInputPer1K: 0.000025, outputPer1K: 0.0004 },
    'gpt-4.1': { inputPer1K: 0.002, cachedInputPer1K: 0.0005, outputPer1K: 0.008 },
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
export const PRICING_VERSION = 'v2';

const warnedUnknownModels = new Set<string>();

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
    const pricing = AI_PRICING[model as ModelName];
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

/** Whisper speech-to-text pricing: $0.006 per minute of audio */
const WHISPER_COST_PER_MINUTE = 0.006;

export function estimateWhisperCostUsd(durationSeconds: number): number {
    return (durationSeconds / 60) * WHISPER_COST_PER_MINUTE;
}

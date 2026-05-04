/**
 * AI model pricing constants for cost tracking.
 * Input/output prices are per 1,000 tokens in USD.
 */
export const AI_PRICING = {
    'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
    'gpt-4.1-mini': { inputPer1K: 0.0004, outputPer1K: 0.0016 },
    'gpt-4.1': { inputPer1K: 0.002, outputPer1K: 0.008 },
    'gpt-4o-mini-transcribe': { inputPer1K: 0.00125, outputPer1K: 0.005 },
    'text-embedding-3-small': { inputPer1K: 0.00002, outputPer1K: 0 },
    'claude-haiku-4-5-20251001': { inputPer1K: 0.0008, outputPer1K: 0.004 },
    'claude-sonnet-4-20250514': { inputPer1K: 0.003, outputPer1K: 0.015 },
} as const;

export type ModelName = keyof typeof AI_PRICING;

/**
 * Calculate estimated cost in USD for a given model and token counts.
 */
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
    const pricing = AI_PRICING[model as ModelName];
    if (!pricing) return 0;
    return (tokensIn / 1000) * pricing.inputPer1K + (tokensOut / 1000) * pricing.outputPer1K;
}

/** Whisper speech-to-text pricing: $0.006 per minute of audio */
const WHISPER_COST_PER_MINUTE = 0.006;

export function estimateWhisperCostUsd(durationSeconds: number): number {
    return (durationSeconds / 60) * WHISPER_COST_PER_MINUTE;
}

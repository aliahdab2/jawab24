/**
 * AI model pricing constants for cost tracking.
 * Input/output prices are per 1,000 tokens in USD.
 */
export const AI_PRICING = {
    'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
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

/**
 * Generic LLM provider abstraction.
 * Any AI model (OpenAI, Claude, Gemini, self-hosted) implements this interface.
 */

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMChatParams {
    messages: LLMMessage[];
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    /** Phase 6.5 diagnostic tag — propagated to `withAiMetrics` so non-default-model
     *  traffic routes to the right pipeline counter instead of `unknown`. */
    pipeline?: string;
}

export interface LLMChatResult {
    content: string;
    tokensIn?: number;
    tokensInCached?: number;
    tokensOut?: number;
    tokensTotal?: number;
}

export interface LLMProvider {
    readonly name: string;
    readonly modelId: string;
    isConfigured(): boolean;
    chat(params: LLMChatParams): Promise<LLMChatResult>;
}

/**
 * JSON schema for structured AI replies.
 * Keep in sync with the inline schema in openai.ts:132-159 (production path).
 * Used by the provider abstraction for non-default model calls.
 */
export const AI_REPLY_JSON_SCHEMA = {
    type: 'object' as const,
    properties: {
        reply: { type: 'string' as const },
        intent: {
            type: 'string' as const,
            enum: [
                'QUESTION', 'COMPLIMENT', 'COMPLAINT', 'PURCHASE_INTENT',
                'GREETING', 'BUSINESS_INQUIRY', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT',
            ],
        },
        confidence: {
            type: 'string' as const,
            enum: ['high', 'medium', 'low'],
        },
        flags: {
            type: 'array' as const,
            items: { type: 'string' as const },
        },
        // Gender self-report (v53) — see the inline schema in openai.ts for semantics.
        gender: {
            type: 'string' as const,
            enum: ['m', 'f', 'unknown'],
        },
        gender_basis: {
            type: 'string' as const,
            enum: ['self', 'name', 'unclear'],
        },
        used_name: { type: 'boolean' as const },
    },
    required: ['reply', 'intent', 'confidence', 'flags', 'gender', 'gender_basis', 'used_name'] as const,
    additionalProperties: false,
};

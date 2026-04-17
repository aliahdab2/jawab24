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
}

export interface LLMChatResult {
    content: string;
    tokensIn?: number;
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
    },
    required: ['reply', 'intent', 'confidence', 'flags'] as const,
    additionalProperties: false,
};

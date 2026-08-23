import { normalizeAiIntent } from '@jawab24/shared';
import { config } from '../../config';
import { openaiService, assertDeliverableOrThrow, type GenerateRequest, type GenerateResponse } from '../openai';
import { parseReplyContent } from '../reply/parseReplyContent';
import type { LLMProvider } from './types';
import { OpenAIAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';
import { AiClientNotConfiguredError } from '../../lib/errors';

/**
 * Map of model IDs to the provider factory that creates them.
 * To add a new provider: add entries here + create an adapter file.
 */
const MODEL_PROVIDERS: Record<string, () => LLMProvider> = {
    // OpenAI models
    'gpt-4.1-mini': () => new OpenAIAdapter('gpt-4.1-mini'),
    'gpt-4.1-nano': () => new OpenAIAdapter('gpt-4.1-nano'),
    'gpt-4.1': () => new OpenAIAdapter('gpt-4.1'),
    'gpt-4o-mini': () => new OpenAIAdapter('gpt-4o-mini'),
    'gpt-5-mini': () => new OpenAIAdapter('gpt-5-mini'),
    'gpt-5-nano': () => new OpenAIAdapter('gpt-5-nano'),
    'gpt-5.4-mini': () => new OpenAIAdapter('gpt-5.4-mini'),
    'gpt-5.4-nano': () => new OpenAIAdapter('gpt-5.4-nano'),
    // Claude models
    'claude-haiku-4-5-20251001': () => new ClaudeAdapter('claude-haiku-4-5-20251001'),
    'claude-sonnet-4-20250514': () => new ClaudeAdapter('claude-sonnet-4-20250514'),
};

/** Set of all valid model IDs for route-level validation. */
export const VALID_MODELS = new Set(Object.keys(MODEL_PROVIDERS));

/** Cache of instantiated providers to avoid re-creating clients. */
const providerCache = new Map<string, LLMProvider>();

/**
 * Get or create a provider for the given model ID.
 * Throws if model ID is not in the registry.
 */
function getProvider(modelId: string): LLMProvider {
    const cached = providerCache.get(modelId);
    if (cached) return cached;

    const factory = MODEL_PROVIDERS[modelId];
    if (!factory) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const provider = factory();
    providerCache.set(modelId, provider);
    return provider;
}

/**
 * Generate a reply using a specific model provider.
 * Reuses openaiService for prompt building and validation — only the
 * LLM call goes through the provider adapter.
 *
 * This is the NON-production path, used by:
 *   - Playground A/B model comparison
 *   - Production failover (when circuit breaker is open)
 */
export async function generateReplyWithProvider(
    request: GenerateRequest,
    modelId: string,
): Promise<GenerateResponse> {
    const provider = getProvider(modelId);

    if (!provider.isConfigured()) {
        throw new AiClientNotConfiguredError(modelId);
    }

    try {
        const systemPrompt = openaiService.buildSystemPrompt(request);
        const { messages } = openaiService.buildMessages(request, systemPrompt);

        const result = await provider.chat({
            messages: messages.map(m => ({
                role: m.role as 'system' | 'user' | 'assistant',
                content: typeof m.content === 'string' ? m.content : '',
            })),
            maxTokens: config.openai.maxTokens,
            temperature: config.openai.temperature,
            topP: config.openai.topP,
            frequencyPenalty: config.openai.frequencyPenalty,
            presencePenalty: config.openai.presencePenalty,
            timeoutMs: config.openai.timeoutMs,
            pipeline: request.context?.pipeline,
        });

        // Parse the envelope through the same parser as the production path
        // (salvage / empty-on-broken / plain passthrough — never raw envelope text).
        const { parsed } = parseReplyContent(result.content, {
            site: 'provider', envelopeEnforced: true, pipeline: request.context?.pipeline,
        });

        // Normalize intent (GPT and Claude both may invent non-standard intents)
        if (parsed.intent) {
            parsed.intent = normalizeAiIntent(parsed.intent) || parsed.intent;
        }

        // Run the same post-reply validation as the production path
        const validated = openaiService.validateReply(parsed, request);
        assertDeliverableOrThrow(validated, request.context?.pipeline);

        return {
            reply: validated.reply,
            language: request.language || 'auto',
            model: modelId,
            intent: validated.intent,
            confidence: validated.confidence,
            flags: validated.flags,
            gender: validated.gender,
            genderBasis: validated.genderBasis,
            usedName: validated.usedName,
            tokensUsed: result.tokensTotal,
            tokensIn: result.tokensIn,
            tokensInCached: result.tokensInCached,
            tokensOut: result.tokensOut,
        };
    } catch (error) {
        console.error(`Provider ${provider.name} (${modelId}) error:`, error);
        // Rethrow — backend's catch decides retry-vs-flag via isTransientAiError.
        // Returning a templated fake reply here is the bug we're removing.
        throw error;
    }
}

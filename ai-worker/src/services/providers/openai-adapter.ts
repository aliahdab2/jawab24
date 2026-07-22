import OpenAI from 'openai';
import * as Sentry from '@sentry/node';
import { config } from '../../config';
import type { LLMProvider, LLMChatParams, LLMChatResult, LLMMessage } from './types';
import { AI_REPLY_JSON_SCHEMA } from './types';
import { withAiMetrics } from '../../lib/aiMetrics';
import { classifyTimeoutAbort, isTimeoutAbort } from '../../lib/aiTimeout';
import { AiTimeoutError } from '../../lib/errors';

export class OpenAIAdapter implements LLMProvider {
    readonly name = 'openai';
    readonly modelId: string;
    private client: OpenAI | null = null;

    constructor(modelId: string) {
        this.modelId = modelId;
        if (config.openai.apiKey) {
            this.client = new OpenAI({ apiKey: config.openai.apiKey });
        }
    }

    isConfigured(): boolean {
        return this.client !== null && config.openai.apiKey.length > 0;
    }

    async chat(params: LLMChatParams): Promise<LLMChatResult> {
        if (!this.client) {
            throw new Error('OpenAI client not configured');
        }
        const client = this.client;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

        try {
            const completion = await withAiMetrics(
                params.pipeline,
                this.modelId,
                () => Sentry.startSpan(
                    { name: 'ai.llm.call', op: 'ai', attributes: { 'ai.model': this.modelId } },
                    () => {
                        const isReasoningModel = /^(gpt-5|o1|o3|o4)/i.test(this.modelId);
                        // Lowest reasoning tier — enough to stop the model burning
                        // max_completion_tokens on hidden reasoning. The gpt-5.1+ family
                        // renamed this tier: 'minimal' was removed and only 'none' disables
                        // reasoning (gpt-5.4-mini rejects 'minimal' with a 400). gpt-5.0 and
                        // the o-series still use 'minimal'.
                        const minimalReasoningEffort = /^gpt-5\.\d/i.test(this.modelId) ? 'none' : 'minimal';
                        const base: OpenAI.ChatCompletionCreateParamsNonStreaming = {
                            model: this.modelId,
                            messages: params.messages as OpenAI.ChatCompletionMessageParam[],
                            response_format: {
                                type: 'json_schema',
                                json_schema: {
                                    name: 'ai_reply',
                                    strict: true,
                                    schema: AI_REPLY_JSON_SCHEMA,
                                },
                            },
                        };
                        const body: OpenAI.ChatCompletionCreateParamsNonStreaming = isReasoningModel
                            ? {
                                ...base,
                                max_completion_tokens: params.maxTokens,
                                // gpt-5 / o-series default to 'medium' reasoning_effort,
                                // which consumes most of max_completion_tokens on hidden
                                // reasoning and starves the JSON output. The lowest tier
                                // makes the model behave like a standard chat model.
                                reasoning_effort: minimalReasoningEffort,
                                // Note: gpt-5 / o-series reject custom temperature/top_p/penalties.
                            }
                            : {
                                ...base,
                                max_tokens: params.maxTokens,
                                temperature: params.temperature,
                                ...(params.topP !== undefined && { top_p: params.topP }),
                                ...(params.frequencyPenalty !== undefined && { frequency_penalty: params.frequencyPenalty }),
                                ...(params.presencePenalty !== undefined && { presence_penalty: params.presencePenalty }),
                            };
                        return client.chat.completions.create(body, { signal: controller.signal });
                    },
                ),
                classifyTimeoutAbort(controller.signal),
            );

            const content = completion.choices[0]?.message?.content?.trim() || '';
            return {
                content,
                tokensIn: completion.usage?.prompt_tokens,
                tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
                tokensOut: completion.usage?.completion_tokens,
                tokensTotal: completion.usage?.total_tokens,
            };
        } catch (e) {
            if (isTimeoutAbort(controller.signal)) {
                throw new AiTimeoutError(params.timeoutMs);
            }
            throw e;
        } finally {
            clearTimeout(timeout);
        }
    }
}

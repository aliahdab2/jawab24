import OpenAI from 'openai';
import * as Sentry from '@sentry/node';
import { config } from '../../config';
import type { LLMProvider, LLMChatParams, LLMChatResult, LLMMessage } from './types';
import { AI_REPLY_JSON_SCHEMA } from './types';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../../lib/aiMetrics';

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

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

        try {
            // Pipeline not plumbed to LLMChatParams (non-default-model path is admin/playground only,
            // low traffic). Counter key falls back to 'unknown' — acceptable noise for this surface.
            recordAiAttempt(undefined, this.modelId);
            const completion = await Sentry.startSpan(
                { name: 'ai.llm.call', op: 'ai', attributes: { 'ai.model': this.modelId } },
                () => this.client!.chat.completions.create({
                    model: this.modelId,
                    messages: params.messages as OpenAI.ChatCompletionMessageParam[],
                    max_tokens: params.maxTokens,
                    temperature: params.temperature,
                    ...(params.topP !== undefined && { top_p: params.topP }),
                    ...(params.frequencyPenalty !== undefined && { frequency_penalty: params.frequencyPenalty }),
                    ...(params.presencePenalty !== undefined && { presence_penalty: params.presencePenalty }),
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'ai_reply',
                            strict: true,
                            schema: AI_REPLY_JSON_SCHEMA,
                        },
                    },
                }, { signal: controller.signal }),
            );
            recordAiReturn(undefined, this.modelId);

            const content = completion.choices[0]?.message?.content?.trim() || '';
            return {
                content,
                tokensIn: completion.usage?.prompt_tokens,
                tokensInCached: completion.usage?.prompt_tokens_details?.cached_tokens,
                tokensOut: completion.usage?.completion_tokens,
                tokensTotal: completion.usage?.total_tokens,
            };
        } catch (err) {
            recordAiFailedBeforeLog(undefined, this.modelId, 'OpenAIApiError');
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }
}

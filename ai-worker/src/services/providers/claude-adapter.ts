import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/node';
import { config } from '../../config';
import type { LLMProvider, LLMChatParams, LLMChatResult, LLMMessage } from './types';

export class ClaudeAdapter implements LLMProvider {
    readonly name = 'anthropic';
    readonly modelId: string;
    private client: Anthropic | null = null;

    constructor(modelId: string) {
        this.modelId = modelId;
        if (config.anthropic.apiKey) {
            this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
        }
    }

    isConfigured(): boolean {
        return this.client !== null && config.anthropic.apiKey.length > 0;
    }

    async chat(params: LLMChatParams): Promise<LLMChatResult> {
        if (!this.client) {
            throw new Error('Anthropic client not configured');
        }

        // Claude API requires system message separate from conversation messages
        const systemMessage = params.messages.find(m => m.role === 'system')?.content || '';
        const conversationMessages = params.messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

        try {
            const response = await Sentry.startSpan(
                { name: 'ai.llm.call', op: 'ai', attributes: { 'ai.model': this.modelId } },
                () => this.client!.messages.create({
                    model: this.modelId,
                    system: systemMessage,
                    messages: conversationMessages,
                    max_tokens: params.maxTokens,
                    temperature: params.temperature,
                    ...(params.topP !== undefined && { top_p: params.topP }),
                    // Note: Anthropic API does not support frequency_penalty / presence_penalty
                }, { signal: controller.signal }),
            );

            let content = '';
            for (const block of response.content) {
                if (block.type === 'text') {
                    content += block.text;
                }
            }
            content = content.trim();

            // Claude sometimes wraps JSON in markdown code blocks — strip them
            content = stripMarkdownCodeBlock(content);

            return {
                content,
                tokensIn: response.usage?.input_tokens,
                tokensOut: response.usage?.output_tokens,
                tokensTotal: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
            };
        } finally {
            clearTimeout(timeout);
        }
    }
}

/**
 * Strip markdown code block wrapper if present.
 * Claude sometimes returns ```json\n{...}\n``` instead of raw JSON.
 */
function stripMarkdownCodeBlock(text: string): string {
    const match = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    return match ? match[1].trim() : text;
}

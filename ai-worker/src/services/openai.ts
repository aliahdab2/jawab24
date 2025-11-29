import OpenAI from 'openai';
import { config } from '../config';

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date;
}

export interface GenerateRequest {
    comment: string;
    language?: string;
    context?: {
        postMessage?: string;
        pageName?: string;
        previousReplies?: string[];
        knowledgeBase?: string;
        conversationHistory?: ConversationMessage[];
    };
}

export interface GenerateResponse {
    reply: string;
    language: string;
    tokensUsed?: number;
}

export class OpenAIService {
    private client: OpenAI | null = null;

    constructor() {
        if (config.openai.apiKey) {
            this.client = new OpenAI({
                apiKey: config.openai.apiKey,
            });
        }
    }

    /**
     * Check if OpenAI is configured
     */
    isConfigured(): boolean {
        return this.client !== null && config.openai.apiKey.length > 0;
    }

    /**
     * Generate a reply for a comment or message
     */
    async generateReply(request: GenerateRequest): Promise<GenerateResponse> {
        if (!this.client) {
            return this.getFallbackReply(request);
        }

        try {
            const systemPrompt = this.buildSystemPrompt(request);
            const messages = this.buildMessages(request, systemPrompt);

            const completion = await this.client.chat.completions.create({
                model: config.openai.model,
                messages,
                max_tokens: config.openai.maxTokens,
                temperature: config.openai.temperature,
            });

            const reply = completion.choices[0]?.message?.content?.trim() || '';
            const detectedLanguage = this.detectLanguage(request.comment);

            return {
                reply: reply || this.getFallbackReply(request).reply,
                language: request.language || detectedLanguage,
                tokensUsed: completion.usage?.total_tokens,
            };
        } catch (error) {
            console.error('OpenAI API error:', error);
            return this.getFallbackReply(request);
        }
    }

    /**
     * Build messages array including conversation history
     */
    private buildMessages(request: GenerateRequest, systemPrompt: string): OpenAI.ChatCompletionMessageParam[] {
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
        ];

        // Add conversation history if available (for DMs)
        if (request.context?.conversationHistory && request.context.conversationHistory.length > 0) {
            for (const msg of request.context.conversationHistory) {
                messages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content,
                });
            }
        }

        // Add the current message/comment
        const userPrompt = this.buildUserPrompt(request);
        messages.push({ role: 'user', content: userPrompt });

        return messages;
    }

    /**
     * Build system prompt for the AI
     */
    private buildSystemPrompt(request: GenerateRequest): string {
        const pageName = request.context?.pageName || 'our page';
        const language = request.language || 'the same language as the message';
        const knowledgeBase = request.context?.knowledgeBase;
        const isConversation = request.context?.conversationHistory && request.context.conversationHistory.length > 0;

        let prompt = `You are a friendly and professional customer service assistant for "${pageName}".
${isConversation ? 'You are having a conversation with a customer via Facebook Messenger.' : 'Your task is to respond to customer comments on Facebook posts.'}

Guidelines:
- Be polite, helpful, and professional
- Keep responses concise (1-3 sentences)
- Respond in ${language}
- If the message is positive, thank them warmly
- If the message is a question, provide a helpful answer based on the business information below
- If the message is negative, apologize and offer to resolve the issue
- Never be defensive or argumentative
- Use appropriate emojis sparingly (1-2 max)
- If you don't know something specific, offer to connect them with a human agent`;

        // Add knowledge base if available
        if (knowledgeBase && knowledgeBase.trim().length > 0) {
            prompt += `

=== BUSINESS INFORMATION ===
${knowledgeBase}
=== END BUSINESS INFORMATION ===

Use the above business information to answer customer questions accurately. If a question is not covered, politely say you'll check and get back to them.`;
        }

        prompt += `

Important: Only output the reply text, nothing else. Do not include any prefixes like "Reply:" or "Assistant:".`;

        return prompt;
    }

    /**
     * Build user prompt with the comment
     */
    private buildUserPrompt(request: GenerateRequest): string {
        let prompt = `Comment: "${request.comment}"`;

        if (request.context?.postMessage) {
            prompt = `Post: "${request.context.postMessage}"\n\n${prompt}`;
        }

        return prompt;
    }

    /**
     * Simple language detection based on character sets
     */
    private detectLanguage(text: string): string {
        // Arabic characters
        if (/[\u0600-\u06FF]/.test(text)) {
            return 'ar';
        }
        // Swedish characters
        if (/[åäöÅÄÖ]/.test(text)) {
            return 'sv';
        }
        // Default to English
        return 'en';
    }

    /**
     * Get fallback reply when AI is unavailable
     */
    private getFallbackReply(request: GenerateRequest): GenerateResponse {
        const language = request.language || this.detectLanguage(request.comment);
        
        const fallbacks: Record<string, string> = {
            ar: 'شكراً لتعليقك! سنتواصل معك قريباً. 🙏',
            sv: 'Tack för din kommentar! Vi återkommer snart. 🙏',
            en: 'Thank you for your comment! We will get back to you soon. 🙏',
        };

        return {
            reply: fallbacks[language] || fallbacks['en'],
            language,
        };
    }
}

export const openaiService = new OpenAIService();


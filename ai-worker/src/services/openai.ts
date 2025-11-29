import OpenAI from 'openai';
import { config } from '../config';

export interface GenerateRequest {
    comment: string;
    language?: string;
    context?: {
        postMessage?: string;
        pageName?: string;
        previousReplies?: string[];
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
     * Generate a reply for a comment
     */
    async generateReply(request: GenerateRequest): Promise<GenerateResponse> {
        if (!this.client) {
            return this.getFallbackReply(request);
        }

        try {
            const systemPrompt = this.buildSystemPrompt(request);
            const userPrompt = this.buildUserPrompt(request);

            const completion = await this.client.chat.completions.create({
                model: config.openai.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
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
     * Build system prompt for the AI
     */
    private buildSystemPrompt(request: GenerateRequest): string {
        const pageName = request.context?.pageName || 'our page';
        const language = request.language || 'the same language as the comment';

        return `You are a friendly and professional social media manager for ${pageName}. 
Your task is to respond to customer comments on Facebook posts.

Guidelines:
- Be polite, helpful, and professional
- Keep responses concise (1-2 sentences)
- Respond in ${language}
- If the comment is positive, thank them warmly
- If the comment is a question, provide a helpful answer or offer to help via DM
- If the comment is negative, apologize and offer to resolve the issue
- Never be defensive or argumentative
- Use appropriate emojis sparingly (1-2 max)

Important: Only output the reply text, nothing else.`;
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


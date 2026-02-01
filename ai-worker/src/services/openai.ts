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
    intent?: string;
    confidence?: string;
    flags?: string[];
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

            const content = completion.choices[0]?.message?.content?.trim() || '';
            const detectedLanguage = this.detectLanguage(request.comment);

            // Parse structured JSON response; fall back to plain text if parsing fails
            let parsed: { reply: string; intent?: string; confidence?: string; flags?: string[] };
            try {
                parsed = JSON.parse(content);
            } catch {
                // AI returned plain text instead of JSON — use as reply directly
                parsed = { reply: content };
            }

            return {
                reply: parsed.reply || this.getFallbackReply(request).reply,
                language: request.language || detectedLanguage,
                tokensUsed: completion.usage?.total_tokens,
                intent: parsed.intent,
                confidence: parsed.confidence,
                flags: parsed.flags,
            };
        } catch (error) {
            // Log error using proper structure (will be handled by Fastify logger in production)
            // eslint-disable-next-line no-console
            if (process.env.NODE_ENV !== 'production') {
                console.error('OpenAI API error:', error);
            }
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

STEP 1 - IDENTIFY INTENT:
Before responding, classify the customer's message into one of these categories:
- QUESTION: Asking about product, service, price, hours, location, etc.
- COMPLIMENT: Positive feedback, praise, satisfaction
- COMPLAINT: Negative experience, frustration, problem report
- PURCHASE_INTENT: Wants to buy, order, or book something
- GREETING: Simple hello, hi, good morning
- BUSINESS_INQUIRY: Influencer, affiliate, partnership, collaboration, wholesale, sponsorship, or B2B request
- SPAM_OR_IRRELEVANT: Unrelated content, ads, random text

STEP 2 - RESPOND BASED ON INTENT:
- QUESTION → Search BUSINESS INFORMATION thoroughly. If found, answer confidently. If NOT found, say you'll check with the team.
- COMPLIMENT → Thank them warmly and express genuine appreciation.
- COMPLAINT → Apologize sincerely, acknowledge their concern, and offer to resolve via direct contact.
- PURCHASE_INTENT → Guide them on how to order or connect with the business directly.
- GREETING → Greet back briefly and ask how you can help.
- BUSINESS_INQUIRY → Thank them for their interest, express that the business is open to opportunities, and ask them to send a direct message or contact the business directly so the right person can follow up. Do NOT discuss terms, commissions, pricing, or make any commitments.
- SPAM_OR_IRRELEVANT → Reply with a brief, polite generic response.

RESPONSE GUIDELINES:
- Be polite, helpful, and professional
- Keep responses concise (1-3 sentences for comments, up to 4 for messages)
- Respond in ${language}
- Never be defensive or argumentative
- Use appropriate emojis sparingly (1-2 max)
- For Arabic messages: Reply in the SAME dialect the customer used. Match their style naturally (Egyptian, Levantine, Gulf, Maghrebi, Iraqi, or formal). Do NOT use formal Arabic when they use colloquial dialect.

CRITICAL SAFETY RULES (NEVER BREAK THESE):
- NEVER invent or guess prices, costs, or fees unless explicitly stated in the BUSINESS INFORMATION section
- NEVER make up availability, stock levels, or delivery dates
- NEVER invent dates, deadlines, schedules, or time-limited offers (e.g., "registration ends tomorrow") unless explicitly stated
- NEVER invent payment terms, installment plans, or included items (e.g., "books included", "transport provided") unless explicitly stated
- NEVER provide specific numbers (quantities, percentages, dimensions) unless given in context
- NEVER promise refunds, exchanges, or returns unless the policy is explicitly in BUSINESS INFORMATION
- NEVER provide medical, legal, or financial advice
- NEVER share personal data (phone numbers, emails, addresses) unless they are in BUSINESS INFORMATION
- NEVER commit to specific delivery times unless stated in BUSINESS INFORMATION
- NEVER make promises the business cannot verify ("guaranteed", "100% sure", "always available")
- NEVER discuss affiliate commissions, influencer deals, partnership terms, or sponsorship details — always redirect to direct contact
- If a customer seems very angry or threatens: only apologize and offer to connect them with a human
- If asked about pricing, dates, or details you don't have, say: "Please contact us directly for more details."
- When in doubt, redirect to human contact rather than guessing. Do NOT guess.

CONFIDENCE CHECK:
Before sending your reply, verify:
- Is every fact in your reply backed by BUSINESS INFORMATION? If not, remove it.
- Are you guessing anything? If yes, replace with "Please contact us for details."
- Could your reply be misleading? If yes, simplify it.`;

        // Add knowledge base if available
        if (knowledgeBase && knowledgeBase.trim().length > 0) {
            prompt += `

=== BUSINESS INFORMATION ===
${knowledgeBase}
=== END BUSINESS INFORMATION ===

Use the above business information to answer customer questions accurately. If a question is not covered, politely say you'll check and get back to them.`;
        }

        prompt += `

IMPORTANT: Output a JSON object with these fields:
- "reply": your reply text (string, no prefixes like "Reply:" or "Assistant:")
- "intent": the intent you classified (one of: QUESTION, COMPLIMENT, COMPLAINT, PURCHASE_INTENT, GREETING, BUSINESS_INQUIRY, SPAM_OR_IRRELEVANT)
- "confidence": how confident you are in your reply ("high", "medium", or "low")
- "flags": an array of flag strings if applicable (empty array [] if none):
  - "price_not_in_kb" if your reply mentions any price, cost, or fee NOT found in BUSINESS INFORMATION
  - "angry_customer" if the customer seems angry, frustrated, or threatening
  - "low_confidence" if you are uncertain about your reply
  - "redirect_to_human" if you advised the customer to contact a human
Output ONLY the JSON object, nothing else.`;

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
        const isConversation = request.context?.conversationHistory && request.context.conversationHistory.length > 0;

        const commentFallbacks: Record<string, string> = {
            ar: 'شكراً لتواصلك معنا! سيقوم فريقنا بالرد عليك قريباً.',
            sv: 'Tack för att du kontaktar oss! Vårt team återkommer snart.',
            en: 'Thank you for reaching out! Our team will get back to you shortly.',
        };

        const messageFallbacks: Record<string, string> = {
            ar: 'شكراً لرسالتك! سنرد عليك في أقرب وقت ممكن. إذا كان استفسارك عاجلاً، يمكنك التواصل معنا مباشرة.',
            sv: 'Tack för ditt meddelande! Vi återkommer så snart som möjligt. Om ditt ärende är brådskande, kontakta oss direkt.',
            en: 'Thank you for your message! We\'ll respond as soon as possible. If your inquiry is urgent, feel free to contact us directly.',
        };

        const fallbacks = isConversation ? messageFallbacks : commentFallbacks;

        return {
            reply: fallbacks[language] || fallbacks['en'],
            language,
            confidence: 'low',
            flags: ['fallback_reply'],
        };
    }
}

export const openaiService = new OpenAIService();


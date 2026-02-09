import OpenAI from 'openai';
import { config } from '../config';

// Token budget constants
const KB_MAX_CHARS = 1500;       // ~400 tokens — prevents catalog-sized KB from nuking costs
const MAX_INPUT_TOKENS = 2000;   // Hard cap on total input tokens (system + history + user message)
const PROMPT_VERSION = 'v3';     // Bump when prompt structure changes (useful for cache diagnostics)

/** Conservative token estimate: ~3.5 chars per token (safe across Latin + Arabic) */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

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

interface TokenInfo {
    estimated_tokens_in: number;
    max_input_tokens: number;
    history_count: number;
    kb_truncated: boolean;
    kb_original_chars: number;
    prompt_version: string;
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
            const { messages, tokenInfo } = this.buildMessages(request, systemPrompt);

            // Log token usage for observability
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({ event: 'ai_call_token_usage', ...tokenInfo }));

            const completion = await this.client.chat.completions.create({
                model: config.openai.model,
                messages,
                max_tokens: config.openai.maxTokens,
                temperature: config.openai.temperature,
                response_format: { type: 'json_object' },
            });

            const content = completion.choices[0]?.message?.content?.trim() || '';
            const detectedLanguage = this.detectLanguage(request.comment);

            // Parse structured JSON response; fall back to plain text if parsing fails
            let parsed: { reply: string; intent?: string; confidence?: string; flags?: string[] };
            try {
                parsed = JSON.parse(content);
            } catch {
                // AI returned plain text instead of JSON — flag for triage
                parsed = {
                    reply: content,
                    intent: 'UNKNOWN',
                    confidence: 'low',
                    flags: ['invalid_json'],
                };
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
     * Build messages array including conversation history, trimmed to token budget
     */
    private buildMessages(request: GenerateRequest, systemPrompt: string): { messages: OpenAI.ChatCompletionMessageParam[]; tokenInfo: TokenInfo } {
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
        ];

        // Collect history messages separately so we can trim them
        const historyMessages: OpenAI.ChatCompletionMessageParam[] = [];
        if (request.context?.conversationHistory && request.context.conversationHistory.length > 0) {
            for (const msg of request.context.conversationHistory) {
                historyMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content,
                });
            }
        }

        const userPrompt = this.buildUserPrompt(request);
        const userMessage: OpenAI.ChatCompletionMessageParam = { role: 'user', content: userPrompt };

        // Calculate token usage and trim history if over budget
        const systemTokens = estimateTokens(systemPrompt);
        const userTokens = estimateTokens(userPrompt);
        let historyTokens = historyMessages.reduce((sum, m) => sum + estimateTokens(m.content as string), 0);
        let totalTokens = systemTokens + historyTokens + userTokens;

        // Trim oldest history messages first until under budget
        while (totalTokens > MAX_INPUT_TOKENS && historyMessages.length > 0) {
            const removed = historyMessages.shift()!;
            const removedTokens = estimateTokens(removed.content as string);
            historyTokens -= removedTokens;
            totalTokens -= removedTokens;
        }

        messages.push(...historyMessages, userMessage);

        const knowledgeBase = request.context?.knowledgeBase || '';
        const tokenInfo: TokenInfo = {
            estimated_tokens_in: totalTokens,
            max_input_tokens: MAX_INPUT_TOKENS,
            history_count: historyMessages.length,
            kb_truncated: knowledgeBase.length > KB_MAX_CHARS,
            kb_original_chars: knowledgeBase.length,
            prompt_version: PROMPT_VERSION,
        };

        return { messages, tokenInfo };
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
- OFFENSIVE: Insults, profanity, disrespectful or abusive language directed at the page or business
- SPAM_OR_IRRELEVANT: Unrelated content, ads, random text

STEP 2 - RESPOND BASED ON INTENT:
- QUESTION → Search BUSINESS INFORMATION thoroughly. If found, answer confidently. If NOT found, say you'll check with the team and get back to them.
- COMPLIMENT → Thank them warmly and express genuine appreciation.
- COMPLAINT → Apologize sincerely, acknowledge their concern, and offer to help resolve the issue.
- PURCHASE_INTENT → Guide them on how to order or connect with the business. Share any contact info from BUSINESS INFORMATION if available.
- GREETING → Greet back briefly and ask how you can help.
- BUSINESS_INQUIRY → Thank them for their interest, express that the business is open to opportunities, and ask them to send details so the right person can follow up. Do NOT discuss terms, commissions, pricing, or make any commitments.
- OFFENSIVE → Reply briefly and calmly. Do NOT engage, argue, or mirror the tone.
- SPAM_OR_IRRELEVANT → Reply with a brief, polite generic response.

RESPONSE GUIDELINES:
- Be polite, helpful, and professional
- Keep responses concise (1-3 sentences for comments, up to 4 for messages)
- Respond in ${language}
- Never be defensive or argumentative
- Use appropriate emojis sparingly (1-2 max)
- For Arabic messages: Reply in the SAME dialect the customer used. Match their style naturally (Egyptian, Levantine, Gulf, Maghrebi, Iraqi, or formal). Do NOT use formal Arabic when they use colloquial dialect.
- IMPORTANT: You ARE the business's page assistant talking to customers via Messenger or comments. When you say "contact us" or "message us", you ARE the contact point. Do NOT tell customers to "contact us directly" or "send a DM" when they are ALREADY talking to you in a DM. Instead, ask them for the details you need right here in the conversation.
- If a customer asks for contact info (phone, email, address) and it IS in BUSINESS INFORMATION, share it. If it is NOT in BUSINESS INFORMATION, say you'll get that info for them and someone from the team will follow up.

CRITICAL SAFETY RULES (NEVER BREAK THESE):
- NEVER invent or guess prices, costs, or fees unless explicitly stated in the BUSINESS INFORMATION section
- NEVER make up availability, stock levels, or delivery dates
- NEVER invent dates, deadlines, schedules, or time-limited offers (e.g., "registration ends tomorrow") unless explicitly stated
- NEVER invent payment terms, installment plans, or included items (e.g., "books included", "transport provided") unless explicitly stated
- NEVER provide specific numbers (quantities, percentages, dimensions) unless given in context
- NEVER promise refunds, exchanges, or returns unless the policy is explicitly in BUSINESS INFORMATION
- NEVER provide medical, legal, or financial advice
- NEVER share personal customer data. Business contact info (phone, email, address) from BUSINESS INFORMATION is OK to share.
- NEVER commit to specific delivery times unless stated in BUSINESS INFORMATION
- NEVER make promises the business cannot verify ("guaranteed", "100% sure", "always available")
- NEVER discuss affiliate commissions, influencer deals, partnership terms, or sponsorship details — always redirect to direct contact
- If a customer seems very angry or threatens: only apologize and offer to connect them with a human
- If asked about pricing, dates, or details you don't have, say: "Let me check with the team and get back to you on that."
- When in doubt, say you'll confirm with the team rather than guessing. Do NOT guess.
- If a customer asks about a specific product and you cannot find it clearly in BUSINESS INFORMATION, do NOT guess or assume. Instead reply: "Let me check that for you! Can you send the product name or a photo?"
- NEVER confirm availability, price, or size unless it is explicitly listed in BUSINESS INFORMATION.
- If the product seems similar but you're not 100% sure, ask for clarification rather than guessing.

CONFIDENCE CHECK:
Before sending your reply, verify:
- Is every fact in your reply backed by BUSINESS INFORMATION? If not, remove it.
- Are you guessing anything? If yes, replace with "Please contact us for details."
- Could your reply be misleading? If yes, simplify it.`;

        // Add knowledge base if available (capped to prevent runaway costs)
        if (knowledgeBase && knowledgeBase.trim().length > 0) {
            const kbTruncated = knowledgeBase.length > KB_MAX_CHARS;
            const effectiveKB = kbTruncated
                ? knowledgeBase.slice(0, KB_MAX_CHARS) + '\n[...]'
                : knowledgeBase;

            prompt += `

=== BUSINESS INFORMATION ===
${effectiveKB}
=== END BUSINESS INFORMATION ===

Use the above business information to answer customer questions accurately. If a question is not covered, politely say you'll check and get back to them.`;
        }

        prompt += `

IMPORTANT: Output a JSON object with these fields:
- "reply": your reply text (string, no prefixes like "Reply:" or "Assistant:")
- "intent": the intent you classified (one of: QUESTION, COMPLIMENT, COMPLAINT, PURCHASE_INTENT, GREETING, BUSINESS_INQUIRY, OFFENSIVE, SPAM_OR_IRRELEVANT)
- "confidence": how confident you are in your reply ("high", "medium", or "low")
- "flags": an array of flag strings if applicable (empty array [] if none):
  - "price_not_in_kb" if your reply mentions any price, cost, or fee NOT found in BUSINESS INFORMATION
  - "angry_customer" if the customer seems angry, frustrated, or threatening
  - "offensive_or_abusive" if the message contains insults, profanity, slurs, or disrespectful language
  - "low_confidence" if you are uncertain about your reply
  - "redirect_to_human" if you advised the customer to contact a human
Output ONLY the JSON object, nothing else.`;

        return prompt;
    }

    /**
     * Build user prompt with the comment or message
     */
    private buildUserPrompt(request: GenerateRequest): string {
        const isConversation = request.context?.conversationHistory && request.context.conversationHistory.length > 0;
        const label = isConversation ? 'Message' : 'Comment';
        let prompt = `${label}: "${request.comment}"`;

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
        const pageName = request.context?.pageName;

        const commentFallbacks: Record<string, string> = pageName
            ? {
                ar: `شكراً لتواصلك مع ${pageName}! سيقوم فريقنا بالرد عليك قريباً.`,
                sv: `Tack för att du kontaktar ${pageName}! Vårt team återkommer snart.`,
                en: `Thank you for reaching out to ${pageName}! Our team will get back to you shortly.`,
            }
            : {
                ar: 'شكراً لتواصلك معنا! سيقوم فريقنا بالرد عليك قريباً.',
                sv: 'Tack för att du kontaktar oss! Vårt team återkommer snart.',
                en: 'Thank you for reaching out! Our team will get back to you shortly.',
            };

        const messageFallbacks: Record<string, string> = pageName
            ? {
                ar: `شكراً لرسالتك إلى ${pageName}! سنرد عليك في أقرب وقت ممكن.`,
                sv: `Tack för ditt meddelande till ${pageName}! Vi återkommer så snart som möjligt.`,
                en: `Thank you for your message to ${pageName}! We'll respond as soon as possible.`,
            }
            : {
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


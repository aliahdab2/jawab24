import { rulesService } from '../rules';
import { templatesService } from '../templates';
import { aiService } from '../ai';
import { messagesService } from '../messages';
import { subscriptionsService } from '../subscriptions';
import { postsService } from '../posts';
import { AiGenerateResponse, Logger, noopLogger } from '../../types';

/** Flags/intents that should cause the pipeline to skip auto-replying */
export const SKIP_REPLY_FLAGS = ['offensive_or_abusive', 'offensive'] as const;
export const SAFE_FALLBACK_FLAGS = ['price_not_in_kb'] as const;
export const SKIP_REPLY_INTENTS = ['OFFENSIVE'] as const;

export function shouldSkipReply(flagReason?: string, aiIntent?: string): boolean {
    if (!flagReason && !aiIntent) return false;
    const flags = (flagReason || '').split(',').map(f => f.trim());
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return flags.some(f => (SKIP_REPLY_FLAGS as readonly string[]).includes(f)) ||
           (SKIP_REPLY_INTENTS as readonly string[]).includes(normalizedIntent);
}

export function shouldUseFallback(flagReason?: string): boolean {
    if (!flagReason) return false;
    const flags = flagReason.split(',').map(f => f.trim());
    return flags.some(f => (SAFE_FALLBACK_FLAGS as readonly string[]).includes(f));
}

/** Safe fallback replies when AI hallucinates pricing */
export const PRICE_FALLBACK: Record<string, string> = {
    ar: 'شكراً لاهتمامك! خليني أتأكد من تفاصيل الأسعار وبرجعلك بأقرب وقت.',
    en: 'Thank you for your interest! Let me confirm the pricing details and get back to you shortly.',
};

export interface GenerateReplyContext {
    userId: string;
    text: string;
    pageName?: string;
    knowledgeBase?: string;
    // For comments
    postId?: string;
    postMessage?: string;
    pageId?: string;
    accessToken?: string;
    // For messages
    senderId?: string;
}

export interface GenerateReplyResult {
    replyText: string | null;
    replyMethod: 'template' | 'ai';
    templateId?: string;
    needsAttention?: boolean;
    flagReason?: string;
    aiIntent?: string;
}

/**
 * Reply Generator Service
 * Handles the logic of generating reply text from templates or AI
 * Platform-agnostic: works for Facebook, Instagram, and Shopify-linked pages
 */
export class ReplyGenerator {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Generate a reply for a comment
     * Tries template first, then AI if enabled
     */
    async generateForComment(
        context: GenerateReplyContext,
        aiEnabled: boolean
    ): Promise<GenerateReplyResult> {
        const { userId, text, pageName, knowledgeBase, postId, pageId, accessToken } = context;

        // 1. Try to find a matching rule with template
        const templateResult = await this.tryTemplateMatch(userId, text);
        if (templateResult) return templateResult;

        // 2. If no template, use AI if enabled
        if (aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                return { replyText: 'Thank you for your comment!', replyMethod: 'template', needsAttention: false };
            }

            // Fetch post content lazily if needed
            let postMessage = context.postMessage;
            if (!postMessage && postId && pageId && accessToken) {
                this.logger.debug('[Generator] Fetching post content for AI context');
                const post = await postsService.findOrCreateFromWebhook(
                    pageId, postId, undefined, accessToken
                );
                postMessage = post.message || undefined;
            }

            const aiResponse = await aiService.generateReply({
                comment: text,
                context: { pageId, pageName, postMessage, knowledgeBase }
            });

            return this.processAiResponse(aiResponse, userId, pageId);
        }

        // 3. Fallback
        this.logger.debug('[Generator] Using fallback reply');
        return { replyText: 'Thank you for your comment!', replyMethod: 'template', needsAttention: false };
    }

    /**
     * Generate a reply for a private message
     * Tries template first, then AI with conversation context
     */
    async generateForMessage(
        context: GenerateReplyContext,
        aiEnabled: boolean
    ): Promise<GenerateReplyResult> {
        const { userId, text, pageName, knowledgeBase, pageId, senderId } = context;

        // 1. Try to find a matching rule with template
        const templateResult = await this.tryTemplateMatch(userId, text);
        if (templateResult) return templateResult;

        // 2. If no template, use AI with conversation context
        if (aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                return { replyText: 'Thank you for your message! We will get back to you soon.', replyMethod: 'template', needsAttention: false };
            }

            if (pageId && senderId) {
                const conversationHistory = await messagesService.getConversationHistory(pageId, senderId, 6);

                const aiResponse = await aiService.generateReply({
                    comment: text,
                    context: { pageId, pageName, knowledgeBase, conversationHistory }
                });

                return this.processAiResponse(aiResponse, userId, pageId);
            }
        }

        return { replyText: null, replyMethod: 'ai', needsAttention: false };
    }

    /**
     * Try to match a template rule — shared across all platforms
     */
    private async tryTemplateMatch(userId: string, text: string): Promise<GenerateReplyResult | null> {
        const matchingRule = await rulesService.findMatchingRule(userId, text);

        if (matchingRule?.templateId) {
            const template = await templatesService.getTemplate(userId, matchingRule.templateId);

            if (template?.translations) {
                const translations = template.translations as Record<string, string>;
                const replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                this.logger.debug('[Generator] Using template', { templateName: template.name });
                return { replyText, replyMethod: 'template', templateId: template.id, needsAttention: false };
            }
        }

        return null;
    }

    /**
     * Process AI response — shared flagging, usage tracking, and cost logging
     * Works identically for Facebook comments, Instagram comments, and DMs
     */
    private async processAiResponse(
        aiResponse: AiGenerateResponse,
        userId: string,
        pageId?: string
    ): Promise<GenerateReplyResult> {
        const flags = aiResponse.flags || [];
        const needsAttention = flags.length > 0 ||
            aiResponse.confidence === 'low' ||
            aiResponse.intent === 'COMPLAINT' ||
            aiResponse.intent === 'OFFENSIVE';
        const flagReason = flags.join(',') ||
            (aiResponse.intent === 'COMPLAINT' ? 'complaint' : null) ||
            (aiResponse.intent === 'OFFENSIVE' ? 'offensive' : null) ||
            undefined;

        await subscriptionsService.incrementAiReplies(userId);

        // Log token usage for cost tracking (skip for cached responses)
        if (!aiResponse.cached) {
            await subscriptionsService.logAiUsage(userId, pageId, aiResponse.tokensUsed, aiResponse.model || 'gpt-4o-mini');
        }

        return {
            replyText: aiResponse.reply,
            replyMethod: 'ai',
            needsAttention,
            flagReason,
            aiIntent: aiResponse.intent,
        };
    }
}

export const replyGenerator = new ReplyGenerator();

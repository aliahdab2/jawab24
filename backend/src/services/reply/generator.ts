import { rulesService } from '../rules';
import { templatesService } from '../templates';
import { aiService } from '../ai';
import { messagesService } from '../messages';
import { subscriptionsService } from '../subscriptions';
import { postsService } from '../posts';
import { Logger, noopLogger } from '../../types';

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

        let replyText: string | null = null;
        let replyMethod: 'template' | 'ai' = 'ai';
        let templateId: string | undefined;

        // 1. Try to find a matching rule with template
        const matchingRule = await rulesService.findMatchingRule(userId, text);

        if (matchingRule?.templateId) {
            const template = await templatesService.getTemplate(userId, matchingRule.templateId);

            if (template?.translations) {
                const translations = template.translations as Record<string, string>;
                replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                replyMethod = 'template';
                templateId = template.id;
                this.logger.debug('[Generator] Using template', { templateName: template.name });
            }
        }

        // 2. If no template, use AI if enabled
        if (!replyText && aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                replyText = 'Thank you for your comment!';
                replyMethod = 'template';
            } else {
                // Fetch post content lazily if needed
                let postMessage = context.postMessage;
                if (!postMessage && postId && pageId && accessToken) {
                    this.logger.debug('[Generator] Fetching post content for AI context');
                    const post = await postsService.findOrCreateFromWebhook(
                        pageId, 
                        postId, 
                        undefined, 
                        accessToken
                    );
                    postMessage = post.message || undefined;
                }

                const aiResponse = await aiService.generateReply({
                    comment: text,
                    context: {
                        pageId,
                        pageName,
                        postMessage,
                        knowledgeBase,
                    }
                });
                replyText = aiResponse.reply;
                replyMethod = 'ai';

                // Determine flagging from AI metadata
                const flags = aiResponse.flags || [];
                const needsAttention = flags.length > 0 ||
                    aiResponse.confidence === 'low' ||
                    aiResponse.intent === 'COMPLAINT' ||
                    aiResponse.intent === 'OFFENSIVE';
                const flagReason = flags.join(',') ||
                    (aiResponse.intent === 'COMPLAINT' ? 'complaint' : null) ||
                    (aiResponse.intent === 'OFFENSIVE' ? 'offensive' : null) ||
                    undefined;
                const aiIntent = aiResponse.intent;

                await subscriptionsService.incrementAiReplies(userId);

                return { replyText, replyMethod, templateId, needsAttention, flagReason, aiIntent };
            }
        }

        // 3. Fallback if still no reply
        if (!replyText) {
            replyText = 'Thank you for your comment!';
            replyMethod = 'template';
            this.logger.debug('[Generator] Using fallback reply');
        }

        return { replyText, replyMethod, templateId, needsAttention: false };
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

        let replyText: string | null = null;
        let replyMethod: 'template' | 'ai' = 'ai';

        // 1. Try to find a matching rule with template
        const matchingRule = await rulesService.findMatchingRule(userId, text);

        if (matchingRule?.templateId) {
            const template = await templatesService.getTemplate(userId, matchingRule.templateId);

            if (template?.translations) {
                const translations = template.translations as Record<string, string>;
                replyText = translations['en'] || translations['ar'] || Object.values(translations)[0];
                replyMethod = 'template';
            }
        }

        // 2. If no template, use AI with conversation context
        if (!replyText && aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                replyText = 'Thank you for your message! We will get back to you soon.';
                replyMethod = 'template';
            } else if (pageId && senderId) {
                // Get conversation history for context
                const conversationHistory = await messagesService.getConversationHistory(
                    pageId,
                    senderId,
                    6
                );

                const aiResponse = await aiService.generateReply({
                    comment: text,
                    context: {
                        pageId,
                        pageName,
                        knowledgeBase,
                        conversationHistory,
                    }
                });
                replyText = aiResponse.reply;
                replyMethod = 'ai';

                // Determine flagging from AI metadata
                const flags = aiResponse.flags || [];
                const needsAttention = flags.length > 0 ||
                    aiResponse.confidence === 'low' ||
                    aiResponse.intent === 'COMPLAINT' ||
                    aiResponse.intent === 'OFFENSIVE';
                const flagReason = flags.join(',') ||
                    (aiResponse.intent === 'COMPLAINT' ? 'complaint' : null) ||
                    (aiResponse.intent === 'OFFENSIVE' ? 'offensive' : null) ||
                    undefined;
                const aiIntent = aiResponse.intent;

                await subscriptionsService.incrementAiReplies(userId);

                return { replyText, replyMethod, needsAttention, flagReason, aiIntent };
            }
        }

        return { replyText, replyMethod, needsAttention: false };
    }
}

export const replyGenerator = new ReplyGenerator();

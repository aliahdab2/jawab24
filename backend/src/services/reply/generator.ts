import { rulesService } from '../rules';
import { templatesService } from '../templates';
import { aiService } from '../ai';
import { messagesService } from '../messages';
import { subscriptionsService } from '../subscriptions';
import { postsService } from '../posts';
import { config } from '../../config';
import { AiGenerateResponse, RetrievedChunkContext, Logger, noopLogger } from '../../types';
import { RetrievalService } from '../kb/retrieval';
import { OpenAIEmbeddingProvider } from '../kb/embedding';
import { gapDetectorService } from '../kb/gap-detector';
import { detectLanguageCode } from '../../utils/language';

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
    /** Text to use for template keyword matching (latest message only).
     *  Falls back to `text` if not provided. */
    templateMatchText?: string;
    pageName?: string;
    knowledgeBase?: string;
    kbActiveVersion?: number | null;
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

/** Lazy-init retrieval service (only created when RAG_MODE != 'off' and OPENAI_API_KEY exists) */
let _retrievalService: RetrievalService | null = null;
function getRetrievalService(): RetrievalService | null {
    if (!config.ragMode || config.ragMode === 'off') return null;
    if (!config.openai?.apiKey) return null;
    if (!_retrievalService) {
        const embeddingProvider = new OpenAIEmbeddingProvider(config.openai.apiKey);
        _retrievalService = new RetrievalService(embeddingProvider);
    }
    return _retrievalService;
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

            // Run RAG retrieval if enabled
            const { retrievedChunks, effectiveKB, queryEmbedding } = await this.resolveKnowledge(
                pageId, text, knowledgeBase, context.kbActiveVersion, 'comment',
            );

            const aiResponse = await aiService.generateReply({
                comment: text,
                context: { pageId, pageName, postMessage, knowledgeBase: effectiveKB, retrievedChunks, channel: 'comment', kbActiveVersion: context.kbActiveVersion, queryEmbedding }
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
        // Use templateMatchText (latest message) for keyword matching to avoid
        // stale consolidated messages hijacking the user's current intent.
        const templateResult = await this.tryTemplateMatch(userId, context.templateMatchText || text);
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

                // Run RAG retrieval if enabled
                const { retrievedChunks, effectiveKB, queryEmbedding } = await this.resolveKnowledge(
                    pageId, text, knowledgeBase, context.kbActiveVersion, 'dm',
                );

                const aiResponse = await aiService.generateReply({
                    comment: text,
                    context: { pageId, pageName, knowledgeBase: effectiveKB, retrievedChunks, channel: 'dm', conversationHistory, kbActiveVersion: context.kbActiveVersion, queryEmbedding }
                });

                return this.processAiResponse(aiResponse, userId, pageId);
            }
        }

        return { replyText: null, replyMethod: 'ai', needsAttention: false };
    }

    /**
     * Resolve knowledge: run RAG retrieval if enabled, otherwise fall back to static KB.
     *
     * RAG_MODE behavior:
     * - 'off': returns static KB, no retrieval
     * - 'shadow': runs retrieval + logs results, but still sends static KB to GPT
     * - 'on': runs retrieval, sends chunks to GPT (static KB omitted)
     */
    private async resolveKnowledge(
        pageId: string | undefined,
        query: string,
        staticKB: string | undefined,
        kbActiveVersion: number | null | undefined,
        channel: 'comment' | 'dm',
    ): Promise<{ retrievedChunks?: RetrievedChunkContext[]; effectiveKB?: string; queryEmbedding?: number[] }> {
        const retrieval = getRetrievalService();

        // No retrieval possible: missing service, pageId, or active version
        if (!retrieval || !pageId || kbActiveVersion === null || kbActiveVersion === undefined) {
            return { effectiveKB: staticKB };
        }

        try {
            retrieval.setLogger(this.logger);
            const { chunks, queryEmbedding } = await retrieval.retrieve(pageId, query, kbActiveVersion);

            if (chunks.length === 0) {
                this.logger.debug('[Generator] RAG returned no chunks, using static KB', { pageId, channel });

                // Fire-and-forget: record KB gap for merchant insights
                gapDetectorService.setLogger(this.logger);
                gapDetectorService.recordGap(pageId, query).catch(err => {
                    this.logger.error('[Generator] Gap detection error', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                });

                return { effectiveKB: staticKB, queryEmbedding };
            }

            const retrievedChunks: RetrievedChunkContext[] = chunks.map(c => ({
                type: c.type,
                title: c.title,
                content: c.content,
                score: c.finalScore,
            }));

            if (config.ragMode === 'shadow') {
                // Shadow mode: log what RAG would have returned but use static KB for actual reply
                this.logger.info('[Generator] RAG shadow mode — retrieval completed', {
                    pageId, channel,
                    chunkCount: retrievedChunks.length,
                    topScore: retrievedChunks[0]?.score,
                    topChunkType: retrievedChunks[0]?.type,
                });
                return { effectiveKB: staticKB, queryEmbedding };
            }

            // RAG_MODE = 'on': use chunks, omit static KB
            return { retrievedChunks, effectiveKB: undefined, queryEmbedding };
        } catch (error) {
            this.logger.error('[Generator] RAG retrieval failed, falling back to static KB', {
                pageId, error: error instanceof Error ? error.message : String(error),
            });
            return { effectiveKB: staticKB };
        }
    }

    /**
     * Try to match a template rule — shared across all platforms
     */
    private async tryTemplateMatch(userId: string, text: string): Promise<GenerateReplyResult | null> {
        const matchingRule = await rulesService.findMatchingRule(userId, text);

        if (matchingRule?.templateId) {
            const template = await templatesService.getTemplate(userId, matchingRule.templateId);

            if (template?.message && template.active !== false) {
                this.logger.debug('[Generator] Using template', { templateName: template.name });
                return { replyText: template.message, replyMethod: 'template', templateId: template.id, needsAttention: false };
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

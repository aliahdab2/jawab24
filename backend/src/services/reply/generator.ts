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
import { gapDetectorService, type GapSource } from '../kb/gap-detector';
import { DEFAULT_AI_MODEL, normalizeAiIntent } from '@jawab24/shared';
import { detectLanguageCode, detectCommentLanguage } from '../../utils/language';
import { countContentWords } from '../../utils/text';

// Messages longer than this many content words are assumed to have complex/
// multi-intent context. Template keyword matching on them produces false positives
// (e.g. "كلمة السر لنظام التسجيل" containing تسجيل keyword), so they go straight to AI.
// Threshold of 6 covers the longest natural short-query pattern:
//   "السلام عليكم كم سعر الدورة" (5 words) → correctly hits template
//   "أنا ناسي كلمة السر لنظام التسجيل ممكن تساعدوني" (8 words) → correctly skips to AI
const TEMPLATE_WORD_LIMIT = 6;

/** Flags/intents that should cause the pipeline to skip auto-replying.
 *  NOTE: low_confidence is intentionally NOT here — a low-confidence reply
 *  is still better than no reply at all. It gets flagged for review instead. */
export const SKIP_REPLY_FLAGS = ['offensive_or_abusive', 'offensive'] as const;
export const SAFE_FALLBACK_FLAGS = ['price_not_in_kb'] as const;
export const SKIP_REPLY_INTENTS = ['OFFENSIVE', 'SPAM_OR_IRRELEVANT'] as const;

/** Intents that skip silently — no needsAttention flag, no notification.
 *  Tagging someone, emoji-only, "follow me", etc. are irrelevant noise.
 *  Offensive content is excluded — it warrants merchant awareness. */
export const SILENT_SKIP_INTENTS = ['SPAM_OR_IRRELEVANT'] as const;

export function shouldSkipReply(flagReason?: string, aiIntent?: string): boolean {
    if (!flagReason && !aiIntent) return false;
    const flags = (flagReason || '').split(',').map(f => f.trim());
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return flags.some(f => (SKIP_REPLY_FLAGS as readonly string[]).includes(f)) ||
           (SKIP_REPLY_INTENTS as readonly string[]).includes(normalizedIntent);
}

/** Returns true when the skip should be completely silent — no flag, no notification.
 *  Used for spam/irrelevant comments that don't warrant merchant attention. */
export function shouldSilentlySkip(aiIntent?: string): boolean {
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return (SILENT_SKIP_INTENTS as readonly string[]).includes(normalizedIntent);
}

export function shouldUseFallback(flagReason?: string): boolean {
    if (!flagReason) return false;
    const flags = flagReason.split(',').map(f => f.trim());
    return flags.some(f => (SAFE_FALLBACK_FLAGS as readonly string[]).includes(f));
}

/** Determine if a message needs human attention based on flags and intent.
 *  For non-question intents (GREETING, COMPLIMENT, SPAM_OR_IRRELEVANT), a low_confidence
 *  flag alone is normal — no human review needed. Only meaningful flags (info_not_in_kb,
 *  price_not_in_kb, etc.) or attention-worthy intents (COMPLAINT, OFFENSIVE) trigger review.
 *  language_mismatch is also excluded for non-question intents — punctuation/emoji engagement
 *  comments (e.g. ".") have no language signal so the AI sometimes replies in the wrong language,
 *  but a GREETING/COMPLIMENT reply doesn't need merchant review regardless of language. */
const QUESTION_LIKE_INTENTS = new Set(['QUESTION', 'BUSINESS_INQUIRY', 'PURCHASE_INTENT']);
const ATTENTION_EXEMPT_FLAGS = new Set(['low_confidence', 'language_mismatch']);
export function computeNeedsAttention(flags: string[], normalizedIntent: string | undefined): boolean {
    const intent = normalizedIntent || '';
    const meaningfulFlags = QUESTION_LIKE_INTENTS.has(intent)
        ? flags.length > 0
        : flags.some(f => !ATTENTION_EXEMPT_FLAGS.has(f) && !f.startsWith('expected_lang:') && !f.startsWith('reply_lang:'));
    return meaningfulFlags ||
        intent === 'COMPLAINT' ||
        intent === 'OFFENSIVE';
}

import { t } from '../../utils/i18n';

/** Safe fallback replies when AI hallucinates pricing */
export const PRICE_FALLBACK: Record<string, string> = {
    ar: t('priceFallback', 'ar'),
    en: t('priceFallback', 'en'),
};

export interface GenerateReplyContext {
    workspaceId: string;
    userId: string;       // kept for billing (subscription checks)
    text: string;
    /** Text to use for template keyword matching (latest message only).
     *  Falls back to `text` if not provided. */
    templateMatchText?: string;
    pageName?: string;
    knowledgeBase?: string;
    kbActiveVersion?: number | null;
    storePolicies?: string;
    productCatalog?: string;
    // For comments
    postId?: string;
    postMessage?: string;
    pageId?: string;
    accessToken?: string;
    // For messages
    senderId?: string;
    senderName?: string;
    // Reply customization
    replyStyle?: string;
    brandVoiceNotes?: string;
    // E-commerce tools (DMs only)
    ecommerceStoreId?: string;
}

export type CommentReplyMode = 'public' | 'private' | 'dual';

export interface GenerateReplyResult {
    replyText: string | null;
    replyMethod: 'template' | 'ai';
    templateId?: string;
    templateName?: string;
    needsAttention?: boolean;
    flagReason?: string;
    aiIntent?: string;
    confidence?: string;
}

export interface PlaygroundInput {
    pageId: string;
    userId?: string;
    workspaceId: string | null;
    question: string;
    /** Effective channel after applying commentReplyMode (dual/private → dm) */
    channel: 'comment' | 'dm';
    knowledgeBase?: string;
    kbActiveVersion?: number | null;
    pageName?: string;
    productCatalog?: string;
    storePolicies?: string;
    postMessage?: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    brandVoiceNotes?: string;
    customerContext?: string;
    model?: string;
}

export interface PlaygroundResult {
    reply: string | null;
    replyMethod: 'template' | 'ai' | 'skipped';
    templateName: string | null;
    ragMode: string;
    chunksRetrieved: number;
    chunks: RetrievedChunkContext[];
    intent: string | null;
    confidence: string | null;
    flags: string[];
    needsAttention: boolean;
    cached: boolean;
    detectedLanguage: string | null;
    tokensUsed: number;
    model: string | null;
    gapRecorded: boolean;
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
     *
     * @param commentReplyMode - When 'dual' or 'private', AI generates a detailed
     *   DM-style reply (with prices, specs, etc.) because the reply will be sent
     *   as a private message, not as a public comment.
     */
    async generateForComment(
        context: GenerateReplyContext,
        aiEnabled: boolean,
        commentReplyMode: CommentReplyMode = 'public',
    ): Promise<GenerateReplyResult> {
        const { workspaceId, userId, text, pageName, knowledgeBase, postId, pageId, accessToken, postMessage: contextPostMessage } = context;

        // Strip platform noise from comment text before language detection and AI processing.
        // Both @mentions and URLs contain Latin chars that pollute language detection
        // (e.g. "@Ali Ahdab" or "https://example.com" on an Arabic page → incorrectly 'en').
        // They also carry no message content the AI should respond to.
        const commentForAI = this.stripCommentNoise(text);

        // Punctuation/emoji-only comment (dots, emojis, symbols) with no post context = spam.
        // If postMessage is present, pass to AI — it has the full post text to judge whether
        // this was an intentional engagement response. The exact-match cache means the AI call
        // only happens once per (comment, post) pair regardless of how many people comment the same dot.
        if (!commentForAI && !contextPostMessage) {
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }
        if (commentForAI && this.isPunctuationOnly(commentForAI) && !contextPostMessage) {
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }

        // 1. Try to find a matching rule with template (skip if page has a store — AI answers with product context)
        if (!context.ecommerceStoreId) {
            const templateResult = await this.tryTemplateMatch(workspaceId, text);
            if (templateResult) return templateResult;
        }

        // 3. If no template, use AI if enabled
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

            // When reply mode is dual or private, the AI reply will be sent as a DM,
            // so use 'dm' channel to get a detailed answer (with prices, specs, etc.)
            // instead of the brief "message us" comment-style reply.
            const effectiveChannel: 'comment' | 'dm' = (commentReplyMode === 'dual' || commentReplyMode === 'private') ? 'dm' : 'comment';

            // Build gap source context for merchant insights
            const gapSource: GapSource = { type: 'comment', context: postMessage };

            // Run RAG retrieval if enabled (use stripped text for better semantic matching)
            const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge(
                pageId, commentForAI || text, knowledgeBase, context.kbActiveVersion, effectiveChannel, undefined, !!context.productCatalog,
            );

            // Language detection: use stripped text only — never fall back to raw text.
            // Empty commentForAI (mention/URL-only comment) returns 'unknown', which correctly
            // triggers the post-content fallback below instead of locking in 'en'.
            const effectiveLang = detectCommentLanguage(commentForAI, postMessage);

            // Pass commenter name as customerContext (same as DMs) so the AI addresses
            // the actual commenter, not a name extracted from an @mention.
            const customerContext = context.senderName ? `Customer name: ${context.senderName}.` : undefined;

            const aiResponse = await aiService.generateReply({
                comment: commentForAI,
                language: effectiveLang !== 'unknown' ? effectiveLang : undefined,
                context: { userId, pageId, pageName, postMessage, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, channel: effectiveChannel, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, brandVoiceNotes: context.brandVoiceNotes, customerContext }
            });

            return this.processAiResponse(aiResponse, userId, pageId, retrievedChunks?.length ?? 0, ragAttempted, !!effectiveKB, text, gapSource);
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
        const { workspaceId, userId, text, pageName, knowledgeBase, pageId, senderId } = context;

        // 1. Templates are for comment-triggered replies. DMs belong to AI.
        // When AI is on, skip template matching entirely — AI answers with full context
        // (conversation history, product catalog, KB). Templates only fire as a fallback
        // when AI is deliberately disabled, so DMs still get some auto-reply.
        if (!aiEnabled) {
            const templateResult = await this.tryTemplateMatch(workspaceId, context.templateMatchText || text);
            if (templateResult && !await this.isRepeatTemplate(templateResult, aiEnabled, pageId, senderId)) {
                return templateResult;
            }
        }

        // 3. If no template, use AI with conversation context
        if (aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                return { replyText: 'Thank you for your message! We will get back to you soon.', replyMethod: 'template', needsAttention: false };
            }

            if (pageId && senderId) {
                // Fetch conversation history and customer summary in parallel (independent DB queries)
                const [conversationHistory, customerSummary] = await Promise.all([
                    messagesService.getConversationHistory(pageId, senderId, 12),
                    messagesService.getCustomerSummary(pageId, senderId),
                ]);
                const namePart = context.senderName ? `Customer name: ${context.senderName}.` : '';
                const customerContext = [namePart, customerSummary].filter(Boolean).join(' ') || undefined;

                // Build gap source: last customer message before the current one
                const prevUserMsg = conversationHistory
                    .filter(m => m.role === 'user' && m.content !== text)
                    .pop();
                const gapSource: GapSource = { type: 'dm', context: prevUserMsg?.content };

                // Run RAG retrieval if enabled (pass full history for context-aware search)
                const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge(
                    pageId, text, knowledgeBase, context.kbActiveVersion, 'dm', conversationHistory, !!context.productCatalog,
                );

                // Exclude the current message from history sent to GPT — it is already
                // included as the final user prompt in buildUserPrompt. Without this filter,
                // GPT sees the current message twice (once in history, once as the prompt)
                // because the incoming message is stored to DB before getConversationHistory runs.
                const historyForAI = conversationHistory.filter(
                    m => !(m.role === 'user' && m.content === text)
                );

                const msgLang = detectLanguageCode(text);
                const aiRequest = {
                    comment: text,
                    language: msgLang !== 'unknown' ? msgLang : undefined,
                    context: { userId, pageId, pageName, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, channel: 'dm' as const, conversationHistory: historyForAI, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, brandVoiceNotes: context.brandVoiceNotes, customerContext, ecommerceStoreId: context.ecommerceStoreId },
                };

                // When an e-commerce store is linked, use the tool loop
                // so the AI can call lookup_order / track_shipment / check_inventory.
                // Otherwise, use the standard aiService (zero behavior change).
                let aiResponse: AiGenerateResponse;
                if (context.ecommerceStoreId) {
                    const { generateReplyWithTools } = await import('../ecommerceToolLoop');
                    aiResponse = await generateReplyWithTools(aiRequest);
                } else {
                    aiResponse = await aiService.generateReply(aiRequest);
                }

                return this.processAiResponse(aiResponse, userId, pageId, retrievedChunks?.length ?? 0, ragAttempted, !!effectiveKB, text, gapSource);
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
        conversationHistory?: { role: string; content: string }[],
        hasEcommerceChunks?: boolean,
    ): Promise<{ retrievedChunks?: RetrievedChunkContext[]; effectiveKB?: string; queryEmbedding?: number[]; ragAttempted: boolean }> {
        const retrieval = getRetrievalService();

        // No retrieval possible: missing service, pageId, or active version
        if (!retrieval || !pageId || kbActiveVersion === null || kbActiveVersion === undefined) {
            return { effectiveKB: staticKB, ragAttempted: false };
        }

        // Small KB optimization: if the entire KB fits comfortably in the context window,
        // send it as-is instead of using RAG chunking. This avoids semantic gaps where the
        // customer uses different terminology than the KB (e.g., "باقات" vs "خدمات").
        // Exception: ecommerce pages have product chunks with detailed specs/prices that
        // aren't in the static KB text — always use RAG for those.
        const KB_RAG_THRESHOLD_CHARS = 5000;
        if (!hasEcommerceChunks && staticKB && staticKB.length < KB_RAG_THRESHOLD_CHARS) {
            this.logger.debug('[Generator] KB is small — skipping RAG, using full static KB', {
                pageId, kbLength: staticKB.length, threshold: KB_RAG_THRESHOLD_CHARS,
            });
            return { effectiveKB: staticKB, ragAttempted: false };
        }

        // Enrich vague follow-up queries with conversation context for better RAG retrieval.
        // When a customer says "شو مميزاتها؟" after asking about AirPods, the RAG query
        // becomes "AirPods Pro شو مميزاتها؟" so it finds the right product chunk.
        //
        // We use BOTH the last user message AND a short tail of the last assistant reply.
        // The user message is ground truth (what the customer asked about).
        // The assistant tail captures topics the AI introduced (e.g., product suggestions,
        // discounts, store visits) that the customer might reference in a vague follow-up
        // like "كم سعره" or "وين فيني شوفون".
        //
        // Hallucination poisoning mitigation: we only take the LAST 80 chars of the
        // assistant reply (the tail). Hallucinated facts tend to appear mid-reply as
        // elaborations, while new topics/offers appear at the end as addendums.
        // The 80-char cap also limits how much any single hallucinated term can influence
        // the embedding, keeping user message + current query as the dominant signal.
        let enrichedQuery = query;
        if (conversationHistory && conversationHistory.length > 0) {
            const isVague = query.trim().split(/\s+/).length <= 6;
            if (isVague) {
                const lastUserMessage = [...conversationHistory].reverse().find(m => m.role === 'user');
                const lastAssistantMessage = [...conversationHistory].reverse().find(m => m.role === 'assistant');

                const parts: string[] = [];
                if (lastUserMessage) {
                    parts.push(lastUserMessage.content.slice(0, 100));
                }
                if (lastAssistantMessage) {
                    // Take the TAIL of the assistant reply — new topics are typically
                    // appended at the end ("وبالمناسبة عنا خصم...", "وكمان عندنا MacBook...").
                    const tail = lastAssistantMessage.content.slice(-80);
                    parts.push(tail);
                }
                parts.push(query);

                enrichedQuery = parts.join(' ').slice(0, 400);
                this.logger.debug('[Generator] Enriched RAG query with conversation context', {
                    original: query, enriched: enrichedQuery.slice(0, 150),
                    usedAssistantTail: !!lastAssistantMessage,
                });
            }
        }

        try {
            retrieval.setLogger(this.logger);
            const { chunks, queryEmbedding } = await retrieval.retrieve(pageId, enrichedQuery, kbActiveVersion);

            if (chunks.length === 0) {
                this.logger.debug('[Generator] RAG returned no chunks, using static KB', { pageId, channel });
                // Don't record a KB gap here — the AI may still answer correctly
                // using the static KB fallback. Gap detection is deferred to the
                // post-AI check (low confidence + info_not_in_kb flag).
                return { effectiveKB: staticKB, queryEmbedding, ragAttempted: true };
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
                return { effectiveKB: staticKB, queryEmbedding, ragAttempted: true };
            }

            // RAG_MODE = 'on': use chunks, omit static KB
            return { retrievedChunks, effectiveKB: undefined, queryEmbedding, ragAttempted: true };
        } catch (error) {
            this.logger.error('[Generator] RAG retrieval failed, falling back to static KB', {
                pageId, error: error instanceof Error ? error.message : String(error),
            });
            return { effectiveKB: staticKB, ragAttempted: true };
        }
    }

    /**
     * Generate a reply for the admin playground.
     * Mirrors the production pipeline (template → offensive filter → RAG → AI → flag processing)
     * but skips billing checks and usage tracking. Returns rich debug data for the playground UI.
     *
     * The caller (admin route) is responsible for:
     * - DB lookups (page, workspace settings, e-commerce KB enrichment)
     * - Translating commentReplyMode (dual/private → pass channel='dm')
     * - HTTP request/response handling
     */
    async generateForPlayground(input: PlaygroundInput): Promise<PlaygroundResult> {
        const {
            pageId, userId, workspaceId, question, channel, knowledgeBase, kbActiveVersion,
            pageName, productCatalog, storePolicies, postMessage, conversationHistory,
            replyStyle, brandVoiceNotes, customerContext, model,
        } = input;

        const ragMode = config.ragMode || 'off';

        // 1. Template match — comments only. Playground always runs AI, so skip templates for DM.
        if (workspaceId && channel !== 'dm') {
            const templateResult = await this.tryTemplateMatch(workspaceId, question);
            if (templateResult) {
                return {
                    reply: templateResult.replyText,
                    replyMethod: 'template',
                    templateName: templateResult.templateName ?? null,
                    ragMode,
                    chunksRetrieved: 0,
                    chunks: [],
                    intent: null,
                    confidence: null,
                    flags: [],
                    needsAttention: false,
                    cached: false,
                    detectedLanguage: null,
                    tokensUsed: 0,
                    model: null,
                    gapRecorded: false,
                };
            }
        }

        // 2. For comments: strip noise, check for spam, detect language with postMessage fallback
        let questionForAI = question;
        if (channel === 'comment') {
            questionForAI = this.stripCommentNoise(question);
            const isEmptyQ = !questionForAI;
            const isPunctuationQ = questionForAI ? this.isPunctuationOnly(questionForAI) : false;
            if (isEmptyQ || (isPunctuationQ && !postMessage)) {
                return {
                    reply: null, replyMethod: 'skipped', templateName: null, ragMode,
                    chunksRetrieved: 0, chunks: [], intent: 'SPAM_OR_IRRELEVANT',
                    confidence: null, flags: [], needsAttention: false, cached: false,
                    detectedLanguage: null, tokensUsed: 0, model: null, gapRecorded: false,
                };
            }
        }

        // 3. RAG retrieval (uses shared resolveKnowledge — same logic as production)
        const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge(
            pageId, questionForAI, knowledgeBase, kbActiveVersion, channel,
            conversationHistory, !!productCatalog,
        );

        // 4. Call AI
        const effectiveLang = channel === 'comment'
            ? detectCommentLanguage(questionForAI, postMessage)
            : detectLanguageCode(question);
        const aiResponse = await aiService.generateReply({
            comment: questionForAI,
            language: effectiveLang !== 'unknown' ? effectiveLang : undefined,
            ...(model ? { model } : {}),
            context: {
                pageId,
                ...(userId ? { userId } : {}),
                pageName,
                knowledgeBase: effectiveKB,
                retrievedChunks: retrievedChunks?.length ? retrievedChunks : undefined,
                storePolicies,
                productCatalog,
                channel,
                kbActiveVersion,
                queryEmbedding,
                ...(channel === 'comment' && postMessage ? { postMessage } : {}),
                ...(channel === 'dm' && conversationHistory?.length ? { conversationHistory } : {}),
                ...(replyStyle ? { replyStyle } : {}),
                ...(brandVoiceNotes ? { brandVoiceNotes } : {}),
                ...(customerContext ? { customerContext } : {}),
            },
        });

        // 5. Normalize intent + process flags (mirrors processAiResponse, minus billing)
        const normalizedIntent = normalizeAiIntent(aiResponse.intent);
        const flags = [...(aiResponse.flags || [])];
        if (aiResponse.confidence === 'low' && !flags.includes('low_confidence')) {
            flags.push('low_confidence');
        }

        // Post-validation hallucination guard (same logic as processAiResponse)
        const HALLUCINATION_SAFE_INTENTS = new Set(['COMPLIMENT', 'COMPLAINT', 'GREETING', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT']);
        if (
            ragAttempted &&
            (retrievedChunks?.length ?? 0) === 0 &&
            !effectiveKB &&
            aiResponse.confidence !== 'low' &&
            !HALLUCINATION_SAFE_INTENTS.has(normalizedIntent || '') &&
            !flags.includes('info_not_in_kb')
        ) {
            flags.push('info_not_in_kb');
            if (!flags.includes('low_confidence')) {
                flags.push('low_confidence');
            }
        }

        const needsAttention = computeNeedsAttention(flags, normalizedIntent);
        const skipped = shouldSkipReply(flags.join(','), normalizedIntent);
        const useFallback = shouldUseFallback(flags.join(','));

        // Gap recording (fire-and-forget, same triggers as processAiResponse)
        let gapRecorded = false;
        if (pageId && flags.includes('info_not_in_kb')) {
            gapDetectorService.setLogger(this.logger);
            gapDetectorService.recordGap(pageId, question, { type: channel === 'dm' ? 'dm' : 'comment' }).catch(() => {});
            gapRecorded = true;
        }

        let finalReply: string | null = aiResponse.reply;
        if (skipped) {
            finalReply = null;
        } else if (useFallback) {
            const lang = aiResponse.language === 'ar' ? 'ar' : 'en';
            finalReply = PRICE_FALLBACK[lang] || PRICE_FALLBACK.en;
        }

        return {
            reply: finalReply,
            replyMethod: skipped ? 'skipped' : 'ai',
            templateName: null,
            ragMode,
            chunksRetrieved: retrievedChunks?.length ?? 0,
            chunks: retrievedChunks ?? [],
            intent: normalizedIntent || null,
            confidence: aiResponse.confidence || null,
            flags,
            needsAttention,
            cached: aiResponse.cached,
            detectedLanguage: aiResponse.language || null,
            tokensUsed: aiResponse.tokensUsed || 0,
            model: aiResponse.model || null,
            gapRecorded,
        };
    }

    /**
     * Check if the same template text was already sent to this sender in conversation history.
     * DM-only dedup: avoids sending the same canned reply twice when the customer
     * asks about the same topic again. When true, the pipeline skips the template
     * and lets AI handle the follow-up with full conversation context.
     */

    /**
     * Returns true when a comment consists entirely of punctuation, symbols, or emojis
     * (no real words in any script). Used to detect engagement-style dots/emojis.
     */
    private isPunctuationOnly(text: string): boolean {
        // Matches text with no letters (\p{L}) and no numbers (\p{N}).
        // Avoids \p{Emoji} which incorrectly includes ASCII digits 0-9 in ECMAScript.
        return text.length > 0 && /^[^\p{L}\p{N}]+$/u.test(text);
    }


    /**
     * Strips @mentions and URLs from a comment — platform noise that pollutes
     * language detection and carries no message content for the AI.
     */
    private stripCommentNoise(text: string): string {
        return text
            .replace(/@[\w\u0600-\u06FF]+(\s+[A-Z][\w]*)*/g, '')
            .replace(/https?:\/\/\S+|www\.\S+/gi, '')
            .trim();
    }

    private async isRepeatTemplate(
        result: GenerateReplyResult,
        aiEnabled: boolean,
        pageId?: string,
        senderId?: string,
    ): Promise<boolean> {
        // Only dedup in DMs when AI can handle the fallback
        if (!aiEnabled || !pageId || !senderId || !result.replyText) return false;

        const history = await messagesService.getConversationHistory(pageId, senderId, 12);
        const isRepeat = history.some(m => m.role === 'assistant' && m.content === result.replyText);

        if (isRepeat) {
            this.logger.debug('[Generator] Template dedup: skipping repeated template for DM');
        }

        return isRepeat;
    }

    /**
     * Try to match a template rule — shared across all platforms.
     *
     * Skips template matching entirely when the message exceeds TEMPLATE_WORD_LIMIT
     * content words. Long messages almost always contain multiple intents or use
     * a keyword incidentally — AI handles them far better than a keyword reply.
     */
    private async tryTemplateMatch(workspaceId: string, text: string): Promise<GenerateReplyResult | null> {
        const wordCount = countContentWords(text);
        if (wordCount > TEMPLATE_WORD_LIMIT) {
            this.logger.debug('[Generator] Skipping template match — message too long', { wordCount, limit: TEMPLATE_WORD_LIMIT });
            return null;
        }

        const matchingRule = await rulesService.findMatchingRule(workspaceId, text);

        if (matchingRule?.templateId) {
            const template = await templatesService.getTemplate(workspaceId, matchingRule.templateId);

            if (template?.message && template.active !== false) {
                this.logger.debug('[Generator] Using template', { templateName: template.name });
                return { replyText: template.message, replyMethod: 'template', templateId: template.id, templateName: template.name, needsAttention: false };
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
        pageId?: string,
        retrievedChunkCount?: number,
        ragAttempted?: boolean,
        hasStaticKB?: boolean,
        queryText?: string,
        gapSource?: GapSource,
    ): Promise<GenerateReplyResult> {
        // Normalize intent: GPT sometimes invents intents (PRICE, OTHER, LOCATION)
        // instead of using the 8 valid ones. Map them back to the standard taxonomy.
        const normalizedIntent = normalizeAiIntent(aiResponse.intent);

        const flags = [...(aiResponse.flags || [])];
        if (aiResponse.confidence === 'low' && !flags.includes('low_confidence')) {
            flags.push('low_confidence');
        }

        // Post-validation: if RAG retrieval was attempted but found 0 chunks and GPT
        // claims high confidence on a question-like intent, force info_not_in_kb +
        // low_confidence flags. Catches hallucinations where GPT invents answers for
        // topics not covered by the KB.
        // Only fires when RAG was actually attempted (ragAttempted=true). Static-KB pages
        // (no RAG) always have 0 chunks — that's normal, not hallucination.
        // Also skips when static KB was provided as fallback (hasStaticKB=true) — the AI
        // had the full KB text and can assess its own confidence.
        const HALLUCINATION_SAFE_INTENTS = new Set(['COMPLIMENT', 'COMPLAINT', 'GREETING', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT']);
        if (
            ragAttempted &&
            retrievedChunkCount === 0 &&
            !hasStaticKB &&
            aiResponse.confidence !== 'low' &&
            !HALLUCINATION_SAFE_INTENTS.has(normalizedIntent || '') &&
            !flags.includes('info_not_in_kb')
        ) {
            flags.push('info_not_in_kb');
            if (!flags.includes('low_confidence')) {
                flags.push('low_confidence');
            }
        }
        const needsAttention = computeNeedsAttention(flags, normalizedIntent);
        const flagReason = flags.join(',') ||
            (normalizedIntent === 'COMPLAINT' ? 'complaint' : null) ||
            (normalizedIntent === 'OFFENSIVE' ? 'offensive' : null) ||
            undefined;

        await subscriptionsService.incrementAiReplies(userId);

        // Log token usage for cost tracking (skip for cached responses)
        if (!aiResponse.cached) {
            await subscriptionsService.logAiUsage(userId, pageId, aiResponse.tokensUsed, aiResponse.model || DEFAULT_AI_MODEL);
        }

        // Record KB gap when the AI explicitly flags the info as missing.
        // The info_not_in_kb flag is the definitive signal — the AI checked
        // the KB and couldn't find the answer. Confidence level doesn't matter:
        // medium-confidence partial answers are still gaps worth surfacing.
        if (
            pageId &&
            queryText &&
            flags.includes('info_not_in_kb')
        ) {
            gapDetectorService.setLogger(this.logger);
            gapDetectorService.recordGap(pageId, queryText, gapSource).catch(err => {
                this.logger.error('[Generator] Gap detection error (low-confidence)', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }

        return {
            replyText: aiResponse.reply,
            replyMethod: 'ai',
            needsAttention,
            flagReason,
            aiIntent: normalizedIntent,
            confidence: aiResponse.confidence,
        };
    }
}

export const replyGenerator = new ReplyGenerator();

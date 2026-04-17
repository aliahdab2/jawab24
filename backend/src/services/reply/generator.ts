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
import { stripCommentNoise, hasMention, isPunctuationOnly } from '../../utils/commentText';

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

/**
 * Extract customer-provided data (name, phone) from conversation history.
 * Returns a short structured string for the model's CUSTOMER CONTEXT, or null.
 *
 * This is a CODE-LEVEL fix for the data-memory bug: gpt-4.1-mini with a large
 * system prompt doesn't reliably track data buried in conversation history.
 * Instead of adding prompt rules, we extract the signal and surface it explicitly.
 */
function extractConversationData(history: { role: string; content: string }[]): string | null {
    // Match 7+ consecutive digits (Arabic-Indic ٠-٩ or Western 0-9), allowing spaces/dashes
    const phonePattern = /[\d\u0660-\u0669][\d\u0660-\u0669\s-]{5,}[\d\u0660-\u0669]/;
    // Patterns indicating bot confirmed a registration/order
    const confirmPattern = /تم تسجيلك|تم الطلب|سجلنا طلبك|سجلنا رقمك|registered|order confirmed/i;

    let customerPhone: string | null = null;
    let customerName: string | null = null;
    const confirmed: string[] = [];

    for (const msg of history) {
        if (msg.role === 'user' && !customerPhone) {
            const match = msg.content.match(phonePattern);
            if (match) {
                customerPhone = match[0].replace(/[\s-]/g, '');
                // Text before the phone is likely the name (e.g. "محمد علي ٠٩٣٢٣٤٣٢٢")
                const before = msg.content.slice(0, msg.content.indexOf(match[0])).trim();
                if (before.length >= 2 && before.length < 60) {
                    customerName = before;
                }
            }
        } else if (msg.role === 'assistant' && confirmPattern.test(msg.content)) {
            // Keep the last confirmed action (most recent)
            confirmed.push(msg.content.slice(0, 120));
        }
    }

    if (!customerPhone && !customerName) return null;

    const parts: string[] = [];
    if (customerName) parts.push(`Customer shared their name: ${customerName}`);
    if (customerPhone) parts.push(`Customer shared their phone: ${customerPhone}`);
    if (confirmed.length > 0) parts.push(`Already confirmed: "${confirmed[confirmed.length - 1]}"`);
    return parts.join('. ');
}

/** Safe fallback replies when AI hallucinates pricing */
export const PRICE_FALLBACK: Record<string, string> = {
    ar: t('priceFallback', 'ar'),
    en: t('priceFallback', 'en'),
};

/**
 * Pick a language for canned fallback text (PRICE_FALLBACK, etc.).
 * The customer message is often script-less ("..."/emoji) when fallback fires,
 * so fall through to post → KB → merchant default before defaulting to English.
 * Mirrors the chain in openai.ts buildDynamicSystemSuffix.
 */
export function resolveFallbackLanguage(opts: {
    text?: string;
    postMessage?: string;
    knowledgeBase?: string;
    defaultReplyLanguage?: string;
}): 'ar' | 'en' {
    const sources = [opts.text, opts.postMessage, opts.knowledgeBase];
    for (const s of sources) {
        if (!s) continue;
        const lang = detectLanguageCode(s);
        if (lang !== 'unknown') return lang === 'ar' ? 'ar' : 'en';
    }
    if (opts.defaultReplyLanguage) {
        return opts.defaultReplyLanguage === 'ar' ? 'ar' : 'en';
    }
    return 'en';
}

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
    // Language fallback
    defaultReplyLanguage?: string;
}

export type CommentReplyMode = 'public' | 'private' | 'dual';

export interface GenerateReplyResult {
    replyText: string | null;
    replyMethod: 'template' | 'ai';
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
    defaultReplyLanguage?: string;
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
        const { userId, text, pageName, knowledgeBase, postId, pageId, accessToken, postMessage: contextPostMessage } = context;

        // Strip platform noise from comment text before language detection and AI processing.
        // Both @mentions and URLs contain Latin chars that pollute language detection
        // (e.g. "@Ali Ahdab" or "https://example.com" on an Arabic page → incorrectly 'en').
        // They also carry no message content the AI should respond to.
        const hadMention = hasMention(text);
        let commentForAI = stripCommentNoise(text);

        // Friend-tagging: pure @mention (stripped to empty) OR @mention + ≤3 words of chatter.
        // The commenter is talking to their tagged friend, not to the page. Skip silently.
        if (hadMention && !commentForAI) {
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }
        if (hadMention && commentForAI) {
            const wordCount = commentForAI.split(/\s+/).filter(w => w.length > 0).length;
            if (wordCount <= 3) {
                return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
            }
        }

        // Punctuation/emoji-only comment (dots, emojis, symbols) with no post context = spam.
        // If postMessage is present, pass to AI — it has the full post text to judge whether
        // this was an intentional engagement response. The exact-match cache means the AI call
        // only happens once per (comment, post) pair regardless of how many people comment the same dot.
        if (!commentForAI && !contextPostMessage) {
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }
        if (commentForAI && isPunctuationOnly(commentForAI) && !contextPostMessage) {
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }

        // 1. Use AI if enabled
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

            // Dual-mode DM with punctuation-only comment (e.g. "." on a CTA post):
            // Replace with a synthetic question so the AI answers with post/KB details
            // instead of classifying as SPAM_OR_IRRELEVANT.
            if (effectiveChannel === 'dm' && postMessage && isPunctuationOnly(commentForAI || text)) {
                const postLang = /[\u0600-\u06FF]/.test(postMessage) ? 'ar' : 'en';
                commentForAI = postLang === 'ar' ? 'أريد التفاصيل' : 'I want the details';
            }

            // Build gap source context for merchant insights
            const gapSource: GapSource = { type: 'comment', context: postMessage };

            // Run RAG retrieval if enabled (use stripped text for better semantic matching).
            // Enrich the query with post context when the comment is short/vague — mirrors how
            // the DM pipeline enriches vague follow-ups with conversation history.
            // A comment like "شو السعر؟" on a hairstyling post should search for
            // "hairstyling course + شو السعر؟", not just "شو السعر؟" alone.
            // For symbol-only comments ("......", emojis), the post message IS the intent.
            const commentText = commentForAI || text;
            const commentWordCount = (commentForAI || '').trim().split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
            const isVagueComment = commentWordCount <= 6;
            const ragQuery = (isVagueComment && postMessage)
                ? `${postMessage.slice(0, 200)} ${commentText}`.trim()
                : commentText;
            const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge(
                pageId, ragQuery, knowledgeBase, context.kbActiveVersion, effectiveChannel, undefined, !!context.productCatalog,
            );

            // Language detection: use stripped text only — never fall back to raw text.
            // Empty commentForAI (mention/URL-only comment) returns 'unknown', which correctly
            // triggers the post-content fallback below instead of locking in 'en'.
            // Short Latin-only tokens (≤3 words, e.g. "Icdl", "Excel") are commonly typed by
            // Arabic speakers. When KB is Arabic, treat them as Arabic to avoid English replies.
            const effectiveLang = detectCommentLanguage(commentForAI, postMessage);
            const kbLang = detectLanguageCode(effectiveKB || '');
            const isAmbiguousLatin = effectiveLang === 'en'
                && commentForAI.trim().split(/\s+/).length <= 3
                && /^[a-zA-Z0-9\s]+$/.test(commentForAI.trim())
                && kbLang === 'ar';
            const resolvedLang = isAmbiguousLatin ? 'ar' : effectiveLang;

            const aiResponse = await aiService.generateReply({
                comment: commentForAI,
                language: resolvedLang !== 'unknown' ? resolvedLang : undefined,
                context: { userId, pageId, pageName, postMessage, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, channel: effectiveChannel, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, brandVoiceNotes: context.brandVoiceNotes, senderName: context.senderName, defaultReplyLanguage: context.defaultReplyLanguage }
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
        const { userId, text, pageName, knowledgeBase, pageId, senderId } = context;

        // 1. Use AI with conversation context
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
                // senderName is passed separately — never merged into customerContext.
                // customerContext holds substantive info only (returning-customer summary, etc.)
                // so it can safely participate in cache-key scoping without fragmenting by name.
                //
                // Append extracted conversation data (name, phone, confirmed actions) so the
                // model sees it as structured context — fixes the data-memory bug where
                // gpt-4.1-mini ignores customer data buried in conversation history.
                const extractedData = extractConversationData(conversationHistory);
                const customerContext = [customerSummary, extractedData].filter(Boolean).join('. ') || undefined;

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
                    context: { userId, pageId, pageName, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, channel: 'dm' as const, conversationHistory: historyForAI, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, brandVoiceNotes: context.brandVoiceNotes, senderName: context.senderName, customerContext, ecommerceStoreId: context.ecommerceStoreId, defaultReplyLanguage: context.defaultReplyLanguage },
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
            pageId, userId, question, channel, knowledgeBase, kbActiveVersion,
            pageName, productCatalog, storePolicies, postMessage, conversationHistory,
            replyStyle, brandVoiceNotes, customerContext, model, defaultReplyLanguage,
        } = input;

        const ragMode = config.ragMode || 'off';

        // 2. Pre-process: strip noise, check for spam, detect language
        let questionForAI = question;

        // Dual-mode DM with punctuation-only input (e.g. "." on a CTA post):
        // Replace with a synthetic question so the AI has something meaningful to answer.
        // The post says "comment . to get details" → customer commented "." → DM should deliver those details.
        if (channel === 'dm' && postMessage && isPunctuationOnly(question.trim())) {
            const postLang = /[\u0600-\u06FF]/.test(postMessage) ? 'ar' : 'en';
            questionForAI = postLang === 'ar' ? 'أريد التفاصيل' : 'I want the details';
        }

        if (channel === 'comment') {
            const hadMentionPG = hasMention(question);
            questionForAI = stripCommentNoise(question);
            const isEmptyQ = !questionForAI;
            const isPunctuationQ = questionForAI ? isPunctuationOnly(questionForAI) : false;

            // Friend-tagging: "@Ali check this" → stripped = "check this" (≤3 words). Skip.
            const isFriendTag = hadMentionPG && questionForAI && questionForAI.split(/\s+/).filter(w => w.length > 0).length <= 3;

            if (isEmptyQ || (isPunctuationQ && !postMessage) || isFriendTag) {
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
        const kbLang = detectLanguageCode(effectiveKB || '');
        const isAmbiguousLatin = channel === 'comment'
            && effectiveLang === 'en'
            && questionForAI.trim().split(/\s+/).length <= 3
            && /^[a-zA-Z0-9\s]+$/.test(questionForAI.trim())
            && kbLang === 'ar';
        const resolvedLang = isAmbiguousLatin ? 'ar' : effectiveLang;

        // Merge caller-provided customerContext with extracted conversation data (same as DM pipeline)
        const playgroundExtracted = conversationHistory?.length ? extractConversationData(conversationHistory) : null;
        const mergedCustomerCtx = [customerContext, playgroundExtracted].filter(Boolean).join('. ') || undefined;

        const aiResponse = await aiService.generateReply({
            comment: questionForAI,
            language: resolvedLang !== 'unknown' ? resolvedLang : undefined,
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
                ...(postMessage ? { postMessage } : {}),
                ...(channel === 'dm' && conversationHistory?.length ? { conversationHistory } : {}),
                ...(replyStyle ? { replyStyle } : {}),
                ...(brandVoiceNotes ? { brandVoiceNotes } : {}),
                ...(mergedCustomerCtx ? { customerContext: mergedCustomerCtx } : {}),
                ...(defaultReplyLanguage ? { defaultReplyLanguage } : {}),
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
        // Don't skip DM replies that originated from a post comment (dual mode) —
        // the customer engaged with a CTA post and deserves a response
        const skipped = (channel === 'dm' && postMessage)
            ? false
            : shouldSkipReply(flags.join(','), normalizedIntent);
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
            const lang = resolveFallbackLanguage({
                text: question,
                postMessage,
                knowledgeBase,
                defaultReplyLanguage,
            });
            finalReply = PRICE_FALLBACK[lang];
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

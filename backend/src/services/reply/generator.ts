import { aiService } from '../ai';
import type { AiGenerateRequest } from '../../types';
import type { AiPipeline } from '../../types/aiPipeline';
import { messagesService } from '../messages';
import { subscriptionsService } from '../subscriptions';
import { workspaceSettingsService } from '../workspaceSettings';
import { postsService } from '../posts';
import { config } from '../../config';
import { AiGenerateResponse, RetrievedChunkContext, Logger, noopLogger } from '../../types';
import { RetrievalService } from '../kb/retrieval';
import { OpenAIEmbeddingProvider } from '../kb/embedding';
import { gapDetectorService, type GapSource } from '../kb/gap-detector';
import { DEFAULT_AI_MODEL, normalizeAiIntent, KB_GAP_FLAGS, hasAnyFlag, type ProductCard, type FlagMeta } from '@jawab24/shared';
import { detectLanguageCode, isLowSignalLatinToken, resolveDmLanguageHint } from '../../utils/language';
import { isContentFree, type FacebookMessageTag } from '../../utils/commentText';
import { buildCommentRagQuery, preprocessCommentText, resolveCommentLanguage, rewriteContentFreeCta } from './commentPreprocess';
import { detectBusinessActionFlags } from './urgentFlags';

/**
 * Single source of truth for AI dispatch: when a store is linked, route
 * through the e-commerce tool loop (search_products / check_inventory /
 * lookup_order). Otherwise, use the standard aiService. Both real DM and
 * playground/test-reply paths must use this — bypassing it caused the AI
 * to hallucinate product URLs in the test surfaces while real DMs worked.
 */
async function dispatchAiReply(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (request.context?.ecommerceStoreId) {
        const { generateReplyWithTools } = await import('../ecommerceToolLoop');
        return generateReplyWithTools(request);
    }
    return aiService.generateReply(request);
}

/** Flags/intents that should cause the pipeline to skip auto-replying.
 *  NOTE: low_confidence is intentionally NOT here — a low-confidence reply
 *  is still better than no reply at all. It gets flagged for review instead. */
export const SKIP_REPLY_FLAGS = ['offensive_or_abusive', 'offensive'] as const;
export const SAFE_FALLBACK_FLAGS = ['price_not_in_kb'] as const;
export const SKIP_REPLY_INTENTS = ['OFFENSIVE', 'SPAM_OR_IRRELEVANT'] as const;

/** Flags that hold the reply for merchant review instead of sending.
 *  self_identification_exhausted = Check 6 stripped the ENTIRE reply (all
 *  reveal talk) and the validator no longer substitutes a canned identity
 *  line — it answered "who are you?" whatever the customer asked (prod,
 *  Jawab24 page, 2026-08-01). With nothing defensible to send, the message
 *  is held exactly like held_low_confidence. Stored flag_reason for held
 *  rows: 'held_self_identification'. */
export const HOLD_REPLY_FLAGS = ['self_identification_exhausted'] as const;

export function shouldHoldReply(flagReason?: string): boolean {
    return hasAnyFlag(flagReason, HOLD_REPLY_FLAGS);
}

/** Intents that skip silently — no needsAttention flag, no notification.
 *  Tagging someone, emoji-only, "follow me", etc. are irrelevant noise.
 *  Offensive content is excluded — it warrants merchant awareness. */
export const SILENT_SKIP_INTENTS = ['SPAM_OR_IRRELEVANT'] as const;

export function shouldSkipReply(flagReason?: string, aiIntent?: string): boolean {
    if (!flagReason && !aiIntent) return false;
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return hasAnyFlag(flagReason, SKIP_REPLY_FLAGS) ||
           (SKIP_REPLY_INTENTS as readonly string[]).includes(normalizedIntent);
}

/** Returns true when the skip should be completely silent — no flag, no notification.
 *  Used for spam/irrelevant comments that don't warrant merchant attention. */
export function shouldSilentlySkip(aiIntent?: string): boolean {
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return (SILENT_SKIP_INTENTS as readonly string[]).includes(normalizedIntent);
}

export function shouldUseFallback(flagReason?: string, aiIntent?: string): boolean {
    if (!flagReason) return false;
    if (!hasAnyFlag(flagReason, SAFE_FALLBACK_FLAGS)) return false;
    // The SWAP is scoped to the two intents where a price claim is the reply's
    // substance — QUESTION and PURCHASE_INTENT (BAMBO regression, 2026-07-27:
    // a customer's closing «نعم» was answered with an invented «1200 دينار ليبي»
    // while the check was QUESTION-gated). Legitimate computed carts survive:
    // the validator accepts any total whose price_math verifies against the KB
    // (eval 97.2%, Cat 65 3/3 + Cat 68 4/4), so a flagged purchase reply is
    // ungrounded by definition. Other intents stay flag-only (needs_attention +
    // cache-block) — canned price text is never the right substitute for a
    // complaint or greeting that merely mentions a number. A missing/blank
    // intent keeps the swap (legacy failover paths predate intent reporting).
    const normalizedIntent = (aiIntent || '').trim().toUpperCase();
    return !normalizedIntent || normalizedIntent === 'QUESTION' || normalizedIntent === 'PURCHASE_INTENT';
}

/** Max stored length for the captured KB-gap question. Enough to convey the
 *  topic without bloating flag_meta; the UI truncates further for display. */
export const KB_GAP_QUESTION_MAX = 280;

/**
 * Build flag_meta for KB-gap flags (info/price/phone) by capturing the customer
 * question the AI couldn't answer from the knowledge base. This lets the inbox
 * show the merchant exactly what to add to Business Info, even after the
 * conversation moves on (a later "تمام" would otherwise hide the original ask).
 *
 * Returns null when no KB-gap flag is present or there's no usable question
 * text, so callers can pass the result straight through to markAsReplied. The
 * question is stored under each KB-gap flag actually present (typically one).
 */
export function buildKbGapFlagMeta(flags: string[], queryText?: string): FlagMeta | null {
    const present = KB_GAP_FLAGS.filter(f => flags.includes(f));
    if (present.length === 0) return null;
    const question = queryText?.trim();
    if (!question) return null;
    const clipped = question.length > KB_GAP_QUESTION_MAX
        ? `${question.slice(0, KB_GAP_QUESTION_MAX - 1)}…`
        : question;
    const meta: FlagMeta = {};
    for (const flag of present) meta[flag] = { question: clipped };
    return meta;
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

/** Intents for which a "no chunks + high confidence" state is NOT a hallucination —
 *  social/abuse replies legitimately need no KB grounding. */
const HALLUCINATION_SAFE_INTENTS = new Set(['COMPLIMENT', 'COMPLAINT', 'GREETING', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT']);

/**
 * Derive the normalized intent, flag set, and needsAttention for a generated reply.
 *
 * Single source of truth shared by `processAiResponse` (production) and
 * `generateForPlayground` (test tool / eval). These two previously duplicated this
 * logic verbatim — which is exactly how the comment-language gate drifted and shipped
 * a bug. Keeping it here makes that class of drift impossible (Rule 14: prevention).
 *
 * Pure: no billing, no gap recording, no I/O. Callers layer their own side effects
 * (quota increment, gap detection, skip/fallback) on top of the returned flags.
 */
export function computeReplyFlags(opts: {
    aiFlags: string[] | undefined;
    confidence: string | undefined;
    intent: string | undefined;
    /** The customer's question/comment — drives the business-action backstop flags. */
    queryText: string | undefined;
    /** Whether RAG retrieval ran (static-KB-only pages legitimately have 0 chunks). */
    ragAttempted: boolean | undefined;
    retrievedChunkCount: number;
    /** Whether the full static KB was sent to the model (it can self-assess confidence). */
    hasEffectiveKB: boolean;
}): { normalizedIntent: string | undefined; flags: string[]; replyShortened: boolean } {
    const { aiFlags, confidence, intent, queryText, ragAttempted, retrievedChunkCount, hasEffectiveKB } = opts;
    const normalizedIntent = normalizeAiIntent(intent);

    // `reply_shortened` is an informational marker from the ai-worker's
    // truncation retry: the reply WAS delivered, just auto-shortened to fit the
    // model output cap. It must never behave like an alarm flag — any unknown
    // flag left in `flags` lands in flag_reason and trips needsAttention (see
    // computeNeedsAttention) and from there the flagged_reply push. Strip it
    // here, the single choke point shared by production and playground, and
    // surface it separately for the quiet inbox/test-page badge.
    const rawFlags = aiFlags || [];
    const replyShortened = rawFlags.includes('reply_shortened');
    const flags = rawFlags.filter(f => f !== 'reply_shortened');
    if (confidence === 'low' && !flags.includes('low_confidence')) {
        flags.push('low_confidence');
    }
    // Deterministic backstop: ensure high-stakes business-action intents
    // (cancel/refund/exchange) are flagged even when the model misses the
    // phrasing — these must always reach the merchant.
    for (const f of detectBusinessActionFlags(queryText)) {
        if (!flags.includes(f)) flags.push(f);
    }

    // Post-validation: RAG ran, found 0 chunks, no static KB fallback, yet the model
    // claims non-low confidence on a question-like intent → force info_not_in_kb +
    // low_confidence. Catches hallucinations where GPT invents answers for topics the
    // KB doesn't cover. Skipped for social/abuse intents and static-KB pages.
    if (
        ragAttempted &&
        retrievedChunkCount === 0 &&
        !hasEffectiveKB &&
        confidence !== 'low' &&
        !HALLUCINATION_SAFE_INTENTS.has(normalizedIntent || '') &&
        !flags.includes('info_not_in_kb')
    ) {
        flags.push('info_not_in_kb');
        if (!flags.includes('low_confidence')) {
            flags.push('low_confidence');
        }
    }

    return { normalizedIntent, flags, replyShortened };
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
 * Locale-correct price fallback text. Resolves through `t(key, lang)` rather than
 * indexing PRICE_FALLBACK: that table is a `Record<string, string>` literal holding
 * only `ar`/`en`, so a third locale would have a correct translation in its JSON and
 * still be served English. `t()` reads the locale table, so new languages work here
 * with no code change.
 */
export function priceFallbackText(lang: string): string {
    return t('priceFallback', lang);
}

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
        // A bare Latin token ("icdl", a product name) carries no real language
        // signal — the detector floors it at English. Skip it so the conversation
        // context (post → KB → merchant default) decides the fallback language,
        // matching resolveCommentLanguage. Without this, an "icdl" reply on an
        // Arabic thread forces the English away/quota fallback template.
        if (isLowSignalLatinToken(s)) continue;
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
    // For comments — also populated for DMs whose conversation originated from a
    // comment (dual/private mode). See messageProcessor.resolveOriginPostMessage.
    postId?: string;
    postMessage?: string;
    pageId?: string;
    accessToken?: string;
    // For messages
    senderId?: string;
    senderName?: string;
    // Reply customization
    replyStyle?: string;
    /** Effective reply mode ('sales' | 'info') — see AiGenerateRequest.context.replyMode. */
    replyMode?: string;
    brandVoiceNotes?: string;
    /**
     * Stage 2.6 structured BUSINESS_INFO prompt block (merchant-confirmed only).
     * Built by `contextEnricher.enrichPageContext`; null when the merchant has
     * not yet filled in any field in the editor. The AI prompt injects this
     * verbatim — see ai-worker's openai.ts.
     */
    businessInfoBlock?: string | null;
    /**
     * G1a fact-collections prompt block (enumerable lists + their derived
     * coverage statements). Built by `contextEnricher.enrichPageContext`;
     * undefined when the page has no collections.
     */
    factCollectionsBlock?: string;
    /** See EnrichedContext.factCollectionsGated — disables the semantic cache for
     *  replies whose list content was specific to this message. */
    factCollectionsGated?: boolean;
    // E-commerce tools (DMs only)
    ecommerceStoreId?: string;
    // Language fallback
    defaultReplyLanguage?: string;
    /** Merchant's IANA timezone (workspace settings) — drives the "Today's date" prompt line. */
    timezone?: string;
    /** Facebook `message_tags` array from the Graph webhook — used to detect friend
     *  tags (peer-to-peer) vs page tags (real questions). Only populated for
     *  Facebook comments; undefined for DMs, Instagram, and older rows. */
    messageTags?: FacebookMessageTag[];
    /** Our own Facebook page ID — needed to distinguish a page-tag pointing at US
     *  (a real question) from a page-tag pointing at some other page (skip). */
    ourFacebookPageId?: string;
}

export type CommentReplyMode = 'public' | 'private' | 'dual';

export interface GenerateReplyResult {
    replyText: string | null;
    replyMethod: 'template' | 'ai';
    needsAttention?: boolean;
    flagReason?: string;
    /** Structured per-reason detail for flagReason (e.g. the unanswered
     *  question for info_not_in_kb). Persisted to the message/comment row. */
    flagMeta?: FlagMeta | null;
    aiIntent?: string;
    confidence?: string;
    /**
     * Rich product cards to send as a follow-up attachment after the text reply.
     * Only populated for e-commerce replies when a tool surfaced product data.
     * Callers must fall back to text-only when the adapter doesn't support cards.
     */
    productCards?: ProductCard[];
    /**
     * The ai-worker auto-shortened this reply (truncation retry) before it was
     * delivered. Informational only — drives a quiet badge on the outgoing
     * message; deliberately never part of flagReason/needsAttention.
     */
    replyShortened?: boolean;
}

export interface PlaygroundInput {
    pageId: string;
    userId?: string;
    workspaceId: string | null;
    question: string;
    /** Effective channel after applying commentReplyMode (dual/private → dm).
     *  Drives RAG retrieval, the dual-DM punctuation rewrite, and the AI context channel. */
    channel: 'comment' | 'dm';
    /** The channel the user actually tested (comment/dm) BEFORE the dual/private → dm
     *  flattening. Comment-specific steps — preprocessing (friend-tag/spam skip) and
     *  `resolveCommentLanguage` (post-language mirroring) — must key off this, not the
     *  effective `channel`, or they silently no-op for dual/private merchants and a bare
     *  Latin token ("Icdl") on an Arabic post resolves to English. Mirrors production's
     *  `generateForComment`, which always runs those steps regardless of effective channel.
     *  Defaults to `channel` when unset (back-compat for callers that don't flatten). */
    requestedChannel?: 'comment' | 'dm';
    knowledgeBase?: string;
    kbActiveVersion?: number | null;
    pageName?: string;
    productCatalog?: string;
    storePolicies?: string;
    postMessage?: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    /** Effective reply mode ('sales' | 'info') — see AiGenerateRequest.context.replyMode. */
    replyMode?: string;
    brandVoiceNotes?: string;
    /** Stage 2.6 structured BUSINESS_INFO prompt block (merchant-confirmed only). */
    businessInfoBlock?: string | null;
    /** G1a fact-collections prompt block — built by playgroundContext from the
     *  page's real collections, so eval exercises the production block. */
    factCollectionsBlock?: string;
    /** See GenerateReplyContext.factCollectionsGated. */
    factCollectionsGated?: boolean;
    customerContext?: string;
    /** Customer display name (DM only) — feeds gender-aware Arabic DM addressing. */
    senderName?: string;
    /** Minutes since the previous thread message (DM only) — the time-gap fact line. */
    minutesSinceLastMessage?: number;
    model?: string;
    defaultReplyLanguage?: string;
    /** See GenerateReplyContext.timezone. */
    timezone?: string;
    /** See GenerateReplyContext.messageTags. */
    messageTags?: FacebookMessageTag[];
    /** See GenerateReplyContext.ourFacebookPageId. */
    ourFacebookPageId?: string;
    /** Linked e-commerce store id — when set, the tool loop is invoked so the AI
     *  can call search_products / check_inventory / lookup_order. Mirrors the
     *  real DM path; without this, playground/test-reply would hallucinate URLs. */
    ecommerceStoreId?: string;
    /** Pipeline tag for ai_usage_log — distinguishes interactive playground from batch eval runs. */
    pipeline?: AiPipeline;
}

export interface PlaygroundResult {
    reply: string | null;
    replyMethod: 'template' | 'ai' | 'skipped';
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
    /** See GenerateReplyResult.replyShortened — quiet badge signal, never an alarm. */
    replyShortened: boolean;
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

/** Max chars of the enriched RAG query sent to the embedding model. */
const ENRICHED_QUERY_MAX_CHARS = 500;
/** Per-turn cap so one verbose turn (e.g. an assistant marketing dump) can't consume the whole budget. */
const ENRICHED_QUERY_PER_TURN_CHARS = 200;
/** A query with at most this many words is treated as a follow-up that needs conversation context. */
const FOLLOW_UP_MAX_WORDS = 12;
/** How many of the most-recent turns are eligible for context enrichment. */
const ENRICHED_QUERY_HISTORY_TURNS = 4;

/**
 * Build the query used for RAG retrieval. A short follow-up's topic usually lives NOT in the bare
 * message but in an earlier turn or in the assistant's last reply (e.g. customer: "ممكن لمواعيد" /
 * "بس تعرف الوقت" after the bot named the course). For such follow-ups we fold the last few turns
 * into the query so retrieval finds the right chunk instead of a topicless one (the institute prod
 * failures, eval Cat 54).
 *
 * Ordering matters: the customer's message comes FIRST (it dominates the embedding), then context
 * turns are appended NEWEST-FIRST, each capped to {@link ENRICHED_QUERY_PER_TURN_CHARS}. This
 * guarantees the most-recent turn — the one that just named the course/price/schedule the follow-up
 * refers to — always fits the budget, and the final length clamp can only ever trim the OLDEST
 * (least relevant) context. The earlier version joined oldest→newest then `slice(0, 500)`, which
 * silently dropped that newest turn whenever the history exceeded the budget, and had no per-turn
 * cap so one verbose turn could starve the rest — reintroducing the "marketing-dump biases
 * retrieval" failure the enrichment was meant to fix.
 *
 * Caveat: including the assistant turn can bias retrieval toward an AI-introduced name (the reason
 * the original code used the user message only). The query-first ordering keeps the customer's words
 * dominant, and the eval suite (Cat 1/11/24 + the Cat-54 repros) guards the tradeoff — recall here
 * matters more than the rare bias case.
 */
export function buildEnrichedQuery(
    query: string,
    conversationHistory?: { content: string }[],
): string {
    if (!conversationHistory || conversationHistory.length === 0) return query;
    const isFollowUp = query.trim().split(/\s+/).filter(Boolean).length <= FOLLOW_UP_MAX_WORDS;
    if (!isFollowUp) return query;

    const parts = [query];
    let budget = ENRICHED_QUERY_MAX_CHARS - query.length;
    const recent = conversationHistory.slice(-ENRICHED_QUERY_HISTORY_TURNS);
    // Walk newest→oldest so the most recent turn always survives the budget.
    for (let i = recent.length - 1; i >= 0 && budget > 1; i--) {
        const snippet = recent[i].content.trim().slice(0, ENRICHED_QUERY_PER_TURN_CHARS);
        if (!snippet) continue;
        const piece = snippet.slice(0, budget - 1); // -1 reserves the joining space
        if (!piece) break;
        parts.push(piece);
        budget -= piece.length + 1;
    }
    return parts.join(' ').slice(0, ENRICHED_QUERY_MAX_CHARS);
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
        const { userId, text, pageName, knowledgeBase, postId, pageId, accessToken, postMessage: contextPostMessage, messageTags, ourFacebookPageId } = context;

        // Shared pre-processing: Facebook user-tag rule, regex @mention skip, and
        // punctuation-only-no-context skip. Single source of truth between this path
        // and the admin playground.
        const pre = preprocessCommentText({
            text, messageTags, ourFacebookPageId,
            hasPostContext: !!contextPostMessage,
        });
        if (pre.skipReason) {
            this.logger.info('[Generator] Comment preprocess skip', {
                skipReason: pre.skipReason, pageId, postId,
            });
            return { replyText: null, replyMethod: 'ai', aiIntent: 'SPAM_OR_IRRELEVANT', needsAttention: false };
        }
        let commentForAI = pre.commentForAI;

        // 1. Use AI if enabled
        if (aiEnabled) {
            const limitCheck = await subscriptionsService.canUseAiReplies(userId);

            if (!limitCheck.allowed) {
                this.logger.info('[Generator] AI limit reached', { reason: limitCheck.reason });
                const lang = resolveFallbackLanguage({
                    text, postMessage: contextPostMessage, knowledgeBase,
                    defaultReplyLanguage: context.defaultReplyLanguage,
                });
                // Master switch: when off (default), suppress the auto-reply and surface
                // the comment in "Needs Attention" so the merchant handles it manually.
                // When on, send the merchant's custom message — or the hardcoded translation
                // if they enabled the toggle without writing one.
                const wsSettings = await workspaceSettingsService.getSettings(context.workspaceId);
                if (!wsSettings.limitFallbackEnabled) {
                    return { replyText: null, replyMethod: 'template', needsAttention: true };
                }
                const custom = await workspaceSettingsService.getLimitFallbackMessage(context.workspaceId, lang);
                return { replyText: custom ?? t('commentFallback', lang), replyMethod: 'template', needsAttention: false };
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

            commentForAI = rewriteContentFreeCta({
                commentForAI, rawText: text, postMessage,
            });

            // Build gap source context for merchant insights
            const gapSource: GapSource = { type: 'comment', context: postMessage };

            // Run RAG retrieval if enabled. buildCommentRagQuery enriches a short/vague
            // comment with the post context (shared with the playground/test tool).
            const ragQuery = buildCommentRagQuery(commentForAI, text, postMessage);
            const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge({
                pageId, query: ragQuery, staticKB: knowledgeBase, kbActiveVersion: context.kbActiveVersion,
                channel: effectiveChannel, hasEcommerceChunks: !!context.productCatalog, userId,
            });

            const resolvedLang = resolveCommentLanguage(commentForAI, postMessage, effectiveKB);

            // Model is resolved inside aiService.generateReply via userId.
            const aiResponse = await aiService.generateReply({
                comment: commentForAI,
                // A DEFAULT, not an assertion: resolvedLang may have mirrored the post's/KB's
                // language for a low-signal token ("ICDL" on an Arabic post). The ai-worker
                // re-derives from `comment` whether this is a reading of the customer's own
                // words (resolveChain.currentMessageIsIdentifiable) — nothing to pass here.
                language: resolvedLang !== 'unknown' ? resolvedLang : undefined,
                context: { userId, pageId, pageName, postMessage, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, factCollectionsBlock: context.factCollectionsBlock, factCollectionsGated: context.factCollectionsGated, channel: effectiveChannel, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, replyMode: context.replyMode, brandVoiceNotes: context.brandVoiceNotes, businessInfoBlock: context.businessInfoBlock, senderName: context.senderName, defaultReplyLanguage: context.defaultReplyLanguage, timezone: context.timezone, pipeline: 'comment_reply' }
            });

            return this.processAiResponse(aiResponse, userId, pageId, retrievedChunks?.length ?? 0, ragAttempted, !!effectiveKB, text, gapSource);
        }

        // 3. Fallback
        this.logger.debug('[Generator] Using fallback reply');
        const lang = resolveFallbackLanguage({
            text, postMessage: contextPostMessage, knowledgeBase,
            defaultReplyLanguage: context.defaultReplyLanguage,
        });
        const custom = await workspaceSettingsService.getLimitFallbackMessage(context.workspaceId, lang);
        return { replyText: custom ?? t('commentFallback', lang), replyMethod: 'template', needsAttention: false };
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
                const lang = resolveFallbackLanguage({
                    // postMessage is present for DMs that originated from a comment
                    // (dual/private mode) — an Arabic origin post rescues the language
                    // when the customer's latest DM is a bare token like "icdl".
                    text, postMessage: context.postMessage, knowledgeBase,
                    defaultReplyLanguage: context.defaultReplyLanguage,
                });
                // Master switch: when off, suppress the auto-reply (silent + flag).
                // When on, send custom or hardcoded translation.
                const wsSettings = await workspaceSettingsService.getSettings(context.workspaceId);
                if (!wsSettings.limitFallbackEnabled) {
                    return { replyText: null, replyMethod: 'template', needsAttention: true };
                }
                const custom = await workspaceSettingsService.getLimitFallbackMessage(context.workspaceId, lang);
                return { replyText: custom ?? t('messageFallback', lang), replyMethod: 'template', needsAttention: false };
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

                // Run RAG retrieval if enabled (pass full history for context-aware search).
                // NOTE: deliberately do NOT enrich the query with the originating post here.
                // DM retrieval uses the customer's own messages only — enriching with post /
                // post-reply content biases retrieval away from off-topic follow-ups (the
                // Doaa case, 2026-04-19: an address question after a course post-reply missed
                // the address chunk). The post is instead surfaced to the model as optional
                // [current_post] context below, which does not skew retrieval.
                const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge({
                    pageId, query: text, staticKB: knowledgeBase, kbActiveVersion: context.kbActiveVersion,
                    channel: 'dm', conversationHistory, hasEcommerceChunks: !!context.productCatalog, userId,
                });

                // Exclude the current message from history sent to GPT — it is already
                // included as the final user prompt in buildUserPrompt. Without this filter,
                // GPT sees the current message twice (once in history, once as the prompt)
                // because the incoming message is stored to DB before getConversationHistory runs.
                const historyForAI = conversationHistory.filter(
                    m => !(m.role === 'user' && m.content === text)
                );

                // Time since the previous thread activity (either direction) — the
                // "clock" the model otherwise lacks: history reaches it undated, so
                // it cannot tell a live conversation from a days-later return. Sent
                // as a plain fact; promptBuilder renders it in the per-call block.
                // NOTE: historyForAI drops prior user messages whose content equals
                // the CURRENT text (the just-stored-message filter matches by content,
                // not id), so a customer repeating an identical message computes the
                // gap from an older turn — overstated, never understated. Coarse
                // formatTimeGap buckets absorb most of it; acceptable edge.
                const lastPrev = historyForAI[historyForAI.length - 1];
                const minutesSinceLastMessage = lastPrev?.timestamp
                    ? Math.max(0, Math.round((Date.now() - new Date(lastPrev.timestamp).getTime()) / 60000))
                    : undefined;

                // Language hint: resolveDmLanguageHint (shared with the playground path)
                // defers low-confidence Latin reads to the ai-worker's history-first chain.
                // Prior context includes assistant messages — the bot's prior turn is what
                // the customer is responding to, so it's a valid language anchor (matters
                // for dual-DM openers where the bot sent the first DM and the customer's
                // first reply is a Latin token). The full rationale — the deliberate <0.6
                // blunt floor, Arabizi vs accent-free French, the REVERTED narrowing —
                // lives on the helper in packages/shared/src/language/detector.ts.
                // Model is resolved inside aiService.generateReply via userId.
                const aiRequest: AiGenerateRequest = {
                    comment: text,
                    // With no prior history to defer to, the en@0.5 floor still travels as
                    // `language: 'en'` — that is fine and deliberate (it remains the sensible
                    // default). What must NOT happen is the prompt asserting "the customer
                    // wrote in English" over it; the ai-worker re-derives that from `comment`.
                    language: resolveDmLanguageHint(text, historyForAI.length > 0),
                    context: { userId, pageId, pageName, knowledgeBase: effectiveKB, retrievedChunks, storePolicies: context.storePolicies, productCatalog: context.productCatalog, factCollectionsBlock: context.factCollectionsBlock, factCollectionsGated: context.factCollectionsGated, channel: 'dm', conversationHistory: historyForAI, kbActiveVersion: context.kbActiveVersion, queryEmbedding, replyStyle: context.replyStyle, replyMode: context.replyMode, brandVoiceNotes: context.brandVoiceNotes, businessInfoBlock: context.businessInfoBlock, senderName: context.senderName, customerContext, ecommerceStoreId: context.ecommerceStoreId, defaultReplyLanguage: context.defaultReplyLanguage, timezone: context.timezone, minutesSinceLastMessage, ...(context.postMessage ? { postMessage: context.postMessage } : {}), pipeline: 'dm_reply' },
                };

                const aiResponse = await dispatchAiReply(aiRequest);

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
    private async resolveKnowledge(opts: {
        pageId: string | undefined;
        query: string;
        staticKB: string | undefined;
        kbActiveVersion: number | null | undefined;
        channel: 'comment' | 'dm';
        conversationHistory?: { role: string; content: string }[];
        hasEcommerceChunks?: boolean;
        userId?: string;
    }): Promise<{ retrievedChunks?: RetrievedChunkContext[]; effectiveKB?: string; queryEmbedding?: number[]; ragAttempted: boolean }> {
        const { pageId, query, staticKB, kbActiveVersion, channel, conversationHistory, hasEcommerceChunks, userId } = opts;
        const retrieval = getRetrievalService();

        // No retrieval possible: missing service, pageId, or active version
        if (!retrieval || !pageId || kbActiveVersion === null || kbActiveVersion === undefined) {
            return { effectiveKB: staticKB, ragAttempted: false };
        }

        // Non-ecommerce pages ALWAYS receive the full Business Info / KB, in full — and no
        // retrieval/embedding/chunk call runs on this path at all. The decision is deliberately
        // size-INDEPENDENT: RAG is never used as a filter over a single-document KB, because
        // chunking it can only DROP the answer-bearing text — a short/lexical query like
        // "وين موقعكم" retrieves the wrong chunks and the address (which IS in the KB) never
        // reaches the model → deflection (D-012). Any oversized KB is bounded by the
        // KB_MAX_CHARS (16k) truncation in promptBuilder — that cap, not a gate here, limits
        // prompt size. RAG is retained ONLY for ecommerce pages, whose product specs/prices
        // live in chunks rather than the static KB text (handled below).
        //
        // KB_RAG_THRESHOLD_CHARS is an emergency rollback lever ONLY: when set, a KB LARGER
        // than it falls back to the legacy RAG path. Unset (the default) → full KB
        // unconditionally, at any size.
        if (!hasEcommerceChunks && staticKB) {
            const ragRollbackCeiling = parseInt(process.env.KB_RAG_THRESHOLD_CHARS || '', 10);
            const forceRagForLargeKb = !Number.isNaN(ragRollbackCeiling) && staticKB.length > ragRollbackCeiling;
            if (!forceRagForLargeKb) {
                this.logger.debug('[Generator] Non-ecommerce page — sending full KB (RAG not used as a filter)', {
                    pageId, kbLength: staticKB.length,
                });
                return { effectiveKB: staticKB, ragAttempted: false };
            }
        }

        // Enrich short follow-up queries with recent conversation context so retrieval finds the
        // right chunk (see buildEnrichedQuery for the ordering/budget rationale and the bias caveat).
        const enrichedQuery = buildEnrichedQuery(query, conversationHistory);
        if (enrichedQuery !== query) {
            this.logger.debug('[Generator] Enriched RAG query with recent conversation context', {
                original: query, enriched: enrichedQuery.slice(0, 150),
            });
        }

        try {
            retrieval.setLogger(this.logger);
            // Retrieval mode (env-selectable for A/B; default 'dual' = the fix):
            //   off      → raw query only (pre-#349 behavior — no follow-up enrichment)
            //   enriched → enriched query only (#349 behavior — poisons misspelled/topic-switch queries)
            //   dual     → union(enriched, raw): keeps the vague-follow-up benefit AND lets a
            //              self-contained query recover its own chunk (primaryEmbeddingIndex=1 → raw
            //              query's embedding for the cache key).
            const retrievalMode = process.env.RAG_RETRIEVAL_MODE || 'dual';
            const { chunks, queryEmbedding } = await (
                retrievalMode === 'off'
                    ? retrieval.retrieve(pageId, query, kbActiveVersion, undefined, userId)
                    : retrievalMode === 'enriched' || enrichedQuery === query
                        ? retrieval.retrieve(pageId, enrichedQuery, kbActiveVersion, undefined, userId)
                        : retrieval.retrieveMulti(pageId, [enrichedQuery, query], kbActiveVersion, undefined, userId, 1)
            );

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
            replyStyle, replyMode, brandVoiceNotes, businessInfoBlock, factCollectionsBlock, factCollectionsGated, customerContext, senderName, minutesSinceLastMessage, model, defaultReplyLanguage,
            timezone, messageTags, ourFacebookPageId, ecommerceStoreId, pipeline,
        } = input;

        const ragMode = config.ragMode || 'off';

        // Whether the user is testing a COMMENT, independent of the dual/private → dm
        // channel flattening (`channel` is the effective channel; for a dual/private
        // merchant a comment test arrives here as 'dm'). Comment preprocessing and
        // comment-language resolution must follow the requested channel so they don't
        // silently no-op — matching production's generateForComment.
        const isCommentTest = (input.requestedChannel ?? channel) === 'comment';

        // Shared comment pre-processing — single source of truth with generateForComment.
        // Only applies to comment inputs; DM inputs skip directly to the dual-DM rewrite.
        let questionForAI = question;
        if (isCommentTest) {
            const pre = preprocessCommentText({
                text: question, messageTags, ourFacebookPageId,
                hasPostContext: !!postMessage,
            });
            if (pre.skipReason) {
                return {
                    reply: null, replyMethod: 'skipped', ragMode,
                    chunksRetrieved: 0, chunks: [], intent: 'SPAM_OR_IRRELEVANT',
                    confidence: null, flags: [], needsAttention: false, cached: false,
                    detectedLanguage: null, tokensUsed: 0, model: null, gapRecorded: false,
                    replyShortened: false,
                };
            }
            questionForAI = pre.commentForAI;
        }

        // Content-free CTA input (e.g. "." / "٠٠٠" on a CTA post): replace with a
        // synthetic question so the AI has something meaningful to answer — on any
        // channel (see rewriteContentFreeCta for the public-mode rationale).
        questionForAI = rewriteContentFreeCta({
            commentForAI: questionForAI, rawText: question, postMessage,
        });

        // 3. RAG retrieval (uses shared resolveKnowledge — same logic as production).
        // Comment tests enrich a short/vague query with the post via the shared
        // buildCommentRagQuery, so the test tool retrieves the same chunks as production
        // (e.g. "icdl" on a courses post hits the course chunks, not the bare token).
        // DM follow-ups are enriched from conversation history inside resolveKnowledge.
        const ragQuery = isCommentTest
            ? buildCommentRagQuery(questionForAI, question, postMessage)
            : questionForAI;
        const { retrievedChunks, effectiveKB, queryEmbedding, ragAttempted } = await this.resolveKnowledge({
            pageId, query: ragQuery, staticKB: knowledgeBase, kbActiveVersion,
            channel, conversationHistory, hasEcommerceChunks: !!productCatalog, userId,
        });

        // 4. Call AI — DM tests resolve the language hint through the SAME
        // defer-to-history helper as production DMs (resolveDmLanguageHint), so
        // eval results for Latin-floor messages on threads with history match
        // what production actually sends. Comment tests keep their own chain.
        const resolvedLang = isCommentTest
            ? resolveCommentLanguage(questionForAI, postMessage, effectiveKB)
            : resolveDmLanguageHint(question, !!conversationHistory?.length);

        // Merge caller-provided customerContext with extracted conversation data (same as DM pipeline)
        const playgroundExtracted = conversationHistory?.length ? extractConversationData(conversationHistory) : null;
        const mergedCustomerCtx = [customerContext, playgroundExtracted].filter(Boolean).join('. ') || undefined;

        const aiRequest = {
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
                ...(channel === 'dm' && senderName ? { senderName } : {}),
                ...(channel === 'dm' && typeof minutesSinceLastMessage === 'number' ? { minutesSinceLastMessage } : {}),
                ...(replyStyle ? { replyStyle } : {}),
                ...(replyMode ? { replyMode } : {}),
                ...(brandVoiceNotes ? { brandVoiceNotes } : {}),
                ...(businessInfoBlock ? { businessInfoBlock } : {}),
                ...(factCollectionsBlock ? { factCollectionsBlock } : {}),
                ...(factCollectionsGated ? { factCollectionsGated } : {}),
                ...(mergedCustomerCtx ? { customerContext: mergedCustomerCtx } : {}),
                ...(defaultReplyLanguage ? { defaultReplyLanguage } : {}),
                ...(timezone ? { timezone } : {}),
                ...(ecommerceStoreId ? { ecommerceStoreId } : {}),
                pipeline: pipeline ?? 'playground',
            },
        };

        const aiResponse = await dispatchAiReply(aiRequest);

        // 5. Derive flags + intent — shared with processAiResponse (production), so the
        // test tool/eval can't drift from production. Playground skips the billing + gap
        // side effects that processAiResponse layers on top.
        const { normalizedIntent, flags, replyShortened } = computeReplyFlags({
            aiFlags: aiResponse.flags,
            confidence: aiResponse.confidence,
            intent: aiResponse.intent,
            queryText: questionForAI,
            ragAttempted,
            retrievedChunkCount: retrievedChunks?.length ?? 0,
            hasEffectiveKB: !!effectiveKB,
        });

        const needsAttention = computeNeedsAttention(flags, normalizedIntent);
        // Don't skip DM replies that originated from a post comment (dual mode) —
        // the customer engaged with a CTA post and deserves a response.
        // Likewise never SPAM-skip a content-free comment on a post, on ANY channel:
        // "٠٠٠" / "." is the customer following the post's CTA. rewriteContentFreeCta
        // normally prevents the spam verdict at the input; this is the deterministic
        // backstop so a model quirk about one Unicode script can't silence solicited
        // engagement (eval #324). OFFENSIVE is NOT bypassed — shouldSilentlySkip is
        // true only for SPAM_OR_IRRELEVANT, so an offensive emoji still skips+flags.
        const solicitedCta = !!postMessage && isContentFree(question.trim());
        const skipped = (channel === 'dm' && postMessage)
            ? false
            : shouldSkipReply(flags.join(','), normalizedIntent)
                && !(solicitedCta && shouldSilentlySkip(normalizedIntent));
        const useFallback = shouldUseFallback(flags.join(','), normalizedIntent);

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
            finalReply = priceFallbackText(lang);
        }

        return {
            reply: finalReply,
            replyMethod: skipped ? 'skipped' : 'ai',
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
            replyShortened,
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
        // Derive flags + normalized intent — shared with generateForPlayground so the
        // test tool/eval can't drift from this production path (see computeReplyFlags).
        const { normalizedIntent, flags, replyShortened } = computeReplyFlags({
            aiFlags: aiResponse.flags,
            confidence: aiResponse.confidence,
            intent: aiResponse.intent,
            queryText,
            ragAttempted,
            retrievedChunkCount: retrievedChunkCount ?? 0,
            hasEffectiveKB: !!hasStaticKB,
        });
        const needsAttention = computeNeedsAttention(flags, normalizedIntent);
        const flagReason = flags.join(',') ||
            (normalizedIntent === 'COMPLAINT' ? 'complaint' : null) ||
            (normalizedIntent === 'OFFENSIVE' ? 'offensive' : null) ||
            undefined;
        // Capture the unanswered question so the inbox can tell the merchant
        // exactly what to add to Business Info (see buildKbGapFlagMeta).
        const flagMeta = buildKbGapFlagMeta(flags, queryText);

        await subscriptionsService.incrementAiReplies(userId);

        // Record quota-consumption event in legacy `usage_logs` (NOT the cost
        // source — `ai_usage_log` is written by ai.ts via logAiUsage). Skip
        // for cached responses since no real tokens were consumed.
        if (!aiResponse.cached) {
            await subscriptionsService.logQuotaEvent(userId, pageId, aiResponse.tokensUsed, aiResponse.model || DEFAULT_AI_MODEL);
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
            flagMeta,
            aiIntent: normalizedIntent,
            confidence: aiResponse.confidence,
            ...(aiResponse.productCards?.length ? { productCards: aiResponse.productCards } : {}),
            ...(replyShortened ? { replyShortened: true } : {}),
        };
    }
}

export const replyGenerator = new ReplyGenerator();

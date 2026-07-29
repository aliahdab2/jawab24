/**
 * Shared types for the reply-generation pipeline.
 *
 * Extracted from openai.ts so the prompt builder, validator, and request-context
 * helpers can share them without importing the service (avoids an import cycle).
 * openai.ts re-exports GenerateRequest / GenerateResponse for backward compat —
 * external callers keep importing them from '../openai'.
 */

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date;
}

export interface RetrievedChunkContext {
    type: string;
    title: string | null;
    content: string;
    score: number;
}

export interface GenerateRequest {
    comment: string;
    language?: string;
    /**
     * Whether `language` is a POSITIVE reading of this message or just a fallback.
     *
     * The backend's detector returns en@0.5 for "Latin script, recognized nothing"
     * — accent-free French, romanized Urdu/Tagalog, phone numbers, "12h" — which is
     * 68.77% of Latin-script inbound traffic. Passing that as a bare `language: 'en'`
     * made the prompt assert "The customer wrote in English. Do NOT switch", and the
     * model obeyed on a French message (2026-07-29 WhatsApp report).
     *
     * `false` = treat `language` as a sticky default the model may correct by
     * mirroring the customer. Absent = fall back to structural provenance from the
     * resolution chain (see resolveInputLanguageWithSource).
     */
    languageCertain?: boolean;
    context?: {
        /** Backend-side tag used for Phase 6.5 diagnostic counters. Opaque here. */
        pipeline?: string;
        postMessage?: string;
        pageName?: string;
        previousReplies?: string[];
        knowledgeBase?: string;
        retrievedChunks?: RetrievedChunkContext[];
        storePolicies?: string;
        productCatalog?: string;
        channel?: 'comment' | 'dm';
        conversationHistory?: ConversationMessage[];
        replyStyle?: string;
        brandVoiceNotes?: string;
        /**
         * Stage 2.6 structured BUSINESS_INFO prompt block (pre-formatted by
         * backend's contextEnricher via `formatBusinessInfoPrompt`). Built from
         * `business_profile.merchant` ONLY — never FB suggestions — and further
         * provenance-gated so only merchant-authored fields (editor/kb_extract)
         * are asserted; unconfirmed FB-sync values are demoted to the narrative
         * fallback so they can't override the merchant's KB text. The AI treats
         * this block as authoritative and refuses to invent values for fields
         * marked `[NOT_PROVIDED]`. Null/absent → no block injected.
         */
        businessInfoBlock?: string | null;
        customerContext?: string;
        /**
         * Customer's display name from the platform profile (FB display name,
         * WhatsApp profile name, or IG username). The backend already fetches this
         * (adapter.fetchSenderName); here it is used only for DM addressing and, in
         * Arabic, to infer grammatical gender (see promptBuilder). It lives in the
         * per-call block AFTER the cached prefix, so it never affects the OpenAI
         * prompt-prefix cache. Cache correctness for the exact-reply cache is handled
         * backend-side (buildCacheKey buckets DMs by first name). Absent → no name
         * line and gender falls back to message self-reference, then neutral.
         */
        senderName?: string;
        /** Merchant's configured fallback language — used when all detection signals fail. */
        defaultReplyLanguage?: string;
        /**
         * Merchant's IANA timezone (settings.timezone, e.g. 'Asia/Riyadh'). Used to
         * compute the "Today's date" line in the prompt so the model can tell whether
         * dates in KB content / the post are past or upcoming. Absent → UTC.
         */
        timezone?: string;
        /**
         * When true, the backend has already prepended the merchant's configured
         * welcome greeting to this reply (customer's first message). The model must
         * NOT add its own greeting — answer directly — or the customer sees a double
         * "welcome". See backend messageProcessor first-message handling.
         */
        suppressGreeting?: boolean;
        /**
         * Minutes since the previous message in this thread (computed backend-side
         * from messages.created_at — platform-generic: FB/IG/WhatsApp). Rendered as
         * a plain fact line in the per-call block so the model has the clock a human
         * has: it can tell a live conversation (seconds/minutes) from a days-later
         * return, and behave naturally in each. Information only, no rules. Lives in
         * the per-call block AFTER the cached prefix (never breaks the OpenAI prompt
         * cache), and only set on the with-history path, which skips all reply caches.
         */
        minutesSinceLastMessage?: number;
    };
}

export interface GenerateResponse {
    reply: string;
    language: string;
    model?: string;
    tokensUsed?: number;
    tokensIn?: number;
    tokensInCached?: number;
    tokensOut?: number;
    intent?: string;
    confidence?: string;
    flags?: string[];
    /**
     * v53 gender self-report — the grammatical gender the reply's address forms
     * actually use ('unknown' = no gendered forms), what that decision was based
     * on, and whether the reply embeds the customer's name in any script. The
     * backend uses these to learn a first-name→gender consensus map and to gate
     * which bucket a reply may be cached in (see backend ai.ts saveToCache guard).
     * Absent on paths that don't emit them (failover, e-commerce tool loop) —
     * the backend fail-safes to per-name bucketing.
     */
    gender?: 'm' | 'f' | 'unknown';
    genderBasis?: 'self' | 'name' | 'unclear';
    usedName?: boolean;
}

export interface TokenInfo {
    estimated_tokens_in: number;
    max_input_tokens: number;
    history_count: number;
    kb_truncated: boolean;
    kb_original_chars: number;
    chunk_count: number;
    prompt_version: string;
}

/** One line of the model's self-reported cart arithmetic (v56).
 *  `unit` must be a price that appears literally in Business Info / the
 *  catalog; `qty` a positive integer. Verified deterministically in
 *  replyValidator (Check 1b) — never trusted as-is. */
export interface PriceMathTerm {
    unit: number;
    qty: number;
}

/** A claimed computed total: Σ(unit×qty) over `terms` must equal `total`. */
export interface PriceMathClaim {
    total: number;
    terms: PriceMathTerm[];
}

/** The JSON object GPT returns (parsed, before validation). */
export interface ParsedReply {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    hedging?: boolean;
    language?: string;
    gender?: 'm' | 'f' | 'unknown';
    gender_basis?: 'self' | 'name' | 'unclear';
    used_name?: boolean;
    /**
     * v56 price-math self-report — when the reply quotes a COMPUTED total
     * (items + delivery, quantity × unit price), the model lists the breakdown
     * here. replyValidator verifies every unit against KB values and the
     * arithmetic; verified totals extend Check 1's accepted set for this reply
     * only. null / absent / malformed → the literal-KB guard, unchanged.
     * Typed `unknown`-compatible on purpose at the validator boundary — this is
     * model output and all shape-checking lives in verifiedPriceMathValues.
     */
    price_math?: PriceMathClaim[] | null;
}

/** Result of validateReply — `hedging` is consumed and dropped. */
export interface ValidatedReply {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    language?: string;
    gender?: 'm' | 'f' | 'unknown';
    genderBasis?: 'self' | 'name' | 'unclear';
    usedName?: boolean;
}

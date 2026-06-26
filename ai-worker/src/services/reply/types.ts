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

/** The JSON object GPT returns (parsed, before validation). */
export interface ParsedReply {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    hedging?: boolean;
    language?: string;
}

/** Result of validateReply — `hedging` is consumed and dropped. */
export interface ValidatedReply {
    reply: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    language?: string;
}

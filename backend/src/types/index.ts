// Re-export from organized type files
export * from './common';
export * from './logger';
export * from './auth';
export * from './facebook';
export * from './instagram';
export * from './settings';
export * from './payment';

// Conversation Message for AI context
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date;
}

// Retrieved KB chunk passed from retrieval to AI prompt
export interface RetrievedChunkContext {
    type: string;
    title: string | null;
    content: string;
    score: number;
}

// AI Types
export interface AiGenerateRequest {
    comment: string;
    /**
     * Resolved reply-language hint. A DEFAULT, not an assertion that the customer
     * wrote in it: 'en' here is often the detector's en@0.5 floor ("Latin script,
     * recognized nothing"). The ai-worker re-derives certainty from `comment`, so no
     * companion flag is sent — one was tried and every axios hop below dropped it.
     */
    language?: string;
    /** When set, ai-worker routes through the provider abstraction instead of the default OpenAI path. */
    model?: string;
    context?: {
        userId?: string;
        pageId?: string;
        pipeline?: import('./aiPipeline').AiPipeline;
        postMessage?: string;
        pageName?: string;
        previousReplies?: string[];
        knowledgeBase?: string;
        retrievedChunks?: RetrievedChunkContext[];
        storePolicies?: string;
        productCatalog?: string;
        channel?: 'comment' | 'dm';
        conversationHistory?: ConversationMessage[];
        kbActiveVersion?: number | null;
        queryEmbedding?: number[];
        replyStyle?: string;
        /**
         * Effective reply mode for this page ('sales' | 'info'), resolved via
         * resolveEffectiveReplyMode(page.replyMode, workspace.replyMode).
         * 'info' appends the INFO-DESK MODE block in ai-worker's promptBuilder
         * and joins both reply-cache scopes (`rm:i` exact segment + semantic
         * metadata). Absent = 'sales'.
         */
        replyMode?: string;
        brandVoiceNotes?: string;
        /**
         * Stage 2.6 structured BUSINESS_INFO prompt block, pre-formatted from
         * `business_profile.merchant`. Injected verbatim by ai-worker. Null/
         * absent → no structured block in the prompt; the AI falls back to
         * narrative KB only.
         */
        businessInfoBlock?: string | null;
        /**
         * G1a fact-collections block: the merchant's enumerable LIST facts
         * (outlets, coverage areas, delivery zones), each list followed by its
         * DERIVED coverage/absence statement. Pre-rendered by
         * `factCollectionsService.buildFactCollectionsContext`; ai-worker
         * injects it verbatim as <business_lists>. Absent → no block in the
         * prompt, which is the case for every page without collections.
         */
        factCollectionsBlock?: string;
        /**
         * True when the block's rows were filtered to this message (G1 stage L2).
         * Disables the SEMANTIC cache for the reply — that cache matches by
         * embedding similarity, and two "where can I find you in X" questions with
         * different X are far inside the LOCATION threshold, so a hit would return
         * one area's outlets for another. The exact-text cache is unaffected.
         */
        factCollectionsGated?: boolean;
        /** Customer's display name — used for personalization only, never affects cache keys. */
        senderName?: string;
        /** Substantive customer context (history, returning-customer summary, etc.) that changes the answer. */
        customerContext?: string;
        ecommerceStoreId?: string;
        ecommerceToolsEnabled?: boolean;
        /** Merchant's configured fallback language — used when all detection signals fail. */
        defaultReplyLanguage?: string;
        /**
         * Merchant's IANA timezone (workspace settings). The ai-worker uses it to
         * compute the "Today's date" prompt line for past/upcoming date reasoning.
         */
        timezone?: string;
        /**
         * Minutes elapsed between the previous message in this thread (either
         * direction) and the current customer message. Platform-generic — computed
         * from messages.created_at, so FB/IG/WhatsApp all get it. Rendered by
         * ai-worker as a plain FACT line in the per-call block ("time since the
         * previous message: 3 days") so the model can behave like a human who can
         * see the clock: continue a live conversation vs. welcome back a returning
         * customer. Information only — no behavioral rules attached. Only set when
         * history exists, which is exactly the path that skips ALL reply caches
         * (ai.ts hasConversationHistory), so it never fragments cache keys.
         */
        minutesSinceLastMessage?: number;
    };
}

export interface AiGenerateResponse {
    reply: string;
    language: string;
    cached: boolean;
    model?: string;
    intent?: string;
    confidence?: string;
    flags?: string[];
    tokensUsed?: number;
    /**
     * Rich product cards to send as a follow-up attachment after the text reply.
     * Populated by ecommerceToolLoop when a tool surfaces product references.
     * Undefined for non-ecommerce replies and tools that return only scalar data.
     */
    productCards?: import('@jawab24/shared').ProductCard[];
    /**
     * What each e-commerce tool call decided, in execution order. Present only
     * when a tool round ran (omitted, not `[]`, on the no-tool path) so the eval
     * can pin "the resolver chose product X" / "answered ambiguous" next to the
     * reply text (Rule 19).
     */
    toolOutcomes?: ToolOutcome[];
}

/** One executed e-commerce tool call, reduced to what an assertion can read. */
export interface ToolOutcome {
    name: string;
    /** `success`, or the result's error code (`ambiguous_product`, `product_not_found`, …). */
    outcome: string;
    /** The product the resolver chose, when the tool answered about one. */
    platformProductId?: string;
    /** The candidates offered, when the tool answered `ambiguous_product`. */
    candidateIds?: string[];
}

export interface AiCacheEntry {
    id: string;
    commentHash: string;
    replyText: string;
    language: string | null;
    hitCount: number | null;
    createdAt: Date | null;
    lastUsedAt: Date | null;
}

export interface CreatePageDTO {
    facebookPageId: string | null;
    name: string;
    accessToken: string;
    autoReplyEnabled?: boolean;
    knowledgeBase?: string;
}

export interface UpdatePageDTO {
    name?: string;
    accessToken?: string;
    autoReplyEnabled?: boolean;
    knowledgeBase?: string;
    businessProfile?: import('../utils/validation').BusinessProfileInput;
    /**
     * Fields of `businessProfile` the merchant explicitly reviewed in this save
     * (opened that field's editor and saved), even if the value is unchanged.
     * Only these — plus fields whose value actually changed — get their
     * provenance stamped editor-confirmed; the rest of the full-replace echo
     * carries its existing provenance forward (the fb_sync-laundering fix).
     */
    businessProfileConfirmFields?: string[];
}

/**
 * Per-page lead-config override payload (PATCH /pages/:id/lead-config).
 * For each slice: `null` reverts it to the workspace default; a set value is a
 * full replacement for this page; an absent key leaves that slice unchanged.
 */
export interface UpdateLeadConfigDTO {
    leadStages?: import('@jawab24/shared').LeadStagesConfig | null;
    leadFields?: import('@jawab24/shared').LeadCustomFieldDef[] | null;
}

/**
 * Per-page persona override payload (PATCH /pages/:id/brand-voice, D-084).
 * `null` reverts the page to the workspace persona; a record with language
 * keys pins this page's own persona (auto-translated on save exactly like the
 * workspace field).
 */
export interface UpdateBrandVoiceDTO {
    brandVoiceNotesMulti: Record<string, string> | null;
}

/**
 * Per-page reply-mode override payload (PATCH /pages/:id/reply-mode).
 * `null` reverts the page to the workspace default; 'sales' | 'info' pins the
 * mode for this page (an explicit 'sales' pin survives a workspace-level flip).
 */
export interface UpdateReplyModeDTO {
    replyMode: import('@jawab24/shared').ReplyMode | null;
}

// Post Types
export interface Post {
    id: string;
    pageId: string | null;
    facebookPostId: string;
    message: string | null;
    autoReplyEnabled: boolean | null;
    triggerKeyword: string | null;
    triggerReply: string | null;
    createdTime: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreatePostDTO {
    pageId: string;
    facebookPostId: string;
    message?: string;
    autoReplyEnabled?: boolean;
    createdTime?: Date;
}

export interface UpdatePostDTO {
    message?: string;
    autoReplyEnabled?: boolean;
    triggerKeyword?: string | null;
    triggerReply?: string | null;
    scheduledPublishTime?: Date | null;
}

// Comment Types
export interface Comment {
    id: string;
    postId: string | null;
    facebookCommentId: string;
    message: string;
    fromId: string | null;
    fromName: string | null;
    replied: boolean | null;
    replyText: string | null;
    replyMethod: string | null;
    detectedLanguage: string | null;
    replyLanguage: string | null;
    needsAttention: boolean | null;
    flagReason: string | null;
    flagMeta: import('@jawab24/shared').FlagMeta | null;
    aiIntent: string | null;
    createdTime: Date | null;
    repliedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreateCommentDTO {
    postId: string;
    workspaceId: string;
    facebookCommentId: string;
    message: string;
    fromId?: string;
    fromName?: string;
    /** Facebook Graph `message_tags` — see comments.messageTags schema column. */
    messageTags?: import('../utils/commentText').FacebookMessageTag[];
    createdTime?: Date;
    repliedAt?: Date;
}

export interface UpdateCommentDTO {
    replied?: boolean;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual' | 'post_reply';
    detectedLanguage?: string;
    replyLanguage?: string;
    repliedAt?: Date;
    needsAttention?: boolean;
    flagReason?: string | null;
    flagMeta?: import('@jawab24/shared').FlagMeta | null;
    aiIntent?: string | null;
    fromName?: string;
    resolved?: boolean;
}

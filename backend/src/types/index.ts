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
    language?: string;
    /** When set, ai-worker routes through the provider abstraction instead of the default OpenAI path. */
    model?: string;
    context?: {
        userId?: string;
        pageId?: string;
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
        kbActiveVersion?: number | null;
        queryEmbedding?: number[];
        replyStyle?: string;
        brandVoiceNotes?: string;
        /** Customer's display name — used for personalization only, never affects cache keys. */
        senderName?: string;
        /** Substantive customer context (history, returning-customer summary, etc.) that changes the answer. */
        customerContext?: string;
        ecommerceStoreId?: string;
        ecommerceToolsEnabled?: boolean;
        /** Merchant's configured fallback language — used when all detection signals fail. */
        defaultReplyLanguage?: string;
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
    replyMethod?: 'template' | 'ai' | 'manual';
    detectedLanguage?: string;
    replyLanguage?: string;
    repliedAt?: Date;
    needsAttention?: boolean;
    flagReason?: string | null;
    aiIntent?: string | null;
    fromName?: string;
}

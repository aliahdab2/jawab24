// Re-export from organized type files
export * from './common';
export * from './logger';
export * from './auth';
export * from './facebook';
export * from './instagram';
export * from './settings';
export * from './payment';

// Rule Types
export interface Rule {
    id: string;
    userId: string | null;
    name: string;
    keywords: string[] | null;
    templateId: string | null;
    priority: number | null;
    active: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreateRuleDTO {
    name: string;
    keywords?: string[];
    templateId?: string;
    priority?: number;
    active?: boolean;
}

export type UpdateRuleDTO = Partial<CreateRuleDTO>;

// Template Types
export interface Template {
    id: string;
    userId: string | null;
    name: string;
    message: string;
    active: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreateTemplateDTO {
    name: string;
    message: string;
    active?: boolean;
}

export type UpdateTemplateDTO = Partial<CreateTemplateDTO>;

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
        customerContext?: string;
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

// Page Types
export interface Page {
    id: string;
    userId: string | null;
    facebookPageId: string;
    name: string | null;
    accessToken: string;
    autoReplyEnabled: boolean | null;
    knowledgeBase: string | null;
    kbVersion: number | null;
    kbActiveVersion: number | null;
    kbUpdatedAt: Date | null;
    businessProfile: Record<string, unknown> | null;
    businessProfileUpdatedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreatePageDTO {
    facebookPageId: string;
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
    businessProfile?: Record<string, unknown>;
}

// Post Types
export interface Post {
    id: string;
    pageId: string | null;
    facebookPostId: string;
    message: string | null;
    autoReplyEnabled: boolean | null;
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
    templateId: string | null;
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
    facebookCommentId: string;
    message: string;
    fromId?: string;
    fromName?: string;
    createdTime?: Date;
    repliedAt?: Date;
}

export interface UpdateCommentDTO {
    replied?: boolean;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    templateId?: string;
    detectedLanguage?: string;
    replyLanguage?: string;
    repliedAt?: Date;
    needsAttention?: boolean;
    flagReason?: string | null;
    aiIntent?: string | null;
}

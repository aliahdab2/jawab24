// Re-export from organized type files
export * from './common';
export * from './logger';
export * from './instagram';
export * from './settings';
export * from './payment';

// User types
export interface User {
    id: string;
    facebookId: string;
    name: string | null;
    email: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

// JWT payload
export interface JWTPayload {
    userId: string;
    facebookId: string;
    iat?: number;
    exp?: number;
}

// Facebook API responses
export interface FacebookTokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
}

export interface FacebookUserProfile {
    id: string;
    name: string;
    email?: string;
}

export interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
    category?: string;
    tasks?: string[];
}

export interface FacebookPagesResponse {
    data: FacebookPage[];
    paging?: {
        cursors?: {
            before: string;
            after: string;
        };
    };
}

// Request/Response types
export interface AuthRequest {
    code: string;
}

export interface AuthResponse {
    token: string;
    fbAccessToken: string;
    user: {
        id: string;
        name: string;
        email?: string;
        facebookId: string;
    };
}

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
    translations: Record<string, string>;
    keywords: string[] | null;
    active: boolean | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface CreateTemplateDTO {
    name: string;
    translations: Record<string, string>;
    keywords?: string[];
    active?: boolean;
}

export type UpdateTemplateDTO = Partial<CreateTemplateDTO>;

// Conversation Message for AI context
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: Date;
}

// AI Types
export interface AiGenerateRequest {
    comment: string;
    language?: string;
    context?: {
        postMessage?: string;
        pageName?: string;
        previousReplies?: string[];
        knowledgeBase?: string;
        conversationHistory?: ConversationMessage[];
    };
}

export interface AiGenerateResponse {
    reply: string;
    language: string;
    cached: boolean;
    model?: string;
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
}

export interface UpdateCommentDTO {
    replied?: boolean;
    replyText?: string;
    replyMethod?: 'template' | 'ai' | 'manual';
    templateId?: string;
    detectedLanguage?: string;
    replyLanguage?: string;
    repliedAt?: Date;
}

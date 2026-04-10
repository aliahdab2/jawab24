/**
 * Comment Platform Adapter Interface
 *
 * Defines the contract that each platform (Facebook, Instagram, WhatsApp, Shopify)
 * must implement to plug into the shared comment processing pipeline.
 */

import type { Platform, PlatformPage } from './platform-adapter';

/** Normalized stored comment returned by the adapter */
export interface StoredComment {
    id: string;
    replied: boolean;
    needsAttention?: boolean;
}

/** Normalized content entity (post / media) that a comment belongs to */
export interface ContentEntity {
    id: string;
    autoReplyEnabled: boolean;
    /** Post message or media caption — passed to reply generator for context */
    message?: string | null;
    /** Per-post engagement trigger: keyword the merchant asks followers to comment */
    triggerKeyword?: string | null;
    /** Per-post engagement trigger: reply sent when triggerKeyword is matched */
    triggerReply?: string | null;
}

/** Context passed to replyGenerator.generateForComment */
export interface CommentReplyContext {
    workspaceId: string;
    userId: string;       // kept for billing (subscription checks)
    text: string;
    pageName?: string;
    knowledgeBase?: string;
    kbActiveVersion?: number | null;
    postId?: string;
    postMessage?: string;
    pageId: string;
    accessToken?: string;
    storePolicies?: string;
    productCatalog?: string;
    replyStyle?: 'professional' | 'casual' | 'enthusiastic';
    brandVoiceNotes?: string;
    senderName?: string;
}

export interface SendCommentResult {
    success: boolean;
    error?: string;
}

export interface CommentPlatformAdapter {
    readonly platform: Platform;

    /** Look up the page by platform-specific ID */
    getPage(platformPageId: string): Promise<PlatformPage | null>;

    /** Find or create the content entity (post/media) for this comment */
    findOrCreateContent(pageId: string, contentId: string): Promise<ContentEntity>;

    /** Store the incoming comment, return { comment, isNew } */
    storeComment(
        contentId: string,
        platformCommentId: string,
        message: string,
        fromId?: string,
        fromName?: string,
    ): Promise<{ comment: StoredComment; isNew: boolean }>;

    /** Send the reply to the platform */
    sendReply(opts: {
        platformCommentId: string;
        platformPageId: string;
        replyText: string;
        commentMessage: string;
        accessToken: string;
        fromId?: string;
        userSettings: Record<string, unknown>;
        /** Post/media text — used to detect language when comment is punctuation-only */
        postMessage?: string;
    }): Promise<SendCommentResult>;

    /** Mark a stored comment as replied in the database */
    markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        detectedLanguage: string,
        templateId?: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ): Promise<void>;

    /**
     * Build the reply generator context from platform-specific data.
     * Called only after processor validates page.userId is non-null.
     */
    buildGeneratorContext(
        page: PlatformPage,
        contentEntity: ContentEntity,
        contentId: string,
    ): CommentReplyContext;

    /** Get fallback reply text when generator returns nothing (null = no fallback, return error) */
    getFallbackReply(): string | null;

    /** Flag a comment as needing attention without sending a reply */
    flagComment(commentId: string, flagReason?: string, aiIntent?: string): Promise<void>;

    /**
     * Fetch the commenter's name from the platform API (best-effort fallback).
     * Called when the webhook didn't include the commenter name.
     * Optional — platforms that don't support this can omit it.
     */
    fetchCommenterName?(platformCommentId: string, accessToken: string): Promise<string | undefined>;
}

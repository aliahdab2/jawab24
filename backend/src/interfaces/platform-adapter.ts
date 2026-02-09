/**
 * Platform Adapter Interface
 *
 * Defines the contract that each messaging platform (Facebook, Instagram, WhatsApp, Shopify)
 * must implement to plug into the shared message processing pipeline.
 */

/** Normalized page representation used by the shared pipeline */
export interface PlatformPage {
    id: string;
    userId: string | null;
    name: string | null;
    accessToken: string;
    knowledgeBase: string | null;
    /** Whether auto-reply is enabled for this platform on this page */
    autoReplyEnabled: boolean;
    /** Platform-specific account ID (e.g., instagramAccountId) — set by adapter */
    platformAccountId?: string;
    /** Linked Shopify store ID for product-aware AI replies */
    shopifyStoreId?: string | null;
}

/** Stored message returned by the adapter's storeIncomingMessage */
export interface StoredMessage {
    id: string;
    replied: boolean;
    needsAttention?: boolean;
}

export type Platform = 'facebook' | 'instagram' | 'shopify' | 'whatsapp';

export interface MessagePlatformAdapter {
    readonly platform: Platform;

    /** Look up the page/account by the platform-specific ID. Must set autoReplyEnabled for this platform. */
    getPage(platformPageId: string): Promise<PlatformPage | null>;

    /** Fetch the sender's display name (best-effort, may return undefined). pageId enables DB cache lookup. */
    fetchSenderName(senderId: string, accessToken: string, pageId?: string): Promise<string | undefined>;

    /** Store the incoming message and return { message, isNew } */
    storeIncomingMessage(
        pageId: string,
        platformMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }>;

    /** Convert platform message ID to the internal ID used for debounce lookups */
    getInternalMessageId(platformMessageId: string): string;

    /** Send a reply message to the sender */
    sendReply(page: PlatformPage, senderId: string, text: string): Promise<void>;

    /** Send an away message when auto-reply is disabled */
    sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void>;

    /** Mark a stored message as replied in the database */
    markAsReplied(
        messageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
    ): Promise<void>;
}

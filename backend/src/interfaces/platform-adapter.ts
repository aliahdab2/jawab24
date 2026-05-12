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
    workspaceId: string | null;
    name: string | null;
    accessToken: string;
    knowledgeBase: string | null;
    /** Active KB version for RAG retrieval (null = no chunks ingested yet) */
    kbActiveVersion: number | null;
    /** Whether auto-reply is enabled for this platform on this page */
    autoReplyEnabled: boolean;
    /** Platform-specific account ID (e.g., instagramAccountId) — set by adapter */
    platformAccountId?: string;
    /** Linked e-commerce store ID for product-aware AI replies */
    ecommerceStoreId?: string | null;
    /** Structured business profile from Facebook sync (hours, phone, address, etc.) */
    businessProfile?: Record<string, unknown> | null;
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

    /** Max characters for a single reply on this platform (default: 2000) */
    readonly maxReplyLength?: number;

    /** Look up the page/account by the platform-specific ID. Must set autoReplyEnabled for this platform. */
    getPage(platformPageId: string): Promise<PlatformPage | null>;

    /** Fetch the sender's display name (best-effort, may return undefined). pageId enables DB cache lookup; platformPageId enables platform API fallback. */
    fetchSenderName(senderId: string, accessToken: string, pageId?: string, platformPageId?: string): Promise<string | undefined>;

    /** Store the incoming message and return { message, isNew } */
    storeIncomingMessage(
        pageId: string,
        workspaceId: string,
        platformMessageId: string,
        senderId: string,
        text: string,
        senderName?: string,
    ): Promise<{ message: StoredMessage; isNew: boolean }>;

    /** Convert platform message ID to the internal ID used for debounce lookups */
    getInternalMessageId(platformMessageId: string): string;

    /** Send typing indicator (cosmetic, fire-and-forget). Not all platforms support this. */
    sendTypingIndicator?(page: PlatformPage, senderId: string): Promise<void>;

    /**
     * Send a reply message to the sender.
     * `incomingMessageId` (when provided) is the platform's `mid` for the
     * customer's message we're replying to — Messenger uses it to render the
     * reply as a quoted thread reply. Adapters whose platform doesn't support
     * quoted replies (Instagram) ignore the parameter.
     */
    sendReply(page: PlatformPage, senderId: string, text: string, incomingMessageId?: string): Promise<void>;

    /**
     * Send an emoji reaction to a specific incoming message.
     * Optional: not all platforms support reactions (Instagram DM API doesn't).
     * The shared pipeline checks for this method's presence before calling.
     */
    sendReaction?(
        page: PlatformPage,
        senderId: string,
        incomingMessageId: string,
        reaction: 'like' | 'love',
    ): Promise<void>;

    /**
     * Send rich product cards (Generic Template carousel) as a follow-up to a text reply.
     * Optional: adapters that don't support attachments (e.g., WhatsApp today) may omit this.
     * Callers should fall back to text only when the method is absent.
     */
    sendProductCards?(
        page: PlatformPage,
        senderId: string,
        cards: import('@jawab24/shared').ProductCard[],
    ): Promise<void>;

    /** Send an away message when auto-reply is disabled */
    sendAwayMessage(page: PlatformPage, senderId: string, text: string): Promise<void>;

    /** Mark a stored message as replied in the database */
    markAsReplied(
        messageId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply' | 'reaction',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ): Promise<void>;
}

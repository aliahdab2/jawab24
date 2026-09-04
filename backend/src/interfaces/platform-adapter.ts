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
    /** `pages.kb_indexed_version` — the chunk generation retrieval may read (D-106). */
    kbIndexedVersion: number | null;
    /** Whether auto-reply is enabled for this platform on this page */
    autoReplyEnabled: boolean;
    /**
     * Why auto-reply is off ('user' | 'plan_limit' | 'trial_block' | null).
     * Only the Facebook page-level toggle carries this; platform-specific
     * toggles (Instagram) are merchant-explicit and never set a reason.
     */
    autoReplyDisabledReason?: string | null;
    /** Platform-specific account ID (e.g., instagramAccountId) — set by adapter */
    platformAccountId?: string;
    /**
     * Which credential + Graph host this page's INSTAGRAM traffic rides on.
     * Set by the two Instagram adapters (`resolveInstagramCredential`); absent on
     * Facebook and WhatsApp pages. Instagram Login accounts live on
     * graph.instagram.com with their own token, so anything issuing an Instagram
     * Graph call must take the host from here rather than assume graph.facebook.com.
     */
    instagramCredential?: import('../services/instagramCredential').InstagramCredential;
    /** Linked e-commerce store ID for product-aware AI replies */
    ecommerceStoreId?: string | null;
    /** Structured business profile from Facebook sync (hours, phone, address, etc.) */
    businessProfile?: Record<string, unknown> | null;
    /**
     * Per-page persona override (D-084). Must ride the adapter mapping: the
     * processors hand THIS object to enrichPageContext, so a field missing here
     * is a feature that works in the playground and is silently dark in
     * production (the Rule 19.2 drift, inverted).
     */
    brandVoiceNotesMulti?: Record<string, string> | null;
    /** Per-page reply-mode override ('sales' | 'info'); null = inherit workspace default */
    replyMode?: string | null;
}

/** Stored message returned by the adapter's storeIncomingMessage */
export interface StoredMessage {
    id: string;
    replied: boolean;
    needsAttention?: boolean;
    /** Needed by stale-backlog suppression to measure message age. */
    createdAt?: Date | string | null;
    /** Store-then-enrich lifecycle marker (null | 'pending' | 'done' | 'failed').
     *  When set, this row is an attachment that nonTextHandler already announced
     *  via SSE — messageProcessor uses it to skip a duplicate `message:received`. */
    enrichmentStatus?: string | null;
}

export type Platform = 'facebook' | 'instagram' | 'shopify' | 'whatsapp';

export interface MessagePlatformAdapter {
    readonly platform: Platform;

    /** Max characters for a single reply on this platform (default: 2000) */
    readonly maxReplyLength?: number;

    /** Look up the page/account by the platform-specific ID. Must set autoReplyEnabled for this platform. */
    getPage(platformPageId: string): Promise<PlatformPage | null>;

    /**
     * Fetch the sender's display name (best-effort, may return undefined). pageId enables DB cache
     * lookup; platformPageId enables platform API fallback. `baseUrl` overrides the Graph host —
     * only Instagram Login pages need it (graph.instagram.com); every other page omits it and the
     * adapter falls back to graph.facebook.com.
     */
    fetchSenderName(senderId: string, accessToken: string, pageId?: string, platformPageId?: string, baseUrl?: string): Promise<string | undefined>;

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
     * Clear the typing indicator on abort paths (skip/hold/empty/delivery-failed).
     * Optional: platforms without a typing indicator can omit this. The happy
     * path doesn't need it — sending the actual message auto-clears typing on
     * Messenger and Instagram.
     */
    sendTypingOff?(page: PlatformPage, senderId: string): Promise<void>;

    /**
     * Send a reply message to the sender.
     *
     * Returns the PLATFORM's own message id when the channel gives us one
     * (WhatsApp returns a `wamid`), otherwise undefined. Callers persist it as
     * `messages.platformMessageId` so an inbound echo of that same message can
     * later be recognised as OUR send rather than a human's.
     *
     * That matters for WhatsApp Coexistence, where the merchant keeps the
     * Business app on the same number: Meta echoes every outbound message back,
     * including the ones we sent via the API. Without a stored id to compare
     * against, the echo handler would read our own replies as "a human answered"
     * and pause the bot after every message it sent.
     */
    /**
     * Render the canonical (markdown-capable) reply text into what THIS channel
     * can display. Pure, synchronous, no I/O. The pipeline calls it immediately
     * before `sendReply` and persists the result, so the stored row is what the
     * customer saw. Messenger/Instagram render nothing → plain; WhatsApp has its
     * own `*bold*` markup → translated. See `renderReplyForChannel`.
     *
     * `knownPhones` are the merchant's own contact lines; each is isolated in
     * place so a spaced number does not paint its groups backwards in Arabic RTL.
     */
    renderReply(text: string, knownPhones?: string[]): string;

    sendReply(page: PlatformPage, senderId: string, text: string): Promise<string | undefined>;

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
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
    ): Promise<void>;
}

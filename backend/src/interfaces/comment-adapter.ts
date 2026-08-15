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
    /** How the per-post trigger fires: 'keyword' (match triggerKeyword) | 'all' (any comment). */
    triggerType?: string | null;
    /** Comma-separated veto keywords — a comment containing any never fires the rule. */
    triggerExcludeKeyword?: string | null;
    /** CTA link button (DM-modes only, Facebook-only): label + URL, stored together. */
    triggerButtonLabel?: string | null;
    triggerButtonUrl?: string | null;
    /** Attached Post Reply image URL (DM-modes only), or null when none. */
    triggerImageUrl?: string | null;
    /** Post Reply option: like the customer's comment after a successful send.
     *  Facebook-only column — Instagram content never carries it. */
    likeComment?: boolean;
    /** Post Reply option: mention (@-tag) the commenter in the public comment.
     *  Facebook-only column — Instagram content never carries it. */
    tagCommenter?: boolean;
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
    /** Effective reply mode ('sales' | 'info') — resolved by commentProcessor from
     *  page.replyMode ?? workspace settings.replyMode. */
    replyMode?: string;
    brandVoiceNotes?: string;
    /** Stage 2.6 structured BUSINESS_INFO block (merchant-confirmed only). */
    businessInfoBlock?: string | null;
    /** G1a fact-collections prompt block — enumerable lists (outlets, coverage
     *  areas, delivery zones) plus their derived coverage statements. */
    factCollectionsBlock?: string;
    /** See GenerateReplyContext.factCollectionsGated. */
    factCollectionsGated?: boolean;
    senderName?: string;
    defaultReplyLanguage?: string;
    /** Merchant's IANA timezone (workspace settings) — drives the "Today's date" prompt line. */
    timezone?: string;
    /** Facebook `message_tags` array — present for Facebook comments only. Feeds the
     *  user-tag / page-tag classification in commentPreprocess.preprocessCommentText. */
    messageTags?: import('../utils/commentText').FacebookMessageTag[];
    /** Our own Facebook page id — required to distinguish a page-tag pointing at us
     *  (a real question) from a page-tag pointing at another page (skip). */
    ourFacebookPageId?: string;
}

export interface SendCommentResult {
    success: boolean;
    error?: string;
    /** PSID of the DM recipient, present when a private message was successfully sent */
    dmRecipientId?: string;
    /**
     * Structured info about a DM failure, if any. Consumed by commentProcessor
     * to decide page-level integration alerts (never per-comment flags).
     * See docs/comment-and-message-handling.md → "DM-failure-aware fallback".
     */
    dmFailure?: import('../utils/fbGraphErrors').DmFailure;
    /**
     * Classified Graph failure of a PUBLIC comment post. Separate from `dmFailure` on
     * purpose — no DM was attempted, and `dmFailure`'s presence drives both the inbox
     * flag (`dm_failed` vs `send_failed`) and the auto-pause bucket. Consumed only by
     * page-token recovery, which needs the code/subcode to tell a dead credential from
     * a blip. See services/reply/sender.ts → SendReplyResult.publicFailure.
     */
    publicFailure?: import('../utils/fbGraphErrors').DmFailure;
    /** True when the public fallback was intentionally suppressed by the failure bucket. */
    suppressedPublic?: boolean;
    /** True when a Post Reply image was actually delivered (its own native-image message
     *  sent after the text). Drives the delivery-accurate "image attached" badge. */
    imageDelivered?: boolean;
}

export interface CommentPlatformAdapter {
    readonly platform: Platform;

    /** Look up the page by platform-specific ID */
    getPage(platformPageId: string): Promise<PlatformPage | null>;

    /** Find or create the content entity (post/media) for this comment */
    findOrCreateContent(pageId: string, contentId: string, accessToken?: string): Promise<ContentEntity>;

    /** Store the incoming comment, return { comment, isNew } */
    storeComment(
        contentId: string,
        workspaceId: string,
        platformCommentId: string,
        message: string,
        fromId?: string,
        fromName?: string,
        messageTags?: import('../utils/commentText').FacebookMessageTag[],
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
        /** Post Reply image URL. Delivered ONLY on the DM channel (private/dual) — the
         *  adapter gates by mode; a public reply never carries it. Undocumented for AI/template. */
        replyImageUrl?: string | null;
        /** Internal post UUID — lets the adapter build the «Read more» postback payload for a
         *  long image caption (FB). Only set on the post_reply-with-image path. */
        postId?: string;
        /** Post Reply CTA link button (DM channel only, Facebook only): label + URL. Only set on
         *  the post_reply path; the adapter delivers it in the private/dual branch, never public. */
        replyCta?: { label: string; url: string } | null;
        /** Post Reply option: mention (@-tag) the commenter in the PUBLIC comment (never in the
         *  DM — a DM already goes to them). Only set on the post_reply path. Facebook resolves it
         *  against `fromId`; the Instagram adapter ignores it (IG mentions need `@username`). */
        tagCommenter?: boolean;
        /** Which Graph host + credential this page's Instagram calls use. Set by the processor
         *  from the PlatformPage; absent on Facebook. See `resolveInstagramCredential`. */
        instagramCredential?: import('../services/instagramCredential').InstagramCredential;
    }): Promise<SendCommentResult>;

    /** Mark a stored comment as replied in the database */
    markAsReplied(
        commentId: string,
        replyText: string,
        replyMethod: 'template' | 'ai' | 'manual' | 'post_reply',
        detectedLanguage: string,
        needsAttention?: boolean,
        flagReason?: string,
        aiIntent?: string,
        aiOriginalReply?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
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

    /**
     * Flag a comment without sending a reply. Default behavior: needsAttention=true,
     * resolved=false (surfaces in the actionable inbox).
     *
     * `autoResolve=true` flips that to needsAttention=false, resolved=true: the failure
     * is still recorded in flag_reason + flag_meta for analytics/filtering, but it stays
     * out of the page owner's queue. Used for unactionable failures like customer_refused
     * where no manual intervention can succeed.
     */
    flagComment(
        commentId: string,
        flagReason?: string,
        aiIntent?: string,
        flagMeta?: import('@jawab24/shared').FlagMeta | null,
        autoResolve?: boolean,
    ): Promise<void>;

    /**
     * Fetch the commenter's name from the platform API (best-effort fallback).
     * Called when the webhook didn't include the commenter name.
     * Optional — platforms that don't support this can omit it.
     */
    fetchCommenterName?(platformCommentId: string, accessToken: string): Promise<string | undefined>;

    /**
     * Fetch authoritative `message_tags` from the platform's API when the
     * webhook didn't deliver them. Only Facebook implements this — IG webhooks
     * don't carry tag data at all, and WhatsApp/Shopify don't have the concept.
     * Returns null on any error (network, permission, missing comment) so the
     * caller can fail-closed without throwing.
     */
    fetchCommentWithTags?(platformCommentId: string, accessToken: string): Promise<{
        message: string;
        message_tags?: Array<{ id: string; name: string; type: 'user' | 'page'; offset: number; length: number }>;
        from?: { id: string; name: string };
    } | null>;

    /**
     * Like the customer's comment as the page (Post Reply option). Best-effort:
     * callers fire-and-forget and a failure must never affect the reply. Resolves
     * to whether the like landed (never rejects) so callers can count failures.
     * Only Facebook implements this — the Instagram API has no like endpoint.
     */
    likeComment?(platformCommentId: string, accessToken: string): Promise<boolean>;
}

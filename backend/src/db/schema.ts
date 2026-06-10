import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, real, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL } from '@jawab24/shared';
import type { FacebookMessageTag } from '../utils/commentText';

// 1. Users Table
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    facebookId: varchar('facebook_id', { length: 255 }).unique(), // nullable — phone is now the primary identity
    phone: varchar('phone', { length: 20 }).unique(), // primary identity for phone OTP login
    phoneVerified: boolean('phone_verified').default(false).notNull(),
    name: varchar('name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    picture: text('picture'), // Facebook profile picture URL
    facebookAccessToken: text('facebook_access_token'),
    facebookTokenExpiresAt: timestamp('facebook_token_expires_at'),
    isAdmin: boolean('is_admin').default(false), // Admin flag for manual upgrades
    hasInstagramPermission: boolean('has_instagram_permission').default(false),
    lastSeenAt: timestamp('last_seen_at'),
    // Server-tracked last-active workspace. Source of truth for "where should this user
    // land on login" — beats stale persisted client state. Nullable: empty until the user
    // explicitly switches or accepts an invite. ON DELETE SET NULL so deleting a workspace
    // doesn't break login for its members; the resolver falls back to a heuristic.
    lastActiveWorkspaceId: uuid('last_active_workspace_id').references((): AnyPgColumn => workspaces.id, { onDelete: 'set null' }),
    // Non-expiring AI-reply credit balance from one-time top-up purchases.
    // Consumed only after the monthly plan quota is exhausted. Survives renewal,
    // cancellation, and plan changes. May go negative after a refund of a
    // partially-consumed pack (gate `> 0` blocks usage until next purchase clears
    // the deficit) — intentional anti-abuse design, never clamp here.
    topupBalance: integer('topup_balance').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    // App-level invariant: at least one of facebookId or phone must be non-null
});

// OTP Codes Table — for phone number verification
export const otpCodes = pgTable('otp_codes', {
    id: uuid('id').defaultRandom().primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(), // bcrypt hash of 6-digit code
    expiresAt: timestamp('expires_at').notNull(), // now + 5 minutes
    attempts: integer('attempts').default(0).notNull(), // max 3 before lockout
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
    phoneIdx: index('otp_codes_phone_idx').on(table.phone),
}));

// ============================================
// WORKSPACE / TEAM TABLES
// ============================================

// 1a. Workspaces Table
export const workspaces = pgTable('workspaces', {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).unique(),
    logoUrl: text('logo_url'),
    // Business settings stored as JSONB (industry standard — no separate settings table)
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        ownerIdIdx: index('idx_workspaces_owner_id').on(table.ownerId),
    };
});

// 1b. Workspace Members Table
export const workspaceMembers = pgTable('workspace_members', {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    role: varchar('role', { length: 20 }).notNull().default('member'), // 'owner' | 'admin' | 'member'
    joinedAt: timestamp('joined_at').defaultNow(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    // Per-member opt-out for daily lead digest emails. Null = subscribed (default). Set = muted at this time.
    leadDigestMutedAt: timestamp('lead_digest_muted_at'),
}, (table) => {
    return {
        workspaceUserUnique: uniqueIndex('idx_workspace_members_ws_user').on(table.workspaceId, table.userId),
        workspaceIdIdx: index('idx_workspace_members_workspace_id').on(table.workspaceId),
        userIdIdx: index('idx_workspace_members_user_id').on(table.userId),
    };
});

// 1c. Workspace Invites Table
export const workspaceInvites = pgTable('workspace_invites', {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    email: varchar('email', { length: 255 }), // nullable — either email or phone must be set
    phone: varchar('phone', { length: 20 }), // E.164 format (+966xxxxxxxxx)
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    role: varchar('role', { length: 20 }).default('member'),
    status: varchar('status', { length: 20 }).default('pending'), // 'pending' | 'accepted' | 'expired' | 'revoked'
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        tokenHashIdx: index('idx_workspace_invites_token_hash').on(table.tokenHash),
        workspaceIdIdx: index('idx_workspace_invites_workspace_id').on(table.workspaceId),
        workspaceEmailUnique: uniqueIndex('idx_workspace_invites_ws_email').on(table.workspaceId, table.email),
        workspacePhoneUnique: uniqueIndex('idx_workspace_invites_ws_phone').on(table.workspaceId, table.phone),
    };
});

// 1d. Refresh Tokens Table (Level 2 Security)
export const refreshTokens = pgTable('refresh_tokens', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(), // Store hash for security
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'), // Any non-null value means revoked
    replacedByTokenHash: varchar('replaced_by_token_hash', { length: 255 }), // For rotation tracking
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_refresh_tokens_user_id').on(table.userId),
        tokenHashIdx: index('idx_refresh_tokens_token_hash').on(table.tokenHash),
    };
});

// 2. Pages Table (Facebook Pages with optional linked Instagram)
export const pages = pgTable('pages', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    facebookPageId: varchar('facebook_page_id', { length: 255 }).unique(),
    name: varchar('name', { length: 255 }),
    accessToken: text('access_token').notNull(),
    tokenLastVerifiedAt: timestamp('token_last_verified_at'),
    // Why the page is currently disconnected (access_token = ''). Null when connected.
    // Lets support answer "why isn't this customer replying?" with a single SQL query.
    //   - 'token_revoked':  FB returned a real OAuth-revoked code/subcode (e.g. 190/460 password changed)
    //   - 'no_user_token':  user has no facebook_access_token at all (incomplete onboarding or wiped)
    //   - 'user_revoked':   reserved for future Deauthorize Callback (user removed app from FB)
    disconnectReason: varchar('disconnect_reason', { length: 30 }),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    // Instagram Business Account linked to this page
    instagramAccountId: varchar('instagram_account_id', { length: 255 }),
    instagramUsername: varchar('instagram_username', { length: 255 }),
    instagramProfilePicUrl: text('instagram_profile_pic_url'),
    instagramAutoReplyEnabled: boolean('instagram_auto_reply_enabled').default(false),
    // WhatsApp Business Account linked to this page
    whatsappPhoneNumberId: varchar('whatsapp_phone_number_id', { length: 255 }),
    whatsappBusinessAccountId: varchar('whatsapp_business_account_id', { length: 255 }),
    whatsappDisplayPhoneNumber: varchar('whatsapp_display_phone_number', { length: 30 }),
    whatsappAutoReplyEnabled: boolean('whatsapp_auto_reply_enabled').default(false),
    // E-commerce store linked to this page (for product-aware AI replies)
    ecommerceStoreId: uuid('ecommerce_store_id').references(() => ecommerceStores.id, { onDelete: 'set null' }),
    // Knowledge base for AI context - business info, products, FAQ
    knowledgeBase: text('knowledge_base'),
    // Suggested knowledge base from Facebook data - pending user confirmation
    suggestedKnowledgeBase: text('suggested_knowledge_base'),
    // KB versioning — kbVersion bumps on every KB change, kbActiveVersion set after ingestion completes
    kbVersion: integer('kb_version').default(1),
    kbActiveVersion: integer('kb_active_version').default(1),
    kbUpdatedAt: timestamp('kb_updated_at'),
    // Business profile — structured data from Facebook sync
    businessProfile: jsonb('business_profile').default({}),
    businessProfileUpdatedAt: timestamp('business_profile_updated_at'),
    // Defensive auto-pause: when Facebook persistently rejects our reply sends
    // (Page restricted, unpublished, permission lost mid-flight), we bump the
    // counter on every page-level failure (our_fault / unknown buckets), reset
    // on any successful send, and flip auto_reply_enabled=false once the
    // counter crosses the threshold. autoPauseReason carries the cause for the
    // UI banner. Customer toggling auto-reply back on clears both fields.
    consecutiveSendFailures: integer('consecutive_send_failures').default(0).notNull(),
    autoPauseReason: varchar('auto_pause_reason', { length: 30 }),
    autoPausedAt: timestamp('auto_paused_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_pages_user_id').on(table.userId),
        workspaceIdIdx: index('idx_pages_workspace_id').on(table.workspaceId),
        facebookPageIdIdx: index('idx_pages_facebook_page_id').on(table.facebookPageId),
        instagramAccountIdIdx: index('idx_pages_instagram_account_id').on(table.instagramAccountId),
        whatsappPhoneNumberIdIdx: index('idx_pages_whatsapp_phone_number_id').on(table.whatsappPhoneNumberId),
        ecommerceStoreIdIdx: index('idx_pages_ecommerce_store_id').on(table.ecommerceStoreId),
    };
});

// 2b. Channel Trials Table — anti-abuse ledger
//
// A connected channel (Facebook page, its linked Instagram business account, or
// a WhatsApp number) gets exactly ONE free trial across all of Jawab24, bound to
// the first account that auto-enabled it. This stops the "farm endless free
// trials by recreating accounts" abuse: a new login is cheap, but the business's
// channel is not. A different, non-paying account that reconnects the same
// channel may connect it, but cannot enable auto-reply for free — it must
// subscribe. The (channelType, channelId) pair is unique so the FIRST writer
// wins; subsequent enables by the same owner are no-ops (ON CONFLICT DO NOTHING).
export const channelTrials = pgTable('channel_trials', {
    id: uuid('id').defaultRandom().primaryKey(),
    // 'facebook' (facebookPageId) | 'instagram' (instagramAccountId) | 'whatsapp' (whatsappPhoneNumberId)
    channelType: varchar('channel_type', { length: 20 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    // The account that first claimed the channel's free trial. SET NULL on user
    // delete so the claim survives (a deleted user must not free up the channel
    // for a fresh trial); firstUserId === null then reads as "claimed, owner gone".
    firstUserId: uuid('first_user_id').references(() => users.id, { onDelete: 'set null' }),
    firstWorkspaceId: uuid('first_workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    firstTrialedAt: timestamp('first_trialed_at').defaultNow(),
}, (table) => {
    return {
        channelUnique: uniqueIndex('idx_channel_trials_type_id').on(table.channelType, table.channelId),
        firstUserIdIdx: index('idx_channel_trials_first_user_id').on(table.firstUserId),
    };
});

// 3. Posts Table (Facebook Posts)
export const posts = pgTable('posts', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    facebookPostId: varchar('facebook_post_id', { length: 255 }).unique().notNull(),
    message: text('message'),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    /** Per-post engagement trigger: comma-separated keywords the merchant asks followers to comment */
    triggerKeyword: text('trigger_keyword'),
    /** Per-post engagement trigger: reply sent when any triggerKeyword is matched */
    triggerReply: text('trigger_reply'),
    createdTime: timestamp('created_time'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_posts_page_id').on(table.pageId),
        facebookPostIdIdx: index('idx_posts_facebook_post_id').on(table.facebookPostId),
    };
});

// 3b. Instagram Media Table (Instagram Posts, Reels, Stories)
export const instagramMedia = pgTable('instagram_media', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    instagramMediaId: varchar('instagram_media_id', { length: 255 }).unique().notNull(),
    mediaType: varchar('media_type', { length: 50 }), // 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REELS'
    caption: text('caption'),
    permalink: text('permalink'),
    thumbnailUrl: text('thumbnail_url'),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    /** Per-post engagement trigger: comma-separated keywords the merchant asks followers to comment */
    triggerKeyword: text('trigger_keyword'),
    /** Per-post engagement trigger: reply sent when any triggerKeyword is matched */
    triggerReply: text('trigger_reply'),
    createdTime: timestamp('created_time'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_instagram_media_page_id').on(table.pageId),
        instagramMediaIdIdx: index('idx_instagram_media_id').on(table.instagramMediaId),
    };
});

// 4. Comments Table (Facebook Comments)
export const comments = pgTable('comments', {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    // Denormalized from pages.workspace_id to enable (workspace_id, created_at DESC) index for
    // workspace-scoped inbox queries. Backfilled and promoted to NOT NULL in migration 0080.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    facebookCommentId: varchar('facebook_comment_id', { length: 255 }).unique().notNull(),
    message: text('message').notNull(),
    // Facebook Graph `message_tags` — structured record of user/page tags in the
    // comment (offset, length, type, id). Stored so we can reprocess old comments
    // via the playground or audit why a reply was sent/skipped. Nullable because
    // Instagram comments don't carry this field and pre-upgrade rows have no data.
    messageTags: jsonb('message_tags').$type<FacebookMessageTag[]>(),
    fromId: varchar('from_id', { length: 255 }),
    fromName: varchar('from_name', { length: 255 }),
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template' (canned: AI fallback or greeting/away message), 'ai', 'manual', 'post_reply' (per-post keyword trigger)
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
    // Structured params/debug info for flag_reason keys that carry data
    // (e.g. { dm_failed: { bucket, code, fbMessage } }, { sla_no_reply: { minutes } }).
    // Plain keys like info_not_in_kb leave this NULL.
    flagMeta: jsonb('flag_meta'),
    aiIntent: varchar('ai_intent', { length: 50 }),
    resolved: boolean('resolved').default(false),
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        postIdIdx: index('idx_comments_post_id').on(table.postId),
        facebookCommentIdIdx: index('idx_comments_facebook_comment_id').on(table.facebookCommentId),
        repliedIdx: index('idx_comments_replied').on(table.replied),
        detectedLanguageIdx: index('idx_comments_detected_language').on(table.detectedLanguage),
        needsAttentionIdx: index('idx_comments_needs_attention').on(table.needsAttention),
        resolvedIdx: index('idx_comments_resolved').on(table.resolved),
        createdAtIdx: index('idx_comments_created_at').on(table.createdAt),
        createdTimeIdx: index('idx_comments_created_time').on(table.createdTime),
        // Composite index for actionRequired filter: (resolved=false AND (replied=false OR needsAttention=true)) ORDER BY createdAt DESC
        actionRequiredIdx: index('idx_comments_action_required').on(table.postId, table.resolved, table.replied, table.needsAttention, table.createdAt),
        // Drives workspace-scoped "all" inbox — index seek + scan-to-limit instead of join-then-sort
        workspaceCreatedAtIdx: index('idx_comments_workspace_created_at').on(table.workspaceId, table.createdAt),
    };
});

// 4b. Instagram Comments Table
export const instagramComments = pgTable('instagram_comments', {
    id: uuid('id').defaultRandom().primaryKey(),
    mediaId: uuid('media_id').references(() => instagramMedia.id, { onDelete: 'cascade' }),
    // Denormalized from pages.workspace_id. See comments table for rationale.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    instagramCommentId: varchar('instagram_comment_id', { length: 255 }).unique().notNull(),
    message: text('message').notNull(),
    fromId: varchar('from_id', { length: 255 }),
    fromUsername: varchar('from_username', { length: 255 }),
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template' (canned: AI fallback or greeting/away message), 'ai', 'manual', 'post_reply' (per-post keyword trigger)
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
    flagMeta: jsonb('flag_meta'),
    aiIntent: varchar('ai_intent', { length: 50 }),
    resolved: boolean('resolved').default(false),
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        mediaIdIdx: index('idx_instagram_comments_media_id').on(table.mediaId),
        instagramCommentIdIdx: index('idx_instagram_comments_id').on(table.instagramCommentId),
        repliedIdx: index('idx_instagram_comments_replied').on(table.replied),
        needsAttentionIdx: index('idx_instagram_comments_needs_attention').on(table.needsAttention),
        resolvedIdx: index('idx_instagram_comments_resolved').on(table.resolved),
        createdAtIdx: index('idx_instagram_comments_created_at').on(table.createdAt),
        createdTimeIdx: index('idx_instagram_comments_created_time').on(table.createdTime),
        // Composite index for actionRequired filter (mirrors comments table)
        actionRequiredIdx: index('idx_ig_comments_action_required').on(table.mediaId, table.resolved, table.replied, table.needsAttention, table.createdAt),
        // Drives workspace-scoped "all" inbox for IG (mirrors comments table)
        workspaceCreatedAtIdx: index('idx_ig_comments_workspace_created_at').on(table.workspaceId, table.createdAt),
    };
});

// 7. Settings Table
export const settings = pgTable('settings', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).unique(),
    dashboardLanguage: varchar('dashboard_language', { length: 10 }).default('ar'),
    defaultReplyLanguage: varchar('default_reply_language', { length: 10 }).default('ar'),
    supportedLanguages: text('supported_languages').array().default(sql`ARRAY['en', 'ar']`),
    autoDetectLanguage: boolean('auto_detect_language').default(true),
    aiEnabled: boolean('ai_enabled').default(true),
    aiModel: varchar('ai_model', { length: 100 }).default(DEFAULT_AI_MODEL),
    // Auto-reply settings
    commentReplyMode: varchar('comment_reply_mode', { length: 20 }).default('public'), // 'public', 'private', or 'dual'
    dualReplyNudge: text('dual_reply_nudge').default(''),
    commentsAutoReply: boolean('comments_auto_reply').default(true),
    messagesAutoReply: boolean('messages_auto_reply').default(true),
    businessHoursOnly: boolean('business_hours_only').default(false),
    businessHoursStart: varchar('business_hours_start', { length: 5 }).default('09:00'),
    businessHoursEnd: varchar('business_hours_end', { length: 5 }).default('18:00'),
    timezone: varchar('timezone', { length: 100 }).default('Asia/Damascus'),
    // DEPRECATED - kept for backward compatibility (use language-specific fields below)
    awayMessage: text('away_message'),
    greetingMessage: text('greeting_message'),
    // Multilingual messages (added 2026-02-14)
    // Multilingual Messages (JSONB)
    // Structure: { [lang: string]: string, sourceLang: string }
    greetingMessageMulti: jsonb('greeting_message_multi').$type<Record<string, string>>().default({}),
    // Master switch for the greeting message. When false (default for new
    // merchants) the configured greeting never fires — the AI handles the
    // first message directly. Set true by the migration for existing
    // merchants whose greetingMessageMulti was already customized.
    greetingMessageEnabled: boolean('greeting_message_enabled').notNull().default(false),
    awayMessageMulti: jsonb('away_message_multi').$type<Record<string, string>>().default({}),
    // Master switch: when true, customers receive a reply at the monthly limit
    // (the custom message below if set, otherwise the hardcoded translation).
    // When false (default), the reply is suppressed and the comment/DM is flagged
    // for manual handling in the inbox.
    limitFallbackEnabled: boolean('limit_fallback_enabled').default(false),
    // Custom reply text. Only used when limitFallbackEnabled is true.
    // Empty + enabled → hardcoded `commentFallback` / `messageFallback` translation.
    limitFallbackMessageMulti: jsonb('limit_fallback_message_multi').$type<Record<string, string>>().default({}),
    dualReplyNudgeMulti: jsonb('dual_reply_nudge_multi').$type<Record<string, string>>().default({}),
    dualReplyNudgeVariations: jsonb('dual_reply_nudge_variations').$type<Record<string, string[]>>().default({}),
    replyDelay: integer('reply_delay').default(3), // seconds — defaults to the "Natural" preset so new merchants feel human out of the box
    // SLA escalation thresholds (minutes) - auto-flag unreplied items as needsAttention
    commentEscalationMinutes: integer('comment_escalation_minutes').default(60),
    messageEscalationMinutes: integer('message_escalation_minutes').default(30),
    // Human handoff: default pause duration when user takes over a conversation
    handoffPauseDurationMinutes: integer('handoff_pause_duration_minutes').default(DEFAULT_HANDOFF_PAUSE_MINUTES),
    // Reply style & confidence routing
    replyStyle: varchar('reply_style', { length: 20 }).default('professional'),
    brandVoiceNotes: text('brand_voice_notes').default(''),
    brandVoiceNotesMulti: jsonb('brand_voice_notes_multi').$type<Record<string, string>>().default({}),
    holdLowConfidence: boolean('hold_low_confidence').default(false),
    // Push notification preferences
    notificationsEnabled: boolean('notifications_enabled').default(true).notNull(),
    // Push notification when a new lead (customer who shared a phone number) is captured
    newLeadAlertsEnabled: boolean('new_lead_alerts_enabled').default(true).notNull(),
    // Onboarding
    onboardingCompletedAt: timestamp('onboarding_completed_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_settings_user_id').on(table.userId),
    };
});

// 10. Messages Table (for storing DMs - Facebook & Instagram)
// Conversations Table — canonical source of truth for per-sender state on a page.
// A conversation is one thread between a page and a single platform user (sender_id).
// Today only sender_name lives here; future conversation-level fields (last_message_at,
// resolved, unread_count, assignee, labels, etc.) migrate here incrementally.
// See docs/comment-and-message-handling.md → "Conversations normalization".
export const conversations = pgTable('conversations', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    platform: varchar('platform', { length: 20 }).notNull(), // 'facebook' | 'instagram' | 'whatsapp'
    senderName: varchar('sender_name', { length: 255 }),
    // Post or media that triggered this DM conversation (via comment→DM in dual/private mode).
    // UUID points to either posts.id (Facebook) or instagram_media.id (Instagram); resolved
    // via the conversation's platform field. No FK because it targets two tables —
    // messageProcessor degrades gracefully if the referenced row was deleted.
    // First-write-wins: set once when the comment pipeline creates the outgoing DM,
    // never overwritten. Lets messageProcessor inherit the originating post context for
    // follow-up DMs — otherwise AI classifies short follow-ups as SPAM_OR_IRRELEVANT.
    originContentId: uuid('origin_content_id'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        // Unique constraint — one conversation per (page, sender). Enables ON CONFLICT upsert.
        pageSenderUnique: uniqueIndex('uq_conversations_page_sender').on(table.pageId, table.senderId),
        pageIdIdx: index('idx_conversations_page_id').on(table.pageId),
    };
});

export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    // Denormalized from pages.workspace_id. See comments table for rationale.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
    // FK to conversations. Nullable during Tier A transition — will be NOT NULL after
    // backfill + a safety period (Tier B/C). New writes always set it.
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
    // UNIQUE: webhook idempotency. Facebook/Instagram retry the same mid on 5xx
    // or timeout; concurrent retries previously raced past a check-then-insert and
    // produced duplicate rows → duplicate replies. The unique constraint forces
    // INSERT … ON CONFLICT semantics in services/messages.ts findOrCreateFromWebhook.
    platformMessageId: varchar('platform_message_id', { length: 255 }).notNull().unique(),
    platform: varchar('platform', { length: 20 }).default('facebook'), // 'facebook' or 'instagram'
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    // Legacy denormalized copy of conversations.sender_name. Kept during Tier A transition
    // as a fallback; dropped in Tier B/C once all callers read from the conversation.
    senderName: varchar('sender_name', { length: 255 }),
    message: text('message').notNull(),
    direction: varchar('direction', { length: 10 }).default('incoming'), // 'incoming' or 'outgoing'
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template' (canned: AI fallback or greeting/away message), 'ai', 'manual', 'post_reply' (per-post keyword trigger)
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
    flagMeta: jsonb('flag_meta'),
    aiIntent: varchar('ai_intent', { length: 50 }),
    resolved: boolean('resolved').default(false),
    attachmentType: varchar('attachment_type', { length: 20 }), // 'audio', 'image', 'video', 'file' — null for text
    // Client-supplied idempotency key for outgoing manual replies. Frontend generates a UUID
    // per send attempt; if the network drops mid-flight and the client retries with the same
    // key, the controller short-circuits instead of double-sending to FB/IG. NULL on incoming
    // and on legacy rows.
    clientMessageId: varchar('client_message_id', { length: 64 }),
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_messages_page_id').on(table.pageId),
        conversationIdIdx: index('idx_messages_conversation_id').on(table.conversationId),
        senderIdIdx: index('idx_messages_sender_id').on(table.senderId),
        platformMessageIdIdx: index('idx_messages_platform_message_id').on(table.platformMessageId),
        directionIdx: index('idx_messages_direction').on(table.direction),
        platformIdx: index('idx_messages_platform').on(table.platform),
        needsAttentionIdx: index('idx_messages_needs_attention').on(table.needsAttention),
        repliedIdx: index('idx_messages_replied').on(table.replied),
        createdAtIdx: index('idx_messages_created_at').on(table.createdAt),
        createdTimeIdx: index('idx_messages_created_time').on(table.createdTime),
        resolvedFilterIdx: index('idx_messages_resolved_filter').on(table.pageId, table.direction, table.resolved, table.replied),
        // Composite index for sender inbox queries: isFirstIncomingMessage, hasNewerUnrepliedMessage, isPaused lookups
        senderInboxIdx: index('idx_messages_sender_inbox').on(table.pageId, table.senderId, table.direction, table.replied, table.createdAt),
        // Covering index for unreplied message queries (getUnrepliedFromSender, dashboard counts)
        unrepliedIdx: index('idx_messages_page_unreplied').on(table.pageId, table.replied, table.createdAt),
        // Composite index for escalation SLA queries (replied + needsAttention + direction + time)
        escalationIdx: index('idx_messages_escalation').on(table.replied, table.needsAttention, table.direction, table.createdTime),
        // Drives workspace-scoped "all" inbox for DMs (mirrors comments tables)
        workspaceCreatedAtIdx: index('idx_messages_workspace_created_at').on(table.workspaceId, table.createdAt),
        // Per-page idempotency for manual-reply retries. Postgres treats NULLs as distinct in
        // unique indexes, so legacy/incoming rows (NULL key) coexist freely; only client-supplied
        // keys are deduplicated.
        clientMessageIdUnique: uniqueIndex('uq_messages_page_client_message_id').on(table.pageId, table.clientMessageId),
    };
});

// 11. Conversation Pauses Table (for explicit human handoff / smart-reply pause)
export const conversationPauses = pgTable('conversation_pauses', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    pausedUntil: timestamp('paused_until').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        // Covering index for pause expiry lookups (pageId + senderId + pausedUntil range scan)
        pageSenderIdx: index('idx_conversation_pauses_page_sender').on(table.pageId, table.senderId, table.pausedUntil),
    };
});

// 8. AI Cache Table
export const aiCache = pgTable('ai_cache', {
    id: uuid('id').defaultRandom().primaryKey(),
    commentHash: varchar('comment_hash', { length: 64 }).unique().notNull(),
    replyText: text('reply_text').notNull(),
    language: varchar('language', { length: 10 }),
    metadata: jsonb('metadata'),
    hitCount: integer('hit_count').default(1),
    createdAt: timestamp('created_at').defaultNow(),
    lastUsedAt: timestamp('last_used_at').defaultNow(),
}, (table) => {
    return {
        commentHashIdx: index('idx_ai_cache_comment_hash').on(table.commentHash),
        lastUsedIdx: index('idx_ai_cache_last_used').on(table.lastUsedAt),
    };
});

// 9. Logs Table
export const logs = pgTable('logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 100 }),
    status: varchar('status', { length: 50 }),
    message: text('message'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_logs_user_id').on(table.userId),
        createdAtIdx: index('idx_logs_created_at').on(table.createdAt),
        actionIdx: index('idx_logs_action').on(table.action),
    };
});

// ============================================
// PRICING & SUBSCRIPTION TABLES
// ============================================

// 10. Plans Table - Configurable pricing plans
export const plans = pgTable('plans', {
    id: uuid('id').defaultRandom().primaryKey(),
    // Basic info
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).unique().notNull(), // 'free', 'starter', 'business', 'pro'
    description: text('description'),

    // Pricing
    price: integer('price').notNull().default(0), // Monthly price in cents (3900 = $39.00)
    yearlyPrice: integer('yearly_price'), // Yearly price in cents (39000 = $390.00); null = no yearly option
    currency: varchar('currency', { length: 3 }).default('USD'),
    interval: varchar('interval', { length: 20 }).default('month'), // 'month', 'year'
    stripePriceId: varchar('stripe_price_id', { length: 255 }), // Stripe Monthly Price ID (e.g., price_xxxxx)
    stripeYearlyPriceId: varchar('stripe_yearly_price_id', { length: 255 }), // Stripe Yearly Price ID

    // Limits
    maxPages: integer('max_pages').default(1),
    maxAiRepliesPerMonth: integer('max_ai_replies_per_month').default(200),
    maxProducts: integer('max_products').default(50), // null = unlimited

    // Features
    facebookEnabled: boolean('facebook_enabled').default(true),
    instagramEnabled: boolean('instagram_enabled').default(true),
    whatsappEnabled: boolean('whatsapp_enabled').default(false),
    ecommerceEnabled: boolean('ecommerce_enabled').default(true),
    showBranding: boolean('show_branding').default(true), // Show "Powered by Jawab24"
    prioritySupport: boolean('priority_support').default(false),

    // Trial
    trialDays: integer('trial_days').default(0), // 0 = no trial, 30 = 30-day trial

    // Regional pricing (optional JSON for different regions)
    regionalPricing: jsonb('regional_pricing').default({}), // { "SY": 350000, "SA": 50 }

    // Status
    isActive: boolean('is_active').default(true),
    isPublic: boolean('is_public').notNull().default(true), // false = hidden from public /pricing grid but still purchasable via direct link (high-volume plans)
    isDefault: boolean('is_default').default(false), // Default plan for new users
    sortOrder: integer('sort_order').default(0), // For display ordering

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        slugIdx: index('idx_plans_slug').on(table.slug),
        isActiveIdx: index('idx_plans_is_active').on(table.isActive),
    };
});

// 11. Subscriptions Table - User subscriptions
export const subscriptions = pgTable('subscriptions', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }).notNull(),

    // Status
    status: varchar('status', { length: 20 }).default('active'), // 'trialing', 'active', 'past_due', 'canceled', 'paused'

    // Trial info
    trialEndsAt: timestamp('trial_ends_at'),

    // Billing period
    currentPeriodStart: timestamp('current_period_start').defaultNow(),
    currentPeriodEnd: timestamp('current_period_end'),

    // Payment info (for Stripe integration)
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }), // Stripe Subscription ID
    paymentMethod: varchar('payment_method', { length: 50 }), // 'stripe', 'paypal', 'manual'
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }), // Stripe Customer ID
    stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }), // For tracking
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false), // Cancel at period end flag

    // Cancellation
    canceledAt: timestamp('canceled_at'),
    cancelReason: text('cancel_reason'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_subscriptions_user_id').on(table.userId),
        statusIdx: index('idx_subscriptions_status').on(table.status),
        planIdIdx: index('idx_subscriptions_plan_id').on(table.planId),
    };
});

// 12. Usage Table - Monthly usage tracking
export const usage = pgTable('usage', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

    // Period (monthly reset)
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),

    // Counters
    aiRepliesCount: integer('ai_replies_count').default(0),
    totalCommentsProcessed: integer('total_comments_processed').default(0),
    totalMessagesProcessed: integer('total_messages_processed').default(0),

    // Daily breakdown (JSON for detailed analytics)
    dailyBreakdown: jsonb('daily_breakdown').default({}), // { "2024-01-15": { ai: 10 } }

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_usage_user_id').on(table.userId),
        periodIdx: index('idx_usage_period').on(table.periodStart, table.periodEnd),
        userPeriodIdx: index('idx_usage_user_period').on(table.userId, table.periodStart),
    };
});

// 12b. Top-up Purchases Table — one-time AI reply credit packs
//
// Supports two purchase paths (`source` column):
//   - 'stripe': self-service card payment via Stripe PaymentIntent. The
//     stripe_payment_intent_id is required and unique (enforces webhook
//     idempotency — replays of payment_intent.succeeded find the row and no-op).
//   - 'manual' / 'admin': admin-credited purchase for bank-transfer / USDT /
//     WhatsApp / cash payments common in MENA. external_ref holds the bank
//     transaction ID, wallet address, or any reference the admin enters.
//
// Each successful purchase increments users.topup_balance by replies_added.
// Refunds decrement; balance may go negative on partial-consume + refund
// (intentional anti-abuse).
//
// Status lifecycle: 'pending' (Stripe only — created with PaymentIntent)
//   → 'succeeded' (Stripe webhook OR admin credit)
//   → 'refunded' (Stripe charge.refunded webhook OR admin reverse).
// Manual/admin purchases skip 'pending' — they're inserted as 'succeeded'.
export const topupPurchases = pgTable('topup_purchases', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    // Pack identifier — '5k' or '10k' at launch. String (not enum) so new packs
    // can be added via config without a schema migration.
    pack: varchar('pack', { length: 16 }).notNull(),
    repliesAdded: integer('replies_added').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),
    // Payment source — see table comment above.
    source: varchar('source', { length: 16 }).notNull().default('stripe'),
    // Stripe PaymentIntent id — REQUIRED when source='stripe' (enforced by
    // CHECK constraint), nullable when source='manual'/'admin'. UNIQUE when
    // present so webhook replays are idempotent.
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique(),
    // Free-form reference for non-Stripe purchases: bank transfer ID,
    // USDT TXID, "WhatsApp chat 2026-05-24", etc. Audit trail for admin.
    externalRef: varchar('external_ref', { length: 255 }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    succeededAt: timestamp('succeeded_at'),
    refundedAt: timestamp('refunded_at'),
}, (table) => {
    return {
        userIdIdx: index('idx_topup_purchases_user_id').on(table.userId),
        statusIdx: index('idx_topup_purchases_status').on(table.status),
        sourceIdx: index('idx_topup_purchases_source').on(table.source),
        statusCheck: check(
            'topup_purchases_status_check',
            sql`${table.status} IN ('pending', 'succeeded', 'failed', 'refunded')`
        ),
        sourceCheck: check(
            'topup_purchases_source_check',
            sql`${table.source} IN ('stripe', 'manual', 'admin')`
        ),
        // Stripe purchases must carry the PaymentIntent id; manual/admin may not.
        stripeIdRequiredCheck: check(
            'topup_purchases_stripe_id_required',
            sql`${table.source} != 'stripe' OR ${table.stripePaymentIntentId} IS NOT NULL`
        ),
    };
});

// 12b. Payment Requests Table — admin-generated "collect payment" links.
//
// An admin generates a Stripe Checkout link for a CUSTOM amount and sends it to
// a customer to collect money for replies that were ALREADY credited manually
// (e.g. an urgent top-up granted by hand). This is collect-only and money-side
// ONLY: paying a request marks it 'paid' and NEVER touches users.topup_balance
// (the replies were credited separately). It is therefore independent of the
// self-service top-up engine — no reply quantity, no crediting logic.
//
// Hosted Stripe Checkout (mode: 'payment') is used so the completion event is
// `checkout.session.completed` — already subscribed on the webhook endpoint —
// avoiding any dependency on `payment_intent.succeeded`.
//
// Status lifecycle: 'pending' (created with the Checkout Session)
//   → 'paid' (checkout.session.completed webhook, status='pending'-gated)
//   → 'expired' (optional future sweep for abandoned links).
export const paymentRequests = pgTable('payment_requests', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),
    // What the customer is paying for — shown on the Stripe Checkout page and in
    // the admin history (e.g. "10,000 Smart Replies granted 2026-06-03").
    description: varchar('description', { length: 500 }),
    // Hosted Checkout Session the customer pays through. Unique so a replayed
    // checkout.session.completed webhook finds the row and no-ops.
    stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }).unique().notNull(),
    // Resolved on completion — audit/reconciliation trail.
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    // Optional link to the manual top-up this request collects money for. Lets
    // admins report "granted but unpaid" — a paid request reconciles against the
    // grant it bills. Nullable: a freestanding "pay $X" request needn't link one.
    topupPurchaseId: uuid('topup_purchase_id').references(() => topupPurchases.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    // Admin who created the request (audit trail; complements admin_audit_logs).
    createdByAdminUserId: uuid('created_by_admin_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    paidAt: timestamp('paid_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
    return {
        userIdIdx: index('idx_payment_requests_user_id').on(table.userId),
        statusIdx: index('idx_payment_requests_status').on(table.status),
        statusCheck: check(
            'payment_requests_status_check',
            sql`${table.status} IN ('pending', 'paid', 'expired')`
        ),
        // Collect-only: a positive amount is always required.
        amountPositiveCheck: check(
            'payment_requests_amount_positive',
            sql`${table.amountCents} > 0`
        ),
    };
});

// 13. Usage Logs Table - Detailed usage events for audit
export const usageLogs = pgTable('usage_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

    // Event type
    eventType: varchar('event_type', { length: 50 }).notNull(), // 'ai_reply', 'comment_processed'

    // Context
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    platform: varchar('platform', { length: 20 }), // 'facebook', 'instagram'

    // Metadata
    metadata: jsonb('metadata').default({}),

    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_usage_logs_user_id').on(table.userId),
        eventTypeIdx: index('idx_usage_logs_event_type').on(table.eventType),
        createdAtIdx: index('idx_usage_logs_created_at').on(table.createdAt),
    };
});

// ============================================
// NOTIFICATION TABLES
// ============================================

// 14. Device Tokens Table - FCM tokens for push notifications
export const deviceTokens = pgTable('device_tokens', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    token: text('token').notNull(),
    platform: varchar('platform', { length: 20 }).notNull(), // 'android', 'ios', 'web'
    createdAt: timestamp('created_at').defaultNow(),
    lastUsedAt: timestamp('last_used_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_device_tokens_user_id').on(table.userId),
        tokenIdx: index('idx_device_tokens_token').on(table.token),
    };
});

// 15. Notifications Table - In-app notification log
export const notifications = pgTable('notifications', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    type: varchar('type', { length: 50 }).notNull(), // 'payment_failed', 'subscription_expiring', 'page_disconnected'
    titles: jsonb('titles').$type<Record<string, string>>().notNull(),
    bodies: jsonb('bodies').$type<Record<string, string>>().notNull(),
    data: jsonb('data'), // Deep link info, metadata
    read: boolean('read').default(false),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_notifications_user_id').on(table.userId),
        unreadIdx: index('idx_notifications_unread').on(table.userId, table.read),
        typeIdx: index('idx_notifications_type').on(table.type),
    };
});

// 16. Notification Send Log - per-token FCM send audit for delivery diagnostics.
// One row per token per send attempt. Tokens are stored as SHA-256 hashes only.
export const notificationSendLog = pgTable('notification_send_log', {
    id: uuid('id').defaultRandom().primaryKey(),
    notificationId: uuid('notification_id'),
    userId: uuid('user_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(), // SHA-256 hex
    platform: varchar('platform', { length: 20 }).notNull(),    // android | ios | web
    fcmMessageId: text('fcm_message_id'),                        // present on success
    success: boolean('success').notNull(),
    errorCode: varchar('error_code', { length: 100 }),           // e.g. messaging/registration-token-not-registered
    sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (table) => {
    return {
        userSentIdx: index('idx_notification_send_log_user_sent').on(table.userId, table.sentAt),
        errorSentIdx: index('idx_notification_send_log_error_sent').on(table.errorCode, table.sentAt),
    };
});

// ============================================
// E-COMMERCE TABLES (Shopify, Salla, Zid, ...)
// ============================================

// 17a. Pending E-commerce Installs - Temporary storage for platform OAuth install flow
export const pendingEcommerceInstalls = pgTable('pending_ecommerce_installs', {
    id: uuid('id').defaultRandom().primaryKey(),
    platform: varchar('platform', { length: 20 }).notNull(), // 'shopify' | 'salla' | 'zid'
    storeDomain: varchar('store_domain', { length: 255 }).notNull(),
    accessToken: text('access_token').notNull(),       // AES-256-GCM encrypted
    accessTokenIv: varchar('access_token_iv', { length: 64 }).notNull(),
    refreshToken: text('refresh_token'),                // AES-256-GCM encrypted; null for Shopify (offline tokens never expire)
    refreshTokenIv: varchar('refresh_token_iv', { length: 64 }),
    tokenExpiresAt: timestamp('token_expires_at'),      // Salla 14d / Zid ~1y; null for Shopify
    scopes: text('scopes'),
    nonce: varchar('nonce', { length: 64 }).notNull(),  // CSRF nonce for OAuth
    status: varchar('status', { length: 20 }).default('pending'), // pending|claimed|expired
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        platformCheck: check('pending_ecommerce_installs_platform_check', sql`${table.platform} in ('shopify', 'salla', 'zid')`),
        storeDomainIdx: index('idx_pending_ecommerce_store_domain').on(table.storeDomain),
        statusIdx: index('idx_pending_ecommerce_status').on(table.status),
        platformStatusExpiresIdx: index('idx_pending_ecommerce_platform_status_expires').on(table.platform, table.status, table.expiresAt),
    };
});

// 17. E-commerce Stores Table - Connected stores across all supported platforms
export const ecommerceStores = pgTable('ecommerce_stores', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 20 }).notNull(), // 'shopify' | 'salla' | 'zid'
    storeDomain: varchar('store_domain', { length: 255 }).notNull(), // e.g. "my-store.myshopify.com"
    accessToken: text('access_token').notNull(),             // AES-256-GCM encrypted
    accessTokenIv: varchar('access_token_iv', { length: 64 }).notNull(),
    refreshToken: text('refresh_token'),                     // nullable — Shopify never expires, Salla/Zid need refresh
    refreshTokenIv: varchar('refresh_token_iv', { length: 64 }),
    tokenExpiresAt: timestamp('token_expires_at'),           // null = never expires (Shopify)

    // Store info (synced from platform)
    storeName: varchar('store_name', { length: 255 }),
    storeEmail: varchar('store_email', { length: 255 }),
    storeCurrency: varchar('store_currency', { length: 10 }),
    storeTimezone: varchar('store_timezone', { length: 100 }),

    // Synced product data
    productCount: integer('product_count').default(0),
    productSummary: text('product_summary'),   // ~800 chars structured summary for AI
    policiesSummary: text('policies_summary'), // shipping, returns, etc.

    // Platform-specific extras (e.g. Shopify planName, Salla merchant_id)
    platformData: jsonb('platform_data'),

    // Sync state
    lastSyncAt: timestamp('last_sync_at'),
    isActive: boolean('is_active').default(true),
    installedAt: timestamp('installed_at').defaultNow(),
    uninstalledAt: timestamp('uninstalled_at'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        platformCheck: check('ecommerce_stores_platform_check', sql`${table.platform} in ('shopify', 'salla', 'zid')`),
        platformDomainUnique: uniqueIndex('idx_ecommerce_stores_platform_domain').on(table.platform, table.storeDomain),
        userIdIdx: index('idx_ecommerce_stores_user_id').on(table.userId),
        workspaceIdIdx: index('idx_ecommerce_stores_workspace_id').on(table.workspaceId),
        isActiveIdx: index('idx_ecommerce_stores_is_active').on(table.isActive),
        tokenExpiresAtIdx: index('idx_ecommerce_stores_token_expires_at').on(table.tokenExpiresAt),
    };
});

// 18. E-commerce Products Table - Individual product data synced from any platform
export const ecommerceProducts = pgTable('ecommerce_products', {
    id: uuid('id').defaultRandom().primaryKey(),
    ecommerceStoreId: uuid('ecommerce_store_id').references(() => ecommerceStores.id, { onDelete: 'cascade' }).notNull(),
    platformProductId: varchar('platform_product_id', { length: 255 }).notNull(), // Platform's own product ID

    // Product info
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'), // Plain-text product description (features, specs)
    productType: varchar('product_type', { length: 255 }),
    vendor: varchar('vendor', { length: 255 }),
    status: varchar('status', { length: 20 }).default('active'), // 'active', 'draft', 'archived'

    // Pricing & inventory
    priceRange: varchar('price_range', { length: 100 }), // "220 - 350 AED"
    currency: varchar('currency', { length: 10 }),
    totalInventory: integer('total_inventory').default(0),
    hasVariants: boolean('has_variants').default(false),
    variantSummary: text('variant_summary'), // "S, M, L in Black, White"

    // Metadata
    tags: text('tags'),
    handle: varchar('handle', { length: 500 }),  // URL slug: Shopify 'handle', Salla 'slug'
    imageUrl: text('image_url'),                  // Main product image URL (future use)

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        storeProductUnique: uniqueIndex('idx_ecommerce_products_store_product').on(table.ecommerceStoreId, table.platformProductId),
        storeIdIdx: index('idx_ecommerce_products_store_id').on(table.ecommerceStoreId),
        statusIdx: index('idx_ecommerce_products_status').on(table.status),
    };
});

// ============================================
// RAG / KNOWLEDGE BASE TABLES
// ============================================

// KB Chunks Table — chunked + embedded knowledge base content for vector search
export const kbChunks = pgTable('kb_chunks', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    type: varchar('type', { length: 50 }).notNull(), // 'offering', 'policy', 'faq', 'info', 'hours', 'location'
    language: varchar('language', { length: 10 }),
    title: varchar('title', { length: 500 }),
    contentOriginal: text('content_original').notNull(),
    contentNormalized: text('content_normalized').notNull(),
    titleNormalized: varchar('title_normalized', { length: 500 }),
    tokenCount: integer('token_count'),
    metadata: jsonb('metadata').default({}),
    // Note: embedding vector(512) column added via raw SQL in migration (Drizzle doesn't support vector type)
    kbVersion: integer('kb_version').notNull(),
    // Nullable expiry; retrieval filters out chunks where valid_until <= NOW().
    // Use for time-bound narrative content (e.g. "Ramadan hours") so stale facts
    // can't outscore current ones via semantic similarity alone.
    validUntil: timestamp('valid_until'),
    // Authority tier for retrieval ranking (lower = more authoritative):
    //   1 = live platform API (Salla/Shopify/Zid) — never written here, projected at query time
    //   2 = manually entered structured catalog rows (future catalog_items table)
    //   3 = approved narrative chunks (merchant explicitly marked canonical)
    //   4 = raw narrative chunks ingested from free-text KB (DEFAULT for legacy rows)
    //   5 = auto-extracted suggestions awaiting merchant review — excluded from retrieval
    // Retrieval adds a boost of (4 - LEAST(source_tier, 4)) * 0.15 to final_score,
    // and excludes tier 5 entirely. See retrieval.ts.
    sourceTier: integer('source_tier').notNull().default(4),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_kb_chunks_page_id').on(table.pageId),
        typeIdx: index('idx_kb_chunks_type').on(table.type),
        pageVersionIdx: index('idx_kb_chunks_page_version').on(table.pageId, table.kbVersion),
    };
});

// Semantic Cache Table — vector-based reply caching for semantically similar questions
export const semanticCache = pgTable('semantic_cache', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    queryText: text('query_text').notNull(),
    // Note: query_embedding vector(512) column added via raw SQL in migration (Drizzle doesn't support vector type)
    intent: varchar('intent', { length: 50 }).notNull(),
    replyText: text('reply_text').notNull(),
    metadata: jsonb('metadata').default({}),
    kbActiveVersionAtCreation: integer('kb_active_version_at_creation').notNull(),
    promptVersion: varchar('prompt_version', { length: 10 }),
    hitCount: integer('hit_count').default(0),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_semantic_cache_page_id').on(table.pageId),
        intentIdx: index('idx_semantic_cache_intent').on(table.intent),
        pageVersionIdx: index('idx_semantic_cache_page_version').on(table.pageId, table.kbActiveVersionAtCreation),
    };
});

// KB Gaps Table — tracks questions the KB couldn't answer (for merchant notifications)
export const kbGaps = pgTable('kb_gaps', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    queryText: text('query_text').notNull(),
    queryNormalized: text('query_normalized').notNull(),
    detectedIntent: varchar('detected_intent', { length: 50 }),
    occurrenceCount: integer('occurrence_count').default(1),
    firstSeenAt: timestamp('first_seen_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
    resolved: boolean('resolved').default(false),
    sourceType: varchar('source_type', { length: 10 }),
    sourceContext: text('source_context'),
}, (table) => {
    return {
        pageIdIdx: index('idx_kb_gaps_page_id').on(table.pageId),
        unresolvedIdx: index('idx_kb_gaps_unresolved').on(table.pageId, table.resolved),
    };
});

// ============================================
// LEADS
// ============================================

// Leads Table — captured customer contacts from AI conversations (DMs + comments)
export const leads = pgTable('leads', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    sourceType: varchar('source_type', { length: 20 }).notNull().default('message'), // 'message' | 'comment'
    sourceId: uuid('source_id'), // FK to messages.id or comments.id — intentionally no hard FK (different tables)
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    senderName: varchar('sender_name', { length: 255 }),
    phone: varchar('phone', { length: 50 }).notNull(),
    extractedData: jsonb('extracted_data').$type<{ summary?: string; fields: Array<{ key: string; label_en: string; label_ar: string; value: string }> }>().notNull().default({ fields: [] }),
    status: varchar('status', { length: 20 }).notNull().default('new'), // 'new' | 'contacted' | 'converted'
    // Id of a workspace-defined sub-stage (LeadSubStage.id) under the current main status.
    // Null = main stage only. Labels live in workspaces.settings.leadStages — generic across business types.
    subStage: varchar('sub_stage', { length: 64 }),
    // Merchant-entered values for workspace-defined custom fields (settings.leadFields),
    // keyed by field id so renaming a field never orphans the data. Null = none entered.
    customFields: jsonb('custom_fields').$type<Record<string, string>>(),
    extractionStatus: varchar('extraction_status', { length: 20 }).notNull().default('completed'), // 'completed' | 'pending' | 'failed'
    extractionAttempts: integer('extraction_attempts').notNull().default(0),
    // Set when this lead has been included in a daily digest email to the owner (null = not yet emailed)
    digestEmailedAt: timestamp('digest_emailed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
    pageIdIdx: index('idx_leads_page_id').on(table.pageId),
    senderPageUnique: uniqueIndex('idx_leads_sender_page').on(table.senderId, table.pageId),
    statusIdx: index('idx_leads_status').on(table.pageId, table.status),
    createdAtIdx: index('idx_leads_created_at').on(table.pageId, table.createdAt),
    digestEmailedAtIdx: index('idx_leads_digest_emailed_at').on(table.digestEmailedAt),
}));

// Audit log for daily lead digest emails — one row per send attempt (sent, skipped, or failed).
// Operators query this to answer "did we email user X?" and to monitor delivery health.
export const leadDigestSends = pgTable('lead_digest_sends', {
    id: uuid('id').defaultRandom().primaryKey(),
    // Workspace whose leads are summarized in this digest. Nullable for backfill rows from before
    // the per-workspace fan-out — new rows always populate it.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    // The recipient (owner or admin) the digest was sent to. Each workspace fan-out produces one row per recipient.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    // 'sent' | 'failed' | 'skipped_no_email' | 'skipped_no_subscription' | 'skipped_abandoned' | 'skipped_muted'
    status: varchar('status', { length: 32 }).notNull(),
    leadCount: integer('lead_count').notNull(),
    lang: varchar('lang', { length: 10 }), // 'ar' | 'en' | null when skipped before language pick
    resendEmailId: varchar('resend_email_id', { length: 255 }),
    errorMessage: text('error_message'),
    // Link to the rendered email body in email_sends (null for skipped rows — nothing was sent).
    emailSendId: uuid('email_send_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_lead_digest_sends_user_id').on(table.userId),
    workspaceIdIdx: index('idx_lead_digest_sends_workspace_id').on(table.workspaceId),
    createdAtIdx: index('idx_lead_digest_sends_created_at').on(table.createdAt),
}));

// Generic outbound email log — one row per EmailService.send() attempt.
// Single source of truth for "what email did we send / try to send" across
// every email type (lead_digest, waitlist, transactional, …). Decision-level
// audit lives in type-specific tables (lead_digest_sends, waitlist_email_sends);
// the body + delivery status lives here. Bodies contain PII (lead names,
// phones) — TODO: add a cron to null html_body older than 30 days.
export const emailSends = pgTable('email_sends', {
    id: uuid('id').defaultRandom().primaryKey(),
    type: varchar('type', { length: 50 }).notNull(), // 'lead_digest' | 'waitlist' | 'transactional' | …
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    subject: text('subject').notNull(),
    htmlBody: text('html_body').notNull(),
    status: varchar('status', { length: 16 }).notNull(), // 'sent' | 'failed'
    resendEmailId: varchar('resend_email_id', { length: 255 }),
    errorMessage: text('error_message'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    typeIdx: index('idx_email_sends_type').on(table.type),
    createdAtIdx: index('idx_email_sends_created_at').on(table.createdAt),
    userIdIdx: index('idx_email_sends_user_id').on(table.userId),
}));

// ============================================
// AI COST TRACKING
// ============================================

// AI Usage Log — one row per LLM call or cache hit, for cost analytics
export const aiUsageLog = pgTable('ai_usage_log', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    model: varchar('model', { length: 100 }).notNull(),     // e.g. 'gpt-4.1-mini'
    tokensIn: integer('tokens_in').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),  // OpenAI prompt-cache hits, billed at per-model cached rate
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),          // pre-computed from pricing table
    cached: boolean('cached').notNull().default(false),      // true = cache hit (zero cost)
    pipeline: varchar('pipeline', { length: 50 }),           // 'facebook_comment', 'instagram_message', …
    intent: varchar('intent', { length: 50 }),               // GREETING, COMPLAINT, … (nullable; legacy rows have none)
    pricingVersion: varchar('pricing_version', { length: 16 }).notNull().default('v1'),  // AI_PRICING schema version; v2 = per-model cached rates
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index('idx_ai_usage_log_user_id').on(table.userId),
    createdAtIdx: index('idx_ai_usage_log_created_at').on(table.createdAt),
    userDateIdx: index('idx_ai_usage_log_user_date').on(table.userId, table.createdAt),
}));

// ============================================
// ADMIN TABLES
// ============================================

// 16. Admin Audit Logs Table - Track all admin actions for accountability
export const adminAuditLogs = pgTable('admin_audit_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }), // Admin who performed the action
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }), // User affected by the action
    action: varchar('action', { length: 50 }).notNull(), // 'manual_upgrade', 'manual_downgrade', 'extend_subscription', etc.
    previousValue: jsonb('previous_value'), // State before action (e.g., { planId, status, periodEnd })
    newValue: jsonb('new_value'), // State after action
    paymentReference: varchar('payment_reference', { length: 255 }), // Bank transfer ID, etc.
    note: text('note'), // Admin's note explaining the action
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
    return {
        adminUserIdIdx: index('idx_admin_audit_admin_user_id').on(table.adminUserId),
        targetUserIdIdx: index('idx_admin_audit_target_user_id').on(table.targetUserId),
        actionIdx: index('idx_admin_audit_action').on(table.action),
        createdAtIdx: index('idx_admin_audit_created_at').on(table.createdAt),
    };
});

// Stripe Webhook Events - idempotency deduplication
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
    eventId: varchar('event_id', { length: 255 }).primaryKey(), // Stripe event ID (evt_*)
    eventType: varchar('event_type', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('processing'), // 'processing' | 'completed'
    processedAt: timestamp('processed_at').defaultNow().notNull(),
});

// 19. Customer Notification Templates — merchant-configurable per-store templates
export const customerNotificationTemplates = pgTable('customer_notification_templates', {
    id: uuid('id').defaultRandom().primaryKey(),
    ecommerceStoreId: uuid('ecommerce_store_id').notNull().references(() => ecommerceStores.id, { onDelete: 'cascade' }),
    notificationType: varchar('notification_type', { length: 50 }).notNull(),
    // Types: 'abandoned_cart' | 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'review_request' | 'digital_delivery'
    channel: varchar('channel', { length: 20 }).notNull().default('sms'),
    messageAr: text('message_ar').notNull(),
    messageEn: text('message_en').notNull(),
    isEnabled: boolean('is_enabled').default(false),
    delayMinutes: integer('delay_minutes').default(0),
    includeCoupon: boolean('include_coupon').default(false),
    couponCode: varchar('coupon_code', { length: 50 }),
    couponDiscount: varchar('coupon_discount', { length: 20 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    storeTypeUnique: uniqueIndex('idx_cust_notif_tmpl_store_type').on(table.ecommerceStoreId, table.notificationType),
    storeIdx: index('idx_cust_notif_tmpl_store').on(table.ecommerceStoreId),
}));

// 20. Customer Notifications Log — audit trail + deduplication for every sent notification
export const customerNotificationsLog = pgTable('customer_notifications_log', {
    id: uuid('id').defaultRandom().primaryKey(),
    ecommerceStoreId: uuid('ecommerce_store_id').notNull().references(() => ecommerceStores.id, { onDelete: 'cascade' }),
    notificationType: varchar('notification_type', { length: 50 }).notNull(),
    platformEventId: varchar('platform_event_id', { length: 255 }), // platform order/cart ID for dedup
    customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
    customerName: varchar('customer_name', { length: 255 }),
    channel: varchar('channel', { length: 20 }).notNull(),
    messageSent: text('message_sent').notNull(),
    status: varchar('status', { length: 20 }).default('pending'), // 'pending' | 'sent' | 'failed' | 'cancelled'
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    errorMessage: text('error_message'),
    orderNumber: varchar('order_number', { length: 50 }),
    cartTotal: varchar('cart_total', { length: 50 }),
    scheduledAt: timestamp('scheduled_at'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
    storeIdx: index('idx_cust_notif_log_store').on(table.ecommerceStoreId),
    phoneIdx: index('idx_cust_notif_log_phone').on(table.customerPhone),
    statusIdx: index('idx_cust_notif_log_status').on(table.status),
    typeEventIdx: index('idx_cust_notif_log_type_event').on(table.notificationType, table.platformEventId),
    storeTypeEventIdx: index('idx_cust_notif_log_store_type_event').on(table.ecommerceStoreId, table.notificationType, table.platformEventId),
    pendingScheduledIdx: index('idx_cust_notif_log_pending_scheduled').on(table.status, table.scheduledAt),
}));

// Waitlist - collects emails or phone numbers for upcoming features
export const waitlistEmails = pgTable('waitlist_emails', {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 30 }),
    feature: varchar('feature', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    unsubscribedAt: timestamp('unsubscribed_at'),
}, (table) => ({
    emailFeatureUnique: uniqueIndex('idx_waitlist_email_feature').on(table.email, table.feature),
    phoneFeatureUnique: uniqueIndex('idx_waitlist_phone_feature').on(table.phone, table.feature),
}));

// Email Unsubscribes — global suppression list across waitlist + registered users.
// Source of truth for "should this address ever receive marketing email again?"
// `email` is stored lowercased; primary key dedupes naturally.
export const emailUnsubscribes = pgTable('email_unsubscribes', {
    email: varchar('email', { length: 255 }).primaryKey(),
    unsubscribedAt: timestamp('unsubscribed_at').defaultNow().notNull(),
    source: varchar('source', { length: 32 }), // 'waitlist' | 'user' | 'manual' — analytics only
});

// Waitlist Email Sends — audit log for emails sent to waitlist subscribers
export const waitlistEmailSends = pgTable('waitlist_email_sends', {
    id: uuid('id').defaultRandom().primaryKey(),
    subject: varchar('subject', { length: 500 }).notNull(),
    body: text('body').notNull(),
    recipientCount: integer('recipient_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    feature: varchar('feature', { length: 50 }),
    sentBy: uuid('sent_by').notNull().references(() => users.id),
    sentAt: timestamp('sent_at').defaultNow(),
});

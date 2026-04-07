import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, real, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL } from '@jawab24/shared';

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

// 3. Posts Table (Facebook Posts)
export const posts = pgTable('posts', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    facebookPostId: varchar('facebook_post_id', { length: 255 }).unique().notNull(),
    message: text('message'),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    /** Per-post engagement trigger: keyword the merchant asks followers to comment */
    triggerKeyword: varchar('trigger_keyword', { length: 100 }),
    /** Per-post engagement trigger: reply sent when triggerKeyword is matched */
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
    /** Per-post engagement trigger: keyword the merchant asks followers to comment */
    triggerKeyword: varchar('trigger_keyword', { length: 100 }),
    /** Per-post engagement trigger: reply sent when triggerKeyword is matched */
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

// 5. Templates Table (Defined before rules and comments due to foreign keys)
export const templates = pgTable('templates', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    message: text('message').notNull().default(''),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_templates_user_id').on(table.userId),
        workspaceIdIdx: index('idx_templates_workspace_id').on(table.workspaceId),
    };
});

// 4. Comments Table (Facebook Comments)
export const comments = pgTable('comments', {
    id: uuid('id').defaultRandom().primaryKey(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    facebookCommentId: varchar('facebook_comment_id', { length: 255 }).unique().notNull(),
    message: text('message').notNull(),
    fromId: varchar('from_id', { length: 255 }),
    fromName: varchar('from_name', { length: 255 }),
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
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
    };
});

// 4b. Instagram Comments Table
export const instagramComments = pgTable('instagram_comments', {
    id: uuid('id').defaultRandom().primaryKey(),
    mediaId: uuid('media_id').references(() => instagramMedia.id, { onDelete: 'cascade' }),
    instagramCommentId: varchar('instagram_comment_id', { length: 255 }).unique().notNull(),
    message: text('message').notNull(),
    fromId: varchar('from_id', { length: 255 }),
    fromUsername: varchar('from_username', { length: 255 }),
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
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
    };
});

// 6. Rules Table
export const rules = pgTable('rules', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    keywords: text('keywords').array(),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    priority: integer('priority').default(0),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_rules_user_id').on(table.userId),
        workspaceIdIdx: index('idx_rules_workspace_id').on(table.workspaceId),
        // Covering index for "get active rules by priority" queries
        activeRulesIdx: index('idx_rules_workspace_active_priority').on(table.workspaceId, table.active, table.priority),
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
    awayMessageMulti: jsonb('away_message_multi').$type<Record<string, string>>().default({}),
    dualReplyNudgeMulti: jsonb('dual_reply_nudge_multi').$type<Record<string, string>>().default({}),
    dualReplyNudgeVariations: jsonb('dual_reply_nudge_variations').$type<Record<string, string[]>>().default({}),
    replyDelay: integer('reply_delay').default(0), // seconds
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
export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    platformMessageId: varchar('platform_message_id', { length: 255 }).notNull(),
    platform: varchar('platform', { length: 20 }).default('facebook'), // 'facebook' or 'instagram'
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    senderName: varchar('sender_name', { length: 255 }),
    message: text('message').notNull(),
    direction: varchar('direction', { length: 10 }).default('incoming'), // 'incoming' or 'outgoing'
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    aiOriginalReply: text('ai_original_reply'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    needsAttention: boolean('needs_attention').default(false),
    flagReason: varchar('flag_reason', { length: 255 }),
    aiIntent: varchar('ai_intent', { length: 50 }),
    resolved: boolean('resolved').default(false),
    attachmentType: varchar('attachment_type', { length: 20 }), // 'audio', 'image', 'video', 'file' — null for text
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_messages_page_id').on(table.pageId),
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
    maxTemplates: integer('max_templates').default(5), // null = unlimited
    maxRules: integer('max_rules').default(7), // null = unlimited
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
    templateRepliesCount: integer('template_replies_count').default(0),
    totalCommentsProcessed: integer('total_comments_processed').default(0),
    totalMessagesProcessed: integer('total_messages_processed').default(0),

    // Daily breakdown (JSON for detailed analytics)
    dailyBreakdown: jsonb('daily_breakdown').default({}), // { "2024-01-15": { ai: 10, template: 5 } }

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_usage_user_id').on(table.userId),
        periodIdx: index('idx_usage_period').on(table.periodStart, table.periodEnd),
        userPeriodIdx: index('idx_usage_user_period').on(table.userId, table.periodStart),
    };
});

// 13. Usage Logs Table - Detailed usage events for audit
export const usageLogs = pgTable('usage_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

    // Event type
    eventType: varchar('event_type', { length: 50 }).notNull(), // 'ai_reply', 'template_reply', 'comment_processed'

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
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),          // pre-computed from pricing table
    cached: boolean('cached').notNull().default(false),      // true = cache hit (zero cost)
    pipeline: varchar('pipeline', { length: 50 }),           // 'facebook_comment', 'instagram_message', …
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
}, (table) => ({
    emailFeatureUnique: uniqueIndex('idx_waitlist_email_feature').on(table.email, table.feature),
    phoneFeatureUnique: uniqueIndex('idx_waitlist_phone_feature').on(table.phone, table.feature),
}));

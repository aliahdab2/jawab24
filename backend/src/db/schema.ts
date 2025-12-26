import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Users Table
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    facebookId: varchar('facebook_id', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

// 2. Pages Table (Facebook Pages with optional linked Instagram)
export const pages = pgTable('pages', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    facebookPageId: varchar('facebook_page_id', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 255 }),
    accessToken: text('access_token').notNull(),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    // Instagram Business Account linked to this page
    instagramAccountId: varchar('instagram_account_id', { length: 255 }),
    instagramUsername: varchar('instagram_username', { length: 255 }),
    instagramAutoReplyEnabled: boolean('instagram_auto_reply_enabled').default(true),
    // Knowledge base for AI context - business info, products, FAQ
    knowledgeBase: text('knowledge_base'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_pages_user_id').on(table.userId),
        facebookPageIdIdx: index('idx_pages_facebook_page_id').on(table.facebookPageId),
        instagramAccountIdIdx: index('idx_pages_instagram_account_id').on(table.instagramAccountId),
    };
});

// 3. Posts Table (Facebook Posts)
export const posts = pgTable('posts', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    facebookPostId: varchar('facebook_post_id', { length: 255 }).unique().notNull(),
    message: text('message'),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
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
    name: varchar('name', { length: 255 }).notNull(),
    translations: jsonb('translations').notNull().default({}),
    keywords: text('keywords').array(),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_templates_user_id').on(table.userId),
        // GIN indexes are not fully supported in drizzle-kit push yet without raw SQL, 
        // but we define them here for completeness if we use migration generation.
        // For now, simple indexes or relying on raw SQL migrations might be needed for GIN.
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
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    templateId: uuid('template_id').references(() => templates.id),
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
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
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    detectedLanguage: varchar('detected_language', { length: 10 }),
    replyLanguage: varchar('reply_language', { length: 10 }),
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        mediaIdIdx: index('idx_instagram_comments_media_id').on(table.mediaId),
        instagramCommentIdIdx: index('idx_instagram_comments_id').on(table.instagramCommentId),
        repliedIdx: index('idx_instagram_comments_replied').on(table.replied),
    };
});

// 6. Rules Table
export const rules = pgTable('rules', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
    aiModel: varchar('ai_model', { length: 100 }).default('gpt-4o-mini'),
    // Auto-reply settings
    commentsAutoReply: boolean('comments_auto_reply').default(true),
    messagesAutoReply: boolean('messages_auto_reply').default(true),
    businessHoursOnly: boolean('business_hours_only').default(false),
    businessHoursStart: varchar('business_hours_start', { length: 5 }).default('09:00'),
    businessHoursEnd: varchar('business_hours_end', { length: 5 }).default('18:00'),
    awayMessage: text('away_message'),
    greetingMessage: text('greeting_message'),
    replyDelay: integer('reply_delay').default(0), // seconds
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
    facebookMessageId: varchar('facebook_message_id', { length: 255 }).unique().notNull(),
    instagramMessageId: varchar('instagram_message_id', { length: 255 }),
    platform: varchar('platform', { length: 20 }).default('facebook'), // 'facebook' or 'instagram'
    senderId: varchar('sender_id', { length: 255 }).notNull(),
    senderName: varchar('sender_name', { length: 255 }),
    message: text('message').notNull(),
    direction: varchar('direction', { length: 10 }).default('incoming'), // 'incoming' or 'outgoing'
    replied: boolean('replied').default(false),
    replyText: text('reply_text'),
    replyMethod: varchar('reply_method', { length: 50 }), // 'template', 'ai', 'manual'
    createdTime: timestamp('created_time'),
    repliedAt: timestamp('replied_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_messages_page_id').on(table.pageId),
        senderIdIdx: index('idx_messages_sender_id').on(table.senderId),
        facebookMessageIdIdx: index('idx_messages_facebook_message_id').on(table.facebookMessageId),
        directionIdx: index('idx_messages_direction').on(table.direction),
        platformIdx: index('idx_messages_platform').on(table.platform),
    };
});

// 8. AI Cache Table
export const aiCache = pgTable('ai_cache', {
    id: uuid('id').defaultRandom().primaryKey(),
    commentHash: varchar('comment_hash', { length: 64 }).unique().notNull(),
    replyText: text('reply_text').notNull(),
    language: varchar('language', { length: 10 }),
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
    price: integer('price').notNull().default(0), // Price in cents (500 = $5.00)
    currency: varchar('currency', { length: 3 }).default('USD'),
    interval: varchar('interval', { length: 20 }).default('month'), // 'month', 'year'
    
    // Limits
    maxPages: integer('max_pages').default(1),
    maxAiRepliesPerMonth: integer('max_ai_replies_per_month').default(50),
    maxTemplates: integer('max_templates').default(3), // null = unlimited
    maxRules: integer('max_rules').default(2), // null = unlimited
    
    // Features
    facebookEnabled: boolean('facebook_enabled').default(true),
    instagramEnabled: boolean('instagram_enabled').default(true),
    whatsappEnabled: boolean('whatsapp_enabled').default(false),
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
    
    // Payment info (for future payment integration)
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }), // Stripe, PayPal, etc.
    paymentMethod: varchar('payment_method', { length: 50 }), // 'stripe', 'paypal', 'manual'
    
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

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

// 2. Pages Table
export const pages = pgTable('pages', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    facebookPageId: varchar('facebook_page_id', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 255 }),
    accessToken: text('access_token').notNull(),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_pages_user_id').on(table.userId),
        facebookPageIdIdx: index('idx_pages_facebook_page_id').on(table.facebookPageId),
    };
});

// 3. Posts Table
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

// 4. Comments Table
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

// 10. Messages Table (for storing DMs)
export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    facebookMessageId: varchar('facebook_message_id', { length: 255 }).unique().notNull(),
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

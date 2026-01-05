import { pgTable, index, unique, uuid, varchar, text, integer, timestamp, foreignKey, jsonb, boolean } from "drizzle-orm/pg-core"
  import { sql } from "drizzle-orm"



export const aiCache = pgTable("ai_cache", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	commentHash: varchar("comment_hash", { length: 64 }).notNull(),
	replyText: text("reply_text").notNull(),
	language: varchar("language", { length: 10 }),
	hitCount: integer("hit_count").default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	lastUsedAt: timestamp("last_used_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxAiCacheCommentHash: index("idx_ai_cache_comment_hash").on(table.commentHash),
		idxAiCacheLastUsed: index("idx_ai_cache_last_used").on(table.lastUsedAt),
		aiCacheCommentHashUnique: unique("ai_cache_comment_hash_unique").on(table.commentHash),
	}
});

export const templates = pgTable("templates", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	name: varchar("name", { length: 255 }).notNull(),
	translations: jsonb("translations").default({}).notNull(),
	keywords: text("keywords").array(),
	active: boolean("active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxTemplatesUserId: index("idx_templates_user_id").on(table.userId),
		idxTemplatesTranslations: index("idx_templates_translations").on(table.translations),
	}
});

export const rules = pgTable("rules", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	name: varchar("name", { length: 255 }).notNull(),
	keywords: text("keywords").array(),
	templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" } ),
	priority: integer("priority").default(0),
	active: boolean("active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxRulesUserId: index("idx_rules_user_id").on(table.userId),
		idxRulesPriority: index("idx_rules_priority").on(table.priority),
	}
});

export const users = pgTable("users", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	facebookId: varchar("facebook_id", { length: 255 }).notNull(),
	name: varchar("name", { length: 255 }),
	email: varchar("email", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		usersFacebookIdUnique: unique("users_facebook_id_unique").on(table.facebookId),
	}
});

export const settings = pgTable("settings", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	dashboardLanguage: varchar("dashboard_language", { length: 10 }).default('en'::character varying),
	defaultReplyLanguage: varchar("default_reply_language", { length: 10 }).default('ar'::character varying),
	supportedLanguages: text("supported_languages").default(ARRAY['en'::text, 'ar'::text]).array(),
	autoDetectLanguage: boolean("auto_detect_language").default(true),
	aiEnabled: boolean("ai_enabled").default(true),
	aiModel: varchar("ai_model", { length: 100 }).default('gpt-4-mini'::character varying),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxSettingsUserId: index("idx_settings_user_id").on(table.userId),
		settingsUserIdUnique: unique("settings_user_id_unique").on(table.userId),
	}
});

export const logs = pgTable("logs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" } ),
	commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" } ),
	action: varchar("action", { length: 100 }),
	status: varchar("status", { length: 50 }),
	message: text("message"),
	metadata: jsonb("metadata"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxLogsUserId: index("idx_logs_user_id").on(table.userId),
		idxLogsCreatedAt: index("idx_logs_created_at").on(table.createdAt),
		idxLogsAction: index("idx_logs_action").on(table.action),
	}
});

export const posts = pgTable("posts", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" } ),
	facebookPostId: varchar("facebook_post_id", { length: 255 }).notNull(),
	message: text("message"),
	autoReplyEnabled: boolean("auto_reply_enabled").default(true),
	createdTime: timestamp("created_time", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxPostsPageId: index("idx_posts_page_id").on(table.pageId),
		idxPostsFacebookPostId: index("idx_posts_facebook_post_id").on(table.facebookPostId),
		postsFacebookPostIdUnique: unique("posts_facebook_post_id_unique").on(table.facebookPostId),
	}
});

export const comments = pgTable("comments", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" } ),
	facebookCommentId: varchar("facebook_comment_id", { length: 255 }).notNull(),
	message: text("message").notNull(),
	fromId: varchar("from_id", { length: 255 }),
	fromName: varchar("from_name", { length: 255 }),
	replied: boolean("replied").default(false),
	replyText: text("reply_text"),
	replyMethod: varchar("reply_method", { length: 50 }),
	templateId: uuid("template_id").references(() => templates.id),
	detectedLanguage: varchar("detected_language", { length: 10 }),
	replyLanguage: varchar("reply_language", { length: 10 }),
	createdTime: timestamp("created_time", { mode: 'string' }),
	repliedAt: timestamp("replied_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxCommentsPostId: index("idx_comments_post_id").on(table.postId),
		idxCommentsFacebookCommentId: index("idx_comments_facebook_comment_id").on(table.facebookCommentId),
		idxCommentsReplied: index("idx_comments_replied").on(table.replied),
		idxCommentsDetectedLanguage: index("idx_comments_detected_language").on(table.detectedLanguage),
		commentsFacebookCommentIdUnique: unique("comments_facebook_comment_id_unique").on(table.facebookCommentId),
	}
});

export const pages = pgTable("pages", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" } ),
	facebookPageId: varchar("facebook_page_id", { length: 255 }).notNull(),
	name: varchar("name", { length: 255 }),
	accessToken: text("access_token").notNull(),
	autoReplyEnabled: boolean("auto_reply_enabled").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	knowledgeBase: text("knowledge_base"),
	instagramAccountId: varchar("instagram_account_id", { length: 255 }),
	instagramUsername: varchar("instagram_username", { length: 255 }),
	instagramAutoReplyEnabled: boolean("instagram_auto_reply_enabled").default(true),
},
(table) => {
	return {
		idxPagesUserId: index("idx_pages_user_id").on(table.userId),
		idxPagesFacebookPageId: index("idx_pages_facebook_page_id").on(table.facebookPageId),
		idxPagesInstagramAccountId: index("idx_pages_instagram_account_id").on(table.instagramAccountId),
		pagesFacebookPageIdUnique: unique("pages_facebook_page_id_unique").on(table.facebookPageId),
	}
});

export const instagramMedia = pgTable("instagram_media", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" } ),
	instagramMediaId: varchar("instagram_media_id", { length: 255 }).notNull(),
	mediaType: varchar("media_type", { length: 50 }),
	caption: text("caption"),
	permalink: text("permalink"),
	thumbnailUrl: text("thumbnail_url"),
	autoReplyEnabled: boolean("auto_reply_enabled").default(true),
	createdTime: timestamp("created_time", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxInstagramMediaPageId: index("idx_instagram_media_page_id").on(table.pageId),
		idxInstagramMediaId: index("idx_instagram_media_id").on(table.instagramMediaId),
		instagramMediaInstagramMediaIdKey: unique("instagram_media_instagram_media_id_key").on(table.instagramMediaId),
	}
});

export const instagramComments = pgTable("instagram_comments", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	mediaId: uuid("media_id").references(() => instagramMedia.id, { onDelete: "cascade" } ),
	instagramCommentId: varchar("instagram_comment_id", { length: 255 }).notNull(),
	message: text("message").notNull(),
	fromId: varchar("from_id", { length: 255 }),
	fromUsername: varchar("from_username", { length: 255 }),
	replied: boolean("replied").default(false),
	replyText: text("reply_text"),
	replyMethod: varchar("reply_method", { length: 50 }),
	detectedLanguage: varchar("detected_language", { length: 10 }),
	replyLanguage: varchar("reply_language", { length: 10 }),
	createdTime: timestamp("created_time", { mode: 'string' }),
	repliedAt: timestamp("replied_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxInstagramCommentsMediaId: index("idx_instagram_comments_media_id").on(table.mediaId),
		idxInstagramCommentsId: index("idx_instagram_comments_id").on(table.instagramCommentId),
		idxInstagramCommentsReplied: index("idx_instagram_comments_replied").on(table.replied),
		instagramCommentsInstagramCommentIdKey: unique("instagram_comments_instagram_comment_id_key").on(table.instagramCommentId),
	}
});

export const messages = pgTable("messages", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" } ),
	facebookMessageId: varchar("facebook_message_id", { length: 255 }).notNull(),
	instagramMessageId: varchar("instagram_message_id", { length: 255 }),
	platform: varchar("platform", { length: 20 }).default('facebook'::character varying),
	senderId: varchar("sender_id", { length: 255 }).notNull(),
	senderName: varchar("sender_name", { length: 255 }),
	message: text("message").notNull(),
	direction: varchar("direction", { length: 10 }).default('incoming'::character varying),
	replied: boolean("replied").default(false),
	replyText: text("reply_text"),
	replyMethod: varchar("reply_method", { length: 50 }),
	createdTime: timestamp("created_time", { mode: 'string' }),
	repliedAt: timestamp("replied_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxMessagesPageId: index("idx_messages_page_id").on(table.pageId),
		idxMessagesSenderId: index("idx_messages_sender_id").on(table.senderId),
		idxMessagesFacebookMessageId: index("idx_messages_facebook_message_id").on(table.facebookMessageId),
		idxMessagesDirection: index("idx_messages_direction").on(table.direction),
		idxMessagesPlatform: index("idx_messages_platform").on(table.platform),
		messagesFacebookMessageIdKey: unique("messages_facebook_message_id_key").on(table.facebookMessageId),
	}
});

export const usage = pgTable("usage", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" } ),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	aiRepliesCount: integer("ai_replies_count").default(0),
	templateRepliesCount: integer("template_replies_count").default(0),
	totalCommentsProcessed: integer("total_comments_processed").default(0),
	totalMessagesProcessed: integer("total_messages_processed").default(0),
	dailyBreakdown: jsonb("daily_breakdown").default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxUsageUserId: index("idx_usage_user_id").on(table.userId),
		idxUsagePeriod: index("idx_usage_period").on(table.periodStart, table.periodEnd),
		idxUsageUserPeriod: index("idx_usage_user_period").on(table.userId, table.periodStart),
	}
});

export const usageLogs = pgTable("usage_logs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" } ),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" } ),
	platform: varchar("platform", { length: 20 }),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
},
(table) => {
	return {
		idxUsageLogsUserId: index("idx_usage_logs_user_id").on(table.userId),
		idxUsageLogsEventType: index("idx_usage_logs_event_type").on(table.eventType),
		idxUsageLogsCreatedAt: index("idx_usage_logs_created_at").on(table.createdAt),
	}
});

export const subscriptions = pgTable("subscriptions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" } ),
	planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" } ),
	status: varchar("status", { length: 20 }).default('active'::character varying),
	trialEndsAt: timestamp("trial_ends_at", { mode: 'string' }),
	currentPeriodStart: timestamp("current_period_start", { mode: 'string' }).defaultNow(),
	currentPeriodEnd: timestamp("current_period_end", { mode: 'string' }),
	externalSubscriptionId: varchar("external_subscription_id", { length: 255 }),
	paymentMethod: varchar("payment_method", { length: 50 }),
	canceledAt: timestamp("canceled_at", { mode: 'string' }),
	cancelReason: text("cancel_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
	stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
},
(table) => {
	return {
		idxSubscriptionsUserId: index("idx_subscriptions_user_id").on(table.userId),
		idxSubscriptionsStatus: index("idx_subscriptions_status").on(table.status),
		idxSubscriptionsPlanId: index("idx_subscriptions_plan_id").on(table.planId),
		idxSubscriptionsStripeCustomer: index("idx_subscriptions_stripe_customer").on(table.stripeCustomerId),
		idxSubscriptionsExternalSubscription: index("idx_subscriptions_external_subscription").on(table.externalSubscriptionId),
	}
});

export const plans = pgTable("plans", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: varchar("name", { length: 100 }).notNull(),
	slug: varchar("slug", { length: 50 }).notNull(),
	description: text("description"),
	price: integer("price").default(0).notNull(),
	currency: varchar("currency", { length: 3 }).default('USD'::character varying),
	interval: varchar("interval", { length: 20 }).default('month'::character varying),
	maxPages: integer("max_pages").default(1),
	maxAiRepliesPerMonth: integer("max_ai_replies_per_month").default(50),
	maxTemplates: integer("max_templates").default(3),
	maxRules: integer("max_rules").default(2),
	facebookEnabled: boolean("facebook_enabled").default(true),
	instagramEnabled: boolean("instagram_enabled").default(true),
	whatsappEnabled: boolean("whatsapp_enabled").default(false),
	showBranding: boolean("show_branding").default(true),
	prioritySupport: boolean("priority_support").default(false),
	trialDays: integer("trial_days").default(0),
	regionalPricing: jsonb("regional_pricing").default({}),
	isActive: boolean("is_active").default(true),
	isDefault: boolean("is_default").default(false),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	stripePriceId: varchar("stripe_price_id", { length: 255 }),
},
(table) => {
	return {
		idxPlansSlug: index("idx_plans_slug").on(table.slug),
		idxPlansIsActive: index("idx_plans_is_active").on(table.isActive),
		idxPlansStripePrice: index("idx_plans_stripe_price").on(table.stripePriceId),
		plansSlugKey: unique("plans_slug_key").on(table.slug),
	}
});
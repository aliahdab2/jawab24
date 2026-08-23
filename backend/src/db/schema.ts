import { pgTable, uuid, varchar, text, timestamp, boolean, integer, index, uniqueIndex, real, numeric, date, check, customType, type AnyPgColumn } from 'drizzle-orm/pg-core';
// Fixed jsonb column type — drizzle 0.29's own `jsonb` double-encodes through
// postgres-js and stores jsonb *strings* (see jsonbColumn.ts for the full story).
import { jsonb } from './jsonbColumn';
import { sql } from 'drizzle-orm';
import { DEFAULT_HANDOFF_PAUSE_MINUTES, DEFAULT_AI_MODEL, PLACEHOLDER_TIMEZONE } from '@jawab24/shared';
import type { LeadStagesConfig, LeadCustomFieldDef, PostSuggestionVariant } from '@jawab24/shared';
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
    // Attribution: which partner (reseller / country rep) brought this merchant in.
    // Written only by the admin console's manual assignment today; a future
    // referral-link signup flow stamps the same column. ON DELETE SET NULL so
    // removing a partner never breaks their merchants' accounts.
    partnerId: uuid('partner_id').references((): AnyPgColumn => partners.id, { onDelete: 'set null' }),
    // Admin-authored follow-up note about this merchant, shown to the assigned
    // partner in the portal (e.g. "لم يفعّل الرد الآلي بعد — تواصل معه").
    // Meaningful only while partner_id is set; kept on unassign so re-assigning
    // doesn't lose context.
    partnerNote: text('partner_note'),
    // GA4 client id (the `_ga` cookie's `GA1.1.<client>.<ts>` tail), captured from
    // the browser after login. Server-side conversions (GA4 Measurement Protocol,
    // services/ga4.ts) need it to attribute a milestone back to the ad click that
    // started the session — without it the event still LANDS in GA4 but Google Ads
    // cannot tie it to a keyword, so it counts without optimising.
    //
    // FIRST-TOUCH: written only while NULL (see authController.setAnalyticsClientId).
    // The cookie is per-browser and 2-year stable, so the first value we see is the
    // one most likely to carry the ad click; a later login from a second device must
    // not overwrite it. NULL for every user who signed up before this shipped, and
    // for anyone with analytics blocked — both degrade to "no MP event", never to
    // a broken signup.
    gaClientId: varchar('ga_client_id', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    // App-level invariant: at least one identity anchor must be non-null —
    // facebookId, phone, or (for auto-provisioned e-commerce merchants, whose
    // sign-in path is the platform's embedded entry) email.
}, (table) => {
    return {
        // Supports the case-insensitive lookup that guards e-commerce
        // auto-provisioning (authService.provisionEcommerceMerchantUser). That
        // guard runs on a PUBLIC install callback and would otherwise sequential-
        // scan `users` on every App Market install.
        //
        // Deliberately NOT unique. A unique index is the structurally correct
        // answer to the check-then-insert race, but `users.email` has never been
        // constrained, so pre-existing duplicates would fail this migration
        // mid-deploy — a worse outcome than the race. The race itself is closed
        // instead by a transaction-scoped advisory lock in the provisioning path.
        // TODO(JAWAB24-ZID-EMAIL-UNIQ): audit `select lower(email), count(*) from
        // users where email is not null group by 1 having count(*) > 1` in
        // production, de-duplicate, then promote this to a partial unique index.
        emailLowerIdx: index('idx_users_email_lower').on(sql`lower(${table.email})`),
        // Serves the partner portal's "my merchants" query.
        partnerIdIdx: index('idx_users_partner_id').on(table.partnerId),
    };
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

// Activation funnel events — lightweight, internal product analytics (NO external service).
// One row per (user, milestone). The unique (user_id, event) index combined with
// onConflictDoNothing in services/activation.ts makes every emit idempotent: the FIRST
// time a user reaches a step wins, later emits are silent no-ops. That gives us
// "first_autoreply_sent fires once per user" for free, and lets the funnel query count
// each user once per step without DISTINCT gymnastics. See services/activation.ts.
export const activationEvents = pgTable('activation_events', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    // 'signup' | 'page_connected' | 'kb_filled' | 'autoreply_enabled' | 'first_autoreply_sent'
    // (enforced in TS via the ActivationEvent union in services/activation.ts).
    event: text('event').notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Exactly-once claim for the GA4 mirror (services/activation.ts). Set by the
    // single `UPDATE … WHERE ga4_mirrored_at IS NULL RETURNING` that both the live
    // mirror and the signup-session replay go through, so a milestone can never be
    // reported to Google Ads twice however the two race. NULL means "not claimed by
    // that code" — NOT "never sent": rows mirrored before migration 0176 carry no
    // stamp although they were sent. Never read it as a send log.
    ga4MirroredAt: timestamp('ga4_mirrored_at', { withTimezone: true }),
}, (table) => ({
    userEventUnique: uniqueIndex('activation_events_user_event_idx').on(table.userId, table.event),
    createdAtIdx: index('activation_events_created_at_idx').on(table.createdAt),
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
    // Rotation family: every token minted from one login shares this id, so a
    // theft response / logout can revoke the whole lineage in ONE statement
    // (RFC 9700 §4.14.2). Chain-walking replacedByTokenHash could not do that —
    // grace-window mints branch off the chain and were unreachable. Nullable
    // only for rows that predate the column; those adopt their own id as family
    // on first rotation (see refreshToken.ts).
    familyId: uuid('family_id'),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'), // Any non-null value means revoked
    // Successor's token hash. Its PRESENCE is what distinguishes a
    // rotation-revocation (grace-eligible) from a terminal one (logout / reuse
    // detection), so never set it on a terminal revoke.
    replacedByTokenHash: varchar('replaced_by_token_hash', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_refresh_tokens_user_id').on(table.userId),
        tokenHashIdx: index('idx_refresh_tokens_token_hash').on(table.tokenHash),
        familyIdIdx: index('idx_refresh_tokens_family_id').on(table.familyId),
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
    //   - 'token_revoked':  FB returned a real OAuth-revoked code/subcode — on the user token
    //                       (e.g. 190/460 password changed) or on the PAGE token itself (code 190
    //                       on a page-level revoke). A page is judged by its own token, so an
    //                       account with no user token keeps its valid pages.
    //   - 'user_revoked':   reserved for future Deauthorize Callback (user removed app from FB)
    disconnectReason: varchar('disconnect_reason', { length: 30 }),
    autoReplyEnabled: boolean('auto_reply_enabled').default(true),
    // Why auto_reply_enabled is false. Null when enabled, or for legacy rows disabled
    // before this column existed (provenance unknown — treated as user-disabled).
    // Distinguishes merchant intent from system enforcement — the comment pipeline
    // stores comments unreplied for system-disabled pages but drops them for
    // user-disabled ones (deliberate product choice).
    //   - 'user':        merchant toggled the page off in the dashboard
    //   - 'trial_block': channel already consumed its free trial under another account
    //   - 'auto_pause':  send-failure auto-pause tripped (see pageAutoPause.ts; details
    //                    in auto_pause_reason / auto_paused_at)
    //   - 'plan_limit':  RESERVED — no current writer. Over-limit pages are refused at
    //                    connect (not persisted); value kept only for support backfills
    //                    of pre-06/2026 shadow pages
    // The revoked-page sync path clears this to null (the blanked access_token is the
    // authoritative disconnect signal there).
    autoReplyDisabledReason: varchar('auto_reply_disabled_reason', { length: 30 }),
    // Instagram Business Account linked to this page
    instagramAccountId: varchar('instagram_account_id', { length: 255 }),
    instagramUsername: varchar('instagram_username', { length: 255 }),
    instagramProfilePicUrl: text('instagram_profile_pic_url'),
    instagramAutoReplyEnabled: boolean('instagram_auto_reply_enabled').default(false),
    // Instagram-DIRECT connect (Instagram Login, no Facebook Page). When set, this
    // row is an Instagram-only channel: the send path uses graph.instagram.com with
    // THIS token instead of graph.facebook.com with access_token (which stays '' —
    // there is no page). Presence of this token IS the discriminator; do not add a
    // separate source column. AES-256-GCM encrypted (enc:v1: prefix), 60-day
    // long-lived Instagram User token refreshed by the sweep like the WhatsApp one.
    instagramAccessToken: text('instagram_access_token'),
    // NULL means "unknown" — never compute days-until from it (same contract as
    // whatsapp_token_expires_at below).
    instagramTokenExpiresAt: timestamp('instagram_token_expires_at'),
    // WhatsApp Business Account linked to this page
    whatsappPhoneNumberId: varchar('whatsapp_phone_number_id', { length: 255 }),
    whatsappBusinessAccountId: varchar('whatsapp_business_account_id', { length: 255 }),
    whatsappDisplayPhoneNumber: varchar('whatsapp_display_phone_number', { length: 30 }),
    whatsappAutoReplyEnabled: boolean('whatsapp_auto_reply_enabled').default(false),
    // Embedded Signup business token for the merchant's WABA — separate from the
    // Facebook page token in access_token. AES-256-GCM encrypted (enc:v1: prefix).
    whatsappAccessToken: text('whatsapp_access_token'),
    // When the WABA business token expires. Meta FORCES a 60-day expiry on the
    // "WhatsApp Embedded Signup" login variation (the never-expire option is only
    // offered for the "General" variation), so unlike the FB page token this one
    // dies on a clock. NULL means "unknown or never expires" — Meta's debug_token
    // reports expires_at = 0 for non-expiring tokens, so callers must treat NULL
    // as "no deadline" and never compute a days-until from it.
    whatsappTokenExpiresAt: timestamp('whatsapp_token_expires_at'),
    // Last successful debug_token health check. Drives the sweep's staleness query,
    // mirroring token_last_verified_at on the Facebook side.
    whatsappTokenLastVerifiedAt: timestamp('whatsapp_token_last_verified_at'),
    // Why WhatsApp is currently disconnected (whatsapp_access_token cleared). Null
    // when connected. Mirrors disconnect_reason for the Facebook channel.
    //   - 'token_expired': Meta code 190 / debug_token is_valid=false — merchant must reconnect
    //   - 'app_uninstalled': account_update webhook said the customer removed our app
    whatsappDisconnectReason: varchar('whatsapp_disconnect_reason', { length: 30 }),
    // TRUE when the number was onboarded via Meta's Coexistence flow ("API
    // Solutions for Business App Users") and therefore stays live in the
    // merchant's WhatsApp Business app; FALSE/NULL means it was migrated to the
    // Cloud API and no longer works on their phone.
    //
    // Load-bearing beyond bookkeeping: a coexistence number must NOT be
    // registered against the Cloud API on reconnect, it is the only kind that
    // emits `smb_message_echoes` (a human answering from the phone), and it
    // decides the default reply mode — a human and the AI share this number, so
    // answering instantly risks replying twice to the same customer.
    //
    // Nullable on purpose: NULL is "connected before this column existed", which
    // is necessarily a migrated number.
    whatsappCoexistence: boolean('whatsapp_coexistence'),
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
    // Catalog vertical (business type shaping catalog defaults). NULL = derive
    // from the FB page category (business_profile.suggestions.category) via
    // verticalFromFbCategory; a stored value is a merchant override and wins.
    catalogVertical: varchar('catalog_vertical', { length: 20 }),
    // Newest post created_time consumed by the catalog posts-scan. The next scan
    // only fetches posts newer than this, so re-scans propose new posts' items
    // instead of re-flooding the review sheet with everything already seen.
    catalogScanLastPostTime: timestamp('catalog_scan_last_post_time'),
    // Per-page overrides of the workspace lead config (settings.leadStages /
    // settings.leadFields). NULL = inherit the workspace config; a set value is
    // a full replacement for this page. Resolved via resolveEffectiveLeadStages/
    // resolveEffectiveLeadFields in @jawab24/shared. No default — null must stay
    // distinguishable from an empty {} / [] override.
    leadStages: jsonb('lead_stages').$type<LeadStagesConfig>(),
    leadFields: jsonb('lead_fields').$type<LeadCustomFieldDef[]>(),
    // Per-page persona override (workspace settings.brandVoiceNotesMulti is the
    // default). Same inherit semantics as leadStages: NULL = inherit — and an
    // empty {} also inherits, mirroring resolveBrandVoiceNotes' "no keys = no
    // persona written" rule, so clearing every language reverts to the
    // workspace persona instead of silencing it. Resolved through
    // resolveBrandVoiceNotes' pageOverride parameter (single choke point);
    // cache isolation is free — the persona TEXT is already a cache scope on
    // both layers (exact-key `bv:` segment + semantic brandVoiceHash metadata).
    brandVoiceNotesMulti: jsonb('brand_voice_notes_multi').$type<Record<string, string>>(),
    // Per-page override of the workspace reply mode (settings.reply_mode).
    // NULL = inherit; 'sales' | 'info' is a deliberate pin for this page that
    // survives a workspace-level flip. Resolved via resolveEffectiveReplyMode
    // in @jawab24/shared. No default — null must stay distinguishable from an
    // explicit 'sales' pin (same semantics as leadStages/leadFields above).
    replyMode: varchar('reply_mode', { length: 10 }),
    // Defensive auto-pause: when Facebook persistently rejects our reply sends
    // (Page restricted, unpublished, permission lost mid-flight), we bump the
    // counter on every page-level failure (our_fault / unknown buckets), reset
    // on any successful send, and flip auto_reply_enabled=false once the
    // counter crosses the threshold. autoPauseReason carries the cause for the
    // UI banner. Customer toggling auto-reply back on clears both fields.
    consecutiveSendFailures: integer('consecutive_send_failures').default(0).notNull(),
    autoPauseReason: varchar('auto_pause_reason', { length: 30 }),
    autoPausedAt: timestamp('auto_paused_at'),
    // Merchant-initiated soft-hide of an already-DISCONNECTED Facebook page
    // (agencies rotate pages and their dead cards pile up on the channels
    // screen). The row and ALL its data are kept — hard delete stays an
    // admin/GDPR action. Hidden from merchant surfaces by the filter in the
    // pages controller's getAll, NEVER inside pagesService.getPages: the
    // Facebook sync needs archived rows in its existing-page map, or it would
    // re-insert duplicates and mis-compute the revoke list. Sync clears this
    // automatically when the page reappears in the merchant's Meta grant.
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        userIdIdx: index('idx_pages_user_id').on(table.userId),
        workspaceIdIdx: index('idx_pages_workspace_id').on(table.workspaceId),
        facebookPageIdIdx: index('idx_pages_facebook_page_id').on(table.facebookPageId),
        // UNIQUE: one IG account, one row — `getPageByInstagramId` takes result[0]
        // and routes every webhook by it, so a duplicate would split a merchant's
        // Instagram between two rows arbitrarily. Uniqueness also backstops the
        // connectInstagramDirect select-then-insert race (Postgres treats NULLs as
        // distinct, so FB-only and WhatsApp-only rows are unaffected). Prod checked
        // clean of duplicates 2026-08-16 before this tightened (PR #772 review M2).
        instagramAccountIdIdx: uniqueIndex('idx_pages_instagram_account_id').on(table.instagramAccountId),
        // UNIQUE: one WhatsApp number belongs to exactly one page across the
        // platform. Makes the "number taken" invariant structural (a concurrent
        // double-connect gets 23505 → 409) instead of relying only on the
        // check-then-insert in controllers/whatsapp.ts. Postgres treats NULLs as
        // distinct, so the many WhatsApp-less rows (whatsapp_phone_number_id NULL)
        // never collide — uniqueness applies only to real numbers.
        whatsappPhoneNumberIdIdx: uniqueIndex('idx_pages_whatsapp_phone_number_id').on(table.whatsappPhoneNumberId),
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

// 2c. Trial Grants Table — anti-abuse ledger for the per-ACCOUNT free trial
//
// Sibling to `channel_trials`, but guarding a different benefit: the one-time
// 30-day free trial (default Starter plan) that every brand-new account gets.
// Account deletion is a GDPR-honoring HARD delete (services/auth.ts deleteUser)
// that also removes the user's subscription + usage rows — so without this ledger
// a person could delete their account and re-sign-up with the same phone /
// Facebook identity to mint a brand-new trial (and fresh monthly quota) over and
// over. The unique constraints on users.phone / users.facebookId only block LIVE
// duplicates; once the row is hard-deleted the value is reusable and the signup
// path treats the returnee as brand-new.
//
// This table records, per signup identity, that the identity has ALREADY consumed
// its free trial. The row SURVIVES the user delete (firstUserId SET NULL) so the
// claim outlives the account. On the next signup, subscriptions.createSubscription
// consults it and, if the identity is present, issues a 'canceled' subscription
// (no trial dates) → zero free quota — the returning account looks new but must
// subscribe to use Smart Replies.
// First writer wins (unique identityType+identityHash, ON CONFLICT DO NOTHING).
// See services/trialLedger.ts.
//
// The identity is stored ONLY as a keyed HMAC-SHA256 hash, never in plaintext: the
// raw phone / Facebook id is PII we just hard-deleted, and an equality match (same
// identity → same hash) is all this ledger ever needs.
export const trialGrants = pgTable('trial_grants', {
    id: uuid('id').defaultRandom().primaryKey(),
    // 'phone' (users.phone) | 'facebook' (users.facebookId) — the signup identity.
    identityType: varchar('identity_type', { length: 20 }).notNull(),
    // HMAC-SHA256 hex of the normalized identity, domain-separated. 64 hex chars.
    identityHash: varchar('identity_hash', { length: 64 }).notNull(),
    // The account that first claimed the trial. SET NULL on user delete so the
    // claim survives the hard delete; firstUserId === null then reads as
    // "trial consumed, original owner gone".
    firstUserId: uuid('first_user_id').references(() => users.id, { onDelete: 'set null' }),
    firstTrialedAt: timestamp('first_trialed_at').defaultNow(),
}, (table) => {
    return {
        identityUnique: uniqueIndex('idx_trial_grants_type_hash').on(table.identityType, table.identityHash),
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
    /** Comma-separated keywords that VETO the trigger: a comment containing any of them
     *  never fires the Post Reply (both trigger modes) and falls through to the AI pipeline. */
    triggerExcludeKeyword: text('trigger_exclude_keyword'),
    /** How the per-post trigger fires: 'keyword' = only comments matching triggerKeyword;
     *  'all' = any comment (triggerKeyword ignored). 'all' still runs the skip-rule +
     *  complaint guards before sending (see commentProcessor step 3b). */
    triggerType: varchar('trigger_type', { length: 20 }).default('keyword').notNull(),
    /** Post Reply image (DM-modes only): public URL Meta fetches, storage key for deletion,
     *  and decoded byte size for the per-workspace quota SUM. See services/imageStorage.ts. */
    triggerImageUrl: text('trigger_image_url'),
    triggerImageKey: text('trigger_image_key'),
    triggerImageBytes: integer('trigger_image_bytes'),
    /** Post Reply option: page likes the customer's comment after a successful trigger send.
     *  Facebook-only — the Instagram API has no like-comment endpoint, so instagram_media
     *  has no counterpart column. */
    likeComment: boolean('like_comment').default(false).notNull(),
    /** Post Reply option: the public comment we post mentions (@-tags) the commenter, so they
     *  get a "you were mentioned" notification on top of the reply notification Facebook already
     *  sends. Facebook-only — Instagram mentions use a different mechanism (`@username`), so
     *  instagram_media has no counterpart column.
     *
     *  Meta only renders the tag when the PAGE's «Others Tagging this Page» setting is on, and
     *  that setting is NOT readable through any API (measured 2026-08-07: `/{page}/settings`
     *  exposes 13 settings, none of them this one; `?metadata=1` is disabled on v23.0), so an
     *  armed post cannot know in advance whether its mentions will render. Measured on a live
     *  page the same day: an unresolvable `@[id]` is STRIPPED silently — no error, no tag, and
     *  the token does not survive as literal text. The send path still verifies and repairs, so
     *  the reply never keeps the leftover leading space — see
     *  services/reply/commentMentionGuard.ts. */
    tagCommenter: boolean('tag_commenter').default(false).notNull(),
    /** Post Reply CTA button (DM-modes only, Facebook-only): a tappable link under the private
     *  reply. Label + URL are stored/cleared together (both set = button shown, both null = none).
     *  instagram_media has no counterpart column (button-template support unverified on IG). */
    triggerButtonLabel: text('trigger_button_label'),
    triggerButtonUrl: text('trigger_button_url'),
    /** Set when the merchant armed a Post Reply on a still-SCHEDULED FB post via the
     *  picker; cleared by the publish webhook (item=post, verb=add) once the same
     *  post_id goes live. A value still set past its own time while a foreign post_id
     *  publishes on the page is the tripwire for "scheduled post changed id at publish" —
     *  but only after Graph confirms the post is still pending, because the likelier
     *  cause is a publish webhook we never received. See postsService.onPostPublished. */
    scheduledPublishTime: timestamp('scheduled_publish_time'),
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
    /** Comma-separated veto keywords — see posts.triggerExcludeKeyword. */
    triggerExcludeKeyword: text('trigger_exclude_keyword'),
    /** How the per-post trigger fires: 'keyword' = only comments matching triggerKeyword;
     *  'all' = any comment (triggerKeyword ignored). See posts.triggerType. */
    triggerType: varchar('trigger_type', { length: 20 }).default('keyword').notNull(),
    /** Post Reply image (DM-modes only): public URL Meta fetches, storage key for deletion,
     *  and decoded byte size for the per-workspace quota SUM. See services/imageStorage.ts. */
    triggerImageUrl: text('trigger_image_url'),
    triggerImageKey: text('trigger_image_key'),
    triggerImageBytes: integer('trigger_image_bytes'),
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
    // (e.g. { dm_failed: { bucket, code, fbMessage } }, { sla_no_reply: { minutes } },
    // and KB-gap flags { info_not_in_kb | price_not_in_kb | phone_not_in_kb: { question } }
    // — the customer question that wasn't in the KB).
    // Plain keys like angry_customer / low_confidence leave this NULL.
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
    // Smart Reply comments: like the customer's comment after replying (Facebook only —
    // the IG Graph API has no like-comment endpoint). Post Reply has its own per-post
    // toggle (posts.like_comment); this one governs the smart-reply path.
    likeComments: boolean('like_comments').default(false),
    dualReplyNudge: text('dual_reply_nudge').default(''),
    commentsAutoReply: boolean('comments_auto_reply').default(true),
    messagesAutoReply: boolean('messages_auto_reply').default(true),
    businessHoursOnly: boolean('business_hours_only').default(false),
    businessHoursStart: varchar('business_hours_start', { length: 5 }).default('09:00'),
    businessHoursEnd: varchar('business_hours_end', { length: 5 }).default('18:00'),
    // Placeholder only — every merchant should set this explicitly (the business-hours
    // card prefills the detected zone when hours are switched on). Declared as
    // 'Asia/Riyadh' because that is what production has actually been handing out:
    // migration 0026 created the column with 'Asia/Damascus' but prod's default was
    // later changed by hand, so all 59 pre-D-034 rows carry Riyadh. Codifying the live
    // value keeps fresh databases identical to prod instead of silently splitting them.
    timezone: varchar('timezone', { length: 100 }).default(PLACEHOLDER_TIMEZONE),
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
    // Workspace default reply mode: 'sales' (AI may ask customers for contact
    // details and promise follow-up) | 'info' (information desk — never asks,
    // never promises; passive lead storage only). Pages override via
    // pages.reply_mode (NULL = inherit this value).
    replyMode: varchar('reply_mode', { length: 10 }).default('sales'),
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
    // Store-then-enrich lifecycle for attachment messages (see nonTextHandler.ts).
    // The attachment row is stored as a placeholder the instant the webhook lands,
    // then enriched (Whisper transcript / vision description / shared-post text) and
    // finalized with one atomic UPDATE — so the merchant inbox shows the attachment
    // immediately and the reply pipeline can PARK until the real content is ready
    // (messageProcessor step 11) instead of answering the bare "[صورة]" placeholder.
    //   NULL      = no enrichment lifecycle (text, outgoing, sticker, non-enrichable
    //               attachment, and every legacy row — no backfill needed)
    //   'pending' = stub stored, enrichment in flight (bounded by service timeouts)
    //   'done'    = enrichment succeeded; `message` now holds the real content
    //   'failed'  = enrichment failed/denied; the placeholder text is final
    enrichmentStatus: varchar('enrichment_status', { length: 16 }),
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
        // Composite index for sender inbox queries: hasOutgoingMessage, hasNewerUnrepliedMessage, isPaused lookups
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
    // Stamped by the trial-ending reminder cron (services/trialReminders.ts) once
    // the merchant has been warned, so the daily run never warns twice for the
    // same trial. NULL = not yet warned. Written only after the in-app
    // notification lands; see the service for the retry semantics.
    trialEndingNotifiedAt: timestamp('trial_ending_notified_at'),
    // Stamped by the trial-ended notice (same daily cron, second sweep) once the
    // merchant has been told the trial expired and replies stopped — the "last
    // try" conversion touch. NULL = not yet notified. Same retry semantics as
    // trial_ending_notified_at: written only after the in-app notification lands.
    trialEndedNotifiedAt: timestamp('trial_ended_notified_at'),
    // Stamped the one time this subscription's `purchase` conversion is reported
    // to GA4 (services/ga4.ts). It exists to make that report exactly-once
    // ACROSS TWO webhook paths that both see money: `checkout.session.completed`
    // (a plan with no trial, charged at checkout) and `invoice.payment_succeeded`
    // (a trialed plan's first real charge, ~30 days later — and every renewal
    // after it). Whichever arrives first claims the stamp; the others find it set
    // and send nothing, so a renewal can never be reported as an acquisition.
    // NULL = never reported. Claimed with `WHERE … IS NULL`, the same first-touch
    // shape as users.ga_client_id, which is what makes the claim atomic under
    // concurrent webhook delivery. ⛔ The amount guard must run BEFORE the claim:
    // a trial checkout completes at $0 and must NOT consume the stamp, or the
    // real payment 30 days later is suppressed forever.
    ga4PurchaseReportedAt: timestamp('ga4_purchase_reported_at'),

    // Billing period
    currentPeriodStart: timestamp('current_period_start').defaultNow(),
    currentPeriodEnd: timestamp('current_period_end'),

    // Payment info (for Stripe integration)
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }), // Stripe Subscription ID / Shopify AppSubscription GID / Zid App Market subscription id
    paymentMethod: varchar('payment_method', { length: 50 }), // 'stripe', 'paypal', 'manual', 'shopify', 'zid'
    stripeCustomerId: varchar('stripe_customer_id', { length: 255 }), // Stripe Customer ID
    stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }), // For tracking
    // Shopify App Pricing (managed billing): the *.myshopify.com domain whose app
    // subscription this row mirrors. Required when payment_method='shopify' (CHECK
    // below), unique among shopify rows (partial index) so one shop can never bill
    // two workspaces. Lives here — NOT on ecommerce_stores — so the paid state
    // survives GDPR shop/redact deleting the store row.
    shopifyShopDomain: varchar('shopify_shop_domain', { length: 255 }),
    // Zid App Market (managed billing): our ecommerce_stores UUID for the Zid
    // store whose App Market subscription this row mirrors. Same role as
    // shopify_shop_domain on the Shopify rail — required when
    // payment_method='zid' (CHECK below), unique among live zid rows (partial
    // index) so one store can never bill two workspaces.
    //
    // Keyed on OUR store UUID rather than Zid's numeric store id because that
    // is what every trigger already has in hand (the webhook target_url carries
    // `sid`, the reconciler sweeps store rows) and it needs no extra lookup on
    // the cancel path. Unlike Shopify there is no GDPR shop/redact mandate that
    // deletes the store row out from under the subscription, so the mirror does
    // not need to survive independently of ecommerce_stores.
    zidStoreId: varchar('zid_store_id', { length: 255 }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false), // Cancel at period end flag

    // Dunning-email idempotency stamps (services/dunningNotices.ts). Each marks
    // "the merchant has been emailed for the CURRENT failure episode" — an
    // episode runs from the first failed renewal charge to the next successful
    // payment, which resets both to NULL so a later failure notifies again.
    // Claimed atomically (UPDATE … WHERE <col> IS NULL) before sending because
    // two triggers race (webhook retries × the daily sweep), and released back
    // to NULL when the send provably did not go out. NULL = no open notified
    // episode. Same column-stamp pattern as trial_ending_notified_at above.
    renewalFailureNotifiedAt: timestamp('renewal_failure_notified_at'),
    suspensionNotifiedAt: timestamp('suspension_notified_at'),

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
        // One NON-CANCELED local mirror per shop (same conditional-constraint
        // pattern as topup_purchases). Canceled rows are excluded on purpose:
        // they keep their domain for audit, and a shop that uninstalled from
        // workspace A must stay adoptable by workspace B — a full-scope unique
        // index would deadlock that adoption forever, unhealably.
        // NOTE: drizzle-kit 0.x drops .where() when generating SQL — the real
        // partial index lives in migration 0147 (hand-amended, 0108 precedent).
        shopifyShopDomainUnique: uniqueIndex('idx_subscriptions_shopify_shop_domain')
            .on(table.shopifyShopDomain)
            .where(sql`${table.paymentMethod} = 'shopify' AND ${table.status} IS DISTINCT FROM 'canceled'`),
        // A shopify-billed row without its shop domain is unreconcilable — the
        // 6h sweep and the uninstall cancel both resolve rows by this column.
        shopifyDomainRequiredCheck: check(
            'subscriptions_shopify_domain_required',
            sql`${table.paymentMethod} IS DISTINCT FROM 'shopify' OR ${table.shopifyShopDomain} IS NOT NULL`
        ),
        // `status` is read by checkSubscriptionStatus, which blocks only the
        // values it recognises and grants entitlement to everything else. A
        // value outside this list is therefore free service, forever, and it
        // used to be reachable: the Stripe webhook mirrored that provider's
        // status verbatim, and three of its eight (`unpaid`, `incomplete`,
        // `incomplete_expired`) are not ours. config/stripeBilling.ts now maps
        // them, but a mapping is a promise in application code — this makes the
        // invariant impossible to violate rather than merely unlikely, from any
        // writer on any rail (Rule 14: prevention over detection).
        // Verified against production before adding: 85 rows, zero violations.
        statusInUnionCheck: check(
            'subscriptions_status_in_union',
            sql`${table.status} IS NULL OR ${table.status} IN ('trialing', 'active', 'past_due', 'canceled', 'paused')`
        ),
        // The Zid rail's twin of the two constraints above — same reasoning,
        // same canceled-row exclusion (a store that uninstalled from workspace A
        // must stay adoptable by workspace B). Unlike 0147's era, the current
        // drizzle-kit DOES emit the .where(), so migration 0161 is generated
        // rather than hand-written — amended only to be re-runnable
        // (IF NOT EXISTS / duplicate_object), matching the 0147 precedent.
        zidStoreIdUnique: uniqueIndex('idx_subscriptions_zid_store_id')
            .on(table.zidStoreId)
            .where(sql`${table.paymentMethod} = 'zid' AND ${table.status} IS DISTINCT FROM 'canceled'`),
        // A zid-billed row without its store id is unreconcilable — the sweep
        // and the uninstall cancel both resolve rows by this column.
        zidStoreIdRequiredCheck: check(
            'subscriptions_zid_store_id_required',
            sql`${table.paymentMethod} IS DISTINCT FROM 'zid' OR ${table.zidStoreId} IS NOT NULL`
        ),
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
        // One row per (user, token) — enforced by the database, not by the
        // application's read-then-write. registerDeviceToken used to SELECT,
        // branch, then INSERT with no transaction, so two concurrent
        // registrations of the SAME token both saw zero rows and both inserted.
        // getUserDeviceTokens does not DISTINCT, so the duplicate rode into
        // sendEachForMulticast as [T, T] and FCM delivered the identical push to
        // the same device twice. The stale-token prune could never clear it
        // either: both rows carry the same token, and the prune excludes
        // `ne(token, token)`. Making it unrepresentable beats detecting it.
        userTokenUnique: uniqueIndex('idx_device_tokens_user_token').on(table.userId, table.token),
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
    // Zid dual-header auth: companion `Authorization` Bearer token to access_token
    // (which Zid sends as X-Manager-Token). AES-256-GCM encrypted. Null for Shopify/Salla.
    authorizationToken: text('authorization_token'),
    authorizationTokenIv: varchar('authorization_token_iv', { length: 64 }),
    tokenExpiresAt: timestamp('token_expires_at'),      // Salla 14d / Zid ~1y; null for Shopify
    scopes: text('scopes'),
    // Salla Easy Mode: the app.store.authorize webhook delivers tokens server-to-server
    // with only a numeric merchant id (no browser cookie). We persist it so a logged-in
    // merchant can later claim the install by merchant id. Null for the cookie/OAuth flow.
    merchantId: varchar('merchant_id', { length: 64 }),
    storeName: varchar('store_name', { length: 255 }), // shown on the claim screen ("connect your store '<name>'")
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
        platformMerchantIdx: index('idx_pending_ecommerce_platform_merchant').on(table.platform, table.merchantId),
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
    // Zid dual-header auth: companion `Authorization` Bearer token to access_token
    // (which Zid sends as X-Manager-Token). AES-256-GCM encrypted. Null for Shopify/Salla.
    authorizationToken: text('authorization_token'),
    authorizationTokenIv: varchar('authorization_token_iv', { length: 64 }),
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

    // Zid Embedded Apps (docs.zid.sa/embedded-apps): SHA-256 hex of the UUID we
    // register with Zid via POST /v1/managers/embedded-apps-token. Zid passes the
    // UUID back as ?token= when the merchant opens the app inside the dashboard
    // iframe, and POST /zid/embedded/session (services/embeddedSession.ts)
    // resolves it to a session. The UUID is a bearer credential (it opens a
    // merchant session), so only its hash is stored — a DB leak must not leak
    // live dashboard access. Null for Shopify/Salla and for stores installed
    // before the embedded flow; rotated on every (re)install.
    embeddedTokenHash: varchar('embedded_token_hash', { length: 64 }),
    // Last time the embedded credential was successfully exchanged for a
    // session. Two jobs: it bounds the credential's life (an idle one stops
    // working after EMBEDDED_TOKEN_IDLE_MS instead of living forever), and it
    // is the only way to answer "when was this last used" during an incident.
    // Null means never exchanged since it was minted — the install stamps it.
    embeddedTokenLastUsedAt: timestamp('embedded_token_last_used_at'),

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
        embeddedTokenHashUnique: uniqueIndex('idx_ecommerce_stores_embedded_token_hash').on(table.embeddedTokenHash),
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
    handle: varchar('handle', { length: 500 }),  // URL slug: Shopify 'handle', Zid 'slug'. Salla has none.
    // The platform's own canonical storefront URL (Salla `urls.customer`). Preferred
    // over a URL derived from `handle` — Salla's real product URLs cannot be
    // derived at all (no slug field; `/p/{slug}` was an invented shape). Null for
    // platforms that expose only a handle; `productUrlFor` then derives one.
    productUrl: text('product_url'),
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

/**
 * DATE column that always reads back as 'YYYY-MM-DD'. Drizzle's own
 * `date(..., { mode: 'string' })` is NOT honored here: the postgres.js driver
 * parses DATE (oid 1082) into a JS Date beneath drizzle, which then leaks
 * "Tue Jul 21 2026 02:00:00 GMT+0200 …" into consumers (caught by the catalog
 * prompt-renderer integration test) and re-introduces timezone drift. The
 * driver hands back UTC midnight, so slicing the ISO form is exact.
 */
const isoDateString = customType<{ data: string; driverData: string | Date }>({
    dataType: () => 'date',
    fromDriver: (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)),
});

// 18b. Catalog Items Table — merchant-authored offerings for pages WITHOUT a
// connected e-commerce store (the store-less majority). One row = one thing the
// business sells: a product, a service, a course, a vehicle. Generic `type`
// column, not per-vertical tables (settled kb-restructure ruling).
//
// Reply-path contract (Stage 2 v2): rows are rendered into the existing
// <product_catalog> prompt block as TEXT — never exposed through AI
// function-calling tools (D-004; the v1 tool-based catalog was reverted for
// degrading unrelated replies). kb_chunks.source_tier=2 is reserved for these
// rows if they're ever ingested for RAG; the prompt block is the only consumer
// today.
export const catalogItems = pgTable('catalog_items', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    type: varchar('type', { length: 50 }).notNull().default('product'), // 'product' | 'service' | 'course' | 'vehicle' | 'custom'
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    // Nullable price = "price on request" — a real state, not missing data.
    price: numeric('price', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 30 }), // widened 0144: CurrencyInput truncates at 30, and «ل.س بالعملة القديمة» must fit
    // Written in Release 2 (photo upload + DM photo-card); nullable from day one
    // so the photo rollout needs no second migration.
    imageUrl: text('image_url'),
    isAvailable: boolean('is_available').notNull().default(true),
    // Time-bound offerings (course cohorts, limited offers). Calendar dates,
    // not timestamps — day granularity is the product semantics, and DATE
    // avoids timezone drift. startsAt renders into the prompt ("starts
    // YYYY-MM-DD", model reasons vs its "Today's date" line, D-006); a passed
    // endsAt EXCLUDES the row from the prompt block entirely (kb_chunks
    // valid_until precedent) while the merchant UI keeps it with an "Ended"
    // badge. Real columns (not attributes JSONB) because expiry is SQL-level.
    startsAt: isoDateString('starts_at'),
    endsAt: isoDateString('ends_at'),
    // Merchant-facing label+value details ("المدة: ٦ أسابيع", "سنة الصنع: 2019").
    // Curated-by-suggestion, free by design: the AI consumes these only as
    // rendered TEXT (D-004), so labels need no stable key semantics. Access via
    // drizzle ONLY — the postgres.js driver double-encodes jsonb, so raw SQL
    // `->>` over this column silently returns NULL (parked driver bug).
    attributes: jsonb('attributes').$type<{ label: string; value: string }[]>(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => {
    return {
        pageIdIdx: index('idx_catalog_items_page_id').on(table.pageId),
        pageSortIdx: index('idx_catalog_items_page_sort').on(table.pageId, table.sortOrder),
    };
});

// ============================================
// GENERIC FACT COLLECTIONS (G1 — the fact engine)
// ============================================
// Owner ruling 2026-07-28: «the data should be generic and the code should
// support it». Nothing in this schema knows what a pharmacy, course, or
// delivery zone is — a NEW KIND of business fact is an INSERT into
// fact_collections, never a migration. catalog_items stays specialized for
// SALE items (money semantics: price guards, checkout naming); these tables
// generalize every enumerable list a business has that is not sold: outlet
// directories, coverage areas, per-city delivery zones, branch lists, staff…
//
// Why this exists (measured, 2026-07-28 grounding sweep): the largest
// unstructured defect class is list attribution — real outlet names attached
// to cities the merchant never listed (BAMBO LIBYA fired on 28% of replies).
// A rendered, DERIVED completeness/absence statement took the fabrication
// rate from 28% to 0% in the A/B battery while every honest answer survived.
// The renderer derives that statement from is_complete + the distinct
// key-attribute values; it is never hand-written (a hand-written line rots
// and can embed assumptions the merchant never stated).

export const factCollections = pgTable('fact_collections', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    // Merchant-visible name, in the merchant's language: «الصيدليات التي تبيع
    // منتجاتنا», «مناطق التوصيل», «فروعنا». Doubles as the prompt block header.
    label: varchar('label', { length: 120 }).notNull(),
    // The attribute rows are keyed/filtered by («المدينة», «الحي», «المستوى»).
    // Nullable: a flat list (services offered, brands carried) has no key.
    keyAttr: varchar('key_attr', { length: 60 }),
    // The completeness declaration — the merchant's statement that this list
    // is EXHAUSTIVE. Three states, and the distinction is customer-facing:
    //   NULL  → unconfirmed: absence renders as «غير مسجّل في قائمتي» + contact
    //           (honest — the list is what WE know, not what exists)
    //   true  → confirmed complete: absence renders as a confident negative
    //           («لا يوجد لدينا منفذ هناك») — rule-108 semantics, activated
    //   false → merchant explicitly said the list is partial: absence stays
    //           on the honest wording permanently
    // Only a merchant action may set this (D-038 discipline); extraction and
    // sync never touch it.
    isComplete: boolean('is_complete'),
    completenessConfirmedAt: timestamp('completeness_confirmed_at'),
    // Who authored the collection: 'editor' (merchant created it in the UI) |
    // 'kb_extract' (extracted from their own KB text, merchant-reviewed).
    // fb_sync is deliberately NOT a valid source here — Facebook has no
    // structured lists worth trusting (D-046). ENFORCED by a CHECK constraint in
    // migration 0142 (drizzle-kit 0.20 cannot express one), alongside a unique
    // index on (page_id, label): two collections sharing a label would emit two
    // contradictory coverage statements for the same list.
    source: varchar('source', { length: 20 }).notNull().default('kb_extract'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    pageIdIdx: index('idx_fact_collections_page_id').on(table.pageId),
}));

export const factRows = pgTable('fact_rows', {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id').references(() => factCollections.id, { onDelete: 'cascade' }).notNull(),
    // The row's display name: «صيدلية النرجس المركزية», «توصيل بنغازي».
    name: varchar('name', { length: 200 }).notNull(),
    // label/value pairs, same shape and same driver caveat as
    // catalog_items.attributes (drizzle ONLY — postgres.js double-encodes
    // jsonb, raw `->>` returns NULL). The collection's keyAttr names which
    // label carries the key («المدينة»: «حي الرمال»).
    attributes: jsonb('attributes').$type<{ label: string; value: string }[]>(),
    // Structured SHADOW of attribute values, keyed by attribute label
    // (round-7 write-back contract): the string in `attributes` stays the
    // merchant-visible source of truth the AI quotes; this column carries the
    // machine form ({days:[0,2]} / {start,end}) the editor generated it from.
    // The prompt pipeline NEVER reads it — sorting/counting/expiry
    // intelligence only. Nullable; rows authored as free text simply have none.
    structured: jsonb('structured').$type<import('@jawab24/shared').FactStructuredValues>(),
    // Optional money — a delivery-zone row has a price, an outlet row does
    // not. The renderer shows the column only when ANY row in the collection
    // prices it (no "price on request" stamped on pharmacies — the defect
    // that disqualified catalog_items as the home for lists).
    price: numeric('price', { precision: 12, scale: 2 }),
    currency: varchar('currency', { length: 30 }), // widened 0144: CurrencyInput truncates at 30, and «ل.س بالعملة القديمة» must fit
    // Optional validity window. Self-expiry kills the v38 stale-date class by
    // dates, not by model memory — but note this DIVERGES from catalog_items:
    //
    //   THE START DATE OWNS VISIBILITY (owner ruling 2026-07-31, D-057).
    //   A row with a startsAt leaves the prompt the day AFTER it starts, because
    //   an announced cohort that has already begun is stale whatever its endsAt
    //   claims. endsAt is DESCRIPTIVE — printed for the customer — and gates only
    //   rows that carry no startsAt.
    //
    // The rule lives in ONE place: `isRowLive` in @jawab24/shared/factSchedule.
    // The merchant UI keeps expired rows with an "Ended" badge, computed from the
    // same function. Real columns (not attributes JSONB) because the prompt-build
    // query pre-filters at SQL level — see the lockstep note in
    // services/factCollections.ts buildFactCollectionsContext.
    startsAt: isoDateString('starts_at'),
    endsAt: isoDateString('ends_at'),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    collectionIdIdx: index('idx_fact_rows_collection_id').on(table.collectionId),
    collectionSortIdx: index('idx_fact_rows_collection_sort').on(table.collectionId, table.sortOrder),
}));

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
    // Re-engagement signal (mirrors messages.needsAttention): set true when an
    // already-existing lead comes back — re-shares a phone number or sends a new
    // PURCHASE_INTENT message. NON-DESTRUCTIVE: status stays as the merchant left it
    // (contacted/converted). Surfaced as a "returning" badge + filter; cleared when
    // the merchant changes status. Never auto-regress the lifecycle (CRM standard).
    needsFollowUp: boolean('needs_follow_up').notNull().default(false),
    followUpReason: varchar('follow_up_reason', { length: 40 }), // 'reshared_contact' | 'returned_intent'
    followUpAt: timestamp('follow_up_at'),
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
    needsFollowUpIdx: index('idx_leads_needs_follow_up').on(table.pageId, table.needsFollowUp),
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
// phones); cleanupEmailBodies (utils/cleanup.ts) blanks html_body after 30 days.
//
// ⚠️ Recipients: this table records the `to` address ONLY. For admin-composed
// merchant emails, cc/bcc and per-attachment {filename, size, sha256} live in
// admin_audit_logs (action 'merchant_email_sent'), whose newValue.emailSendId
// joins back to this table's row — query BOTH before concluding "the rep was
// never copied" or "no attachment was sent".
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

/**
 * Daily snapshot of OpenAI's AUTHORITATIVE cost (from the org Costs API), grain =
 * usage_date × api_key_id × model × line_item. Powers the admin AI Cost panel's
 * "what OpenAI bills us" section + the org-total burn used for credit runway.
 * Distinct from ai_usage_log (our per-reply estimate, prod-only, no api_key_id).
 * Money is `numeric` (not `real`) to keep the authoritative figures exact.
 * The unique grain makes the daily upsert idempotent (re-running a day overwrites).
 */
export const aiCostSnapshots = pgTable('ai_cost_snapshots', {
    id: uuid('id').defaultRandom().primaryKey(),
    usageDate: date('usage_date').notNull(),                         // UTC day bucket from the Costs API
    apiKeyId: varchar('api_key_id', { length: 64 }).notNull().default(''), // '' when not key-attributed
    model: varchar('model', { length: 100 }).notNull().default(''),
    lineItem: varchar('line_item', { length: 100 }).notNull().default(''), // e.g. "gpt-4.1-mini, input"
    amountUsd: numeric('amount_usd', { precision: 14, scale: 6 }).notNull(),
    // Optional token overlay from /usage/completions (nullable; filled when available).
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    source: varchar('source', { length: 32 }).notNull().default('openai_costs'),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
}, (table) => ({
    grainIdx: uniqueIndex('uq_ai_cost_snapshots_grain').on(table.usageDate, table.apiKeyId, table.model, table.lineItem),
    dateIdx: index('idx_ai_cost_snapshots_date').on(table.usageDate),
}));

/**
 * Admin-entered OpenAI credit balance anchor ("balance $X as of date Y"). Single
 * logical row (latest wins). Remaining credit = balanceUsd − Costs-API org spend
 * since anchoredAt; runway = remaining ÷ rolling daily org rate. Needed because
 * OpenAI exposes no remaining-balance API.
 */
export const aiCreditBalance = pgTable('ai_credit_balance', {
    id: uuid('id').defaultRandom().primaryKey(),
    balanceUsd: numeric('balance_usd', { precision: 14, scale: 2 }).notNull(),
    anchoredAt: date('anchored_at').notNull(),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

// 17. Partners — resellers / country representatives (e.g. the Syria rep at 20%,
// the white-label reseller at 15%). Merchants are attributed to a partner via
// `users.partner_id`. The commission percentage is per-partner and is
// reporting-only: nothing auto-pays from it.
export const partners = pgTable('partners', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    // Contact email, stored lowercase. Nullable because it is NOT a reliable
    // login anchor on its own: Jawab24 has no email login, and a phone-OTP
    // signup leaves users.email NULL (authService.findOrCreateUserByPhone).
    email: varchar('email', { length: 255 }),
    // E.164 phone — the product's PRIMARY identity, so this is what actually
    // binds a phone-signup partner to their portal. At least one of email or
    // phone must be present (enforced in the service + route schema).
    phone: varchar('phone', { length: 20 }),
    // The partner's own Jawab24 user account (portal login). Nullable until the
    // partner first opens the portal.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // Whole percent, e.g. 20 — display/reporting only.
    commissionPct: integer('commission_pct').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    // Partial uniques: a NULL email/phone must not collide with another NULL.
    emailLowerUnique: uniqueIndex('idx_partners_email_lower')
        .on(sql`lower(${table.email})`)
        .where(sql`${table.email} IS NOT NULL`),
    phoneUnique: uniqueIndex('idx_partners_phone')
        .on(table.phone)
        .where(sql`${table.phone} IS NOT NULL`),
    userIdIdx: index('idx_partners_user_id').on(table.userId),
}));

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
    // Unique so a concurrent re-delivery of the same webhook can't double-send. NULL
    // platformEventId rows (non-event notifications) never conflict — Postgres treats
    // NULLs as distinct — matching the pre-existing "only dedup when event id present" rule.
    storeTypeEventIdx: uniqueIndex('idx_cust_notif_log_store_type_event').on(table.ecommerceStoreId, table.notificationType, table.platformEventId),
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

// ============================================
// POST SUGGESTIONS — «بوست اليوم» pilot
// ============================================
// One AI-suggested social post per page per day (owner ruling 2026-08-09:
// ONE post/day, regenerate REPLACES it — never accumulates). No publishing:
// the merchant copies the text / downloads the image and posts manually
// (FB_SCOPES has no pages_manage_posts). Pilot is env-gated to allowlisted
// pages via config.postSuggestions; spend is bounded by an ABSOLUTE
// 3-generations/day cap (cron consumes 1 of the 3).
/**
 * A stored take: the client-facing shape plus the storage handle the DTO must
 * never carry (imageKey is what supersede/page-deletion sweep from S3).
 */
export type PostSuggestionVariantRow = PostSuggestionVariant & { imageKey: string | null };

export const postSuggestions = pgTable('post_suggestions', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    // UTC calendar day the suggestion belongs to — cron idempotency + history
    // key. DATE not timestamp: day granularity IS the product semantics
    // (catalog_items.startsAt precedent).
    suggestedFor: isoDateString('suggested_for').notNull(),
    source: varchar('source', { length: 20 }).notNull(), // 'cron' | 'manual'
    postType: varchar('post_type', { length: 30 }), // 'promo' | 'product_spotlight' | 'faq_tip' | 'hours_reminder' | 'general'
    // The generation's takes on the same subject: [{ text, headline, imageUrl,
    // imageKey }]. ONE row per generation still — the cron partial-unique index
    // and the daily cap both count GENERATIONS, and neither moved.
    //
    // text/imageUrl/imageKey below MIRROR the selected take and stay the
    // columns of record. That is not redundancy: shipped mobile bundles know
    // nothing about `variants` (Waleed's Android 2.0.26 predates even the
    // feature gate), so they keep rendering the right post from the columns
    // they already read, and every existing SQL consumer keeps working.
    // Null on pre-migration rows = a single-take suggestion; readers rebuild a
    // one-element list from `text` rather than branching on null everywhere.
    variants: jsonb('variants').$type<PostSuggestionVariantRow[] | null>(),
    selectedVariant: integer('selected_variant').notNull().default(0),
    text: text('text').notNull(),
    // Both nullable = text-only suggestion (image call failed / storage off).
    // ⚠️ NOT "cleaned up after supersede" any more — since 2026-08-13 a
    // superseded row keeps its image, so a null here means the generation never
    // produced one. imageKey is the storage handle for delete + the
    // generated-posts/ orphan audit; imageUrl is what the UI shows.
    imageUrl: text('image_url'),
    imageKey: text('image_key'),
    // The English scene description sent to the image model. Stored for TWO
    // reasons, both learned the hard way: it is the anti-repetition input (the
    // generator reads the page's recent briefs so it stops drawing the same
    // desk every day), and it makes visual variety auditable as TEXT, which is
    // what a query can group and diff. (It used to be the only audit at all,
    // because a superseded row's image file was deleted; since 2026-08-13 the
    // images survive too, so the output itself is inspectable as well.)
    imageBrief: text('image_brief'),
    // Which KIND of image this card used ('photo' | 'poster' | 'conceptual').
    // Read back to rotate the next one — the variety mechanism that works,
    // because code decides it rather than asking the model to vary.
    imageMode: varchar('image_mode', { length: 20 }),
    // 'pending' | 'ready' | 'failed' | 'superseded'. A request claims its cap
    // slot and stores a PENDING row, then a worker fills it in — generation is
    // ~35s against nginx's 30s ceiling on this route, so it cannot run on the
    // request. 'failed' is terminal and visible on purpose: the slot was spent,
    // and a row left pending forever would misreport the merchant's balance.
    //
    // ⚠️ 'superseded' changed meaning on 2026-08-13. It used to mean "replaced
    // and GUTTED" — the row's imageUrl/imageKey were nulled and the files
    // deleted from storage. It now means simply "an earlier post, intact": the
    // merchant's history strip is built from these rows, images included. Only
    // ONE row per page is 'ready' at a time, and that is the current post.
    status: varchar('status', { length: 20 }).notNull().default('ready'),
    // Why a 'failed' row failed, as one of the service's own reason codes —
    // never a raw error string, which would leak internals to the client.
    failureReason: varchar('failure_reason', { length: 40 }),
    // Why a READY row shipped without an image ('image_failed' | 'storage_off'),
    // null = it has one. Stored rather than returned once: the generation that
    // knows this now runs in a worker, so the only place the answer can reach
    // the client is the row itself. It also fixes the dead-connection recovery,
    // which re-reads today's row and until now always lost the notice.
    imageDegraded: varchar('image_degraded', { length: 20 }),
    // When the worker reached a terminal state. Null while pending — the pair
    // (createdAt, fulfilledAt) is how generation latency gets measured at all,
    // which today is guesswork off request logs.
    fulfilledAt: timestamp('fulfilled_at'),
    // Market-signal stamps — the pilot's whole point is measuring these.
    // First-write-wins; null = the merchant never did it.
    openedAt: timestamp('opened_at'),
    copiedAt: timestamp('copied_at'),
    downloadedAt: timestamp('downloaded_at'),
    createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
    pageDateIdx: index('idx_post_suggestions_page_date').on(table.pageId, table.suggestedFor),
    // Every read this feature serves is now "this page's newest row, filtered
    // by status" — the current post, the in-flight attempt, the history strip.
    // Dropping the day scope on 2026-08-13 took `suggested_for` out of all
    // three, leaving the index above unable to do more than the page prefix
    // while rows accumulate forever (nothing is deleted any more). This is the
    // one that serves them, and it rides the card fetch — the highest-frequency
    // read in the feature.
    pageCreatedIdx: index('idx_post_suggestions_page_created').on(table.pageId, table.createdAt.desc()),
    // Cron idempotency at the DB level: blue+green can both tick the daily
    // job; the second INSERT (onConflictDoNothing) is a no-op. Manual rows
    // are exempt — regenerates create several rows per day by design.
    cronOnceIdx: uniqueIndex('uq_post_suggestions_cron_once')
        .on(table.pageId, table.suggestedFor)
        .where(sql`source = 'cron'`),
}));

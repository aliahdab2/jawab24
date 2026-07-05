// Shared Types for Jawab24

import type { MerchantProvenanceMap } from './businessProfileMerge';

// --- Validation schemas (single source of truth across backend + frontend) ---
export { UpdateSettingsSchema, type UpdateSettingsInput } from './schemas/settings';

// --- Flag Reason Translations ---
export { default as flagReasonEn } from './i18n/en/flagReason.json';
export { default as flagReasonAr } from './i18n/ar/flagReason.json';

// --- Flag Reason Structured Metadata ---
/**
 * Structured parameters/debug info attached to a flag_reason. Keyed by the
 * reason code so multi-flag rows (comma-separated flag_reason) can carry
 * per-reason data. Rows with only plain keys (angry_customer, low_confidence,
 * etc.) leave flag_meta NULL.
 *
 * Example: flag_reason = "dm_failed,low_confidence",
 *          flag_meta   = { dm_failed: { bucket: "unknown", code: 10, fbMessage: "..." } }
 */
export interface FlagMeta {
    dm_failed?: {
        bucket: 'customer_refused' | 'window_expired' | 'transient' | 'our_fault' | 'unknown';
        code?: number;
        subcode?: number;
        fbMessage?: string;
    };
    sla_no_reply?: {
        minutes: number;
    };
    // KB-gap flags carry the customer question the AI couldn't answer from the
    // knowledge base, captured at flag time. The inbox shows it so the merchant
    // knows exactly what to add to Business Info — the conversation may have
    // moved on (e.g. a later "تمام"/"شكراً"), so the flagged question can't be
    // reconstructed from the latest message alone. Same shape across all three;
    // only the one(s) actually flagged are populated.
    info_not_in_kb?: { question: string };
    price_not_in_kb?: { question: string };
    phone_not_in_kb?: { question: string };
    // Open-ended: future flags can add their own namespaced meta here.
    [key: string]: Record<string, unknown> | undefined;
}

/**
 * Flags meaning "the answer wasn't in the knowledge base" — the merchant should
 * add it to Business Info. Each carries the customer's unanswered question in
 * flag_meta (see FlagMeta). Single source of truth shared by the backend
 * (capture, buildKbGapFlagMeta) and the frontend (display, getKbGapQuestion).
 */
export const KB_GAP_FLAGS = ['info_not_in_kb', 'price_not_in_kb', 'phone_not_in_kb'] as const;
export type KbGapFlag = (typeof KB_GAP_FLAGS)[number];

// --- Utilities ---
export { isValidTimezone, safeTimezone } from './timezone';
export { normalizeArabic } from './utils/arabic-normalize';
export type { NormalizeOptions } from './utils/arabic-normalize';
export { sanitizeUserInput } from './utils/sanitize';
export { sanitizeKbContent } from './utils/sanitize-kb';
export { matchesKeyword, testKeywordsMatch, parseKeywords } from './utils/keyword-matching';
export { PHONE_REGEX, EMAIL_REGEX, isValidPhone, isValidEmail, isValidContact, detectContactType, isArabicPhone, normalizeArabicIndic, extractPhones, extractPhoneFromText, extractPhonesFromText, extractCustomerPhones, SMS_BLOCKED_DIAL_PREFIXES, isSmsBlockedPhone } from './utils/validation';
export type { ExtractedPhone } from './utils/validation';

// --- SSE Event Types ---
export * from './sse-events';

// --- E-commerce Tool Types ---
export * from './ecommerce-tools';

// --- Rich Messaging Types ---
/**
 * A single card in a Messenger/Instagram Generic Template carousel.
 * Used for rich product replies (images + prices + actions).
 *
 * Meta limits: title ≤ 80 chars, subtitle ≤ 80 chars, up to 3 buttons,
 * up to 10 cards per carousel. Callers are responsible for truncation.
 */
export interface ProductCard {
    title: string;
    subtitle: string;
    imageUrl: string;
    productUrl: string;
    buttons?: Array<{
        type: 'web_url' | 'postback';
        title: string;
        url?: string;
        payload?: string;
    }>;
}

// --- Message Types ---
export interface Message {
  id: string;
  pageId: string;
  platformMessageId: string;
  senderId: string;
  senderName: string | null;
  message: string;
  direction: 'incoming' | 'outgoing';
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | 'post_reply' | null;
  createdAt: string | Date | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean;
  platform?: 'facebook' | 'instagram' | 'whatsapp';
  attachmentType?: string | null;
}

// --- Comment Types ---
export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  fromId?: string | null;
  replied: boolean | null;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | 'post_reply' | string | null;
  detectedLanguage: string | null;
  pageId: string | null;
  createdAt: string | Date | null;
  repliedAt?: string | Date | null;
  postId: string | null;
  facebookCommentId?: string;
  /** Facebook: post ID (e.g. "123_456"); Instagram: full permalink URL or null */
  postPermalink?: string | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean | null;
  postMessage?: string | null;
  source?: 'facebook' | 'instagram';
}

// --- Business Profile Types ---
//
// Stage 2.6 (2026-05-23) split this into two parallel sub-objects on the
// same `pages.business_profile` JSONB column:
//
//   business_profile = {
//     merchant:    BusinessProfile  // editor-write-only, AI prompt reads ONLY this
//     suggestions: BusinessProfile  // FB-sync-only, surfaced as "Import from Facebook" buttons
//   }
//
// The split is the regression-prevention gate: stale FB data physically
// cannot reach the AI's BUSINESS_INFO prompt block, because the prompt
// formatter reads only `merchant`. The chunker (used to feed raw KB to
// the AI as text) reads BOTH sub-objects merged (merchant wins on
// conflict), preserving today's behavior for pages whose merchant never
// visited the editor.
//
// During the migration rollout window the column may still contain the
// legacy flat shape (no `merchant`/`suggestions` keys). Readers should
// treat that case as `{ merchant: {}, suggestions: <flat data> }` —
// conservative default, matches the migration's heuristic for FB-default
// rows. See `backend/migrations/0109_split_business_profile.sql`.
//
// Older `phone: string` kept on the inner shape as deprecated for backwards
// compatibility — the migration coerces it into `phones[0]`. Once all rows
// are migrated, `phone` can be removed.
//
// `hours` keeps its `Record<string, string[]>` shape (one entry per day,
// array of canonical strings like `["09:00-18:00"]` / `["closed"]` /
// `["all day"]`). Multi-window was never used in prod (verified
// 2026-05-23) but the array form is preserved so the existing renderers
// keep working. The Stage 2.6 form emits length-1 arrays. Multi-window
// is Stage 2.6.1 if needed.
export interface BusinessProfile {
  name?: string;
  category?: string;
  about?: string;
  /** @deprecated since Stage 2.6 — use `phones[0]`. Coerced on next sync. */
  phone?: string;
  /** Ordered, primary first. v1 enforces length ≤ 10 server-side. */
  phones?: string[];
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  /** Canonical day → ["HH:MM-HH:MM" | "closed" | "all day"]. */
  hours?: Record<string, string[]>;
  channels?: {
    preferred?: 'dm' | 'whatsapp' | 'phone';
    whatsapp?: string;
  };
  language_hint?: 'ar' | 'en' | 'auto';
  /**
   * Free-text policy fields, ≤500 chars each, validated server-side.
   * Each is optional; missing fields appear as `[NOT_PROVIDED]` in the
   * prompt's BUSINESS_INFO block so the AI refuses rather than inventing.
   */
  policies?: {
    shipping?: string;
    returns?: string;
    payment?: string;
    booking?: string;
  };
}

/**
 * Stage 2.6 container shape for `pages.business_profile`. Splits merchant-
 * confirmed data from FB-suggested data so the AI prompt-injection layer
 * can read only what the merchant has explicitly typed (regression-proof
 * by construction: stale FB data physically can't reach the prompt).
 *
 * During the rollout window readers may also encounter the legacy flat
 * `BusinessProfile` shape. Use `unwrapBusinessProfile()` to normalize.
 */
export interface BusinessProfileContainer {
  /** Editor-write + auto-promoted FB data. The AI's BUSINESS_INFO prompt block reads ONLY this. */
  merchant?: BusinessProfile;
  /** FB-sync-only. Raw snapshot of the last FB sync; surfaced in the editor as "Review & Confirm" cues. */
  suggestions?: BusinessProfile;
  /**
   * Stage 2.6.1 sidecar map of per-field provenance for the `merchant`
   * half. Tracks whether each field came from FB sync (auto-promoted) or
   * the merchant editor (manually typed/cleared). See
   * {@link MerchantProvenanceMap} for state semantics, including the
   * "cleared ≠ never-seen" invariant.
   */
  merchantProvenance?: MerchantProvenanceMap;
}

/**
 * Stored JSONB may be in the new container shape, the legacy flat shape,
 * or null. Use {@link unwrapBusinessProfile} to normalize before reading.
 */
export type StoredBusinessProfile = BusinessProfileContainer | BusinessProfile | null | undefined;

function isContainer(p: unknown): p is BusinessProfileContainer {
  return !!p && typeof p === 'object' && ('merchant' in p || 'suggestions' in p);
}

// Hardening guard for the Drizzle + postgres.js jsonb double-encoding (parked
// for a separate hygiene PR). Drizzle's reader auto-parses string values, so
// this branch is dead for any read going through the ORM — but it protects
// any future direct-postgres.js read path from silently demoting the entire
// container into `suggestions`.
function parseIfStringified(p: unknown): unknown {
  if (typeof p !== 'string') return p;
  try { return JSON.parse(p); } catch { return null; }
}

/**
 * Normalize stored business_profile JSONB to the container shape.
 * Legacy flat rows are treated as FB-default (data goes under `suggestions`,
 * `merchant` is empty) — matches the migration's conservative default for
 * rows where we can't tell if the merchant ever edited them.
 */
export function unwrapBusinessProfile(stored: StoredBusinessProfile): BusinessProfileContainer {
  if (!stored) return {};
  const parsed = parseIfStringified(stored);
  if (!parsed) return {};
  if (isContainer(parsed)) return parsed;
  return { merchant: {}, suggestions: parsed as BusinessProfile };
}

/**
 * Merged view of merchant + suggestions for callers that need "everything
 * we know about this business" — used by the chunker to feed raw KB to
 * the AI. Merchant values win on conflict. Does NOT reach the structured
 * BUSINESS_INFO prompt block (that path reads only `merchant`).
 */
export function mergedBusinessProfile(stored: StoredBusinessProfile): BusinessProfile {
  const { merchant = {}, suggestions = {} } = unwrapBusinessProfile(stored);
  return { ...suggestions, ...merchant };
}

// --- Page Types ---
export interface PageReplyBreakdown {
  ai: number;
  template: number;
  postReply: number;
}

export interface Page {
  id: string;
  name: string;
  facebookPageId: string | null;
  autoReplyEnabled: boolean | null;
  // Instagram fields
  instagramAccountId?: string | null;
  instagramUsername?: string | null;
  instagramProfilePicUrl?: string | null;
  instagramAutoReplyEnabled?: boolean | null;
  // WhatsApp fields
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  whatsappDisplayPhoneNumber?: string | null;
  whatsappAutoReplyEnabled?: boolean | null;
  // E-commerce store linked to this page
  ecommerceStoreId?: string | null;
  // KB fields
  knowledgeBase?: string | null;
  suggestedKnowledgeBase?: string | null;
  kbVersion?: number;
  kbActiveVersion?: number;
  kbUpdatedAt?: string | Date | null;
  // Business profile
  businessProfile?: BusinessProfile;
  businessProfileUpdatedAt?: string | Date | null;
  // Per-page overrides of the workspace lead config. null/absent = inherit the
  // workspace's settings.leadStages / settings.leadFields. Set = full replacement
  // for this page (see resolveEffectiveLeadStages / resolveEffectiveLeadFields).
  leadStages?: LeadStagesConfig | null;
  leadFields?: LeadCustomFieldDef[] | null;
  // Connection status (true if Facebook access token is valid)
  isConnected?: boolean;
  // True when a WhatsApp business token is stored (Embedded Signup completed)
  whatsappConnected?: boolean;
  // Defensive auto-pause: set to 'send_rejected' when the bot was paused after
  // hitting the consecutive-send-failure threshold (Page restricted/unpublished
  // by Meta, permission lost mid-flight). Cleared when the customer re-enables
  // auto-reply. See docs/page-auto-pause.md.
  autoPauseReason?: 'send_rejected' | null;
  autoPausedAt?: string | Date | null;
  // Computed/joined fields
  commentsCount?: number;
  repliesCount?: number;
  // Per-method auto-reply breakdown — sums to `repliesCount`.
  breakdown?: PageReplyBreakdown;
  replyRate?: number;
  lastActivity?: number;
  createdAt: string | Date | null;
}

// --- Instagram Types ---
export interface InstagramMedia {
  id: string;
  pageId: string;
  instagramMediaId: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  caption?: string | null;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  autoReplyEnabled: boolean | null;
  createdTime?: string | Date | null;
  createdAt: string | Date | null;
}

export interface InstagramComment {
  id: string;
  mediaId: string;
  instagramCommentId: string;
  message: string;
  fromId?: string | null;
  fromUsername?: string | null;
  replied: boolean | null;
  replyText?: string | null;
  replyMethod?: 'template' | 'ai' | 'manual' | 'post_reply' | null;
  detectedLanguage?: string | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  createdAt: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
}

// --- Template Types ---
export interface Template {
  id: string;
  name: string;
  message: string;
  active: boolean | null;
  usageCount?: number;
}

// Reusable email templates for the admin waitlist broadcast UI.
// Defined as code-as-data on the backend; the frontend fetches them and
// inserts the variant matching the admin's UI language into Subject + Body.
//
// Two body shapes are supported, mutually exclusive in practice:
//   1. bodyEn/bodyAr        — plain text. The backend wraps these in a generic
//                             HTML shell (waitlistEmailTemplate) before sending.
//   2. htmlBodyEn/htmlBodyAr — full custom HTML email. Sent as-is, the only
//                             substitution is {{UNSUBSCRIBE_URL}} per recipient.
//                             When set, the admin UI shows a read-only preview
//                             instead of an editable body field, and the broadcast
//                             endpoint picks the variant matching the recipient's
//                             resolved language (KB → dashboardLanguage → 'ar').
export interface WaitlistEmailTemplate {
  id: string;
  name: string;
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
  htmlBodyEn?: string;
  htmlBodyAr?: string;
}

// --- Rule Types ---
export interface Rule {
  id: string;
  name: string;
  keywords: string[] | null;
  templateId: string | null;
  priority: number | null;
  active: boolean | null;
  matchCount?: number;
}

// --- Dashboard Stats Types ---
export interface DashboardStats {
  totalComments: number;
  autoReplies: number;
  aiReplies: number;
  avgResponseTime: string;
  replyRate: number;
  activePages: number;
}

// --- Pricing & Subscription Types ---
export interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: number; // monthly price in cents
  yearlyPrice: number | null; // yearly price in cents; null = no yearly option
  currency: string;
  interval: 'month' | 'year';
  // Limits
  maxPages: number | null;
  maxAiRepliesPerMonth: number | null;
  maxProducts: number | null;
  // Features
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  ecommerceEnabled: boolean;
  whatsappEnabled: boolean;
  showBranding: boolean;
  prioritySupport: boolean;
  // Trial
  trialDays: number;
  // Regional pricing
  regionalPricing?: Record<string, number>;
  // Status
  isActive: boolean;
  isPublic: boolean; // false = hidden from the public /pricing grid, still purchasable via direct link
  isDefault: boolean;
  sortOrder: number;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  plan?: Plan; // Joined plan data
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  trialEndsAt?: string | Date | null;
  currentPeriodStart: string | Date;
  currentPeriodEnd?: string | Date | null;
  canceledAt?: string | Date | null;
  cancelReason?: string | null;
  createdAt: string | Date;
}

export interface Usage {
  id: string;
  userId: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  aiRepliesCount: number;
  totalCommentsProcessed: number;
  totalMessagesProcessed: number;
  dailyBreakdown?: Record<string, { ai: number }>;
}

export interface UsageSummary {
  currentPeriod: {
    start: string;
    end: string;
  };
  aiReplies: {
    used: number;
    limit: number | null; // null = unlimited
    remaining: number | null;
    percentUsed: number;
  };
  pages: {
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  /**
   * Non-expiring AI reply credit balance from one-time top-up purchases.
   * Consumed only after the monthly plan quota is exhausted. May be negative
   * if a partially-consumed pack was refunded.
   *
   * Optional in the type for backward-compatibility during the rollout window
   * (older clients/mocks won't have it). Backend always returns it as of PR 1.
   */
  topup?: {
    balance: number;
    /** Sum of replies_added across all succeeded top-up purchases (lifetime). */
    lifetimePurchased: number;
  };
  subscription: {
    plan: Plan;
    status: SubscriptionStatus;
    trialDaysRemaining?: number;
    renewsAt?: string;
    hasStripeCustomer?: boolean;
  };
}

// --- API Response Types ---
export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  /** Stable machine code for clients to switch on. */
  code?: 'ai_limit_reached' | 'page_limit_reached' | 'subscription_inactive';
  limit?: number;
  used?: number;
  remaining?: number;
  /** ISO timestamp when the current usage period resets. Set when `code` is 'ai_limit_reached'. */
  resetsAt?: string;
  /**
   * True when allowance comes from the user's top-up balance rather than their
   * monthly plan quota. Set by canUseAiReplies when plan quota is exhausted (or
   * subscription is past_due/canceled) but topup_balance > 0.
   */
  usingTopup?: boolean;
  /** Current top-up balance when `usingTopup` is true. */
  topupBalance?: number;
}

// --- AI Worker Types ---
export interface AiGenerateJobData {
  commentId?: string; // Optional if just testing
  comment: string;
  language?: string;
  context?: Record<string, any>;
  type: 'reply' | 'moderation';
}

export const AI_QUEUE_NAME = 'ai-generation-queue';

// --- Reply Queue Types ---
export interface ReplyJobData {
  // Job identification
  jobType: 'facebook_comment' | 'facebook_message' | 'instagram_comment' | 'instagram_message' | 'whatsapp_message';
  requestId?: string; // Correlate with webhook request for tracing

  // Source identification
  pageId: string;           // Facebook/Instagram page ID (from webhook)
  postId?: string;          // For comments only (Facebook post ID or Instagram media ID)
  commentId?: string;       // Facebook/Instagram comment ID
  parentId?: string;        // Set when comment is a reply to another comment (sub-comment)
  sharedPostUrl?: string;   // URL of a shared post attached to a DM (for post context enrichment)
  sharedPostId?: string;    // Numeric post/media ID from webhook payload (more reliable than URL parsing)
  messageId?: string;       // Facebook/Instagram message ID (for DMs)
  senderId?: string;        // User who sent the comment/message
  senderName?: string;      // Display name of sender
  text: string;             // The actual comment/message content

  // Facebook Graph API `message_tags` — structured record of each user/page tag
  // inside a comment (offset, length, type, id). Used to skip peer-to-peer friend
  // tagging and precisely strip tagged spans before language detection. Undefined
  // for Instagram, DMs, and pre-upgrade jobs.
  //
  // Shape mirrors `backend/src/utils/commentText.ts#FacebookMessageTag`. Kept
  // inline here because the shared package is the base layer and cannot import
  // from `backend/`. If you change one, change both.
  messageTags?: { id: string; name: string; type: 'user' | 'page'; offset: number; length: number }[];

  // Metadata
  receivedAt: string;       // ISO timestamp when webhook received
  replyDelay?: number;      // Delay in seconds before processing (from user settings)
  handoffRetries?: number;  // How many times this job has been re-enqueued due to handoff pause
  // How many times this job has been re-enqueued (parked) because the AI was
  // temporarily unavailable (OpenAI insufficient_quota / ai-worker circuit open).
  // Kept SEPARATE from handoffRetries so quota-parked jobs don't trip the
  // handoff stale-backlog suppression (a 15-min-old unanswered message SHOULD
  // still get a reply once quota returns). Bounded by config.ai.parkMaxRetries.
  aiRetryCount?: number;
}

export interface ReplyJobResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  replyText?: string;
  replyMethod?: 'template' | 'ai' | 'post_reply';
  error?: string;
  needsAttention?: boolean;
  flagReason?: string;
  flagMeta?: FlagMeta;
  aiIntent?: string;
  /** When set, the worker should re-enqueue this job with the given delay (ms) */
  handoffDelayMs?: number;
}

export const REPLY_QUEUE_NAME = 'reply-processing-queue';

/** Default handoff pause duration (minutes) when a user manually replies to a customer */
export const DEFAULT_HANDOFF_PAUSE_MINUTES = 15;

// Re-exported from ./constants so they can be consumed by ./schemas/* without
// circular imports back into this module.
export {
    MAX_TEMPLATE_MESSAGE_LENGTH,
    MAX_BRAND_VOICE_LENGTH,
    DEFAULT_AI_MODEL,
    ALLOWED_AI_MODELS,
    isAllowedAiModel,
    type AllowedAiModel,
} from './constants';

// --- Phase 6.5 P1 diagnostic counters ---
export {
    createAiMetrics,
    withAiMetrics,
    normalizeModelTag,
    type AiMetrics,
    type AiMetricsRedis,
    type AiMetricsStage,
    type CreateAiMetricsOptions,
    type FailedBeforeLogClass,
} from './aiMetrics';

/** Bump when the system prompt changes — used by both ai-worker (telemetry) and backend (cache key). */
// v39: lightweight date awareness — inject today's date (merchant timezone) into the
// prompt so the model stops relaying clearly-past KB/post dates as upcoming. NO
// deterministic guard / flag / deflection (that was v38, reverted in #314 for
// over-deflecting on date-heavy KBs). v38 is intentionally skipped to avoid colliding
// with the reverted deploy's cache/log rows.
// v40: Arabic dialect mirroring — the few-shot examples were accidentally all
// Levantine, so the model copied that and replied Syrian to e.g. Algerian customers
// (a real churn case). Fix: (1) balance the example dialects (Gulf/Egyptian/Levantine/
// Maghrebi/MSA) and add Maghrebi/Darija anchors so no single dialect dominates;
// (2) an explicit rule to mirror the customer's dialect — MSA only when the message is
// dialect-neutral, never default to Levantine — reinforced per-call in the dynamic
// suffix; (3) neutralized the Levantine tokens previously embedded in the per-call
// style directives. The deflection example is kept in MSA so we don't re-seed the
// exact phrase that leaked in prod. Known limit: the model reliably mirrors Gulf/
// Egyptian/Levantine but falls back to MSA for low-resource Maghrebi/Darija output
// (a model-capability ceiling, not a prompt gap).
// v41: info-missing deflection no longer promises a callback. The few-shot
// examples (4, 7, 8, 14) and rule 5 / self-check previously taught "the team
// will contact you / سيتواصلون معك / I'll check and get back to you" — an
// implicit human follow-up the merchant can't reliably action across every AI
// conversation, so it became a false promise. Now: when info isn't in KB, point
// the customer to a contact channel from BUSINESS_INFO (so THEY reach out), or
// be honest "I don't have that right now" with NO callback. Genuine cancel/
// refund/exchange handoff (example 6b) is unchanged — those legitimately route
// to the team and are flagged urgent.
// v42: align the callback promise with what actually escalates to a human. A
// reply that sets needsAttention=true fires a merchant notification regardless
// of topic, but cancel/refund/exchange AND angry_customer raise an URGENT alert
// that gets reliably actioned — so "the team will follow up" is honest for an
// angry/serious customer too, not only the 3 request types. v41's example 6
// (angry + refund) replied "give me order details" with no follow-up promise,
// leaving an urgently-escalated customer with nothing reassuring; example 6 now
// demonstrates the team follow-up (matching example 6b). No rule changed — rule
// 5's no-callback restriction only covers info-missing questions, not angry
// complaints. Info-missing deflection (v41 behavior) is unchanged.
// v43: closed-list / anti-leading-affirmation rule (confidence-mistakes section).
// Pairs with raising the whole-KB-in-context threshold to 16000: injecting the
// whole KB fixed EXISTENCE and PRICE fabrications, but a LEADING yes/no about an
// attribute ("is the English course online?") still got a sycophantic "yes" 5/5
// even with the full KB — a framing/agreeableness bias, NOT retrieval (the same
// question asked neutrally, "online or in-person?", was correct 5/5). New rule:
// do NOT affirm an attribute just because the customer framed it that way; when KB
// enumerates the attribute (an "online courses" list, "delivery zones"), treat the
// list as EXHAUSTIVE — an item not in it does NOT have the attribute, say so
// confidently. Verified on the Damascus institute fixture (Cat 51): leading
// English/makeup online flipped 0/5 → 5/5 correct, and generalizes cross-vertical
// (electronics delivery-to-Jeddah probe passes). Necessary-but-insufficient note:
// the rule is strongest when the KB enumerates the attribute; a structured offerings
// index with explicit flags remains the durable fix for loosely-written KBs.
// v44: removed the hardcoded dialect demonstration examples (Maghrebi answer +
// Maghrebi deflection) and the gratuitous Egyptian reply on a dialect-neutral
// customer message. Hardcoded dialects in few-shot examples get parroted onto
// customers from other countries; the dialect-MIRRORING rule (kept, reinforced
// per-call) is what should drive this. Examples now show FORMAT/tone only and
// mirror the customer's own dialect — not a fixed dialect to copy.
// v45: WARMED the info-missing deflection wording WITHOUT reverting the no-callback
// rule (the #335/#341 rule — don't promise a callback on routine info_not_in_kb,
// an empty promise at scale — STANDS). The problem was the COLD wording: a clipped
// "I don't have it" + a wall of phone numbers. Now: acknowledge warmly in the
// customer's OWN dialect (mirrored, never a hardcoded one), redirect to ONE contact
// channel naturally (never a number-wall), still no callback promise. Also
// de-Levantined the rule-level seed phrase (هالمعلومة → هذه المعلومة, MSA tone-only).
// Bump invalidates exact + semantic caches holding the cold phone-dump replies.
//
// v46: re-layered the system prompt for OpenAI prompt caching (promptBuilder.ts) — the full
// KB / business-info / catalog are hoisted into a per-page-stable block right after
// STATIC_SYSTEM_PREFIX, ahead of the per-call content (language, date, chunks, post), so the
// KB sits in the cacheable prefix and is billed at the cached rate on repeat traffic instead
// of full rate every call. No field content/sanitization changed — only assembly order — but
// the prompt the model sees is reordered, so the cache is invalidated for a clean cutover.
// v47: few-shot hardening — removed the stale "بعد العيد" (after Eid) relative-date demo, and
// made the Example 11 clarifier vertical-neutral (خدمة/باقة → خيار, "services" → "offerings").
// v48: a comment on a post is now answered about the item in that post instead of a generic
// "which product?". Two minimal changes, both in the per-call block (no few-shot/static-prefix
// edit): (1) the comment channel directive now points the model at [current_post] as
// authoritative business info — mirroring the existing DM-on-post directive; (2) the
// [current_post] block is emitted whenever a post is present, no longer gated on the page
// having KB/chunks, so empty-KB merchants get the post in the system prompt (it used to survive
// only as the thin user-prompt label). No dialect handling added — the customer's own words
// remain the only dialect source. Bump invalidates caches holding the old "which product?"
// comment replies.
// v49: classifier accuracy — (1) OFFENSIVE now requires actual profanity/slurs/sexual
// harassment/threats and is judged on the CURRENT message (a benign message is not OFFENSIVE
// just because earlier turns were), fixing benign greetings/help-requests being suppressed
// as OFFENSIVE (lost leads); (2) friendly social openers ("how are you?") count as GREETING.
// Done via intent-definition edits + inline "→ INTENT" classification examples only (no new
// full few-shot blocks — verified redundant by the eval). NOTE: an earlier draft also broadened
// SPAM_OR_IRRELEVANT to "personal/off-topic requests" (poems etc.), but that nudged bare
// punctuation on engagement-CTA posts toward SPAM (losing legit engagement replies), so it was
// dropped — off-topic personal messages get a normal reply. Bump invalidates the prompt cache.
// v50: anti-robotic — restate the "end on the answer, no offer-to-help sign-off" rule at the TAIL
// of the per-call system block (buildPerCallBlock) for recency, with a stronger clause on long
// threads (the multi-turn drift that makes ~12-14% of replies end with a bot-like closing). The
// cacheable STATIC_SYSTEM_PREFIX is unchanged; this bump only invalidates the internal exact-reply
// cache so the new tail reminder isn't shadowed by stale cached replies.
// v51: gender-aware Arabic addressing, scoped to ARABIC DMs ONLY. The per-call block gains a name
// line + an ARABIC GENDER directive that matches masculine/feminine forms inferred from the name +
// the customer's self-reference, falling back to neutral phrasing when unclear. Deliberately NOT in
// the cacheable STATIC_SYSTEM_PREFIX: every other language, every comment, and every business gets a
// byte-identical prompt to v50 (guarded by blast-radius unit tests). Comments stay neutral. The exact
// cache is name-bucketed for DMs and the semantic cache is bypassed for DMs (see ai.ts) so a reply
// gendered for one customer is never served to another — flush caches on deploy.
// v52: SOURCE fix for the offer-closing bot-tell — the prompt was contradicting itself, so the ban
// lost to competing demonstrations/directives (root-caused 2026-07-05, eval Cat 61 #677). Three
// changes, all in the cacheable STATIC_SYSTEM_PREFIX / styleMap: (1) the GENERAL RESPONSE RULES no
// longer say "sometimes ask a question back" (which licensed the tic against the same block's
// offer-closing ban) — a question-back is now explicitly only-when-needed; (2) the `enthusiastic`
// style directive dropped "ask back naturally when more info would help" (a positive license the
// model followed over the negative ban) and now matches the disciplined `professional` phrasing;
// (3) two new few-shot examples DEMONSTRATE a clean flat ending — a warm mid-thread answer and an
// info-not-in-KB answer that stop on the answer (demonstrations beat rules; the prompt previously
// had no positive pattern for the common case). Prefix bytes change → cache invalidated by the bump.
export const PROMPT_VERSION = 'v52';

/** The 8 valid AI intent categories. GPT must return one of these. */
export const VALID_AI_INTENTS = [
    'QUESTION', 'COMPLIMENT', 'COMPLAINT', 'PURCHASE_INTENT',
    'GREETING', 'BUSINESS_INQUIRY', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT',
] as const;
export type AiIntent = (typeof VALID_AI_INTENTS)[number];

/**
 * Map non-standard GPT-invented intents to the closest valid intent.
 * GPT-4o-mini sometimes ignores the taxonomy and invents custom intents
 * like PRICE, LOCATION, HOURS, OTHER, etc. This map provides a code-level
 * safety net so that downstream guards (hallucination, skip, needsAttention)
 * still work correctly.
 */
export const INTENT_NORMALIZATION_MAP: Record<string, AiIntent> = {
    // Question-like intents GPT invents
    'PRICE': 'QUESTION',
    'PRICING': 'QUESTION',
    'LOCATION': 'QUESTION',
    'HOURS': 'QUESTION',
    'AVAILABILITY': 'QUESTION',
    'PRODUCT': 'QUESTION',
    'PRODUCT_QUESTION': 'QUESTION',
    'OFFERING_INFO': 'QUESTION',
    'INFO_OFFERING': 'QUESTION',
    'SERVICE': 'QUESTION',
    'POLICY': 'QUESTION',
    'INFO': 'QUESTION',
    'INFORMATION': 'QUESTION',
    'INQUIRY': 'QUESTION',
    // Sentiment-like
    'POSITIVE': 'COMPLIMENT',
    'PRAISE': 'COMPLIMENT',
    'NEGATIVE': 'COMPLAINT',
    'FEEDBACK': 'COMPLAINT',
    // Purchase-like
    'ORDER': 'PURCHASE_INTENT',
    'BUY': 'PURCHASE_INTENT',
    'BOOKING': 'PURCHASE_INTENT',
    // Greeting-like
    'HELLO': 'GREETING',
    'HI': 'GREETING',
    // Offensive-like
    'ABUSE': 'OFFENSIVE',
    'INSULT': 'OFFENSIVE',
    'PROFANITY': 'OFFENSIVE',
    // Spam-like
    'SPAM': 'SPAM_OR_IRRELEVANT',
    'IRRELEVANT': 'SPAM_OR_IRRELEVANT',
    'PROMO': 'SPAM_OR_IRRELEVANT',
    'SELF_PROMOTION': 'SPAM_OR_IRRELEVANT',
    'PROMOTION': 'SPAM_OR_IRRELEVANT',
};

/**
 * Normalize a raw AI intent to one of the 8 valid intents.
 * Returns the normalized intent, or the original (uppercased) if no mapping exists.
 */
export function normalizeAiIntent(rawIntent?: string): string | undefined {
    if (!rawIntent) return undefined;
    const upper = rawIntent.trim().toUpperCase();
    if (!upper) return undefined;
    if ((VALID_AI_INTENTS as readonly string[]).includes(upper)) return upper;
    return INTENT_NORMALIZATION_MAP[upper] || upper;
}

// --- Order Notification Types ---
export type OrderNotificationType =
  | 'abandoned_cart'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'review_request'
  | 'digital_delivery';

export interface NotificationTemplate {
  id: string;
  ecommerceStoreId: string;
  notificationType: OrderNotificationType;
  messageAr: string;
  messageEn: string;
  isEnabled: boolean;
  delayMinutes: number;
  channel: string;
  includeCoupon: boolean;
  couponCode: string | null;
  couponDiscount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationStats {
  total: number;
  sent: number;
  failed: number;
  byType: Record<string, number>;
}

// --- E-commerce Types (Shopify, Salla, Zid) ---
export interface EcommerceStore {
  id: string;
  userId: string;
  platform: 'shopify' | 'salla' | 'zid';
  storeDomain: string;
  storeName: string | null;
  storeEmail: string | null;
  storeCurrency: string | null;
  tokenExpiresAt: Date | null; // null = never expires (Shopify)
  productCount: number;
  productSummary: string | null;
  policiesSummary: string | null;
  lastSyncAt: Date | null;
  isActive: boolean;
  installedAt: Date | null;
  /**
   * Health of the platform's webhook registration, derived from
   * `platform_data.webhookStatus` on the backend. Surfaced so the integrations
   * card can render a "Re-register webhooks" CTA when retries have exhausted.
   * - 'ok'      — every topic registered, nothing pending
   * - 'pending' — some topics failed but retries are still in flight
   * - 'failed'  — retries exhausted; merchant action required
   * - 'unknown' — legacy row that predates webhookStatus tracking
   */
  webhookHealth: 'ok' | 'pending' | 'failed' | 'unknown';
  /**
   * True when the store's OAuth token can no longer be refreshed — the refresh
   * token was consumed/revoked and the platform rejected it with a permanent 400
   * (invalid_grant). Derived from `platform_data.tokenHealth`. Surfaced so the
   * integrations card can prompt the merchant to reconnect; cleared automatically
   * on the next successful token write. Shopify tokens never expire, so this stays
   * false for Shopify.
   */
  needsReauth: boolean;
}

export interface EcommerceProduct {
  id: string;
  ecommerceStoreId: string;
  platformProductId: string;
  handle: string | null;
  title: string;
  description: string | null;
  productType: string | null;
  vendor: string | null;
  status: string;
  priceRange: string | null;
  currency: string | null;
  totalInventory: number;
  hasVariants: boolean;
  variantSummary: string | null;
  tags: string | null;
  imageUrl: string | null;
}

export interface EcommerceSyncJobData {
  ecommerceStoreId: string;
  platform: 'shopify' | 'salla' | 'zid';
  jobType: 'full_sync' | 'product_update';
  platformProductId?: string; // For incremental product_update
}

// Redis queue key — value intentionally kept as 'shopify-sync-queue' for backward compatibility
export const ECOMMERCE_SYNC_QUEUE_NAME = 'shopify-sync-queue';

// --- Post Sync Queue (Facebook Posts backfill) ---
export interface PostSyncJobData {
  pageId: string; // Internal page UUID
  limit?: number; // Number of recent posts to fetch (default 25)
}
export const POST_SYNC_QUEUE_NAME = 'post-sync-queue';

// --- Leads Types ---
export type LeadStatus = 'new' | 'contacted' | 'converted';
export type LeadSourceType = 'message' | 'comment';
export type LeadExtractionStatus = 'completed' | 'pending' | 'failed';

// --- Lead Stages (customizable sub-stages) ---
// The three main stages above are fixed (the pipeline, counters, and AI
// extraction depend on 'new'). Merchants customize by defining SUB-STAGES
// under each main stage — free-text labels so the feature stays generic
// across business types (store: "تم الشحن/تم التسليم", clinic: "حجز موعد",
// institute: "سجّل بالدورة", ...). Stored per workspace in settings JSONB.
export const LEAD_STAGE_COLORS = ['blue', 'amber', 'emerald', 'rose', 'violet', 'cyan', 'orange', 'slate'] as const;
export type LeadStageColor = typeof LEAD_STAGE_COLORS[number];

export interface LeadSubStage {
  /** Stable id (uuid) — stored on the lead so renaming a sub-stage doesn't orphan it. */
  id: string;
  /** Merchant free-text label, any language. */
  label: string;
  color: LeadStageColor;
}

/** Sub-stages per main stage. Missing key = no sub-stages for that stage. */
export type LeadStagesConfig = Partial<Record<LeadStatus, LeadSubStage[]>>;

/** Hard limits enforced server-side when saving leadStages. */
export const MAX_SUB_STAGES_PER_STAGE = 20;
export const MAX_SUB_STAGE_LABEL_LENGTH = 60;

// --- Lead Custom Fields (merchant-defined per-lead data) ---
// Stages answer "where is this lead?"; custom fields answer "what do I need
// to WRITE about it?" — e.g. المبلغ المدفوع, الخصم, رقم الطلب. Field
// definitions live in workspace settings (same JSONB pattern as leadStages);
// each lead stores its values keyed by field id, so renaming a field never
// orphans the data.
export interface LeadCustomFieldDef {
  /** Stable id (uuid) — values on leads are keyed by it. */
  id: string;
  /** Merchant free-text label, any language. */
  label: string;
}

/** Values on a lead, keyed by LeadCustomFieldDef.id. */
export type LeadCustomFieldValues = Record<string, string>;

/** Hard limits enforced server-side when saving leadFields / field values. */
export const MAX_LEAD_CUSTOM_FIELDS = 10;
export const MAX_LEAD_FIELD_LABEL_LENGTH = 60;
export const MAX_LEAD_FIELD_VALUE_LENGTH = 500;

// --- Effective lead config (per-page override with workspace fallback) ---
// leadStages/leadFields are configured at the workspace level, but a page may
// optionally OVERRIDE either slice for itself. The effective config a lead's
// UI and validation use is: page override ?? workspace default. A null/undefined
// override means "inherit the workspace config"; an empty {}/[] is a deliberate
// override (the merchant cleared that slice for this page). These two pure
// resolvers are the single source of truth — both backend (validation) and
// frontend (rendering) call them so the semantics never drift.
// Deliberate return-type asymmetry: stages may be `undefined` (no sub-stages →
// callers guard with `stages?.[status] ?? []`), while fields always resolves to
// an array, so field callers never need a null-check.
export function resolveEffectiveLeadStages(
  pageOverride: LeadStagesConfig | null | undefined,
  workspaceDefault: LeadStagesConfig | undefined,
): LeadStagesConfig | undefined {
  return pageOverride ?? workspaceDefault;
}

export function resolveEffectiveLeadFields(
  pageOverride: LeadCustomFieldDef[] | null | undefined,
  workspaceDefault: LeadCustomFieldDef[] | undefined,
): LeadCustomFieldDef[] {
  return pageOverride ?? workspaceDefault ?? [];
}

export interface LeadField {
  key: string;
  label_en: string;
  label_ar: string;
  value: string;
}

export interface LeadExtractedData {
  summary?: string;
  fields: LeadField[];
}

export interface Lead {
  id: string;
  pageId: string;
  sourceType: LeadSourceType;
  sourceId: string | null;
  senderId: string;
  senderName: string | null;
  phone: string;
  extractedData: LeadExtractedData;
  status: LeadStatus;
  /** Id of a LeadSubStage from the workspace's leadStages config, or null. */
  subStage: string | null;
  /** Merchant-entered values for the workspace's leadFields, keyed by field id. */
  customFields: LeadCustomFieldValues | null;
  extractionStatus: LeadExtractionStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// --- Workspace / Team Types ---
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  settings: WorkspaceSettings;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string | Date | null;
  invitedBy: string | null;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string | null;
  phone: string | null;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string | Date;
  usedAt: string | Date | null;
  createdAt: string | Date | null;
}

/** Shape of the JSONB `settings` column on the workspaces table */
export interface WorkspaceSettings {
  defaultReplyLanguage: string;
  supportedLanguages: string[] | null;
  autoDetectLanguage: boolean;
  aiEnabled: boolean;
  aiModel: string;
  commentReplyMode: string;
  dualReplyNudge: string | null;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  greetingMessageMulti: Record<string, string>;
  /** When false, the configured greeting is never sent — AI handles the first message directly. */
  greetingMessageEnabled: boolean;
  awayMessageMulti: Record<string, string>;
  /** Master switch — when false, no reply is sent at the monthly limit (silent + flag). */
  limitFallbackEnabled: boolean;
  /** Custom reply when the monthly Smart Reply quota is exhausted. Used only when limitFallbackEnabled is true. */
  limitFallbackMessageMulti: Record<string, string>;
  dualReplyNudgeMulti: Record<string, string>;
  dualReplyNudgeVariations?: Record<string, string[]>;
  replyDelay: number;
  commentEscalationMinutes: number;
  messageEscalationMinutes: number;
  handoffPauseDurationMinutes: number;
  replyStyle: 'professional' | 'casual' | 'enthusiastic';
  brandVoiceNotes: string;
  brandVoiceNotesMulti: Record<string, string>;
  holdLowConfidence: boolean;
  /** Customizable lead sub-stages per main stage (see LeadStagesConfig). */
  leadStages?: LeadStagesConfig;
  /** Merchant-defined per-lead data fields (see LeadCustomFieldDef). */
  leadFields?: LeadCustomFieldDef[];
}

// --- Business Info structured prompt block (Stage 2.6) ---
export { formatBusinessInfoPrompt } from './businessInfoPrompt';
export { applyFbSyncToMerchant, applyMerchantEdit, applyKbExtractToMerchant, classifyForMigration, hasTrackedField, TRACKED_FIELDS } from './businessProfileMerge';
export type { MerchantProvenanceMap, FieldProvenance, ProvenanceSource, MigrationPlan } from './businessProfileMerge';
// --- Business hours canonicalizer (Stage 2.6) ---
export { canonicalizeHoursEntry, canonicalizeHoursWeek, isValidDayKey, SHORT_DAY_KEYS, LONG_DAY_KEYS } from './businessHours';
export type { CanonicalHoursEntry, ParseResult, ParseSuccess, ParseFailure } from './businessHours';
// --- Activation funnel (shared BE emit/query ↔ FE admin panel) ---
export { ACTIVATION_FUNNEL_STEPS, KB_FILLED_MIN_CHARS, isBusinessInfoProvided } from './activation';
export type { ActivationEvent, ActivationFunnel, ActivationFunnelStep } from './activation';
// --- Image-message marker protocol (DM vision descriptions) ---
export { IMAGE_MESSAGE_RE, IMAGE_PLACEHOLDER_RE, isImageMessageBody, extractImageDescription, isAnyImageMessage } from './imageMessage';

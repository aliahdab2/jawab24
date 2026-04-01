// Shared Types for Jawab24

// --- Utilities ---
export { normalizeArabic } from './utils/arabic-normalize';
export type { NormalizeOptions } from './utils/arabic-normalize';
export { sanitizeUserInput } from './utils/sanitize';
export { sanitizeKbContent } from './utils/sanitize-kb';
export { matchesKeyword, testKeywordsMatch } from './utils/keyword-matching';
export { PHONE_REGEX, EMAIL_REGEX, isValidPhone, isValidEmail, isValidContact, detectContactType } from './utils/validation';

// --- SSE Event Types ---
export * from './sse-events';

// --- E-commerce Tool Types ---
export * from './ecommerce-tools';

// --- Message Types ---
export interface Message {
  id: string;
  pageId: string;
  facebookMessageId: string;
  senderId: string;
  senderName: string | null;
  message: string;
  direction: 'incoming' | 'outgoing';
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | null;
  createdAt: string | Date | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean;
}

// --- Comment Types ---
export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  fromId?: string | null;
  replied: boolean | null;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | string | null;
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
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean | null;
  postMessage?: string | null;
  source?: 'facebook' | 'instagram';
}

// --- Business Profile Types ---
export interface BusinessProfile {
  name?: string;
  category?: string;
  about?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  hours?: Record<string, string[]>;
  channels?: {
    preferred?: 'dm' | 'whatsapp' | 'phone';
    whatsapp?: string;
  };
  language_hint?: 'ar' | 'en';
}

// --- Page Types ---
export interface Page {
  id: string;
  name: string;
  facebookPageId: string;
  autoReplyEnabled: boolean | null;
  // Instagram fields
  instagramAccountId?: string | null;
  instagramUsername?: string | null;
  instagramProfilePicUrl?: string | null;
  instagramAutoReplyEnabled?: boolean | null;
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
  // Connection status (true if Facebook access token is valid)
  isConnected?: boolean;
  // Computed/joined fields
  commentsCount?: number;
  repliesCount?: number;
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
  replyMethod?: 'template' | 'ai' | 'manual' | null;
  detectedLanguage?: string | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  createdAt: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
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
  templatesCount: number;
  activeRules: number;
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
  maxTemplates: number | null;
  maxRules: number | null;
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
  templateRepliesCount: number;
  totalCommentsProcessed: number;
  totalMessagesProcessed: number;
  dailyBreakdown?: Record<string, { ai: number; template: number }>;
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
  templates: {
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  rules: {
    used: number;
    limit: number | null;
    remaining: number | null;
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
  limit?: number;
  used?: number;
  remaining?: number;
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
  jobType: 'facebook_comment' | 'facebook_message' | 'instagram_comment' | 'instagram_message';
  requestId?: string; // Correlate with webhook request for tracing

  // Source identification
  pageId: string;           // Facebook/Instagram page ID (from webhook)
  postId?: string;          // For comments only (Facebook post ID or Instagram media ID)
  commentId?: string;       // Facebook/Instagram comment ID
  messageId?: string;       // Facebook/Instagram message ID (for DMs)
  senderId?: string;        // User who sent the comment/message
  senderName?: string;      // Display name of sender
  text: string;             // The actual comment/message content

  // Metadata
  receivedAt: string;       // ISO timestamp when webhook received
  replyDelay?: number;      // Delay in seconds before processing (from user settings)
  handoffRetries?: number;  // How many times this job has been re-enqueued due to handoff pause
}

export interface ReplyJobResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  replyText?: string;
  replyMethod?: 'template' | 'ai';
  error?: string;
  needsAttention?: boolean;
  flagReason?: string;
  aiIntent?: string;
  /** When set, the worker should re-enqueue this job with the given delay (ms) */
  handoffDelayMs?: number;
}

export const REPLY_QUEUE_NAME = 'reply-processing-queue';

/** Default handoff pause duration (minutes) when a user manually replies to a customer */
export const DEFAULT_HANDOFF_PAUSE_MINUTES = 15;

/** Default AI model used across backend and ai-worker services */
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini';

/** Bump when the system prompt changes — used by both ai-worker (telemetry) and backend (cache key). */
export const PROMPT_VERSION = 'v26';

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
  awayMessageMulti: Record<string, string>;
  dualReplyNudgeMulti: Record<string, string>;
  replyDelay: number;
  commentEscalationMinutes: number;
  messageEscalationMinutes: number;
  handoffPauseDurationMinutes: number;
  replyStyle: 'professional' | 'casual' | 'enthusiastic';
  brandVoiceNotes: string;
  brandVoiceNotesMulti: Record<string, string>;
  holdLowConfidence: boolean;
}

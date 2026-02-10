// Shared Types for Jawab24

// --- Utilities ---
export { normalizeArabic } from './utils/arabic-normalize';
export type { NormalizeOptions } from './utils/arabic-normalize';
export { sanitizeUserInput } from './utils/sanitize';
export { sanitizeKbContent } from './utils/sanitize-kb';

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
  needsAttention?: boolean;
  flagReason?: string | null;
  aiIntent?: string | null;
  source?: 'facebook' | 'instagram';
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
  instagramAutoReplyEnabled?: boolean | null;
  // Shopify fields
  shopifyStoreId?: string | null;
  // Other fields
  knowledgeBase?: string | null;
  suggestedKnowledgeBase?: string | null;
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
  translations: Record<string, string>;
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
  price: number; // in cents
  currency: string;
  interval: 'month' | 'year';
  // Limits
  maxPages: number | null;
  maxAiRepliesPerMonth: number | null;
  maxTemplates: number | null;
  maxRules: number | null;
  // Features
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  shopifyEnabled: boolean;
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
}

export const REPLY_QUEUE_NAME = 'reply-processing-queue';

// --- Shopify Types ---
export interface ShopifyStore {
  id: string;
  userId: string;
  shopDomain: string;
  shopName: string | null;
  shopEmail: string | null;
  shopCurrency: string | null;
  productCount: number;
  productSummary: string | null;
  policiesSummary: string | null;
  lastSyncAt: Date | null;
  isActive: boolean;
  installedAt: Date | null;
}

export interface ShopifyProduct {
  id: string;
  shopifyStoreId: string;
  shopifyProductId: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  status: string;
  priceRange: string | null;
  currency: string | null;
  totalInventory: number;
  hasVariants: boolean;
  variantSummary: string | null;
  tags: string | null;
}

export interface ShopifySyncJobData {
  shopifyStoreId: string;
  jobType: 'full_sync' | 'product_update';
  shopifyProductId?: string; // For incremental product_update
}

export const SHOPIFY_SYNC_QUEUE_NAME = 'shopify-sync-queue';

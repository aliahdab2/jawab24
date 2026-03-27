/**
 * API Client Configuration
 * 
 * Industry Standards Applied:
 * - Axios with interceptors for auth token handling
 * - Centralized AuthManager for 401 handling
 * - Separate public/authenticated API instances
 * - CSRF protection for state-changing requests
 * - Request retry with exponential backoff
 * - Request timeout configuration
 *
 * NOTE: When adding new API types, ensure they match the backend DTOs exactly.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { addRetryInterceptor, addTimeoutConfig } from './axiosRetry';
import { authManager } from './authManager';

// Prefer explicit env; fall back to production API to avoid localhost calls in prod builds
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';

// Authenticated API instance
export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Public API instance (no auth interceptor - for unauthenticated endpoints)
export const publicApi = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Enable credentials (cookies) for all requests
api.defaults.withCredentials = true;
publicApi.defaults.withCredentials = true;

// Add retry logic and timeout to both instances
addRetryInterceptor(api, { retries: 3, retryDelay: 1000 });
addRetryInterceptor(publicApi, { retries: 3, retryDelay: 1000 });
addTimeoutConfig(api, 30000); // 30 seconds
addTimeoutConfig(publicApi, 30000);

/**
 * Request Interceptor - Adds auth token and CSRF token
 * 
 * Token Strategy:
 * - Web (cookies): HttpOnly cookies auto-sent, add CSRF token for mutations
 * - Mobile (native): Bearer token from localStorage
 */
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Mobile/Legacy: Add Bearer token if present in localStorage
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Web: Add CSRF token for state-changing requests (POST, PUT, PATCH, DELETE)
    // CSRF cookie is set by the backend alongside the HttpOnly auth cookie
    if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
      const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
      if (match) {
        config.headers['X-CSRF-Token'] = match[2];
      }
    }

    // Workspace scoping: tell the backend which workspace this request is for.
    // Imported lazily to avoid circular dependency (store imports api, api imports store).
    // The header is omitted on unauthenticated requests where activeWorkspaceId is null.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAuthStore } = require('./store');
      const workspaceId = useAuthStore.getState().activeWorkspaceId;
      if (workspaceId) {
        config.headers['X-Workspace-Id'] = workspaceId;
      }
    } catch {
      // Store not yet initialized — continue without header
    }
  }
  return config;
});

/**
 * Response Interceptor - Centralized auth error handling via AuthManager
 *
 * Handles 401 (expired token) and session-related 403s (stale CSRF/workspace).
 * Token refresh with request queuing, centralized logout on failure.
 */
authManager.setupAuthInterceptor(api);

// ============================================================================
// API Endpoints
// ============================================================================

// Auth API
export const authApi = {
  loginWithFacebook: (code: string) =>
    api.post('/auth/facebook', { code }),

  nativeFacebookLogin: (accessToken: string) =>
    api.post('/auth/facebook/native', { accessToken }),

  getProfile: () =>
    api.get('/auth/me'),

  logout: () =>
    api.post('/auth/logout'),

  refreshToken: () =>
    api.post('/auth/refresh'),
};

// Pages API
export const pagesApi = {
  getAll: () => api.get('/pages'),
  getById: (id: string) => api.get(`/pages/${id}`),
  toggle: (id: string, enabled: boolean) =>
    api.patch(`/pages/${id}/auto-reply`, { enabled }),
  sync: () => api.post('/pages/sync'),
  getKbGaps: (pageId: string) => api.get(`/pages/${pageId}/kb-gaps`),
  dismissGap: (pageId: string, gapId: string) => api.post(`/pages/${pageId}/kb-gaps/${gapId}/dismiss`),
};

// Posts API
export const postsApi = {
  getByPage: (pageId: string) => api.get(`/pages/${pageId}/posts`),
  getById: (id: string) => api.get(`/posts/${id}`),
  toggle: (id: string, enabled: boolean) =>
    api.patch(`/posts/${id}/auto-reply`, { enabled }),
};

// Comments API Types
export interface CommentData {
  id: string;
  postId: string;
  facebookCommentId: string;
  message: string;
  fromId: string | null;
  fromName: string | null;
  replied: boolean;
  replyText: string | null;
  replyMethod: 'ai' | 'template' | 'manual' | null;
  detectedLanguage: string | null;
  createdTime: string | null;
  repliedAt: string | null;
  createdAt: string;
  postMessage: string | null;
  pageId: string;
  pageName: string | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  aiIntent?: string | null;
  source?: 'facebook' | 'instagram';
}

export interface CommentsPaginatedResponse {
  data: CommentData[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
  };
}

export interface CommentsQueryParams {
  cursor?: string;           // Comment ID to start after (for infinite scroll)
  limit?: number;            // Comments per page (default 50, max 100)
  replied?: boolean;         // Filter: true = replied only, false = unreplied only
  replyMethod?: 'ai' | 'template' | 'manual';  // Filter by reply method
  needsAttention?: boolean;  // Filter by needsAttention flag
  resolved?: boolean;        // Filter by resolved status
  actionRequired?: boolean;  // Composite: (unreplied & unresolved) OR (needsAttention & unresolved)
}

// Comments Stats Interface
export interface CommentStats {
  total: number;
  replied: number;
  unreplied: number;
  needsAttention: number;
  actionRequired: number;
  resolved: number;
  repliedToday: number;
  replyRate: string;
  byMethod: {
    template: number;
    ai: number;
    manual: number;
  };
}

// Comments API
export const commentsApi = {
  getAll: (params?: CommentsQueryParams) =>
    api.get<CommentsPaginatedResponse>('/comments', { params }),
  getStats: () => api.get<CommentStats>('/comments/stats'),
  getByPost: (postId: string) => api.get(`/posts/${postId}/comments`),
  reply: (id: string, text: string) =>
    api.post(`/comments/${id}/reply`, { replyText: text }),
  submitFeedback: (id: string, data: { feedback: 'positive' | 'negative'; reason?: string[]; source: string }) =>
    api.post(`/comments/${id}/feedback`, {
      helpful: data.feedback === 'positive',
      reason: data.reason ? data.reason.join(', ') : undefined,
      // Source param is tracked by frontend but not currently used by backend controller
    }),
  resolve: (id: string) => api.post(`/comments/${id}/resolve`),
  unresolve: (id: string) => api.post(`/comments/${id}/unresolve`),
};

// Templates API
export const templatesApi = {
  getAll: () => api.get('/templates'),
  getById: (id: string) => api.get(`/templates/${id}`),
  create: (data: { name: string; message: string }) =>
    api.post('/templates', data),
  update: (id: string, data: { name?: string; message?: string; active?: boolean }) =>
    api.put(`/templates/${id}`, data),
  delete: (id: string) => api.delete(`/templates/${id}`),
};

// Rules API
export const rulesApi = {
  getAll: () => api.get('/rules'),
  getById: (id: string) => api.get(`/rules/${id}`),
  create: (data: { name: string; keywords: string[]; templateId: string; priority?: number }) =>
    api.post('/rules', data),
  update: (id: string, data: { name?: string; keywords?: string[]; templateId?: string; priority?: number; active?: boolean }) =>
    api.put(`/rules/${id}`, data),
  delete: (id: string) => api.delete(`/rules/${id}`),
};

// Settings API
export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: Record<string, unknown>) => api.put('/settings', data),
};

// Stats API
export const statsApi = {
  get: () => api.get('/stats'),
};

// Analytics API
export interface AnalyticsOverview {
  period: { from: string; to: string; days: number };
  totals: {
    comments: number;
    messages: number;
    replied: number;
    unreplied: number;
    replyRate: string;
    flagged: number;
  };
  byMethod: Record<string, number>;
  byIntent: Record<string, number>;
  byLanguage: Record<string, number>;
  byPlatform: Record<string, number>;
  flags: Record<string, number>;
  responseTime: {
    avgSeconds: number | null;
    p50Seconds: number | null;
    p95Seconds: number | null;
  };
}

export interface AiUsageModelStats {
  calls: number;
  llmCalls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AiUsageReport {
  period: { from: string; to: string; days: number };
  totals: AiUsageModelStats;
  byModel: Record<string, AiUsageModelStats>;
  byDay: Array<{ date: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

export interface SystemHealthReport {
  services: {
    database: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down'; latencyMs: number };
    aiWorker: { circuit: 'closed' | 'open' | 'half-open' | 'unknown' };
  };
  process: {
    memoryRssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    uptimeSeconds: number;
  };
  externalApis: Array<{
    service: string;
    method: string;
    status: string;
    count: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  }>;
}

export const analyticsApi = {
  getOverview: (days?: number) =>
    api.get<AnalyticsOverview>('/analytics/overview', { params: days ? { days } : undefined }),
  getAiUsage: (days?: number) =>
    api.get<AiUsageReport>('/analytics/ai-usage', { params: days ? { days } : undefined }),
  getSystemHealth: () =>
    api.get<SystemHealthReport>('/analytics/system-health'),
};

// Plans API (Public - uses publicApi to avoid auth redirect issues)
export const plansApi = {
  getAll: (config?: AxiosRequestConfig) => publicApi.get('/plans', config),
  getById: (id: string) => publicApi.get(`/plans/${id}`),
};

// Plans Admin API
export const plansAdminApi = {
  getAll: () => api.get('/plans/admin/all'),
  create: (data: Record<string, unknown>) => api.post('/plans/admin', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/plans/admin/${id}`, data),
  delete: (id: string) => api.delete(`/plans/admin/${id}`),
  setDefault: (id: string) => api.post(`/plans/admin/${id}/set-default`),
};

// Subscription API
export const subscriptionApi = {
  get: () => api.get('/subscription'),
  getUsage: (config?: AxiosRequestConfig) => api.get('/subscription/usage', config),
  changePlan: (planId: string) => api.post('/subscription/change-plan', { planId }),
  cancel: (reason?: string) => api.post('/subscription/cancel', { reason }),
  billingPortal: () => api.post('/payment/billing-portal'),
  pause: () => api.post('/subscription/pause'),
  resume: () => api.post('/subscription/resume'),
  checkAiLimit: () => api.get('/subscription/limits/ai'),
  checkPageLimit: () => api.get('/subscription/limits/pages'),
  checkRuleLimit: () => api.get('/subscription/limits/rules'),
};

// Messages API
export const messagesApi = {
  getAll: (params?: MessagesQueryParams) =>
    api.get<MessagesPaginatedResponse>('/messages', { params }),

  getStats: () => api.get<{ total: number; replied: number; pending: number; resolved: number; needsAttention: number; actionRequired: number; autoReplied: number; repliedToday: number; byMethod: { template: number; ai: number; manual: number }; convTotal: number; convActionRequired: number; convAutoReplied: number; convHandled: number }>('/messages/stats'),

  getConversation: (senderId: string, params: { pageId: string; limit?: number }) =>
    api.get<Message[]>(`/messages/conversation/${senderId}`, { params }),

  reply: (messageId: string, replyText: string) =>
    api.post<Message>(`/messages/${messageId}/reply`, { replyText }),

  // Conversation pause / human handoff
  pauseConversation: (senderId: string, pageId: string, durationMinutes?: number) =>
    api.post<{ pausedUntil: string }>(`/messages/conversation/${senderId}/pause`, { pageId, durationMinutes }),

  resumeConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean }>(`/messages/conversation/${senderId}/resume`, { pageId }),

  getPauseStatus: (senderId: string, pageId: string) =>
    api.get<{ paused: boolean; pausedUntil: string | null; remainingMinutes: number | null }>(
      `/messages/conversation/${senderId}/pause-status`, { params: { pageId } }
    ),

  resolveConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean; resolved: number }>(`/messages/conversation/${senderId}/resolve`, { pageId }),

  unresolveConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean; unresolved: number }>(`/messages/conversation/${senderId}/unresolve`, { pageId }),
};

// AI API
export const aiApi = {
  generateAsync: (data: { comment: string; language?: string; context?: unknown }) =>
    api.post<{ jobId: string; status: string }>('/ai/generate-async', data),

  getJobStatus: (jobId: string) =>
    api.get<{ jobId: string; status: string; result?: { reply: string }; error?: string }>(`/ai/jobs/${jobId}`),
};

// Messages API Types
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
  createdTime: string | null;
  repliedAt: string | null;
  createdAt: string;
  needsAttention?: boolean;
  flagReason?: string | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean;
}

export interface MessagesPaginatedResponse {
  data: Message[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
  };
}

export interface MessagesQueryParams {
  cursor?: string;
  limit?: number;
  direction?: 'incoming' | 'outgoing';
  replied?: boolean;
  resolved?: boolean;
  needsAttention?: boolean;
  actionRequired?: boolean;  // Composite: (unreplied & unresolved) OR (needsAttention & unresolved)
}

// Admin API - Protected routes for admin users only
export const adminApi = {
  // List all users with pagination and filters
  listUsers: async (filters: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    plan?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.search) params.append('search', filters.search);
    if (filters.status) params.append('status', filters.status);
    if (filters.plan) params.append('plan', filters.plan);
    
    const response = await api.get(`/admin/users/all?${params.toString()}`);
    return response.data;
  },

  // Get single user details
  getUser: async (userId: string) => {
    const response = await api.get(`/admin/users/${userId}`);
    return response.data;
  },

  // Manual upgrade user subscription
  upgradeUser: async (userId: string, data: {
    planId: string;
    periodMonths: 1 | 3 | 6 | 12;
    paymentMethod: 'manual' | 'bank_transfer' | 'syrian_bank';
    paymentReference?: string;
    note?: string;
  }) => {
    const response = await api.post(`/admin/users/${userId}/upgrade`, data);
    return response.data;
  },

  // Get all plans (for admin dropdown)
  getPlans: async () => {
    const response = await api.get('/admin/plans');
    return response.data;
  },

  // Get audit logs
  getAuditLogs: async () => {
    const response = await api.get('/admin/audit-logs');
    return response.data;
  },

  // AI Playground — list all pages
  getPages: async () => {
    const response = await api.get('/admin/pages');
    return response.data;
  },

  // AI Playground — KB status for a page
  getKbStatus: async (pageId: string) => {
    const response = await api.get(`/admin/kb/status/${pageId}`);
    return response.data;
  },

  // AI Playground — KB gaps for a page
  getKbGaps: async (pageId: string) => {
    const response = await api.get(`/admin/kb/gaps/${pageId}`);
    return response.data;
  },

  // AI Playground — test AI reply
  testReply: async (data: {
    pageId: string;
    question: string;
    channel: 'comment' | 'dm';
    postMessage?: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
    replyStyle?: string;
    brandVoiceNotes?: string;
    customerContext?: string;
    model?: string;
  }) => {
    const response = await api.post('/admin/ai/playground', data);
    return response.data;
  },

  // AI Playground — update KB text for a page
  updateKb: async (pageId: string, knowledgeBase: string) => {
    const response = await api.patch(`/admin/pages/${pageId}/kb`, { knowledgeBase });
    return response.data;
  },

  // Waitlist — list signups with pagination/filters
  getWaitlist: async (filters: {
    page?: number;
    limit?: number;
    feature?: string;
    search?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.feature) params.append('feature', filters.feature);
    if (filters.search) params.append('search', filters.search);

    const response = await api.get(`/admin/waitlist?${params.toString()}`);
    return response.data;
  },
};

// Voice API — KB voice input transcription
export const voiceApi = {
  transcribe: async (audio: string, mimeType: string = 'audio/webm', languageHint?: string, quality: 'fast' | 'accurate' = 'accurate') => {
    const response = await api.post('/voice/transcribe', { audio, mimeType, languageHint, quality });
    return response.data;
  },
};

// E-commerce API - Manage connected store (Shopify, Salla, Zid)
export const ecommerceApi = {
  getStore: async () => {
    const response = await api.get('/shopify/store');
    return response.data;
  },
  connectStore: async (shopDomain: string) => {
    const response = await api.post('/shopify/store/connect', { shopDomain });
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/shopify/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/shopify/store/sync');
    return response.data;
  },
  getProducts: async () => {
    const response = await api.get('/shopify/store/products');
    return response.data;
  },
  linkPage: async (pageId: string) => {
    const response = await api.patch('/shopify/store/link-page', { pageId });
    return response.data;
  },
  unlinkPage: async (pageId: string) => {
    const response = await api.patch('/shopify/store/unlink-page', { pageId });
    return response.data;
  },
  getIntegrationStatus: async (): Promise<Record<string, boolean>> => {
    try {
      const response = await api.get('/integrations/status');
      return response.data;
    } catch {
      // Graceful fallback: Shopify enabled, others disabled
      return { shopify: true, salla: false, zid: false };
    }
  },
};

/** @deprecated Use ecommerceApi */
export const shopifyApi = ecommerceApi;

// Salla E-commerce API
export const sallaApi = {
  getStore: async () => {
    const response = await api.get('/salla/store');
    return response.data;
  },
  connectStore: async () => {
    const response = await api.post('/salla/store/connect');
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/salla/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/salla/store/sync');
    return response.data;
  },
  getProducts: async () => {
    const response = await api.get('/salla/store/products');
    return response.data;
  },
  linkPage: async (pageId: string) => {
    const response = await api.patch('/salla/store/link-page', { pageId });
    return response.data;
  },
  unlinkPage: async (pageId: string) => {
    const response = await api.patch('/salla/store/unlink-page', { pageId });
    return response.data;
  },
};

// Zid E-commerce API
export const zidApi = {
  getStore: async () => {
    const response = await api.get('/zid/store');
    return response.data;
  },
  connectStore: async () => {
    const response = await api.post('/zid/store/connect');
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/zid/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/zid/store/sync');
    return response.data;
  },
  getProducts: async () => {
    const response = await api.get('/zid/store/products');
    return response.data;
  },
  linkPage: async (pageId: string) => {
    const response = await api.patch('/zid/store/link-page', { pageId });
    return response.data;
  },
  unlinkPage: async (pageId: string) => {
    const response = await api.patch('/zid/store/unlink-page', { pageId });
    return response.data;
  },
};

// Workspace API
export const workspaceApi = {
  list: () => api.get('/workspaces'),
  getCurrent: () => api.get('/workspaces/current'),
  getMembers: () => api.get('/workspaces/current/members'),
  getSettings: () => api.get('/workspaces/current/settings'),
  updateSettings: (data: Record<string, unknown>) => api.put('/workspaces/current/settings', data),
  createInvite: (email: string, role?: string) =>
    api.post('/workspaces/current/invites', { email, role }),
  listInvites: () => api.get('/workspaces/current/invites'),
  revokeInvite: (inviteId: string) =>
    api.delete(`/workspaces/current/invites/${inviteId}`),
  removeMember: (userId: string) =>
    api.delete(`/workspaces/current/members/${userId}`),
  updateMemberRole: (userId: string, role: string) =>
    api.patch(`/workspaces/current/members/${userId}`, { role }),
  acceptInvite: (token: string) =>
    api.post('/invites/accept', { token }),
};

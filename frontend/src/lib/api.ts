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
  }
  return config;
});

/**
 * Response Interceptor - Centralized 401 handling via AuthManager
 * 
 * This uses the AuthManager singleton which handles:
 * - Token refresh with request queuing (prevents race conditions)
 * - Centralized logout on refresh failure
 * - Auth state notifications
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
};

// Posts API
export const postsApi = {
  getByPage: (pageId: string) => api.get(`/pages/${pageId}/posts`),
  getById: (id: string) => api.get(`/posts/${id}`),
  toggle: (id: string, enabled: boolean) =>
    api.patch(`/posts/${id}/auto-reply`, { enabled }),
};

// Comments API
export const commentsApi = {
  getAll: (params?: { page?: number; limit?: number; replied?: boolean }) =>
    api.get('/comments', { params }),
  getByPost: (postId: string) => api.get(`/posts/${postId}/comments`),
  reply: (id: string, text: string) =>
    api.post(`/comments/${id}/reply`, { text }),
  submitFeedback: (id: string, data: { feedback: 'positive' | 'negative'; reason?: string[]; source: string }) =>
    api.post(`/comments/${id}/feedback`, data),
};

// Templates API
export const templatesApi = {
  getAll: () => api.get('/templates'),
  getById: (id: string) => api.get(`/templates/${id}`),
  create: (data: { name: string; translations: Record<string, string>; keywords?: string[] }) =>
    api.post('/templates', data),
  update: (id: string, data: { name?: string; translations?: Record<string, string>; keywords?: string[]; active?: boolean }) =>
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
  pause: () => api.post('/subscription/pause'),
  resume: () => api.post('/subscription/resume'),
  checkAiLimit: () => api.get('/subscription/limits/ai'),
  checkPageLimit: () => api.get('/subscription/limits/pages'),
  checkRuleLimit: () => api.get('/subscription/limits/rules'),
};

// AI API
export const aiApi = {
  generateAsync: (data: { comment: string; language?: string; context?: unknown }) =>
    api.post<{ jobId: string; status: string }>('/ai/generate-async', data),

  getJobStatus: (jobId: string) =>
    api.get<{ jobId: string; status: string; result?: { reply: string }; error?: string }>(`/ai/jobs/${jobId}`),
};

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
};

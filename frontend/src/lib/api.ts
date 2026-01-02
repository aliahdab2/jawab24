import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Public API instance (no auth interceptor)
export const publicApi = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  loginWithFacebook: (code: string) => 
    api.post('/auth/facebook', { code }),
  
  getProfile: () => 
    api.get('/auth/profile'),
};

// Pages API
export const pagesApi = {
  getAll: () => api.get('/pages'),
  getById: (id: string) => api.get(`/pages/${id}`),
  toggle: (id: string, enabled: boolean) => 
    api.post(`/pages/${id}/toggle`, { enabled }),
  sync: () => api.post('/pages/sync'),
};

// Posts API
export const postsApi = {
  getByPage: (pageId: string) => api.get(`/pages/${pageId}/posts`),
  getById: (id: string) => api.get(`/posts/${id}`),
  toggle: (id: string, enabled: boolean) => 
    api.post(`/posts/${id}/toggle`, { enabled }),
};

// Comments API
export const commentsApi = {
  getAll: (params?: { page?: number; limit?: number; replied?: boolean }) => 
    api.get('/comments', { params }),
  getByPost: (postId: string) => api.get(`/posts/${postId}/comments`),
  reply: (id: string, text: string) => 
    api.post(`/comments/${id}/reply`, { text }),
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
  getAll: () => publicApi.get('/plans'),
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
  getUsage: () => api.get('/subscription/usage'),
  changePlan: (planId: string) => api.post('/subscription/change-plan', { planId }),
  cancel: (reason?: string) => api.post('/subscription/cancel', { reason }),
  pause: () => api.post('/subscription/pause'),
  resume: () => api.post('/subscription/resume'),
  checkAiLimit: () => api.get('/subscription/limits/ai'),
  checkPageLimit: () => api.get('/subscription/limits/pages'),
  checkTemplateLimit: () => api.get('/subscription/limits/templates'),
  checkRuleLimit: () => api.get('/subscription/limits/rules'),
};


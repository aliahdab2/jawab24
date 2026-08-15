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

import axios, { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { addRetryInterceptor, addTimeoutConfig } from './axiosRetry';
import { authManager } from './authManager';
import { getEmbeddedToken } from './embeddedSession';
import type { OrderNotificationType, NotificationTemplate, NotificationStats, WaitlistEmailTemplate, ActivationFunnel, CatalogItem, CatalogItemType, CatalogVertical, CatalogVerticalSource, EmailAttachment, FactStructuredValues, PostSuggestionDto, PostSuggestionEvent, PostSuggestionPostType, PostSuggestionResponse } from '@jawab24/shared';
export type { OrderNotificationType, NotificationTemplate, NotificationStats, PostSuggestionResponse };

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

// Add retry logic and timeout to both instances.
// Tuned for weak-network UX: prior config (30s × 4 attempts) made stalled
// requests block the UI for nearly 2 minutes before surfacing failure.
addRetryInterceptor(api, { retries: 2, retryDelay: 500 });
addRetryInterceptor(publicApi, { retries: 2, retryDelay: 500 });
addTimeoutConfig(api, 15000);
addTimeoutConfig(publicApi, 15000);

/**
 * Per-call override for endpoints known to legitimately exceed the default
 * 15s timeout — AI generation, e-commerce product sync, OAuth handshakes,
 * file extraction, audio transcription, bulk email send. These are
 * non-idempotent POSTs that the retry interceptor will not retry, so the
 * timeout must be long enough to let the operation finish.
 */
const LONG_RUNNING_TIMEOUT = 60000;

/**
 * Add CSRF token for state-changing requests (POST, PUT, PATCH, DELETE).
 * CSRF cookie is set by the backend alongside the HttpOnly auth cookie.
 *
 * Needed on BOTH axios instances: publicApi also rides the session cookie
 * (withCredentials), so the backend enforces CSRF on its mutations too
 * whenever a `token` cookie is present — e.g. logout, or a logged-in user
 * submitting the waitlist form.
 */
function attachCsrfToken(config: InternalAxiosRequestConfig): void {
  if (document.cookie && config.method && ['post', 'put', 'patch', 'delete'].includes(config.method.toLowerCase())) {
    const match = document.cookie.match(new RegExp('(^| )csrfToken=([^;]+)'));
    if (match) {
      config.headers['X-CSRF-Token'] = match[2];
    }
  }
}

/**
 * Request Interceptor - Adds auth token and CSRF token
 *
 * Token Strategy:
 * - Web (cookies): HttpOnly cookies auto-sent, add CSRF token for mutations
 * - Mobile (native): Bearer token from localStorage
 * - Embedded (platform dashboard iframe): Bearer token from sessionStorage —
 *   third-party-frame cookies are never sent, so cookies cannot work there
 */
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Embedded first: an embedded tab must never fall back to a cookie session
    // that isn't there. See lib/embeddedSession.ts.
    const embeddedToken = getEmbeddedToken();
    // Mobile/Legacy: Add Bearer token if present in localStorage
    const token = embeddedToken ?? localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    attachCsrfToken(config);

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

// publicApi mutations (logout, waitlist, …) also need the CSRF header —
// no Bearer/workspace headers here, this stays the unauthenticated client.
publicApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    attachCsrfToken(config);
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

// Phone OTP API (unauthenticated — used on the login page)
export const otpApi = {
  requestOtp: (phone: string, locale?: string) =>
    publicApi.post('/auth/phone/request', { phone, locale }),

  verifyOtp: (phone: string, code: string) =>
    publicApi.post<{ user: { id: string; name: string | null; phone: string | null; picture?: string; isAdmin?: boolean }; token: string; workspaces: unknown[] }>('/auth/phone/verify', { phone, code }),

  // Link phone to an already-authenticated user (used in phone-collect flow)
  linkPhone: (phone: string, code: string) =>
    api.post('/auth/phone/link', { phone, code }),
};

// Pages API
export const pagesApi = {
  getAll: () => api.get('/pages'),
  getById: (id: string) => api.get(`/pages/${id}`),
  toggle: (id: string, enabled: boolean) =>
    api.patch(`/pages/${id}/auto-reply`, { enabled }),
  sync: (accessToken?: string) =>
    api.post('/pages/sync', accessToken ? { accessToken } : undefined, { timeout: LONG_RUNNING_TIMEOUT }),
  // Soft-hide a DISCONNECTED page from the channels screen. The row and all its
  // data survive; reconnecting the page through Facebook restores the card.
  archive: (id: string) => api.post(`/pages/${id}/archive`),
  getKbGaps: (pageId: string) => api.get(`/pages/${pageId}/kb-gaps`),
  dismissGap: (pageId: string, gapId: string) => api.post(`/pages/${pageId}/kb-gaps/${gapId}/dismiss`),
  // Phase C: remove merchant-confirmed KB lines that moved to the catalog or
  // duplicate a structured field. `lines` are the EXACT line texts to remove.
  cleanupKb: (pageId: string, lines: string[]) => api.post(`/pages/${pageId}/kb/cleanup`, { lines }),
  // Per-page lead-config override. For each slice: null reverts to the workspace
  // default; an omitted key leaves it unchanged; a value is a full override.
  updateLeadConfig: (id: string, data: { leadStages?: LeadStagesConfig | null; leadFields?: LeadCustomFieldDef[] | null }) =>
    api.patch(`/pages/${id}/lead-config`, data),
  testReply: (pageId: string, data: { question: string; channel: 'comment' | 'dm'; postMessage?: string; conversationHistory?: { role: 'user' | 'assistant'; content: string }[] }) =>
    api.post(`/pages/${pageId}/test-reply`, data, { timeout: LONG_RUNNING_TIMEOUT }),
};

// Native catalog API — merchant-authored offerings on a page (no store needed).
export const catalogApi = {
  list: (pageId: string) =>
    api.get<{ data: CatalogItem[]; vertical: CatalogVerticalInfo }>(`/pages/${pageId}/catalog`),
  create: (pageId: string, data: CatalogItemInput) =>
    api.post(`/pages/${pageId}/catalog`, data),
  update: (pageId: string, itemId: string, data: Partial<CatalogItemInput> & { sortOrder?: number }) =>
    api.patch(`/pages/${pageId}/catalog/${itemId}`, data),
  remove: (pageId: string, itemId: string) =>
    api.delete(`/pages/${pageId}/catalog/${itemId}`),
  setVertical: (pageId: string, vertical: CatalogVertical) =>
    api.patch<{ vertical: CatalogVerticalInfo }>(`/pages/${pageId}/catalog/vertical`, { vertical }),
  // Import flow: extract returns PROPOSALS only (nothing persisted); the
  // reviewed rows are saved all-or-nothing via batchCreate.
  extract: (pageId: string, text: string) =>
    api.post<CatalogExtractResponse>(`/pages/${pageId}/catalog/extract`, { text }, { timeout: LONG_RUNNING_TIMEOUT }),
  // Page scan (D-059): reads the page's recent FB posts (text + images) AND its
  // configured Post Reply auto-replies server-side and returns PROPOSALS in the
  // same shape as extract — same review-then-batch flow. Replies come from our
  // own DB, so the scan still works (replies-only) on a dead token.
  scanPage: (pageId: string) =>
    api.post<CatalogScanResponse>(`/pages/${pageId}/catalog/scan-posts`, {}, { timeout: LONG_RUNNING_TIMEOUT }),
  batchCreate: (pageId: string, items: CatalogItemInput[]) =>
    api.post<{ data: CatalogItem[] }>(`/pages/${pageId}/catalog/batch`, { items }),
};

/** «إنشاء منشور» pilot. Server 404s every route for non-allowlisted pages
 *  (dark feature) — callers treat 404 as "pilot off", never as an error.
 *  Response envelope: the shared `PostSuggestionResponse` (one shape for
 *  getCurrent AND generate — re-exported above for component imports). */
export const postSuggestionsApi = {
  // ⚠️ The PATH still says `today`, the behaviour does not: it returns the
  // page's current post whenever it was made, plus the earlier ones. The URL is
  // frozen because shipped mobile bundles call it and cannot be redeployed.
  getCurrent: (pageId: string) =>
    api.get<PostSuggestionResponse>(`/pages/${pageId}/post-suggestions/today`),
  // REQUESTS a generation — it does not wait for one. The call claims the
  // merchant's daily slot, stores a `pending` row and returns in milliseconds;
  // a worker does the ~35s of paid work and the client polls `getCurrent`. So no
  // long-timeout override here, deliberately: the previous 60s one was never
  // honoured anyway (nginx caps this route at 30s), and pretending otherwise is
  // what produced «حدث خطأ ما» over a post that had actually been created.
  // includeContact: merchant toggle for the server-composed contact footer.
  // postType: merchant-chosen angle; omitted = the server's variety picker.
  generate: (pageId: string, includeContact = true, postType?: PostSuggestionPostType) =>
    api.post<PostSuggestionResponse>(`/pages/${pageId}/post-suggestions`, { includeContact, ...(postType ? { postType } : {}) }),
  // The card's bytes, from OUR origin. Deliberately not a direct fetch of the
  // stored `imageUrl`: that host serves no CORS headers, so the browser can
  // display it but never read it — which is why the download button threw on
  // every press before this. Goes through `api` (not bare fetch) because the
  // route is authenticated and only this client carries the Bearer + workspace
  // headers.
  downloadImage: (pageId: string, suggestionId: string, variantIndex?: number) =>
    api.get<Blob>(`/pages/${pageId}/post-suggestions/${suggestionId}/image`, {
      responseType: 'blob',
      ...(variantIndex !== undefined ? { params: { variant: variantIndex } } : {}),
    }),
  markEvent: (pageId: string, suggestionId: string, event: PostSuggestionEvent) =>
    api.post(`/pages/${pageId}/post-suggestions/${suggestionId}/events`, { event }),
  // Which take the merchant picked. Persisted so the dashboard card and any
  // other reader (including app bundles that predate variants) show the post
  // they chose — the server mirrors it into the columns of record.
  selectVariant: (pageId: string, suggestionId: string, variantIndex: number) =>
    api.put<{ suggestion: PostSuggestionDto }>(`/pages/${pageId}/post-suggestions/${suggestionId}/selection`, { variantIndex }),
};

/** One row of a fact collection, as the API serves it. `price` is the numeric
 *  column's string form ("35000.00"); dates are YYYY-MM-DD. */
export interface FactRowDto {
  id: string;
  name: string;
  attributes: { label: string; value: string }[] | null;
  /** Structured shadow of attribute values, keyed by label (round-7
   *  write-back contract) — display/sorting intelligence only; the string
   *  in `attributes` stays what the AI quotes. */
  structured?: FactStructuredValues | null;
  price: string | null;
  currency: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isAvailable: boolean;
}

export interface FactCollectionWithRows {
  id: string;
  label: string;
  keyAttr: string | null;
  /** null = un-asked · true = merchant declared exhaustive · false = declared partial. */
  isComplete: boolean | null;
  rowCount: number;
  rows: FactRowDto[];
}

/** Body for creating/patching a row. Price accepts what the merchant types
 *  (Arabic-Indic digits included) — the backend normalizes. */
export interface FactRowBody {
  name?: string;
  attributes?: { label: string; value: string }[] | null;
  structured?: FactStructuredValues | null;
  price?: string | number | null;
  currency?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Updates MERGE server-side (rowId upserts and the row PATCH alike):
   *  absent = unchanged, so an updater may omit it. On inserts, absent
   *  defaults to true. */
  isAvailable?: boolean;
}

// Fact-collections list editor (G1b) — the enumerable lists the AI quotes
// exactly (course schedules, price tables, outlet directories). Read-only for
// members; writes need workspace admin.
/** One atomic entity save: row upserts and deletes that may span several
 *  collections (the price row in one list, its sessions in another) — the
 *  backend applies them in a single transaction. */
export interface FactEntitySaveBody {
  upserts: (FactRowBody & { collectionId: string; rowId?: string; name: string })[];
  deletes: { collectionId: string; rowId: string }[];
}

/** Body for the merchant's «add list» (G1b creation UI). Deliberately narrower
 *  than the seeder's service input: no keyAttr (reply-time row gating stays an
 *  admin/seeder concern) and the backend pins source to 'editor'. A collection
 *  is created WITH its first row — born-empty lists are refused server-side. */
export interface FactCollectionCreateBody {
  label: string;
  rows: (FactRowBody & { name: string })[];
}

export const factCollectionsApi = {
  list: (pageId: string) =>
    api.get<{ data: FactCollectionWithRows[] }>(`/pages/${pageId}/fact-collections`),
  /** 201 returns the bare collection (no rows attached) — refetch `list` for
   *  the full shape. 409 DUPLICATE_LABEL / COLLECTION_LIMIT are expected
   *  refusals, mapped to copy in the section's failure handler. */
  createCollection: (pageId: string, body: FactCollectionCreateBody) =>
    api.post<{ data: { id: string; label: string } }>(`/pages/${pageId}/fact-collections`, body),
  /** Rename a list. The label is the header of the list's block in the prompt,
   *  so this changes what the AI reads — not just what the merchant sees. Same
   *  409 DUPLICATE_LABEL contract as create. */
  renameCollection: (pageId: string, collectionId: string, label: string) =>
    api.patch<{ data: { id: string; label: string } }>(`/pages/${pageId}/fact-collections/${collectionId}`, { label }),
  /** Delete a list and its rows — the undo for «add list». The server cascades
   *  the rows and retires the page's reply caches. */
  deleteCollection: (pageId: string, collectionId: string) =>
    api.delete(`/pages/${pageId}/fact-collections/${collectionId}`),
  saveEntity: (pageId: string, body: FactEntitySaveBody) =>
    api.put<{ data: { upserted: FactRowDto[]; deletedIds: string[] } }>(`/pages/${pageId}/fact-entity`, body),
  addRow: (pageId: string, collectionId: string, data: FactRowBody & { name: string }) =>
    api.post<{ data: FactRowDto }>(`/pages/${pageId}/fact-collections/${collectionId}/rows`, data),
  updateRow: (pageId: string, collectionId: string, rowId: string, data: FactRowBody) =>
    api.patch<{ data: FactRowDto }>(`/pages/${pageId}/fact-collections/${collectionId}/rows/${rowId}`, data),
  deleteRow: (pageId: string, collectionId: string, rowId: string) =>
    api.delete(`/pages/${pageId}/fact-collections/${collectionId}/rows/${rowId}`),
  setCompleteness: (pageId: string, collectionId: string, isComplete: boolean | null) =>
    api.patch(`/pages/${pageId}/fact-collections/${collectionId}/completeness`, { isComplete }),
};

/** Effective business vertical for a page's catalog + where it came from
 *  ('merchant' override, mapped 'facebook' page category, or 'default'). */
export interface CatalogVerticalInfo {
  effective: CatalogVertical;
  source: CatalogVerticalSource;
}

/** POST /catalog/scan-posts response — extract's shape plus scan telemetry
 *  (D-059: one scan covers recent posts + configured Post Replies). */
export interface CatalogScanResponse extends CatalogExtractResponse {
  /** Posts read in this scan. */
  postsScanned: number;
  /** Configured Post Reply rows fed to the extractor. */
  repliesScanned: number;
  /** Posts were readable and nothing new existed anywhere — an honest no-op.
   *  Never true when the posts could not be read (see postsUnavailable). */
  upToDate: boolean;
  /** Why the POSTS were not read ('noFacebook' | 'disconnected' | 'graph_error');
   *  the configured replies may still have been scanned. null = read normally. */
  postsUnavailable: 'noFacebook' | 'disconnected' | 'graph_error' | null;
}

/** POST /catalog/extract response. Prices come back as numbers (already
 *  normalized server-side); the review sheet may re-edit them as strings. */
export interface CatalogExtractResponse {
  items: CatalogItemInput[];
  /** Model rows discarded server-side (failed validation, duplicates, over the per-call cap). */
  dropped: number;
  /** Proposals cut because the page lacks free slots. */
  overflow: number;
  remainingCapacity: number;
  /** LLM output hit its token cap — the tail of the text may be missing. */
  truncated: boolean;
}

/** Client-side create/update payload — price is accepted as a string so the
 *  server can normalize Arabic-Indic digits / separators (Simplicity contract §5). */
export interface CatalogItemInput {
  type?: CatalogItemType;
  name: string;
  description?: string | null;
  price?: string | number | null;
  currency?: string | null;
  isAvailable?: boolean;
  /** 'YYYY-MM-DD' calendar dates (course cohort start / offer expiry). */
  startsAt?: string | null;
  endsAt?: string | null;
  attributes?: { label: string; value: string }[] | null;
}

// Posts API
export const postsApi = {
  getAll: () => api.get('/posts'),
  getByPage: (pageId: string) => api.get(`/pages/${pageId}/posts`),
  getById: (id: string) => api.get(`/posts/${id}`),
  toggle: (id: string, enabled: boolean) =>
    api.patch(`/posts/${id}/auto-reply`, { enabled }),
  updateTrigger: (opts: {
    id: string;
    source: 'facebook' | 'instagram';
    triggerKeyword: string | null;
    triggerReply: string | null;
    triggerType?: 'keyword' | 'all';
    // Image intent: undefined = leave as-is; null = remove; object = set a new image.
    triggerImage?: { base64: string; mimeType: string } | null;
    // Like the customer's comment on send (Facebook only — backend coerces to false for Instagram).
    likeComment?: boolean;
    // Mention the commenter in the public comment (Facebook only — backend coerces for Instagram).
    tagCommenter?: boolean;
    // Veto keywords: undefined = leave as-is; '' = clear; string = set.
    triggerExcludeKeyword?: string;
    // CTA button (Facebook only): '' clears, a value sets; both fields sent together.
    triggerButtonLabel?: string;
    triggerButtonUrl?: string;
  }) => api.patch(`/posts/${opts.id}/trigger`, {
    source: opts.source,
    triggerKeyword: opts.triggerKeyword,
    triggerReply: opts.triggerReply,
    triggerType: opts.triggerType ?? 'keyword',
    ...(opts.triggerImage !== undefined ? { triggerImage: opts.triggerImage } : {}),
    ...(opts.likeComment !== undefined ? { likeComment: opts.likeComment } : {}),
    ...(opts.tagCommenter !== undefined ? { tagCommenter: opts.tagCommenter } : {}),
    ...(opts.triggerExcludeKeyword !== undefined ? { triggerExcludeKeyword: opts.triggerExcludeKeyword } : {}),
    ...(opts.triggerButtonLabel !== undefined ? { triggerButtonLabel: opts.triggerButtonLabel } : {}),
    ...(opts.triggerButtonUrl !== undefined ? { triggerButtonUrl: opts.triggerButtonUrl } : {}),
  }),
  // Post Reply picker: recent published posts for a page (per platform) + their
  // trigger state, paginated via the platform Graph cursor.
  // `includeScheduled` opts into the page's still-pending Facebook posts. The server
  // requires the opt-in because this frontend ships inside the mobile app: an older app
  // build has no scheduled-post rendering and would show one as published with no date.
  getPublishedPosts: (
    pageId: string,
    opts?: { source?: 'facebook' | 'instagram'; after?: string; includeScheduled?: boolean },
  ) =>
    api.get(`/pages/${pageId}/published-posts`, {
      params: {
        ...(opts?.source ? { source: opts.source } : {}),
        ...(opts?.after ? { after: opts.after } : {}),
        ...(opts?.includeScheduled ? { includeScheduled: '1' } : {}),
      },
    }),
  // Find-or-create the internal row for a picked published post so its trigger can be
  // configured — lets a merchant arm a post before its first comment arrives.
  ensurePost: (pageId: string, source: 'facebook' | 'instagram', platformPostId: string) =>
    api.post('/posts/ensure', { pageId, source, platformPostId }),
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
  flagMeta?: import('@jawab24/shared').FlagMeta | null;
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
  pageId?: string;           // Filter by specific page
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
    /** AI fallback templates (e.g. quota-exhausted commentFallback) */
    template: number;
    ai: number;
    manual: number;
    /** Per-post keyword-trigger replies */
    postReply: number;
  };
  /** Today's replies split by method — dashboard "Replied Today" breakdown line */
  repliedTodayByMethod: { ai: number; postReply: number };
}

// Comments API
export const commentsApi = {
  getAll: (params?: CommentsQueryParams) =>
    api.get<CommentsPaginatedResponse>('/comments', { params }),
  getStats: (params?: { pageId?: string }) => api.get<CommentStats>('/comments/stats', { params }),
  getByPost: (postId: string) => api.get(`/posts/${postId}/comments`),
  getById: (id: string) => api.get<CommentData>(`/comments/${id}`),
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
  byIntent: Record<string, AiUsageModelStats>;
}

export type AdminUserAiCostPeriod = '7d' | '30d' | '90d' | 'this_month' | 'last_month';

/** Preset periods for the admin AI-cost views (shared by AiSection + the AI Cost panel). */
export const AI_COST_PERIODS: readonly AdminUserAiCostPeriod[] = ['7d', '30d', '90d', 'this_month', 'last_month'];

export interface AdminUserAiCostReport {
  period: AdminUserAiCostPeriod;
  rangeStart: string;
  rangeEnd: string;
  totals: {
    calls: number;
    billedCalls: number;
    cacheHits: number;
    // Scoped to the reply pipelines (comment_reply + dm_reply) — the only
    // cacheable traffic, so this is the meaningful cache-hit rate.
    replyCalls: number;
    replyCacheHits: number;
    replyCacheHitRate: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  byPage: Array<{
    pageId: string | null;
    pageName: string | null;
    calls: number;
    // Real OpenAI calls (calls − cacheHits); cache hits cost $0 but still count as calls.
    billedCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }>;
  // Cost split by source pipeline (Smart Reply vs lead extraction vs embeddings …).
  byPipeline: Array<{
    pipeline: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    costUsd: number;
  }>;
}

// Global (all-workspace) AI consumption + caching for the admin AI Cost panel.
// NOTE: this is OUR estimate from ai_usage_log (prod traffic only) — NOT the
// OpenAI authoritative bill (that comes from the billing endpoints).
export interface AdminGlobalAiCostReport {
  period: AdminUserAiCostPeriod;
  rangeStart: string;
  rangeEnd: string;
  totals: {
    calls: number;
    billedCalls: number;
    cacheHits: number;
    // Blended across ALL pipelines (incl. never-cacheable ones — embeddings,
    // translation, …) so it understates the cache; use replyCacheHitRate.
    internalCacheHitRate: number;
    // Scoped to the reply pipelines (comment_reply + dm_reply) — the only
    // cacheable traffic, so this is the meaningful cache-hit rate.
    replyCalls: number;
    replyCacheHits: number;
    replyCacheHitRate: number;
    tokensIn: number;
    cachedInputTokens: number;
    tokensOut: number;
    costUsd: number;
    promptCacheSavingsUsd: number;
  };
  byPipeline: Array<{
    pipeline: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    costUsd: number;
  }>;
  byModel: Array<{
    model: string;
    calls: number;
    billedCalls: number;
    cacheHits: number;
    tokensIn: number;
    cachedInputTokens: number;
    tokensOut: number;
    costUsd: number;
    promptCacheSavingsUsd: number;
  }>;
  byIntent: Array<{ intent: string; calls: number; cacheHits: number; costUsd: number; avgCostPerCallUsd: number }>;
  byDay: Array<{ date: string; calls: number; costUsd: number }>;
}

// Authoritative OpenAI billing (from daily Costs-API snapshots).
export interface AdminAiBillingReport {
  period: AdminUserAiCostPeriod;
  rangeStart: string;
  rangeEnd: string;
  totalUsd: number;
  byMonth: Array<{ month: string; costUsd: number }>;
  byModel: Array<{ model: string; costUsd: number }>;
  byApiKey: Array<{ apiKeyId: string; label: 'production' | 'eval_dev' | 'other'; costUsd: number }>;
  empty: boolean;
}

// OpenAI prod-key spend vs our ai_usage_log estimate (like-for-like) + org total.
export interface AdminAiReconciliation {
  period: AdminUserAiCostPeriod;
  openaiProdUsd: number;
  ourEstimateUsd: number;
  deltaUsd: number;
  deltaPct: number | null;
  openaiOrgUsd: number;
  prodKeyUnknown: boolean;
}

// OpenAI credit runway + early-warning severity.
export interface AdminAiRunway {
  configured: boolean;
  balanceUsd: number | null;
  anchoredAt: string | null;
  orgSpentSinceAnchorUsd: number;
  remainingUsd: number | null;
  rollingDailyRateUsd: number;
  runwayDays: number | null;
  severity: 'ok' | 'warning' | 'critical';
  currentlyParking: boolean;
  // Latest-complete-day spend spike vs the trailing baseline.
  spendSpike?: {
    spike: boolean;
    day: string | null;
    dayUsd: number;
    baselineDailyUsd: number;
    ratio: number | null;
  };
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
  /** Reply-queue depth + wait percentiles; null when Redis is unreachable. */
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    waitP50Ms: number | null;
    waitP95Ms: number | null;
    waitMaxMs: number | null;
    sampleCount: number;
    windowMinutes: number;
  } | null;
}

export interface CacheStats {
  exactCache: { totalEntries: number; totalHits: number };
  semanticCache: { totalEntries: number; totalHits: number };
}


export interface LeadDigestSendBase {
  id: string;
  userEmail: string | null;
  status: string;
  createdAt: string;
}

export const analyticsApi = {
  getOverview: (days?: number) =>
    api.get<AnalyticsOverview>('/analytics/overview', { params: days ? { days } : undefined }),
  getAiUsage: (days?: number) =>
    api.get<AiUsageReport>('/analytics/ai-usage', { params: days ? { days } : undefined }),
  getSystemHealth: () =>
    api.get<SystemHealthReport>('/analytics/system-health'),
  getCacheStats: () =>
    api.get<CacheStats>('/ai/cache/stats'),
  clearCache: () =>
    api.delete('/ai/cache'),
};

// ── E-commerce analytics (per-store, merchant-facing) ───────────────────────
export type EcommerceAnalyticsRange = '30d' | '90d';

export interface NotificationFunnel {
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
}

export interface EcommerceAnalyticsOverview {
  storeId: string;
  period: { from: string; to: string; range: EcommerceAnalyticsRange };
  notifications: {
    /** Channel-keyed funnel + roll-up total. Today: only 'sms'. Future: 'whatsapp', 'dm'. */
    funnel: { total: NotificationFunnel; byChannel: Record<string, NotificationFunnel> };
    byType: Record<string, number>;
  };
  recovery: {
    abandonedCartsNotified: number;
    cartsRecovered: number;
    revenueRecovered: number;
    currency: string | null;
  };
  replies: {
    totalReplies: number;
    aiReplies: number;
    postReplies: number;
    manualReplies: number;
  };
}

export const ecommerceAnalyticsApi = {
  getOverview: (storeId: string, range: EcommerceAnalyticsRange = '30d') =>
    api.get<EcommerceAnalyticsOverview>(`/api/ecommerce-analytics/${storeId}`, { params: { range } }),
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
  // Change plan on an existing Stripe-backed subscription. Stripe applies
  // proration automatically; the customer is credited for unused time on the
  // old plan and charged a prorated amount for the new plan on the next invoice.
  changePlan: (planId: string, billingInterval: 'month' | 'year' = 'month') =>
    api.post('/payment/change-plan', { planId, billingInterval }),
  cancel: () => api.post('/payment/cancel-subscription'),
  billingPortal: () => api.post('/payment/billing-portal'),
  checkAiLimit: () => api.get('/subscription/limits/ai'),
  checkPageLimit: () => api.get('/subscription/limits/pages'),
  getTopupConfig: () => api.get<{
    success: boolean;
    data: {
      enabled: boolean;
      packs: Record<string, { repliesAdded: number; priceCents: number }>;
      currency: string;
      whatsappNumber: string;
    };
  }>('/subscription/topup/config'),
};

/**
 * Conversation pause state for the human-handoff banner.
 * `reason` distinguishes an explicit UI pause ('explicit') from the implicit
 * pause a manual reply triggers ('manual_reply') — the banner uses it to explain
 * WHY auto-reply is paused. `remainingMinutes` is the auto-resume countdown.
 */
export interface PauseStatus {
  paused: boolean;
  pausedUntil: string | null;
  reason: 'explicit' | 'manual_reply' | null;
  remainingMinutes: number | null;
}

// Messages API
export const messagesApi = {
  getAll: (params?: MessagesQueryParams) =>
    api.get<MessagesPaginatedResponse>('/messages', { params }),

  getStats: (params?: { pageId?: string }) => api.get<{ total: number; replied: number; pending: number; resolved: number; needsAttention: number; actionRequired: number; autoReplied: number; repliedToday: number; byMethod: { template: number; ai: number; manual: number; postReply: number }; repliedTodayByMethod: { ai: number; postReply: number }; convTotal: number; convActionRequired: number; convAutoReplied: number; convHandled: number }>('/messages/stats', { params }),

  getConversation: (senderId: string, params: { pageId: string; limit?: number }) =>
    api.get<Message[]>(`/messages/conversation/${senderId}`, { params }),

  locateMessage: (messageId: string) =>
    api.get<{ senderId: string; pageId: string }>(`/messages/locate/${messageId}`),

  reply: (messageId: string, replyText: string, clientMessageId?: string) =>
    api.post<Message>(`/messages/${messageId}/reply`, { replyText, clientMessageId }, {
      // Bad-network clients (e.g. Syria) need extra headroom on the request that actually
      // hits the FB/IG Graph API. Idempotent on the backend via clientMessageId, so a longer
      // wait can't cause duplicate sends.
      timeout: 60_000,
    }),

  // Send a manual DM into an existing conversation without targeting a specific incoming
  // message. Used when the customer never DM'd (e.g., dual-mode comment reply only).
  replyToConversation: (senderId: string, payload: { pageId: string; replyText: string; clientMessageId?: string }) =>
    api.post<Message>(`/messages/conversation/${senderId}/reply`, payload, { timeout: 60_000 }),

  // Conversation pause / human handoff
  pauseConversation: (senderId: string, pageId: string, durationMinutes?: number) =>
    api.post<{ pausedUntil: string }>(`/messages/conversation/${senderId}/pause`, { pageId, durationMinutes }),

  resumeConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean }>(`/messages/conversation/${senderId}/resume`, { pageId }),

  getPauseStatus: (senderId: string, pageId: string) =>
    api.get<PauseStatus>(
      `/messages/conversation/${senderId}/pause-status`, { params: { pageId } }
    ),

  resolveConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean; resolved: number }>(`/messages/conversation/${senderId}/resolve`, { pageId }),

  unresolveConversation: (senderId: string, pageId: string) =>
    api.post<{ success: boolean; unresolved: number }>(`/messages/conversation/${senderId}/unresolve`, { pageId }),
};

// Messages API Types
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
  replyMethod: 'template' | 'ai' | 'manual' | null;
  createdTime: string | null;
  repliedAt: string | null;
  createdAt: string;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: import('@jawab24/shared').FlagMeta | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean;
  platform?: 'facebook' | 'instagram' | 'whatsapp';
  attachmentType?: string | null;
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
  pageId?: string;           // Filter by specific page
}

// Partners (resellers / country reps) — admin registry + reseller-facing portal
export interface AdminPartner {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  commissionPct: number;
  isActive: boolean;
  /** True once the partner has signed in and the portal bound their account. */
  linked: boolean;
  merchantCount: number;
  createdAt: string | null;
}

export type PartnerMerchantStatus =
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'expired'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'none';

export interface PartnerMerchant {
  id: string;
  name: string | null;
  phone: string | null;
  pageNames: string[];
  planName: string | null;
  status: PartnerMerchantStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  /** Admin-authored follow-up note for this merchant. */
  adminNote: string | null;
}

export interface PartnerOverview {
  // Commission % is deliberately absent — the portal never shows it.
  partner: { name: string };
  merchants: PartnerMerchant[];
}

export interface PartnerMerchantPage {
  id: string;
  name: string | null;
  facebookPageId: string | null;
  instagramUsername: string | null;
  whatsappDisplayPhoneNumber: string | null;
  autoReplyEnabled: boolean | null;
  autoReplyDisabledReason: string | null;
  whatsappAutoReplyEnabled: boolean | null;
  disconnected: boolean;
  disconnectReason: string | null;
  archivedAt: string | null;
  kb: {
    kbLength: number;
    kbActiveVersion: number | null;
    kbUpdatedAt: string | null;
    chunksTotal: number;
    chunksByType: Record<string, number>;
    unresolvedGaps: number;
  };
}

export interface PartnerMerchantDetail {
  id: string;
  name: string | null;
  phone: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  topupBalance: number;
  adminNote: string | null;
  subscription: {
    status: string | null;
    planName: string | null;
    planSlug: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    paymentMethod: string | null;
    maxAiRepliesPerMonth: number | null;
    maxPages: number | null;
  } | null;
  status: PartnerMerchantStatus;
  // Configured-or-not only: the free-text fields (brand voice, greeting, away
  // message) are collapsed to booleans server-side and never reach the client.
  settings: {
    aiEnabled: boolean | null;
    commentsAutoReply: boolean | null;
    messagesAutoReply: boolean | null;
    commentReplyMode: string | null;
    holdLowConfidence: boolean | null;
    businessHoursOnly: boolean | null;
    businessHoursStart: string | null;
    businessHoursEnd: string | null;
    timezone: string | null;
    replyStyle: string | null;
    replyDelay: number | null;
    defaultReplyLanguage: string | null;
    autoDetectLanguage: boolean | null;
    greetingMessageEnabled: boolean | null;
    limitFallbackEnabled: boolean | null;
    onboardingCompletedAt: string | null;
    hasBrandVoice: boolean;
    hasGreetingMessage: boolean;
    hasAwayMessage: boolean;
    source: 'effective' | 'legacy-fallback';
  } | null;
  usage: {
    aiRepliesCount: number;
    postRepliesCount: number;
    periodStart: string | null;
    periodEnd: string | null;
    limit: number | null;
  };
  leads: {
    total: number;
    today: number;
    last7d: number;
    last30d: number;
    byStatus: { new: number; contacted: number; converted: number };
  };
  pages: PartnerMerchantPage[];
  workspaces: Array<{
    id: string;
    name: string | null;
    role: 'owner' | 'admin' | 'member';
    isOwner: boolean;
    ownerName: string | null;
    memberCount: number;
  }>;
}

// Partner Portal API — read-only surface for resellers. Any authenticated user
// may call; non-partners get 403 (NOT_A_PARTNER) and the page redirects them.
export const partnerApi = {
  getOverview: async () => {
    const response = await api.get<{ success: boolean; data: PartnerOverview }>('/partner/overview');
    return response.data;
  },

  // 404 when the merchant is not attributed to the calling partner.
  getMerchant: async (userId: string) => {
    const response = await api.get<{ success: boolean; data: PartnerMerchantDetail }>(`/partner/merchants/${userId}`);
    return response.data;
  },
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

  // Partners (resellers / country reps)
  listPartners: async () => {
    const response = await api.get<{ success: boolean; data: AdminPartner[] }>('/admin/partners');
    return response.data;
  },

  // At least one of email/phone is required — they are how the portal binds
  // the partner's login (a phone-OTP signup has no email at all).
  createPartner: async (input: { name: string; email?: string | null; phone?: string | null; commissionPct: number }) => {
    const response = await api.post<{ success: boolean; data: AdminPartner }>('/admin/partners', input);
    return response.data;
  },

  // Assign (or clear, with null) a merchant's reseller attribution.
  // `note` (partner-visible follow-up note): omit = unchanged, null/'' = clear.
  assignPartner: async (userId: string, partnerId: string | null, note?: string | null) => {
    const response = await api.put<{ success: boolean; data: { partnerId: string | null; partnerNote: string | null } }>(
      `/admin/users/${userId}/partner`,
      note === undefined ? { partnerId } : { partnerId, note },
    );
    return response.data;
  },

  // Activation funnel (signup → first auto-reply) for the signup cohort in the window
  getActivationFunnel: async (days?: number) => {
    const response = await api.get<{ success: boolean; data: ActivationFunnel }>(
      '/admin/activation-funnel',
      { params: days ? { days } : undefined },
    );
    return response.data.data;
  },

  // Get AI cost breakdown by page for a single user, scoped to a preset period
  getUserAiCost: async (userId: string, period: AdminUserAiCostPeriod = '30d') => {
    const response = await api.get<{ success: boolean; data: AdminUserAiCostReport }>(
      `/admin/users/${userId}/ai-cost`,
      { params: { period } },
    );
    return response.data.data;
  },

  // Global AI consumption + caching across all workspaces (admin AI Cost panel)
  getGlobalAiCost: async (period: AdminUserAiCostPeriod = '30d') => {
    const response = await api.get<{ success: boolean; data: AdminGlobalAiCostReport }>(
      `/admin/ai-cost/consumption`,
      { params: { period } },
    );
    return response.data.data;
  },

  // Authoritative OpenAI billing (from snapshots) for the AI Cost panel
  getAiBilling: async (period: AdminUserAiCostPeriod = '30d') => {
    const response = await api.get<{ success: boolean; data: AdminAiBillingReport }>(
      `/admin/ai-cost/billing`,
      { params: { period } },
    );
    return response.data.data;
  },

  // OpenAI prod-key spend vs our estimate (reconciliation) for the AI Cost panel
  getAiReconciliation: async (period: AdminUserAiCostPeriod = '30d') => {
    const response = await api.get<{ success: boolean; data: AdminAiReconciliation }>(
      `/admin/ai-cost/reconciliation`,
      { params: { period } },
    );
    return response.data.data;
  },

  // OpenAI credit runway + early-warning severity
  getAiRunway: async () => {
    const response = await api.get<{ success: boolean; data: AdminAiRunway }>(`/admin/ai-cost/runway`);
    return response.data.data;
  },

  // Set the OpenAI credit-balance anchor; returns the recomputed runway
  setAiCreditBalance: async (body: { balanceUsd: number; anchoredAt: string; note?: string }) => {
    const response = await api.put<{ success: boolean; data: AdminAiRunway }>(`/admin/ai-cost/balance`, body);
    return response.data.data;
  },

  // On-demand OpenAI cost sync ("Sync now"); { configured:false } when no admin key
  // Needs LONG_RUNNING_TIMEOUT: this pulls a wide (95-day) window from OpenAI's org
  // Costs API grouped by api_key_id + line_item — the slowest external call in the
  // app, and it paginates once history exceeds one page. On the default 15s timeout
  // the browser aborts mid-flight and shows a false "sync failed" even though the
  // backend completes and persists every snapshot. Matches every sibling sync above.
  syncAiCosts: async () => {
    const response = await api.post<{ success: boolean; data: { configured: boolean; synced: number } }>(
      `/admin/ai-cost/sync`,
      undefined,
      { timeout: LONG_RUNNING_TIMEOUT },
    );
    return response.data.data;
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

  // Set or clear per-workspace AI model override. null clears the override
  // so the workspace tracks DEFAULT_AI_MODEL again.
  setUserAiModel: async (userId: string, model: string | null) => {
    const response = await api.patch(`/admin/users/${userId}/ai-model`, { model });
    return response.data as { success: boolean; data?: { aiModel: string | null }; error?: string };
  },

  // Manually credit a top-up pack to a user (audit-logged as manual_topup)
  creditTopup: async (data: {
    userId: string;
    pack: '5k' | '10k';
    source?: 'manual' | 'admin';
    externalRef?: string;
    note?: string;
    // Override the open-pending-Stripe-top-up guard (admin POST /topup) when the
    // admin confirms the credit is unrelated to a stuck card payment.
    force?: boolean;
  }): Promise<{
    success: boolean;
    purchase?: { id: string; pack: '5k' | '10k'; repliesAdded: number };
    newBalance?: number;
    // On failure the backend returns a machine code in `error` (e.g.
    // 'PENDING_STRIPE_TOPUP') and a human-readable explanation in `message`.
    error?: string;
    message?: string;
    pendingPaymentIntentIds?: Array<string | null>;
  }> => {
    try {
      const response = await api.post('/admin/topup', data);
      return response.data;
    } catch (err) {
      // axios rejects on non-2xx — unwrap the backend error body so the caller
      // can surface the real reason (409 pending-Stripe guard, 404, 400, 500)
      // instead of a useless generic message.
      if (axios.isAxiosError(err) && err.response?.data) {
        const body = err.response.data as {
          error?: string;
          message?: string;
          pendingPaymentIntentIds?: Array<string | null>;
        };
        return {
          success: false,
          error: body.error,
          message: body.message,
          pendingPaymentIntentIds: body.pendingPaymentIntentIds,
        };
      }
      throw err; // network/unknown failure — let the caller's catch handle it
    }
  },

  // Generate a hosted Stripe payment link for a custom amount to collect money
  // for an already-granted manual credit. Collect-only — paying it never credits
  // reply balance. Returns the URL to send to the customer.
  createPaymentRequest: async (userId: string, data: {
    amountCents: number;
    currency?: string;
    description?: string;
    topupPurchaseId?: string;
  }) => {
    const response = await api.post(`/admin/users/${userId}/payment-request`, data);
    return response.data as {
      success: boolean;
      data?: { id: string; url: string; amountCents: number; currency: string };
      error?: string;
    };
  },

  // Send an admin-composed account-notice email to one merchant (support console).
  // `attachments[].content` is raw base64 with no `data:` prefix — the backend
  // rejects the prefixed form that FileReader produces. `contentType` is
  // server-derived; do not send it. LONG_RUNNING_TIMEOUT because 6MB of
  // attachments → ~8.4MB wire body, which cannot upload inside the 15s default
  // on ordinary uplinks (same reason as the waitlist send and KB extract).
  // `idempotencyKey` rides to Resend as a dedupe header so a retry after an
  // ambiguous failure cannot deliver the same email twice.
  sendCustomerEmail: async (userId: string, data: {
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Pick<EmailAttachment, 'filename' | 'content'>[];
    idempotencyKey?: string;
  }) => {
    const response = await api.post(`/admin/users/${userId}/send-email`, data, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data as {
      success: boolean;
      data?: { emailSendId?: string };
      error?: string;
      code?: string;
    };
  },

  // History of a customer's collect-payment requests.
  listPaymentRequests: async (userId: string) => {
    const response = await api.get(`/admin/users/${userId}/payment-requests`);
    return response.data as {
      success: boolean;
      data?: Array<{
        id: string;
        amountCents: number;
        currency: string;
        description: string | null;
        status: 'pending' | 'paid' | 'expired';
        stripeCheckoutSessionId: string;
        createdAt: string;
        paidAt: string | null;
      }>;
      error?: string;
    };
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
    const response = await api.post('/admin/ai/playground', data, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },

  // Business Info audit — instructions the AI cannot execute + data defects.
  // Read-only: never writes the KB or re-ingests. Slower than the sibling KB
  // calls on a cache miss (one OpenAI classification), so it gets the long
  // timeout rather than the default.
  auditBusinessInfo: async (pageId: string) => {
    const response = await api.post(`/admin/kb/audit/${pageId}`, undefined, { timeout: LONG_RUNNING_TIMEOUT });
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

  // Waitlist — send email to subscribers
  sendWaitlistEmail: async (data: {
    subject: string;
    body: string;
    feature?: string;
    emailIds?: string[];
    extraEmails?: string[];
    audience?: 'waitlist' | 'users' | 'both' | 'extras';
    // Optional: when set, the backend renders the matching custom-HTML template
    // (AR/EN per recipient) instead of wrapping `body` in the generic shell.
    templateId?: string;
  }) => {
    const response = await api.post('/admin/waitlist/send-email', data, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },

  // Waitlist — list reusable email templates (read-only, code-defined)
  getWaitlistTemplates: async () => {
    const response = await api.get<{
      success: true;
      templates: WaitlistEmailTemplate[];
    }>('/admin/waitlist/templates');
    return response.data;
  },

  // Lead digest — paginated history of sends/skips
  getLeadDigestHistory: async (filters: { page?: number; limit?: number; status?: string }) => {
    const params = new URLSearchParams();
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.status) params.append('status', filters.status);
    const response = await api.get<{
      page: number;
      limit: number;
      rows: Array<LeadDigestSendBase & {
        userId: string;
        leadCount: number;
        lang: 'ar' | 'en' | null;
        resendEmailId: string | null;
        errorMessage: string | null;
        emailSendId: string | null;
      }>;
    }>(`/admin/lead-digest/history?${params.toString()}`);
    return response.data;
  },

  // Generic outbound email log — fetch a single rendered email by id.
  // Works across every email type (lead_digest, waitlist, transactional, …).
  getEmailById: async (id: string) => {
    const response = await api.get<{
      id: string;
      type: string;
      toEmail: string;
      subject: string;
      htmlBody: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
    }>(`/admin/emails/${id}`);
    return response.data;
  },

  // Lead digest — manually trigger the daily run
  runLeadDigest: async () => {
    const response = await api.post<{ processed: number; sent: number; skipped: number; errors: number }>(
      '/admin/lead-digest/run',
    );
    return response.data;
  },
};

// KB File Upload API — extract text from PDF, Word, image
export const kbApi = {
  extractText: async (file: string, mimeType: string, fileName?: string) => {
    const response = await api.post('/kb/extract-text', { file, mimeType, fileName }, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
};

// Voice API — KB voice input transcription
export const voiceApi = {
  transcribe: async (audio: string, mimeType: string = 'audio/webm', languageHint?: string, quality: 'fast' | 'accurate' = 'accurate') => {
    const response = await api.post('/voice/transcribe', { audio, mimeType, languageHint, quality }, { timeout: LONG_RUNNING_TIMEOUT });
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
    const response = await api.post('/shopify/store/connect', { shopDomain }, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/shopify/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/shopify/store/sync', undefined, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  reregisterWebhooks: async () => {
    const response = await api.post('/shopify/store/webhooks/reregister', undefined, { timeout: LONG_RUNNING_TIMEOUT });
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
    const response = await api.post('/salla/store/connect', undefined, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/salla/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/salla/store/sync', undefined, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  reregisterWebhooks: async () => {
    const response = await api.post('/salla/store/webhooks/reregister', undefined, { timeout: LONG_RUNNING_TIMEOUT });
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
  // Easy Mode (App Store install): list the pending install(s) staged by the
  // app.store.authorize webhook for a merchant, so the post-install page can
  // confirm "connect your store '<name>'". merchantId is required (scoped).
  getPendingInstalls: async (merchantId: string): Promise<{ pending: Array<{ id: string; storeDomain: string; storeName: string | null; merchantId: string | null; createdAt: string | null }> }> => {
    const response = await api.get('/salla/store/pending', { params: { merchantId } });
    return response.data;
  },
  claimInstall: async (payload: { pendingId?: string; merchantId?: string }) => {
    const response = await api.post('/salla/store/claim', payload, { timeout: LONG_RUNNING_TIMEOUT });
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
    const response = await api.post('/zid/store/connect', undefined, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  disconnectStore: async () => {
    const response = await api.delete('/zid/store');
    return response.data;
  },
  syncProducts: async () => {
    const response = await api.post('/zid/store/sync', undefined, { timeout: LONG_RUNNING_TIMEOUT });
    return response.data;
  },
  reregisterWebhooks: async () => {
    const response = await api.post('/zid/store/webhooks/reregister', undefined, { timeout: LONG_RUNNING_TIMEOUT });
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

// Order Notifications API
export const orderNotificationsApi = {
  getTemplates: (storeId: string) =>
    api.get<NotificationTemplate[]>(`/notification-templates/${storeId}`),
  updateTemplate: (storeId: string, type: OrderNotificationType, data: Partial<Pick<NotificationTemplate, 'isEnabled' | 'messageAr' | 'messageEn' | 'delayMinutes'>>) =>
    api.put<NotificationTemplate>(`/notification-templates/${storeId}/${type}`, data),
  resetTemplates: (storeId: string) =>
    api.post<{ ok: boolean }>(`/notification-templates/${storeId}/reset`),
  getStats: (storeId: string) =>
    api.get<NotificationStats>(`/notification-log/${storeId}/stats`),
};

// Leads API
export type LeadStatus = 'new' | 'contacted' | 'converted';
export type LeadSourceType = 'message' | 'comment';

// Customizable sub-stages: free-text labels defined per workspace under each
// fixed main status (store: "تم الشحن", clinic: "حجز موعد", school: "سجّل").
export type LeadStageColor = 'blue' | 'amber' | 'emerald' | 'rose' | 'violet' | 'cyan' | 'orange' | 'slate';

export interface LeadSubStage {
  id: string;
  label: string;
  color: LeadStageColor;
}

export type LeadStagesConfig = Partial<Record<LeadStatus, LeadSubStage[]>>;

// Merchant-defined per-lead data fields (e.g. المبلغ المدفوع, الخصم) — the
// definitions live in workspace settings; values are stored on each lead
// keyed by field id.
export interface LeadCustomFieldDef {
  id: string;
  label: string;
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
  /** Id of a workspace-defined sub-stage (see LeadStagesConfig), or null. */
  subStage: string | null;
  /** Merchant-entered values for the workspace's leadFields, keyed by field id. */
  customFields: Record<string, string> | null;
  extractionStatus: 'completed' | 'pending' | 'failed';
  /** Re-engagement: true when an already-handled lead came back (re-shared a
   *  number or showed new purchase intent). Independent of `status`. */
  needsFollowUp: boolean;
  /** Why the lead is flagged for follow-up, or null. */
  followUpReason?: 'reshared_contact' | 'returned_intent' | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadsPaginatedResponse {
  data: Lead[];
  total: number;
}

export const leadsApi = {
  getByPage: (pageId: string, params?: { status?: LeadStatus; needsFollowUp?: boolean; search?: string; limit?: number; offset?: number }) =>
    api.get<LeadsPaginatedResponse>('/leads', { params: { pageId, ...params } }),

  /** Fetch a single lead by id — used by the notification deep-link to open the exact lead. */
  getById: (leadId: string) => api.get<Lead>(`/leads/${leadId}`),

  /** Fetch all leads for export. Bypasses the paginated list's per-request cap so
   *  CSV downloads aren't silently truncated when the merchant has >200 leads. */
  getAllForExport: (pageId: string, status?: LeadStatus) =>
    api.get<{ data: Lead[] }>('/leads/export', { params: { pageId, ...(status ? { status } : {}) } }),

  getCount: (pageId: string) =>
    api.get<{ count: number }>('/leads/count', { params: { pageId } }),

  /** Workspace-wide `new` leads summary — drives the dashboard attention row and
   *  the nav badge. Omits pageId deliberately: the dashboard is workspace-scoped
   *  (like commentsApi.getStats), so a per-page count would hide the other pages'
   *  waiting customers. */
  getNewSummary: () =>
    api.get<{ count: number; latestName: string | null; latestAt: string | null }>('/leads/count'),

  updateStatus: (leadId: string, pageId: string, status: LeadStatus, subStage?: string | null) =>
    api.patch<Lead>(`/leads/${leadId}/status`, { pageId, status, subStage: subStage ?? null }),

  /** Replace the lead's custom field values (send every shown field — cleared inputs delete). */
  updateCustomFields: (leadId: string, pageId: string, fields: Record<string, string>) =>
    api.patch<Lead>(`/leads/${leadId}/fields`, { pageId, fields }),

  deleteLead: (leadId: string, pageId: string) =>
    api.delete(`/leads/${leadId}`, { params: { pageId } }),
};

// Workspace API
export const workspaceApi = {
  list: () => api.get('/workspaces'),
  getCurrent: () => api.get('/workspaces/current'),
  getMembers: () => api.get('/workspaces/current/members'),
  getSettings: () => api.get('/workspaces/current/settings'),
  updateSettings: (data: Record<string, unknown>) => api.put('/workspaces/current/settings', data),
  createInvite: (contact: string, role?: string) =>
    api.post('/workspaces/current/invites', { contact, role }),
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

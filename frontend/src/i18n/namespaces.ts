/**
 * Page → namespace mapping for next-intl namespace splitting.
 *
 * Global namespaces (common, nav, notifications, errors, errorBoundary, meta)
 * are loaded automatically on every page — do NOT list them here.
 *
 * Only list the ADDITIONAL namespaces each page needs.
 */

/** Namespaces used by DashboardLayout (sidebar, nav, upgrade CTA, demo banner) */
const DASHBOARD_LAYOUT = ['auth', 'admin', 'dashboard', 'landing', 'logout', 'pricing', 'sidebar'] as const;

/** Namespaces used by AdminLayout */
const ADMIN_LAYOUT = ['admin'] as const;

export const PAGE_NAMESPACES = {
  // ── Public pages ──────────────────────────────────────────────
  landing:            ['landing', 'pricing', 'dataDeletion'],
  login:              ['auth', 'salla', 'shopify', 'zid'],
  index:              ['landing'],
  whatIsJawab24:      ['about'],
  compare:            ['compare'],
  blog:               ['blog', 'landing'],
  ecommerce:          ['ecommerce'],
  help:               ['help'],

  unsubscribe:        ['unsubscribe'],

  // ── Legal pages ───────────────────────────────────────────────
  terms:              ['terms'],
  privacy:            ['privacy'],
  contact:            ['contact'],
  dataDeletion:       ['dataDeletion', 'settings'],

  // ── Error pages ───────────────────────────────────────────────
  error404:           [],
  error500:           [],

  // ── Auth flow ─────────────────────────────────────────────────
  authCallback:       ['auth'],
  authSync:           ['auth'],
  completeProfile:    ['profile'],
  phoneCollect:       ['auth'],

  // ── Payment flow ──────────────────────────────────────────────
  checkout:           ['checkout', 'payment', 'plans', 'pricing', 'landing', 'topup'],
  paymentSuccess:     ['payment'],
  paymentCancel:      ['payment'],
  paymentReturn:      ['payment'],

  // ── Dashboard pages (include DASHBOARD_LAYOUT) ────────────────
  pricing:            [...DASHBOARD_LAYOUT, 'payment', 'subscription'],
  dashboard:          [...DASHBOARD_LAYOUT, 'comments', 'flagReason', 'feedback', 'kb', 'messages', 'onboarding', 'pages', 'plans', 'postSuggestions', 'settings', 'subscription', 'time', 'topup'],
  // 'settings' is needed by PauseBanner (rendered in Comment/MessageDetailModal)
  // for the duration labels (duration15min, duration30min, …).
  // 'kb' + 'pages' are needed by the in-conversation Business Info editor
  // (InlineKbEditorModal → KnowledgeBaseModal) opened from the needs-attention banner.
  comments:           [...DASHBOARD_LAYOUT, 'comments', 'export', 'flagReason', 'feedback', 'kb', 'messages', 'pages', 'settings'],
  messages:           [...DASHBOARD_LAYOUT, 'comments', 'export', 'flagReason', 'kb', 'messages', 'pages', 'settings'],
  leads:              [...DASHBOARD_LAYOUT, 'leads', 'export'],

  // 'kb' is required by FileUploadButton inside the import sheet.
  catalog:            [...DASHBOARD_LAYOUT, 'catalog', 'pages', 'kb', 'testSmartReply'],
  // /business hosts CatalogManager ('catalog') + KnowledgeBasePanel ('kb', 'pages')
  // + TestSmartReplyModal ('testSmartReply') — every rendered child's namespace
  // must be listed or that page shows raw keys (translation:validate won't catch it).
  business:           [...DASHBOARD_LAYOUT, 'business', 'catalog', 'pages', 'kb', 'testSmartReply'],
  pages:              [...DASHBOARD_LAYOUT, 'kb', 'pages', 'testSmartReply', 'time', 'onboarding'],
  settings:           [...DASHBOARD_LAYOUT, 'settings', 'testSmartReply', 'time', 'logout'],
  team:               [...DASHBOARD_LAYOUT, 'team'],
  integrations:       [...DASHBOARD_LAYOUT, 'integrations', 'orderNotifications', 'ecommerceAnalytics', 'salla', 'shopify', 'zid'],
  ecommerceAnalytics: [...DASHBOARD_LAYOUT, 'ecommerceAnalytics', 'integrations'],

  // ── Admin pages (include ADMIN_LAYOUT) ────────────────────────
  adminWaitlist:      [...ADMIN_LAYOUT],
  adminCustomers:     [...ADMIN_LAYOUT],
  adminCustomerDetail:[...ADMIN_LAYOUT],
  adminPlayground:    [...ADMIN_LAYOUT, 'kb'],
  adminObservability: [...ADMIN_LAYOUT],
  adminAiCost:        [...ADMIN_LAYOUT],

  // ── Partner portal (reseller-facing, standalone layout) ───────
  partner:            ['partner'],

  // ── Integration onboarding ────────────────────────────────────
  shopifyOnboard:     ['shopify', 'integrations', 'onboarding'],
  sallaOnboard:       ['salla', 'integrations', 'onboarding'],
  zidOnboard:         ['zid', 'integrations', 'onboarding'],
  zidEmbedded:        ['zid'],
} as const;

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
  checkout:           ['checkout', 'payment', 'plans', 'pricing', 'landing'],
  paymentSuccess:     ['payment'],
  paymentCancel:      ['payment'],
  paymentReturn:      ['payment'],

  // ── Dashboard pages (include DASHBOARD_LAYOUT) ────────────────
  pricing:            [...DASHBOARD_LAYOUT, 'payment', 'subscription'],
  dashboard:          [...DASHBOARD_LAYOUT, 'comments', 'flagReason', 'feedback', 'kb', 'messages', 'onboarding', 'pages', 'plans', 'subscription', 'time'],
  comments:           [...DASHBOARD_LAYOUT, 'comments', 'export', 'flagReason', 'feedback', 'messages'],
  messages:           [...DASHBOARD_LAYOUT, 'comments', 'export', 'flagReason', 'messages'],
  templates:          [...DASHBOARD_LAYOUT, 'templates'],
  rules:              [...DASHBOARD_LAYOUT, 'rules', 'templates'],
  pages:              [...DASHBOARD_LAYOUT, 'kb', 'pages', 'time', 'onboarding'],
  settings:           [...DASHBOARD_LAYOUT, 'settings', 'team', 'time', 'logout'],
  integrations:       [...DASHBOARD_LAYOUT, 'integrations', 'salla', 'shopify', 'zid'],

  // ── Admin pages (include ADMIN_LAYOUT) ────────────────────────
  adminWaitlist:      [...ADMIN_LAYOUT],
  adminCustomers:     [...ADMIN_LAYOUT],
  adminCustomerDetail:[...ADMIN_LAYOUT],
  adminPlayground:    [...ADMIN_LAYOUT, 'kb'],
  adminObservability: [...ADMIN_LAYOUT],

  // ── Integration onboarding ────────────────────────────────────
  shopifyOnboard:     ['shopify', 'integrations', 'onboarding'],
  sallaOnboard:       ['salla', 'integrations', 'onboarding'],
  zidOnboard:         ['zid', 'integrations', 'onboarding'],
} as const;

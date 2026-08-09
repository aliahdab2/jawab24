/**
 * Shared E2E translation helper.
 * Resolves dot-notation keys against nested translation JSON.
 *
 * Usage:
 *   import { t, tAr } from './i18n';
 *   await page.getByText(t('landing.hero.title1'));
 */

// English namespace files
import enAbout from '../src/i18n/en/about.json';
import enAdmin from '../src/i18n/en/admin.json';
import enAuth from '../src/i18n/en/auth.json';
import enCheckout from '../src/i18n/en/checkout.json';
import enComments from '../src/i18n/en/comments.json';
import enCommon from '../src/i18n/en/common.json';
import enCompare from '../src/i18n/en/compare.json';
import enContact from '../src/i18n/en/contact.json';
import enDashboard from '../src/i18n/en/dashboard.json';
import enDataDeletion from '../src/i18n/en/dataDeletion.json';
import enErrorBoundary from '../src/i18n/en/errorBoundary.json';
import enErrors from '../src/i18n/en/errors.json';
import enExport from '../src/i18n/en/export.json';
import enFeedback from '../src/i18n/en/feedback.json';
import { flagReasonEn as enFlagReason } from '@jawab24/shared';
import enIntegrations from '../src/i18n/en/integrations.json';
import enKb from '../src/i18n/en/kb.json';
import enLeads from '../src/i18n/en/leads.json';
import enLanding from '../src/i18n/en/landing.json';
import enLogout from '../src/i18n/en/logout.json';
import enMessages from '../src/i18n/en/messages.json';
import enMeta from '../src/i18n/en/meta.json';
import enNav from '../src/i18n/en/nav.json';
import enNotifications from '../src/i18n/en/notifications.json';
import enOrderNotifications from '../src/i18n/en/orderNotifications.json';
import enEcommerceAnalytics from '../src/i18n/en/ecommerceAnalytics.json';
import enOnboarding from '../src/i18n/en/onboarding.json';
import enPages from '../src/i18n/en/pages.json';
import enPayment from '../src/i18n/en/payment.json';
import enPlans from '../src/i18n/en/plans.json';
import enPostSuggestions from '../src/i18n/en/postSuggestions.json';
import enPricing from '../src/i18n/en/pricing.json';
import enPrivacy from '../src/i18n/en/privacy.json';
import enProfile from '../src/i18n/en/profile.json';
import enSalla from '../src/i18n/en/salla.json';
import enSettings from '../src/i18n/en/settings.json';
import enShopify from '../src/i18n/en/shopify.json';
import enSidebar from '../src/i18n/en/sidebar.json';
import enSse from '../src/i18n/en/sse.json';
import enSubscription from '../src/i18n/en/subscription.json';
import enTeam from '../src/i18n/en/team.json';
import enTerms from '../src/i18n/en/terms.json';
import enTime from '../src/i18n/en/time.json';

// Arabic namespace files
import arAbout from '../src/i18n/ar/about.json';
import arAdmin from '../src/i18n/ar/admin.json';
import arAuth from '../src/i18n/ar/auth.json';
import arCheckout from '../src/i18n/ar/checkout.json';
import arComments from '../src/i18n/ar/comments.json';
import arCommon from '../src/i18n/ar/common.json';
import arCompare from '../src/i18n/ar/compare.json';
import arContact from '../src/i18n/ar/contact.json';
import arDashboard from '../src/i18n/ar/dashboard.json';
import arDataDeletion from '../src/i18n/ar/dataDeletion.json';
import arErrorBoundary from '../src/i18n/ar/errorBoundary.json';
import arErrors from '../src/i18n/ar/errors.json';
import arExport from '../src/i18n/ar/export.json';
import arFeedback from '../src/i18n/ar/feedback.json';
import { flagReasonAr as arFlagReason } from '@jawab24/shared';
import arIntegrations from '../src/i18n/ar/integrations.json';
import arKb from '../src/i18n/ar/kb.json';
import arLeads from '../src/i18n/ar/leads.json';
import arLanding from '../src/i18n/ar/landing.json';
import arLogout from '../src/i18n/ar/logout.json';
import arMessages from '../src/i18n/ar/messages.json';
import arMeta from '../src/i18n/ar/meta.json';
import arNav from '../src/i18n/ar/nav.json';
import arNotifications from '../src/i18n/ar/notifications.json';
import arOrderNotifications from '../src/i18n/ar/orderNotifications.json';
import arEcommerceAnalytics from '../src/i18n/ar/ecommerceAnalytics.json';
import arOnboarding from '../src/i18n/ar/onboarding.json';
import arPages from '../src/i18n/ar/pages.json';
import arPayment from '../src/i18n/ar/payment.json';
import arPlans from '../src/i18n/ar/plans.json';
import arPostSuggestions from '../src/i18n/ar/postSuggestions.json';
import arPricing from '../src/i18n/ar/pricing.json';
import arPrivacy from '../src/i18n/ar/privacy.json';
import arProfile from '../src/i18n/ar/profile.json';
import arSalla from '../src/i18n/ar/salla.json';
import arSettings from '../src/i18n/ar/settings.json';
import arShopify from '../src/i18n/ar/shopify.json';
import arSidebar from '../src/i18n/ar/sidebar.json';
import arSse from '../src/i18n/ar/sse.json';
import arSubscription from '../src/i18n/ar/subscription.json';
import arTeam from '../src/i18n/ar/team.json';
import arTerms from '../src/i18n/ar/terms.json';
import arTime from '../src/i18n/ar/time.json';

// Merged translation objects keyed by namespace
export const en = {
  about: enAbout, admin: enAdmin, auth: enAuth, checkout: enCheckout,
  comments: enComments, common: enCommon, compare: enCompare, contact: enContact,
  dashboard: enDashboard, dataDeletion: enDataDeletion, errorBoundary: enErrorBoundary,
  errors: enErrors, export: enExport, feedback: enFeedback, flagReason: enFlagReason,
  integrations: enIntegrations, kb: enKb, leads: enLeads, landing: enLanding, logout: enLogout,
  ecommerceAnalytics: enEcommerceAnalytics,
  messages: enMessages, meta: enMeta, nav: enNav, notifications: enNotifications, orderNotifications: enOrderNotifications,
  onboarding: enOnboarding, pages: enPages, payment: enPayment, plans: enPlans,
  postSuggestions: enPostSuggestions,
  pricing: enPricing, privacy: enPrivacy, profile: enProfile,
  salla: enSalla, settings: enSettings, shopify: enShopify, sidebar: enSidebar,
  sse: enSse, subscription: enSubscription, team: enTeam,
  terms: enTerms, time: enTime,
};

export const ar = {
  about: arAbout, admin: arAdmin, auth: arAuth, checkout: arCheckout,
  comments: arComments, common: arCommon, compare: arCompare, contact: arContact,
  dashboard: arDashboard, dataDeletion: arDataDeletion, errorBoundary: arErrorBoundary,
  errors: arErrors, export: arExport, feedback: arFeedback, flagReason: arFlagReason,
  integrations: arIntegrations, kb: arKb, leads: arLeads, landing: arLanding, logout: arLogout,
  ecommerceAnalytics: arEcommerceAnalytics,
  messages: arMessages, meta: arMeta, nav: arNav, notifications: arNotifications, orderNotifications: arOrderNotifications,
  onboarding: arOnboarding, pages: arPages, payment: arPayment, plans: arPlans,
  postSuggestions: arPostSuggestions,
  pricing: arPricing, privacy: arPrivacy, profile: arProfile,
  salla: arSalla, settings: arSettings, shopify: arShopify, sidebar: arSidebar,
  sse: arSse, subscription: arSubscription, team: arTeam,
  terms: arTerms, time: arTime,
};

/** Resolve a dot-notation key from a nested object */
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}

/** Replace {param} placeholders in a translated string */
function interpolate(value: string, params: Record<string, string | number>): string {
  return value.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

/** Get English translation by dot-notation key, with optional interpolation */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = resolve(en as unknown as Record<string, unknown>, key);
  return params ? interpolate(value, params) : value;
}

/** Get Arabic translation by dot-notation key, with optional interpolation */
export function tAr(key: string, params?: Record<string, string | number>): string {
  const value = resolve(ar as unknown as Record<string, unknown>, key);
  return params ? interpolate(value, params) : value;
}

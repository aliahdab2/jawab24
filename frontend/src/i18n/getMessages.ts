import type { GetStaticPropsContext, GetServerSidePropsContext } from 'next';

// ── English namespace imports ─────────────────────────────────────────────────
import enAbout         from './en/about.json';
import enBlog          from './en/blog.json';
import enAdmin         from './en/admin.json';
import enAuth          from './en/auth.json';
import enBusiness      from './en/business.json';
import enCatalog       from './en/catalog.json';
import enCheckout      from './en/checkout.json';
import enComments      from './en/comments.json';
import enCommon        from './en/common.json';
import enCompare       from './en/compare.json';
import enContact       from './en/contact.json';
import enEcommerce    from './en/ecommerce.json';
import enDashboard     from './en/dashboard.json';
import enDataDeletion  from './en/dataDeletion.json';
import enErrorBoundary from './en/errorBoundary.json';
import enErrors        from './en/errors.json';
import enExport        from './en/export.json';
import enFeedback      from './en/feedback.json';
import { flagReasonEn as enFlagReason } from '@jawab24/shared';
import enHelp          from './en/help.json';
import enIntegrations  from './en/integrations.json';
import enKb            from './en/kb.json';
import enLeads         from './en/leads.json';
import enLanding       from './en/landing.json';
import enLogout        from './en/logout.json';
import enMessages      from './en/messages.json';
import enMeta          from './en/meta.json';
import enNav           from './en/nav.json';
import enNotifications from './en/notifications.json';
import enOnboarding    from './en/onboarding.json';
import enPages         from './en/pages.json';
import enPartner       from './en/partner.json';
import enPayment       from './en/payment.json';
import enPlans         from './en/plans.json';
import enPricing       from './en/pricing.json';
import enPrivacy       from './en/privacy.json';
import enProfile       from './en/profile.json';

import enSalla         from './en/salla.json';
import enSettings      from './en/settings.json';
import enShopify       from './en/shopify.json';
import enSidebar       from './en/sidebar.json';
import enSse           from './en/sse.json';
import enSubscription  from './en/subscription.json';
import enPostSuggestions from './en/postSuggestions.json';
import enTeam          from './en/team.json';
import enTerms         from './en/terms.json';
import enTestSmartReply from './en/testSmartReply.json';
import enTime          from './en/time.json';
import enZid           from './en/zid.json';
import enOrderNotifications from './en/orderNotifications.json';
import enEcommerceAnalytics from './en/ecommerceAnalytics.json';
import enUnsubscribe   from './en/unsubscribe.json';
import enTopup         from './en/topup.json';

// ── Arabic namespace imports ──────────────────────────────────────────────────
import arAbout         from './ar/about.json';
import arBlog          from './ar/blog.json';
import arAdmin         from './ar/admin.json';
import arAuth          from './ar/auth.json';
import arBusiness      from './ar/business.json';
import arCatalog       from './ar/catalog.json';
import arCheckout      from './ar/checkout.json';
import arComments      from './ar/comments.json';
import arCommon        from './ar/common.json';
import arCompare       from './ar/compare.json';
import arContact       from './ar/contact.json';
import arEcommerce    from './ar/ecommerce.json';
import arDashboard     from './ar/dashboard.json';
import arDataDeletion  from './ar/dataDeletion.json';
import arErrorBoundary from './ar/errorBoundary.json';
import arErrors        from './ar/errors.json';
import arExport        from './ar/export.json';
import arFeedback      from './ar/feedback.json';
import { flagReasonAr as arFlagReason } from '@jawab24/shared';
import arHelp          from './ar/help.json';
import arIntegrations  from './ar/integrations.json';
import arKb            from './ar/kb.json';
import arLeads         from './ar/leads.json';
import arLanding       from './ar/landing.json';
import arLogout        from './ar/logout.json';
import arMessages      from './ar/messages.json';
import arMeta          from './ar/meta.json';
import arNav           from './ar/nav.json';
import arNotifications from './ar/notifications.json';
import arOnboarding    from './ar/onboarding.json';
import arPages         from './ar/pages.json';
import arPartner       from './ar/partner.json';
import arPayment       from './ar/payment.json';
import arPlans         from './ar/plans.json';
import arPricing       from './ar/pricing.json';
import arPrivacy       from './ar/privacy.json';
import arProfile       from './ar/profile.json';
import arSalla         from './ar/salla.json';
import arSettings      from './ar/settings.json';
import arShopify       from './ar/shopify.json';
import arSidebar       from './ar/sidebar.json';
import arSse           from './ar/sse.json';
import arSubscription  from './ar/subscription.json';
import arPostSuggestions from './ar/postSuggestions.json';
import arTeam          from './ar/team.json';
import arTerms         from './ar/terms.json';
import arTestSmartReply from './ar/testSmartReply.json';
import arTime          from './ar/time.json';
import arZid           from './ar/zid.json';
import arOrderNotifications from './ar/orderNotifications.json';
import arEcommerceAnalytics from './ar/ecommerceAnalytics.json';
import arUnsubscribe   from './ar/unsubscribe.json';
import arTopup         from './ar/topup.json';

// Global namespaces loaded on every page
const GLOBAL_NAMESPACES = ['common', 'nav', 'notifications', 'errors', 'errorBoundary', 'meta', 'sse'];

// Lookup table keyed by "locale/namespace"
const NS: Record<string, Record<string, unknown>> = {
  'en/about': enAbout,           'ar/about': arAbout,
  'en/blog': enBlog,             'ar/blog': arBlog,
  'en/business': enBusiness,     'ar/business': arBusiness,
  'en/catalog': enCatalog,       'ar/catalog': arCatalog,
  'en/admin': enAdmin,           'ar/admin': arAdmin,
  'en/auth': enAuth,             'ar/auth': arAuth,
  'en/checkout': enCheckout,     'ar/checkout': arCheckout,
  'en/comments': enComments,     'ar/comments': arComments,
  'en/common': enCommon,         'ar/common': arCommon,
  'en/compare': enCompare,       'ar/compare': arCompare,
  'en/contact': enContact,       'ar/contact': arContact,
  'en/ecommerce': enEcommerce,   'ar/ecommerce': arEcommerce,
  'en/dashboard': enDashboard,   'ar/dashboard': arDashboard,
  'en/dataDeletion': enDataDeletion, 'ar/dataDeletion': arDataDeletion,
  'en/errorBoundary': enErrorBoundary, 'ar/errorBoundary': arErrorBoundary,
  'en/errors': enErrors,         'ar/errors': arErrors,
  'en/export': enExport,         'ar/export': arExport,
  'en/feedback': enFeedback,     'ar/feedback': arFeedback,
  'en/flagReason': enFlagReason, 'ar/flagReason': arFlagReason,
  'en/help': enHelp,             'ar/help': arHelp,
  'en/integrations': enIntegrations, 'ar/integrations': arIntegrations,
  'en/kb': enKb,                 'ar/kb': arKb,
  'en/leads': enLeads,           'ar/leads': arLeads,
  'en/landing': enLanding,       'ar/landing': arLanding,
  'en/logout': enLogout,         'ar/logout': arLogout,
  'en/messages': enMessages,     'ar/messages': arMessages,
  'en/meta': enMeta,             'ar/meta': arMeta,
  'en/nav': enNav,               'ar/nav': arNav,
  'en/notifications': enNotifications, 'ar/notifications': arNotifications,
  'en/onboarding': enOnboarding, 'ar/onboarding': arOnboarding,
  'en/pages': enPages,           'ar/pages': arPages,
  'en/partner': enPartner,       'ar/partner': arPartner,
  'en/payment': enPayment,       'ar/payment': arPayment,
  'en/plans': enPlans,           'ar/plans': arPlans,
  'en/pricing': enPricing,       'ar/pricing': arPricing,
  'en/privacy': enPrivacy,       'ar/privacy': arPrivacy,
  'en/profile': enProfile,       'ar/profile': arProfile,
  'en/salla': enSalla,           'ar/salla': arSalla,
  'en/settings': enSettings,     'ar/settings': arSettings,
  'en/shopify': enShopify,       'ar/shopify': arShopify,
  'en/sidebar': enSidebar,       'ar/sidebar': arSidebar,
  'en/sse': enSse,               'ar/sse': arSse,
  'en/subscription': enSubscription, 'ar/subscription': arSubscription,
  'en/postSuggestions': enPostSuggestions, 'ar/postSuggestions': arPostSuggestions,
  'en/team': enTeam,             'ar/team': arTeam,
  'en/terms': enTerms,           'ar/terms': arTerms,
  'en/testSmartReply': enTestSmartReply, 'ar/testSmartReply': arTestSmartReply,
  'en/time': enTime,             'ar/time': arTime,
  'en/zid': enZid,               'ar/zid': arZid,
  'en/orderNotifications': enOrderNotifications, 'ar/orderNotifications': arOrderNotifications,
  'en/ecommerceAnalytics': enEcommerceAnalytics, 'ar/ecommerceAnalytics': arEcommerceAnalytics,
  'en/unsubscribe': enUnsubscribe,             'ar/unsubscribe': arUnsubscribe,
  'en/topup': enTopup,                         'ar/topup': arTopup,
};

// All namespace names (derived from lookup table keys)
const ALL_NAMESPACE_NAMES = [...new Set(
  Object.keys(NS).filter(k => k.startsWith('en/')).map(k => k.replace('en/', '')),
)];

/** Load and merge namespace files for a locale */
export function loadNamespaces(locale: string, namespaces: string[]) {
  const all = [...new Set([...GLOBAL_NAMESPACES, ...namespaces])];
  return Object.fromEntries(
    all.map((ns) => [ns, NS[`${locale}/${ns}`] ?? {}]),
  );
}

/** Load ALL namespace translations for a locale (used for mobile client-side switching) */
export function loadAllNamespaces(locale: string) {
  return loadNamespaces(locale, ALL_NAMESPACE_NAMES);
}

/**
 * Load translations for getStaticProps / getServerSideProps.
 * Pass `namespaces` to load only specific top-level keys (+ globals).
 */
export async function getI18nProps(
  ctx: GetStaticPropsContext | GetServerSidePropsContext,
  namespaces: string[],
) {
  const locale = ctx.locale || 'ar';
  return { messages: loadNamespaces(locale, namespaces) };
}

/**
 * Factory: creates a getStaticProps that loads only the given namespaces.
 * Usage: export const getStaticProps = makeGetStaticProps(['landing', 'pricing']);
 */
export function makeGetStaticProps(namespaces: string[]) {
  return async (ctx: GetStaticPropsContext) => ({
    props: await getI18nProps(ctx, namespaces),
  });
}

/**
 * Factory: creates a getServerSideProps that loads only the given namespaces.
 */
export function makeGetServerSideProps(namespaces: string[]) {
  return async (ctx: GetServerSidePropsContext) => ({
    props: await getI18nProps(ctx, namespaces),
  });
}

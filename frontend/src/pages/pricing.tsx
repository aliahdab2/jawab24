import { useState, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import Head from 'next/head';
import type { GetStaticProps } from 'next';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
// Direct imports, NOT the '@/components/ui' barrel (43 re-exports). This is
// the paid-ads landing page, so its bundle is the first thing a bought click
// waits on. The barrel reaches FeedSnippet/FlagTag/CtaButtonPill ->
// '@jawab24/shared', which is CommonJS and cannot be tree-shaken: one named
// import pulls zod + libphonenumber-js. Same fix as the landing (#810).
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { UpgradeCTA } from '@/components/ui/UpgradeCTA';
import { subscriptionApi, publicApi } from '@/lib/api';
import { extractObjectData } from '@/lib/api-utils';
import { useTranslations, useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store';
// Direct import, not the '@/hooks' barrel — public page (see DashboardLayout.tsx).
import { useIOSPaymentRedirect } from '@/hooks/useIOSPaymentRedirect';
import { useSelectPlan } from '@/hooks/useSelectPlan';
import { useLocalPaymentRail } from '@/hooks/useLocalPaymentRail';
import { Check, X, Zap, Crown, Sparkles, ChevronDown, Star } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';
import { isUserSanctionedNonBlocking } from '@/utils/geoCheck';
import { isWhatsAppMarketable } from '@/lib/featureFlags';
import { FALLBACK_PLANS } from '@/data/fallbackPlans';
import { captureError } from '@/lib/sentryHelpers';
import type { NextPageWithLayout } from './_app';
import { ShopifyIcon, SallaIcon, ZidIcon } from '@/components/landing/LandingHero';
import { getDisplayPrice, getMonthlyEquivalent, getAnnualSavings, getSarMonthlyEquivalent, formatUsd, planAccentClasses, planBadgeGradient } from '@/utils/pricing';
import { SanctionedCtaFallback } from '@/components/billing/SanctionedCtaFallback';
import { getMarketplaceBilling, MARKETPLACE_COPY, openMarketplaceManageUrl, visiblePlansFor } from '@/lib/marketplaceBilling';
import { PlanTabSelector } from '@/components/billing/PlanTabSelector';

interface PricingPageProps {
  plans: Plan[];
}

// FAQ entries rendered on the page AND emitted as FAQPage JSON-LD — keep in
// sync with the faq<N>Q/faq<N>A keys in i18n/{en,ar}/pricing.json.
const FAQ_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];


function PlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  onSelect,
  loading,
  currentPlanPrice,
  subscriptionStatus,
  isSanctioned,
  hasLocalRail,
  billingInterval,
  locale,
  whatsappMarketable,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  hasActiveSubscription: boolean;
  onSelect: () => void;
  loading: boolean;
  currentPlanPrice: number;
  subscriptionStatus?: string;
  isSanctioned: boolean;
  /** Sanctioned, but a local rail exists (Syria → Sham Cash): keep the real CTA
   *  and let /checkout render the offline panel. */
  hasLocalRail: boolean;
  billingInterval: 'month' | 'year';
  locale?: string;
  /** Whether to advertise WhatsApp on the plan cards. False for a Zid-connected
   *  account, which can never use the channel (D-117), so the cards read
   *  "Facebook & Instagram" — never mention a channel the account can't have. */
  whatsappMarketable: boolean;
}) {
  const tPricing = useTranslations('pricing');
  const tPayment = useTranslations('payment');
  const tLanding = useTranslations('landing');
  const t = (key: string, params?: Record<string, string | number>): string => {
    const dot = key.indexOf('.');
    if (dot < 0) return key;
    const ns = key.slice(0, dot);
    const k = key.slice(dot + 1);
    if (ns === 'pricing') return params ? tPricing(k, params) : tPricing(k);
    if (ns === 'payment') return params ? tPayment(k, params) : tPayment(k);
    return params ? tLanding(k, params) : tLanding(k);
  };

  const isPopular = plan.slug === 'business';
  const isFree = plan.price === 0;
  // A plan without a yearly Stripe price is always displayed (and billed) as
  // monthly, even when the page toggle is on "year" — the backend refuses
  // yearly checkout for it (YEARLY_NOT_AVAILABLE), so advertising an annual
  // total here would promise a price that cannot be charged.
  const cardInterval = plan.yearlyAvailable ? billingInterval : 'month';
  const isAnnual = cardInterval === 'year';

  const displayPrice = !isFree ? getDisplayPrice(plan.price, cardInterval, plan.yearlyPrice) : 0;
  const monthlyEquivalent = !isFree ? getMonthlyEquivalent(plan.price, cardInterval, plan.yearlyPrice) : 0;

  const planName = tPricing(plan.slug);
  const planDescription = tPricing(`${plan.slug}Desc`);

  // Format price
  const formatPrice = (price: number) => formatUsd(price, locale);

  const sarMonthly = !isFree ? getSarMonthlyEquivalent(plan.price, cardInterval, plan.yearlyPrice) : 0;

  const isPro = plan.slug === 'pro';

  // CTA prominence follows the ACTION, not the plan: upgrades/new subscriptions
  // get the solid primary button; downgrades and the current plan stay quiet so
  // the eye lands on the action we want to encourage.
  const isDowngrade = hasActiveSubscription && !isCurrentPlan && plan.price <= currentPlanPrice;
  const ctaProminent = !isCurrentPlan && !isDowngrade && !isFree;

  // Color identity from the shared helper; layout emphasis (scale/z) stays local.
  const accentClasses = planAccentClasses(
    isCurrentPlan ? 'current' : (isPopular && !isCurrentPlan) ? 'blue' : isPro ? 'amber' : 'plain',
  );
  const emphasis = isCurrentPlan || (isPopular && !isCurrentPlan)
    ? 'md:scale-105 z-10'
    : isPro
      ? 'md:scale-[1.02] z-[5]'
      : '';
  const highlightClasses = clsx(accentClasses.ring, emphasis);

  return (
    <Card
      className={`relative flex flex-col h-full transition-all duration-300 hover:shadow-[0_12px_24px_rgba(0,0,0,0.12)] hover:-translate-y-1 ${highlightClasses} ${accentClasses.surface}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-4 start-0 end-0 flex justify-center z-20">
          <span className={`${planBadgeGradient('blue')} text-[13px] font-bold px-4 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap uppercase tracking-wider`}>
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {t('pricing.popular')}
          </span>
        </div>
      )}

      {/* Pro/Premium badge */}
      {isPro && !isCurrentPlan && (
        <div className="absolute -top-4 start-0 end-0 flex justify-center z-20">
          <span className={`${planBadgeGradient('amber')} text-[13px] font-bold px-4 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap uppercase tracking-wider`}>
            <Crown className="w-3.5 h-3.5" />
            {t('pricing.premium')}
          </span>
        </div>
      )}

      {/* Current plan badge - centered at top */}
      {isCurrentPlan && (
        <div className="absolute top-4 start-0 end-0 flex justify-center">
          <span className="inline-flex items-center gap-2 status-success border text-[10px] font-bold px-3 py-1 rounded-full shadow-sm">
            <Check className="w-2.5 h-2.5" />
            {t('pricing.currentPlan')}
            {subscriptionStatus === 'trialing' && (
              <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded text-[10px] font-black uppercase tracking-wider shadow-sm">
                {t('pricing.trial') !== 'pricing.trial' ? t('pricing.trial') : 'TRIAL'}
              </span>
            )}
          </span>
        </div>
      )}

      <div className={clsx('text-center mb-1 md:mb-3 px-3', isCurrentPlan ? 'pt-10' : 'pt-2 md:pt-4')}>
        <div className={`w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 rounded-xl flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${plan.slug === 'free' || plan.slug === 'basic' ? 'icon-bg-slate' :
          plan.slug === 'starter' ? 'icon-bg-blue' :
            plan.slug === 'business' ? 'icon-bg-brand' :
              'icon-bg-amber'
          }`} style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
          {plan.slug === 'free' || plan.slug === 'basic' || plan.slug === 'starter' ? (
            <Zap className="w-5 h-5 md:w-6 md:h-6" />
          ) : plan.slug === 'pro' ? (
            <Crown className="w-5 h-5 md:w-6 md:h-6" />
          ) : (
            <Sparkles className="w-5 h-5 md:w-6 md:h-6" />
          )}
        </div>
        <h3 className="text-lg md:text-xl font-bold text-foreground tracking-tight mb-1">{planName}</h3>
        {planDescription && (
          <p className="text-xs md:text-sm text-muted-foreground leading-relaxed min-h-[32px] px-2">{planDescription}</p>
        )}
      </div>

      {/* Price */}
      <div className="text-center mb-2 md:mb-4 py-1.5 md:py-3 bg-background/50 rounded-xl mx-3">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl md:text-4xl font-extrabold text-foreground">
            {isFree ? '$0' : isAnnual ? formatPrice(monthlyEquivalent) : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-muted-foreground text-sm font-medium">{t('pricing.perMonth')}</span>
          )}
        </div>
        {isAnnual && !isFree && (
          <>
            <p className="text-xs text-muted-foreground mt-1">
              {t('pricing.billedYearly', { amount: formatPrice(displayPrice) })}
            </p>
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full border border-green-200">
                {t('pricing.annualSavingsAmount', { amount: formatPrice(getAnnualSavings(plan.price, plan.yearlyPrice)) })}
              </span>
            </div>
          </>
        )}
        {!isFree && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('pricing.sarEquivalent', { amount: sarMonthly.toLocaleString() })}
          </p>
        )}
        {/* Trial badge — inside the card, visible on all breakpoints */}
        {plan.trialDays > 0 && !hasActiveSubscription && (
          <div className="inline-flex items-center gap-1.5 bg-brand-100 text-brand-700 dark:text-brand-400 text-xs font-semibold mt-3 px-3 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            {t('pricing.trialDays', { days: plan.trialDays })}
          </div>
        )}
      </div>

      {/* Features */}
      <div className="space-y-1 px-3 flex-1">
        {/* Post Replies first — unlimited on every plan, the acquisition hook */}
        <FeatureRow
          included={true}
          highlight={true}
          text={t('pricing.featurePostRepliesUnlimited')}
          subtext={t('pricing.featurePostRepliesIncluded')}
        />

        <FeatureRow
          included={true}
          text={plan.maxPages === null ? t('pricing.featurePagesUnlimited') : t('pricing.featurePages', { count: plan.maxPages })}
          subtext={whatsappMarketable && plan.whatsappEnabled
            ? t('pricing.facebookInstagramWhatsapp')
            : t('pricing.facebookInstagram')}
        />

        <FeatureRow
          included={true}
          text={plan.maxAiRepliesPerMonth === null ? t('pricing.featureAiRepliesUnlimited') : t('pricing.featureAiReplies', { count: plan.maxAiRepliesPerMonth })}
          subtext={t('pricing.aiPowered')}
        />

        {/* WhatsApp is a Business+ entitlement — crossed out on Starter as an
            upsell. Hidden entirely until public launch (isWhatsAppMarketable). */}
        {whatsappMarketable && (
          <FeatureRow
            included={plan.whatsappEnabled}
            text={t('pricing.featureWhatsApp')}
            subtext={plan.whatsappEnabled ? t('pricing.featureWhatsAppDesc') : undefined}
          />
        )}

        {plan.ecommerceEnabled && (
          <FeatureRow
            included={true}
            text={t('pricing.ecommerceIntegration')}
            subtext={t('pricing.ecommerceBadgePlatforms')}
            subtextIcons={
              <>
                <ShopifyIcon className="w-3 h-3 md:w-3.5 md:h-3.5 flex-shrink-0" />
                <SallaIcon className="w-3 h-3 md:w-3.5 md:h-3.5 flex-shrink-0 text-[#00b4b6]" />
                <ZidIcon className="w-3 h-3 md:w-3.5 md:h-3.5 flex-shrink-0" />
              </>
            }
          />
        )}

        {plan.prioritySupport && (
          <FeatureRow
            included={true}
            text={t('pricing.prioritySupport')}
          />
        )}

      </div>

      {/* CTA */}
      <div className="mt-auto pt-1.5 md:pt-3 px-3 pb-1">
        {isSanctioned && !hasLocalRail ? (
          <SanctionedCtaFallback />
        ) : (
          <Button
            onClick={onSelect}
            loading={loading}
            disabled={isCurrentPlan}
            variant={ctaProminent ? 'primary' : 'secondary'}
            className="w-full py-3 text-sm rounded-xl transition-all duration-300"
          >
            {isCurrentPlan ? (
              <div className="flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                <span className="font-bold">{t('pricing.currentPlan')}</span>
                {(subscriptionStatus === 'trialing' || (isCurrentPlan && plan.price === 0 && plan.trialDays > 0)) && (
                  <span className="text-[10px] alert-warning border px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                    {t('pricing.trial') !== 'pricing.trial' ? t('pricing.trial') : 'TRIAL'}
                  </span>
                )}
              </div>
            ) : hasActiveSubscription
              ? (plan.price > currentPlanPrice ? t('pricing.upgrade') : t('pricing.downgrade'))
              : (isFree)
                ? t('pricing.getStarted')
                : (plan.trialDays > 0)
                  ? t('pricing.startTrial')
                  : t('pricing.subscribe')
            }
          </Button>
        )}
      </div>
    </Card>
  );
}

function FeatureRow({
  included,
  text,
  subtext,
  subtextIcons,
  highlight
}: {
  included: boolean;
  text: string;
  subtext?: string;
  subtextIcons?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2.5 py-0.5 md:py-1 px-1 rounded-lg transition-colors ${highlight ? 'bg-brand-50/30 dark:bg-brand-900/20' : ''}`}>
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${included ? 'icon-bg-emerald' : 'bg-muted text-icon-muted'
        }`}>
        {included ? (
          <Check className="w-3 h-3 stroke-[3]" />
        ) : (
          <X className="w-3 h-3 stroke-[3]" />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-xs md:text-sm font-semibold leading-snug text-start ${included ? 'text-muted-foreground' : 'text-muted-foreground line-through decoration-surface-300'
          }`}>
          {text}
        </span>
        {(subtext || subtextIcons) && (
          <span className="flex items-center gap-1.5 text-[10px] md:text-xs text-muted-foreground font-medium mt-0.5 text-start">
            {subtextIcons}
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}

const PricingPage: NextPageWithLayout<PricingPageProps> = ({ plans: serverPlans }) => {
  const locale = useLocale();
  const iosRedirecting = useIOSPaymentRedirect();

  const tPricing = useTranslations('pricing');
  const tSub = useTranslations('subscription');
  const t = (key: string, params?: Record<string, string | number>): string => {
    const dot = key.indexOf('.');
    if (dot < 0) return key;
    const ns = key.slice(0, dot);
    const k = key.slice(dot + 1);
    if (ns === 'pricing') return params ? tPricing(k, params) : tPricing(k);
    return params ? tSub(k, params) : tSub(k);
  };
  const { isAuthenticated } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>(serverPlans);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [isSanctioned, setIsSanctioned] = useState<boolean>(false);
  // Set once the geo check below has answered, so the local-rail hook can read
  // the country it cached instead of issuing a second /geo/check.
  const [geoResolved, setGeoResolved] = useState(false);
  const hasLocalRail = useLocalPaymentRail(geoResolved);
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Which marketplace — if any — owns this account's paid plans (D-073). Read
  // from the one field the backend's guard computes, so this page and the
  // useSelectPlan refusal can never disagree about who is billed where.
  const marketplaceBilling = getMarketplaceBilling(usage);

  // WhatsApp copy on the plan cards is suppressed for a Zid-connected account:
  // it can never use the channel (D-117), so the cards must not advertise it.
  // Layered on the existing marketing flag rather than replacing it.
  const whatsappMarketable = isWhatsAppMarketable() && !usage?.subscription?.whatsappUnavailable;

  // Yearly billing is only offered when at least one paid plan actually has a
  // yearly Stripe price. Without this gate the toggle promised "save ~17%"
  // while the backend could only charge the monthly price. A marketplace bills
  // monthly only, so the toggle is meaningless there.
  const yearlyOffered = useMemo(
    () => !marketplaceBilling && plans.some(p => p.isActive !== false && p.price > 0 && p.yearlyAvailable),
    [plans, marketplaceBilling]
  );
  const effectiveInterval = yearlyOffered ? billingInterval : 'month';

  // Plan-selection flow (native redirect, owner gate, sanctions, free-plan,
  // change-plan-vs-checkout) lives in the shared hook — same logic as /pricing/scale.
  const {
    changingPlan,
    handleSelectPlan,
    showDowngradeDialog,
    closeDowngradeDialog,
    downgradeLoading,
    handleDowngradeConfirm,
  } = useSelectPlan({ plans, usage, billingInterval: effectiveInterval });

  // Client-side: fetch real plans if ISR served fallback data
  useEffect(() => {
    const isFallback = serverPlans.some(p => p.id.startsWith('fallback-'));
    if (!isFallback) return;

    const fetchPlans = async () => {
      try {
        const response = await publicApi.get('/plans');
        const realPlans: Plan[] = response.data.data ?? [];
        if (realPlans.length > 0) {
          setPlans(realPlans);
        }
      } catch {
        // Keep fallback plans — better than nothing
      }
    };

    fetchPlans();
  }, [serverPlans]);

  // Client-side: fetch user-specific data (subscription, usage, geo)
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const [geoResult, usageResult] = await Promise.all([
          isUserSanctionedNonBlocking(1000).catch(() => ({ sanctioned: false, cached: false, timedOut: true })),
          isAuthenticated ? subscriptionApi.getUsage({ timeout: 3000 }).catch(() => null) : Promise.resolve(null),
        ]);

        setIsSanctioned(geoResult.sanctioned);
        setGeoResolved(true);

        if (usageResult?.data) {
          setUsage(extractObjectData<UsageSummary>(usageResult.data));
        }
      } catch (error) {
        captureError(error, 'Failed to load user data', { tags: { page: 'pricing' } });
      }
    };

    fetchUserData();
  }, [isAuthenticated]);

  // Active plans — and, for a marketplace-billed merchant, only the plans that
  // marketplace actually sells (see visiblePlansFor).
  const activePlans = useMemo(() => visiblePlansFor(plans, marketplaceBilling), [plans, marketplaceBilling]);

  // Use slug for plan matching — slugs are stable ('starter', 'business', 'pro'),
  // whereas plan.id is a UUID that differs between environments and after re-seeding.
  // A plan whose entitlement has lapsed is NOT this merchant's "current plan":
  // marking it so disables its card and stamps a green ✅ "Current Plan" badge on
  // it. That dead-ends the one journey that matters here — the dashboard's
  // "Renew subscription" CTA lands on this page, and the only plan that would
  // restore replies was greyed out, with a third green surface telling a frozen
  // merchant they were fine. Read from the gate, the same field the banner uses.
  const currentPlanSlug = usage?.subscription?.autoReply?.allowed === false
    ? undefined
    : usage?.subscription?.plan?.slug;
  const hasActiveSubscription = Boolean(currentPlanSlug);

  // Current plan price for upgrade/downgrade comparison — O(1) lookup per render
  const currentPlanPrice = useMemo(
    () => activePlans.find(p => p.slug === currentPlanSlug)?.price ?? 0,
    [activePlans, currentPlanSlug]
  );

  // --- Mobile tab state --- (tab bar + keyboard nav live in the shared PlanTabSelector)
  const [activeTab, setActiveTab] = useState(0);

  const popularIndex = useMemo(
    () => {
      const idx = activePlans.findIndex(p => p.slug === 'business');
      return idx >= 0 ? idx : 0;
    },
    [activePlans]
  );

  // Default to popular plan tab on mount
  useEffect(() => { setActiveTab(popularIndex); }, [popularIndex]);

  if (iosRedirecting) return null;

  return (
    <>
      <Head>
        <title>{t('pricing.seoTitle')}</title>
        <meta name="description" content={t('pricing.seoDescription')} />
        <meta key="og:title" property="og:title" content={t('pricing.ogTitle')} />
        <meta key="og:description" property="og:description" content={t('pricing.ogDescription')} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": FAQ_IDS.map(i => ({
              "@type": "Question",
              "name": t(`pricing.faq${i}Q`),
              "acceptedAnswer": {
                "@type": "Answer",
                "text": t(`pricing.faq${i}A`),
              },
            })),
          }) }}
        />
      </Head>
        <div>

        {/* Usage Summary if subscribed - Inline */}
        {usage?.subscription?.plan && (
          <div className="max-w-4xl mx-auto mt-1 lg:mt-2 mb-2 lg:mb-4">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-8 py-2 sm:py-3.5 px-4 sm:px-6 bg-card rounded-2xl border border-brand-100 shadow-sm">
              {/* Plan Info */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shadow-inner">
                  <Crown className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-foreground">
                    {tPricing(usage.subscription.plan.slug)}
                  </span>
                  {usage.subscription.status === 'trialing' && (
                    <span className="px-2 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black uppercase tracking-wider shadow-sm">
                      {tPricing('trial')}
                    </span>
                  )}
                </div>
              </div>

              {/* Vertical Divider (desktop only) */}
              <div className="hidden sm:block w-px h-6 bg-theme-border" />

              {/* Usage Stats */}
              <div className="flex items-center gap-3 sm:gap-6 text-sm">
                <div className="flex flex-row items-center gap-1 sm:gap-2">
                  <span className="text-muted-foreground font-medium">{t('pricing.repliesUsed')}</span>
                  <span className="font-bold text-brand-600">
                    {usage.aiReplies.used} / {usage.aiReplies.limit || '∞'}
                  </span>
                </div>

                {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 ? (
                  <>
                    <div className="w-px h-4 bg-theme-border" />
                    <div className="flex items-center gap-1.5 alert-warning border px-3 py-1 rounded-full font-bold">
                      <Zap className="w-3.5 h-3.5 fill-amber-500" />
                      {t('pricing.daysLeftCount', { count: usage.subscription.trialDaysRemaining })}
                    </div>
                  </>
                ) : usage.currentPeriod?.end ? (
                  <>
                    <div className="w-px h-4 bg-theme-border" />
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="font-medium">{t('subscription.quotaResetsOn')}</span>
                      <span className="font-bold text-foreground/70">
                        {new Date(usage.currentPeriod.end).toLocaleDateString(locale === 'ar' ? 'ar-u-nu-latn' : 'en', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {/* A marketplace owns this account's paid plans (D-073). The grid
                below shows only the plans that marketplace sells, and every
                select action is refused by the useSelectPlan guard — say so up
                front, and offer the destination when there is one. Salla has no
                plan to manage; Zid's is the plans page of our app inside the
                merchant's dashboard (observed 2026-08-30). */}
            {marketplaceBilling && (
              <div className="mt-2 flex flex-col sm:flex-row items-center justify-center gap-2 py-2.5 px-4 alert-violet border rounded-2xl text-sm">
                <span className="font-medium">
                  {tPricing(MARKETPLACE_COPY[marketplaceBilling.marketplace].body)}
                </span>
                {marketplaceBilling.manageUrl && (
                  // Not a raw anchor: inside the platform frame this navigates
                  // the dashboard that frames us; on native it must open in the
                  // system browser / Custom Tab (same path as useSelectPlan).
                  <button
                    type="button"
                    onClick={() => { void openMarketplaceManageUrl(marketplaceBilling.manageUrl!, locale); }}
                    className="font-bold underline underline-offset-2 whitespace-nowrap"
                  >
                    {tPricing('marketplaceManageCta', {
                      marketplace: tPricing(MARKETPLACE_COPY[marketplaceBilling.marketplace].name),
                    })}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Page title */}
        <div className="text-center px-4 pt-8 sm:pt-10 md:pt-12 mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-5xl font-display font-bold text-foreground leading-tight max-w-4xl mx-auto">
            {t('pricing.choosePlan')}
          </h1>
          {/* Social proof — desktop/tablet only, saves vertical space on mobile */}
          <div className="hidden sm:flex items-center justify-center gap-2 mt-3">
            <div className="flex" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
              ))}
            </div>
            <span className="text-sm font-bold text-foreground/70">{t('pricing.socialProofRating')}</span>
            <span className="text-subtle" aria-hidden="true">·</span>
            <span className="text-sm text-muted-foreground">{t('pricing.socialProofReviews')}</span>
          </div>
        </div>

        {/* Billing interval toggle — hidden while no plan can actually be
            billed yearly (no yearly Stripe price), so the "save ~17%" promise
            is only shown when it can be honored. */}
        {yearlyOffered && (
        <div className="flex justify-center mb-3 sm:mb-8 lg:mb-12">
          <div className="inline-flex items-center p-1 bg-muted rounded-xl border border-theme-border shadow-inner">
            <button
              type="button"
              onClick={() => setBillingInterval('month')}
              aria-pressed={billingInterval === 'month'}
              className={`min-h-[40px] px-5 py-2 text-sm font-semibold rounded-[10px] transition-all duration-200 ${billingInterval === 'month' ? 'bg-card text-foreground shadow-sm ring-1 ring-theme-border' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval('year')}
              aria-pressed={billingInterval === 'year'}
              className={`min-h-[40px] px-5 py-2 text-sm font-semibold rounded-[10px] transition-all duration-200 flex items-center gap-2 ${billingInterval === 'year' ? 'bg-card text-foreground shadow-sm ring-1 ring-theme-border' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('pricing.yearly')}
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500 text-white whitespace-nowrap">
                {t('pricing.savePercent')}
              </span>
            </button>
          </div>
        </div>
        )}

        {/* Plan tabs — mobile only (Shopify-style segmented control) */}
        <PlanTabSelector
          tabs={activePlans.map((plan) => ({ key: plan.slug, label: tPricing(plan.slug) }))}
          activeIndex={activeTab}
          onChange={setActiveTab}
          locale={locale}
          ariaLabel={t('pricing.planTabs')}
        />

        {/* Plans — single container: stacked grid on mobile, multi-col grid on md+ */}
        <div
          className={clsx(
            // Mobile: single-cell grid so all cards overlap — tallest sets height
            'grid px-4 pt-1 pb-4',
            // Desktop: multi-column grid
            'md:px-6 md:pt-0 md:pb-8',
            'md:gap-6 lg:gap-8 md:items-stretch',
            // The full column count waits for `xl`, NOT `lg`. `lg` (1024px) is the
            // exact width at which DashboardLayout reveals its 256px sidebar and
            // offsets this content by `lg:ms-64` — so a `lg:` column count is
            // asking the viewport for room the container does not have. Measured
            // on iPad Pro 13" portrait (1024x1366), signed in: `lg:grid-cols-4`
            // produced FOUR 136px cards, one Arabic word per line, prices spilling
            // past the card border. At `xl` the sidebar is already paid for.
            // Pinned by src/__tests__/styles/dashboardGridBreakpoint.test.ts.
            activePlans.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-3',
            // A marketplace's two plans: two comfortable columns, not two cards
            // stretched across a four-card track.
            activePlans.length === 2 && 'xl:max-w-3xl',
            'max-w-7xl md:mx-auto lg:px-0',
          )}
        >
          {activePlans.map((plan, index) => (
            <div
              key={plan.id}
              id={`plan-panel-${plan.slug}`}
              // Pairs with the mobile tab (role="tab", id plan-tab-<slug>) in
              // PlanTabSelector to complete the WAI-ARIA tabs pattern. On md+ the
              // tablist is hidden and these are just grid cards; the labelledby
              // still gives each card an accessible name from the (hidden) tab text.
              role="tabpanel"
              aria-labelledby={`plan-tab-${plan.slug}`}
              className={clsx(
                // Mobile: all cards in same cell, only active one visible
                'col-start-1 row-start-1 md:col-auto md:row-auto',
                index !== activeTab && 'hidden md:block',
              )}
            >
              <PlanCard
                plan={plan}
                isCurrentPlan={plan.slug === currentPlanSlug}
                hasActiveSubscription={hasActiveSubscription}
                onSelect={() => handleSelectPlan(plan.id)}
                loading={changingPlan === plan.id}
                currentPlanPrice={currentPlanPrice}
                subscriptionStatus={usage?.subscription?.status}
                isSanctioned={isSanctioned === true}
                hasLocalRail={hasLocalRail}
                billingInterval={effectiveInterval}
                locale={locale}
                whatsappMarketable={whatsappMarketable}
              />
            </div>
          ))}
        </div>

        {/* Trust bar */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-4 px-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" aria-hidden="true" />
            {t('pricing.noCreditCard')}
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" aria-hidden="true" />
            {t('pricing.trustCancelAnytime')}
          </span>
        </div>

        {/* High-volume / Scale plans — discreet link for customers who outgrow Pro.
            Routes to the hidden /pricing/scale page; self-gates on iOS via UpgradeCTA. */}
        <div className="text-center pb-2">
          <UpgradeCTA href="/pricing/scale" className="inline-block">
            <span className="text-sm text-muted-foreground">
              {t('pricing.needMoreThanProTitle')}{' '}
              <span className="text-brand-600 font-semibold hover:underline">{t('pricing.needMoreThanProLink')}</span>
            </span>
          </UpgradeCTA>
        </div>

        {/*
          FAQ Section.

          `id="faq"` is a LINK TARGET, not decoration: the Google Ads campaign's
          «الأسئلة الشائعة» sitelink points at /pricing#faq, and without this the
          anchor resolved to nothing and dropped a paid click at the top of the
          plan grid instead of on the answers it promised. Verified missing on
          production 2026-08-20 — the section existed, the anchor did not.
          scroll-mt clears the sticky public header so the heading is not hidden
          underneath it on arrival.
        */}
        <div id="faq" className="scroll-mt-24 max-w-3xl mx-auto px-4 pb-12 pt-10 sm:pt-12">
          <h2 className="text-xl font-bold text-foreground text-center mb-6">
            {t('pricing.faqTitle')}
          </h2>
          <div className="space-y-3">
            {FAQ_IDS.map((i) => {
              const qKey = `pricing.faq${i}Q`;
              const aKey = `pricing.faq${i}A`;
              const faqPanelId = `pricing-faq-panel-${i}`;
              const question = t(qKey);
              // Skip if translation key is missing (returns the key itself)
              if (question === qKey) return null;
              return (
                <div key={i} className="border border-theme-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    aria-expanded={openFaq === i}
                    aria-controls={faqPanelId}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-start hover:bg-background transition-colors"
                  >
                    <span className="text-sm font-semibold text-foreground">{question}</span>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    id={faqPanelId}
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${openFaq === i ? 'max-h-96' : 'max-h-0'}`}
                  >
                    <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
                      {t(aKey)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>

      <ConfirmationModal
        isOpen={showDowngradeDialog}
        onClose={closeDowngradeDialog}
        onConfirm={handleDowngradeConfirm}
        title={tPricing('downgradeToFreeTitle')}
        message={tPricing('downgradeToFreeMessage')}
        confirmText={tPricing('downgradeToFreeConfirm')}
        variant="warning"
        loading={downgradeLoading}
      />
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
PricingPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Pricing" isPublic skipTitle>{page}</DashboardLayout>
);

export default PricingPage;

/**
 * ISR: Fetch plans server-side at build time, revalidate hourly.
 * Database is the single source of truth — no code changes needed to update prices.
 */
export const getStaticProps: GetStaticProps<PricingPageProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.pricing]);

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
    const res = await fetch(`${apiUrl}/plans`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`API responded with ${res.status}`);
    const json = await res.json();
    const plans: Plan[] = json.data ?? [];

    return {
      props: { plans, ...i18nProps },
      // ISR: revalidate every hour (omitted for mobile static export which doesn't support it)
      ...(process.env.IS_MOBILE_BUILD !== 'true' ? { revalidate: 3600 } : {}),
    };
  } catch {
    // API unreachable at build time — use fallback plans, retry sooner
    return {
      props: { plans: FALLBACK_PLANS, ...i18nProps },
      ...(process.env.IS_MOBILE_BUILD !== 'true' ? { revalidate: 60 } : {}),
    };
  }
};

import { useState, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import type { GetStaticProps } from 'next';
import clsx from 'clsx';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, ConfirmationModal } from '@/components/ui';
import { subscriptionApi, publicApi } from '@/lib/api';
import { extractObjectData } from '@/lib/api-utils';
import { useTranslations, useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { useOwnerGate } from '@/hooks';
import { Check, X, Zap, Crown, Sparkles, ChevronDown, Star } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';
import { isUserSanctioned, isUserSanctionedNonBlocking } from '@/utils/geoCheck';
import { FALLBACK_PLANS } from '@/data/fallbackPlans';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebUrl } from '@/lib/webUrl';
import type { NextPageWithLayout } from './_app';
import { isRTLLocale } from '@/utils/locale';
import { ShopifyIcon, SallaIcon, ZidIcon } from '@/components/landing/LandingHero';
import { getDisplayPrice, getMonthlyEquivalent, getAnnualSavings } from '@/utils/pricing';

interface PricingPageProps {
  plans: Plan[];
}


function PlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  onSelect,
  loading,
  currentPlanPrice,
  subscriptionStatus,
  isSanctioned,
  billingInterval,
  locale,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  hasActiveSubscription: boolean;
  onSelect: () => void;
  loading: boolean;
  currentPlanPrice: number;
  subscriptionStatus?: string;
  isSanctioned: boolean;
  billingInterval: 'month' | 'year';
  locale?: string;
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
  const isAnnual = billingInterval === 'year';

  const displayPrice = !isFree ? getDisplayPrice(plan.price, billingInterval, plan.yearlyPrice) : 0;
  const monthlyEquivalent = !isFree ? getMonthlyEquivalent(plan.price, billingInterval, plan.yearlyPrice) : 0;

  const planName = tPricing(plan.slug);
  const planDescription = tPricing(`${plan.slug}Desc`);

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale || 'en', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(price / 100);
  };

  // SAR equivalent (USD is pegged at 3.75 SAR)
  const sarMonthly = !isFree ? Math.round((isAnnual ? monthlyEquivalent : plan.price) / 100 * 3.75) : 0;

  const isPro = plan.slug === 'pro';

  const highlightClasses = isCurrentPlan
    ? 'ring-2 ring-emerald-400 shadow-[0_20px_40px_rgba(16,185,129,0.18)] md:scale-105 z-10'
    : (isPopular && !isCurrentPlan)
      ? 'ring-2 ring-blue-500 shadow-[0_20px_40px_rgba(59,130,246,0.18)] md:scale-105 z-10'
      : isPro
        ? 'ring-2 ring-amber-400 shadow-[0_20px_40px_rgba(217,161,12,0.15)] md:scale-[1.02] z-[5]'
        : 'border-theme-border shadow-[0_4px_6px_rgba(0,0,0,0.07)]';

  return (
    <Card
      className={`relative flex flex-col h-full transition-all duration-300 hover:shadow-[0_12px_24px_rgba(0,0,0,0.12)] hover:-translate-y-1 ${highlightClasses} ${isCurrentPlan ? 'bg-emerald-50/40 dark:bg-emerald-950/40' : isPro ? 'bg-amber-50/30 dark:bg-amber-950/30' : 'bg-card'}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-4 start-0 end-0 flex justify-center z-20">
          <span className="bg-gradient-to-r from-blue-500 to-brand-500 text-white text-[13px] font-bold px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_4px_8px_rgba(0,0,0,0.2)] whitespace-nowrap uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {t('pricing.popular')}
          </span>
        </div>
      )}

      {/* Pro/Premium badge */}
      {isPro && !isCurrentPlan && (
        <div className="absolute -top-4 start-0 end-0 flex justify-center z-20">
          <span className="bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[13px] font-bold px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-[0_4px_8px_rgba(180,130,0,0.3)] whitespace-nowrap uppercase tracking-wider">
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
        <div className={`w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 rounded-xl flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${plan.slug === 'free' ? 'icon-bg-slate' :
          plan.slug === 'starter' ? 'icon-bg-blue' :
            plan.slug === 'business' ? 'icon-bg-brand' :
              'icon-bg-amber'
          }`} style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
          {plan.slug === 'free' || plan.slug === 'starter' ? (
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
          <div className="inline-flex items-center gap-1.5 bg-brand-100 text-brand-700 text-xs font-semibold mt-3 px-3 py-1 rounded-full">
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
        />

        <FeatureRow
          included={true}
          text={plan.maxPages === null ? t('pricing.featurePagesUnlimited') : t('pricing.featurePages', { count: plan.maxPages })}
          subtext={t('pricing.facebookInstagram')}
        />

        <FeatureRow
          included={true}
          text={plan.maxAiRepliesPerMonth === null ? t('pricing.featureAiRepliesUnlimited') : t('pricing.featureAiReplies', { count: plan.maxAiRepliesPerMonth })}
          subtext={t('pricing.aiPowered')}
        />

        <FeatureRow
          included={plan.showBranding === false}
          text={t('pricing.brandingHidden')}
        />

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
        {isSanctioned ? (
          <div className="text-center p-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-xs font-bold text-slate-500 mb-1">
              {t('payment.unavailable.message')}
            </p>
            <a
              href={`https://wa.me/46700224720?text=${encodeURIComponent(t('landing.footer.whatsappMessage'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 font-bold hover:underline"
            >
              {t('payment.unavailable.supportLink')}
            </a>
          </div>
        ) : (
          <Button
            onClick={onSelect}
            loading={loading}
            disabled={isCurrentPlan}
            variant={isPro || isPopular || plan.slug === 'starter' ? 'primary' : 'secondary'}
            className={clsx(
              'w-full py-3 text-sm rounded-xl transition-all duration-300',
              isPro && 'pricing-btn-pro',
              isPopular && 'pricing-btn-business',
              plan.slug === 'starter' && 'pricing-btn-starter',
              !isPro && !isPopular && plan.slug !== 'starter' && 'font-bold',
            )}
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
  const router = useRouter();
  const locale = useLocale();
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
  const isBlockedForMember = useOwnerGate();
  const [plans, setPlans] = useState<Plan[]>(serverPlans);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);
  const [isSanctioned, setIsSanctioned] = useState<boolean>(false);
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);

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

        if (usageResult?.data) {
          setUsage(extractObjectData<UsageSummary>(usageResult.data));
        }
      } catch (error) {
        captureError(error, 'Failed to load user data', { tags: { page: 'pricing' } });
      }
    };

    fetchUserData();
  }, [isAuthenticated]);

  const handleSelectPlan = async (planId: string) => {
    // On native (Android/iOS), open the web login → checkout flow.
    // Google Play policy prohibits in-app purchases via Stripe.
    // The in-app browser doesn't share the app's auth session, so we
    // route through login with a redirect to checkout after auth.
    if (isNativePlatform()) {
      const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      const checkoutPath = `/checkout?planId=${planId}&interval=${billingInterval}&theme=${theme}`;
      await openExternalUrl(buildWebUrl(`/login?redirect=${encodeURIComponent(checkoutPath)}`, router.locale));
      return;
    }

    // Members cannot manage subscriptions — only the workspace owner can.
    if (isBlockedForMember) {
      toast.error(tPricing('ownerOnlyBilling'));
      return;
    }

    // STRICT PAYMENT VALIDATION: Re-check sanctions before payment
    // (Display is permissive, but payments are strict)
    setChangingPlan(planId);
    const sanctioned = await isUserSanctioned();
    if (sanctioned) {
      setChangingPlan(null);
      toast.error(tPricing('unavailableRegion'));
      captureError(new Error('Payment blocked: sanctioned jurisdiction'), 'Sanctions block on pricing', { tags: { page: 'pricing', action: 'sanctions_block' }, level: 'warning' });
      return;
    }

    // Find the selected plan
    const selectedPlan = plans.find(p => p.id === planId);
    if (!selectedPlan) {
      setChangingPlan(null);
      return;
    }

    // If it's a FREE plan, we don't need Stripe checkout for NEW users
    // New users get this plan automatically on registration/login
    if (selectedPlan.price === 0) {
      if (!isAuthenticated) {
        // Just go to login, then dashboard will auto-activate trial
        router.push(`/login?redirect=${encodeURIComponent('/dashboard')}`);
      } else if (!usage?.subscription) {
        // No subscription — go to dashboard to trigger auto-activation
        router.push('/dashboard');
      } else {
        // Has active subscription — show confirmation, then open Stripe Billing Portal
        setShowDowngradeDialog(true);
      }
      return;
    }

    // For all other PAID plans:
    // If not authenticated, redirect to login then to checkout
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/checkout?planId=${planId}&interval=${billingInterval}`)}`);
      return;
    }

    // If user has an active Stripe-backed subscription, switch plan in-place
    // with proration via /payment/change-plan. The customer keeps their
    // billing anchor; Stripe credits unused time on the old plan and charges
    // the prorated new plan on the next invoice.
    // Users with trial/manual subscriptions (no Stripe customer) go through
    // checkout instead — there's no Stripe subscription to update.
    if (hasActiveSubscription && usage?.subscription?.hasStripeCustomer) {
      try {
        await subscriptionApi.changePlan(planId, billingInterval);
        toast.success(tPricing('planChangeSuccess'));
        // Refresh usage so the UI reflects the new plan immediately.
        router.replace(router.asPath);
      } catch (err) {
        captureError(err, 'Failed to change plan', { tags: { page: 'pricing', action: 'change_plan' } });
        toast.error(tPricing('planChangeError'));
      } finally {
        setChangingPlan(null);
      }
      return;
    }

    // New subscription or trial-to-paid upgrade — navigate to checkout
    router.push(`/checkout?planId=${planId}&interval=${billingInterval}`);
  };

  /** Open Stripe Billing Portal for plan changes, downgrades, or cancellation. */
  const openBillingPortal = async () => {
    try {
      const response = await subscriptionApi.billingPortal();
      window.location.href = response.data.url;
    } catch (err) {
      captureError(err, 'Failed to open billing portal', { tags: { page: 'pricing', action: 'billing_portal' } });
      toast.error(tPricing('billingPortalError'));
    }
  };

  const handleDowngradeConfirm = async () => {
    setDowngradeLoading(true);
    await openBillingPortal();
    // If we're still here (portal didn't open), reset the dialog
    setDowngradeLoading(false);
    setShowDowngradeDialog(false);
  };

  // Filter out inactive plans (keep only plans where isActive is true)
  const activePlans = useMemo(() => plans.filter(p => p.isActive !== false), [plans]);

  // Use slug for plan matching — slugs are stable ('starter', 'business', 'pro'),
  // whereas plan.id is a UUID that differs between environments and after re-seeding.
  const currentPlanSlug = usage?.subscription?.plan?.slug;
  const hasActiveSubscription = Boolean(currentPlanSlug);

  // Current plan price for upgrade/downgrade comparison — O(1) lookup per render
  const currentPlanPrice = useMemo(
    () => activePlans.find(p => p.slug === currentPlanSlug)?.price ?? 0,
    [activePlans, currentPlanSlug]
  );

  // --- Mobile tab state ---
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
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

  // Keyboard navigation for tab bar (RTL-aware)
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isRTL = isRTLLocale(locale);
    const forward = isRTL ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRTL ? 'ArrowRight' : 'ArrowLeft';
    let next = activeTab;

    if (e.key === forward) { e.preventDefault(); next = (activeTab + 1) % activePlans.length; }
    else if (e.key === backward) { e.preventDefault(); next = (activeTab - 1 + activePlans.length) % activePlans.length; }
    else if (e.key === 'Home') { e.preventDefault(); next = 0; }
    else if (e.key === 'End') { e.preventDefault(); next = activePlans.length - 1; }
    else return;

    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <Head>
        <title>{t('pricing.seoTitle')}</title>
        <meta name="description" content={t('pricing.seoDescription')} />
        <meta name="keywords" content={t('pricing.seoKeywords')} />
        <meta key="og:title" property="og:title" content={t('pricing.ogTitle')} />
        <meta key="og:description" property="og:description" content={t('pricing.ogDescription')} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [1, 2, 3, 4, 5].map(i => ({
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
                ) : usage.subscription.renewsAt ? (
                  <>
                    <div className="w-px h-4 bg-theme-border" />
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="font-medium">{t('subscription.renewsOn')}</span>
                      <span className="font-bold text-foreground/70">
                        {new Date(usage.subscription.renewsAt).toLocaleDateString(locale === 'ar' ? 'ar-u-nu-latn' : 'en', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
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

        {/* Billing interval toggle */}
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

        {/* Plan tabs — mobile only (Shopify-style segmented control) */}
        <div
          className="grid mx-4 mb-8 border border-theme-border rounded-lg overflow-hidden md:hidden"
          style={{ gridTemplateColumns: `repeat(${activePlans.length}, 1fr)` }}
          role="tablist"
          aria-label={t('pricing.planTabs')}
          onKeyDown={handleTabKeyDown}
        >
          {activePlans.map((plan, index) => {
            const tabLabel = tPricing(plan.slug);
            return (
              <button
                key={plan.id}
                ref={(el) => { tabRefs.current[index] = el; }}
                type="button"
                role="tab"
                aria-selected={activeTab === index}
                aria-controls={`plan-panel-${plan.slug}`}
                tabIndex={activeTab === index ? 0 : -1}
                onClick={() => setActiveTab(index)}
                className={clsx(
                  'py-3 text-sm font-semibold text-center transition-all duration-200 whitespace-nowrap',
                  'border-theme-border',
                  index > 0 && 'border-s',
                  activeTab === index
                    ? 'bg-card text-foreground shadow-sm'
                    : 'bg-background text-muted-foreground hover:text-foreground/70 hover:bg-muted',
                )}
              >
                {tabLabel}
              </button>
            );
          })}
        </div>

        {/* Plans — single container: stacked grid on mobile, multi-col grid on md+ */}
        <div
          className={clsx(
            // Mobile: single-cell grid so all cards overlap — tallest sets height
            'grid px-4 pt-1 pb-4',
            // Desktop: multi-column grid
            'md:px-6 md:pt-0 md:pb-8',
            'md:gap-6 lg:gap-8 md:items-stretch',
            activePlans.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2 lg:grid-cols-3',
            'max-w-7xl md:mx-auto lg:px-0',
          )}
        >
          {activePlans.map((plan, index) => (
            <div
              key={plan.id}
              id={`plan-panel-${plan.slug}`}
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
                billingInterval={billingInterval}
                locale={locale}
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

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto px-4 pb-12 pt-10 sm:pt-12">
          <h2 className="text-xl font-bold text-foreground text-center mb-6">
            {t('pricing.faqTitle')}
          </h2>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => {
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
        onClose={() => { setShowDowngradeDialog(false); setDowngradeLoading(false); }}
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

import { useState, useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageSkeleton } from '@/components/ui';
import { plansApi, subscriptionApi } from '@/lib/api';
import { extractArrayData, extractObjectData } from '@/lib/api-utils';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { Check, X, Zap, Crown, Sparkles, AlertCircle, Store, ChevronDown } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';
import { isUserSanctioned, isUserSanctionedNonBlocking } from '@/utils/geoCheck';
import { FALLBACK_PLANS } from '@/data/fallbackPlans';
import type { NextPageWithLayout } from './_app';


function PlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  onSelect,
  loading,
  t,
  currentPlanPrice,
  subscriptionStatus,
  isSanctioned,
  billingInterval,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  hasActiveSubscription: boolean;
  onSelect: () => void;
  loading: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  currentPlanPrice: number;
  subscriptionStatus?: string;
  isSanctioned: boolean;
  billingInterval: 'month' | 'year';
}) {
  const isPopular = plan.slug === 'business';
  const isFree = plan.price === 0;
  const isAnnual = billingInterval === 'year';

  // Annual = 10 months (save 2 months ≈ 17%)
  const displayPrice = isAnnual && !isFree ? plan.price * 10 : plan.price;
  const monthlyEquivalent = isAnnual && !isFree ? Math.round(displayPrice / 12) : plan.price;

  // Translate plan names and descriptions based on slug with fallbacks
  const planName = t(`pricing.${plan.slug}` as TranslationKey) !== `pricing.${plan.slug}`
    ? t(`pricing.${plan.slug}` as TranslationKey)
    : (t(`plans.${plan.slug}.name` as TranslationKey) !== `plans.${plan.slug}.name` ? t(`plans.${plan.slug}.name` as TranslationKey) : plan.name);

  const planDescription = t(`pricing.${plan.slug}Desc` as TranslationKey) !== `pricing.${plan.slug}Desc`
    ? t(`pricing.${plan.slug}Desc` as TranslationKey)
    : (t(`plans.${plan.slug}.description` as TranslationKey) !== `plans.${plan.slug}.description` ? t(`plans.${plan.slug}.description` as TranslationKey) : plan.description);

  // Format price
  const formatPrice = (price: number) => {
    return `$${(price / 100).toFixed(0)}`;
  };

  const isHighlighted = isCurrentPlan || (isPopular && !isCurrentPlan);

  return (
    <Card
      className={`relative flex flex-col h-full transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${isHighlighted
        ? 'ring-2 ring-brand-500/80 shadow-xl shadow-brand-500/10 md:scale-105 z-10 md:mt-4'
        : 'border-surface-200 shadow-sm'
        } ${isCurrentPlan ? 'bg-brand-50/50' : 'bg-white'}`}
    >
      {/* Popular badge - High-contrast premium look */}
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
          <span className="bg-gradient-to-r from-indigo-600 via-brand-600 to-brand-500 text-white text-[10px] md:text-xs font-extrabold px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-xl shadow-brand-500/20 border border-white/20 whitespace-nowrap uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            {t('pricing.popular')}
          </span>
        </div>
      )}

      {/* Current plan badge - centered at top */}
      {isCurrentPlan && (
        <div className="absolute top-4 start-0 end-0 flex justify-center">
          <span className="inline-flex items-center gap-2 bg-green-50 text-green-700 text-[10px] font-bold px-3 py-1 rounded-full border border-green-200/50 shadow-sm">
            <Check className="w-2.5 h-2.5" />
            {t('pricing.currentPlan')}
            {subscriptionStatus === 'trialing' && (
              <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded text-[8px] font-black uppercase tracking-wider shadow-sm">
                {t('pricing.trial' as TranslationKey) !== 'pricing.trial' ? t('pricing.trial' as TranslationKey) : 'TRIAL'}
              </span>
            )}
          </span>
        </div>
      )}

      <div className="text-center mb-2 md:mb-3 pt-3 md:pt-4 px-3">
        <div className={`w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 rounded-xl hidden md:flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${plan.slug === 'free' ? 'bg-slate-100 text-slate-600' :
          plan.slug === 'starter' ? 'bg-blue-100 text-blue-600' :
            plan.slug === 'business' ? 'bg-brand-100 text-brand-600' :
              'bg-amber-100 text-amber-600'
          }`} style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
          {plan.slug === 'free' || plan.slug === 'starter' ? (
            <Zap className="w-5 h-5 md:w-6 md:h-6" />
          ) : plan.slug === 'pro' ? (
            <Crown className="w-5 h-5 md:w-6 md:h-6" />
          ) : (
            <Sparkles className="w-5 h-5 md:w-6 md:h-6" />
          )}
        </div>
        <h3 className="text-lg md:text-xl font-bold text-surface-900 tracking-tight mb-1">{planName}</h3>
        {planDescription && (
          <p className="text-xs md:text-sm text-surface-600 leading-relaxed min-h-[32px] px-2 hidden md:block">{planDescription}</p>
        )}
      </div>

      {/* Price */}
      <div className="text-center mb-3 md:mb-4 py-2 md:py-3 bg-surface-50/50 rounded-xl mx-3">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl md:text-4xl font-extrabold text-surface-900">
            {isFree ? '$0' : isAnnual ? formatPrice(monthlyEquivalent) : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-surface-500 text-sm font-medium">{t('pricing.perMonth')}</span>
          )}
        </div>
        {isAnnual && !isFree && (
          <p className="text-xs text-surface-400 mt-1">
            {t('pricing.billedYearly' as TranslationKey, { amount: formatPrice(displayPrice) })}
          </p>
        )}
        {/* Only show trial badge if user doesn't have an active subscription */}
        {plan.trialDays > 0 && !hasActiveSubscription && (
          <div className="inline-flex items-center gap-1.5 bg-brand-100 text-brand-700 text-xs font-semibold mt-3 px-3 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            {t('pricing.trialDays', { days: plan.trialDays })}
          </div>
        )}
      </div>

      {/* Features */}
      <div className="space-y-1 px-3 flex-1">
        <FeatureRow
          included={true}
          text={t('pricing.featurePages' as TranslationKey, { count: (plan.maxPages === null ? t('pricing.unlimited' as TranslationKey) : plan.maxPages) as string | number })}
          subtext={t('pricing.facebookInstagram' as TranslationKey)}
        />

        <FeatureRow
          included={true}
          highlight={true}
          text={t('pricing.featureAiReplies' as TranslationKey, { count: (plan.maxAiRepliesPerMonth === null ? t('pricing.unlimited' as TranslationKey) : plan.maxAiRepliesPerMonth.toLocaleString()) as string | number })}
          subtext={t('pricing.aiPowered' as TranslationKey)}
        />

        <FeatureRow
          included={true}
          text={t('pricing.featureTemplates' as TranslationKey, { count: (plan.maxTemplates === null ? t('pricing.unlimited' as TranslationKey) : plan.maxTemplates) as string | number })}
        />

        <FeatureRow
          included={true}
          text={t('pricing.featureRules' as TranslationKey, { count: (plan.maxRules === null ? t('pricing.unlimited' as TranslationKey) : plan.maxRules) as string | number })}
        />

        <FeatureRow
          included={!plan.showBranding}
          text={t('pricing.brandingHidden' as TranslationKey)}
        />

      </div>

      {/* Integration badge — shown only for plans with Shopify enabled */}
      {plan.shopifyEnabled && (
        <div className="mx-3 mt-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-100">
            <Store className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <span className="text-xs font-medium text-purple-700">
              {t('pricing.shopifyBadge' as TranslationKey)}
            </span>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="mt-auto pt-2 md:pt-3 px-3 pb-1">
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
            variant={isPopular ? 'primary' : plan.slug === 'pro' ? 'primary' : 'secondary'}
            className={`w-full py-3 text-sm rounded-xl transition-all duration-300 ${isPopular ? 'font-bold shadow-lg shadow-brand-200 hover:shadow-brand-300' : plan.slug === 'pro' ? 'font-extrabold !bg-surface-800 !text-white hover:!bg-surface-700 shadow-lg shadow-surface-300' : 'font-bold'
              }`}
          >
            {isCurrentPlan ? (
              <div className="flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                <span className="font-bold">{t('pricing.currentPlan')}</span>
                {(subscriptionStatus === 'trialing' || (isCurrentPlan && plan.price === 0 && plan.trialDays > 0)) && (
                  <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-black border border-amber-200 uppercase tracking-tighter">
                    {t('pricing.trial' as TranslationKey) !== 'pricing.trial' ? t('pricing.trial' as TranslationKey) : 'TRIAL'}
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
        {((isFree || (plan.trialDays > 0 && !hasActiveSubscription)) && !isSanctioned && !isCurrentPlan) && (
          <p className="text-xs text-surface-400 text-center mt-3 font-medium">
            {t('pricing.noCreditCard')}
          </p>
        )}
      </div>
    </Card>
  );
}

function FeatureRow({
  included,
  text,
  subtext,
  highlight
}: {
  included: boolean;
  text: string;
  subtext?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2.5 py-1 md:py-1.5 px-1 rounded-lg transition-colors ${highlight ? 'bg-brand-50/30' : ''}`}>
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${included ? 'bg-green-100 text-green-600' : 'bg-surface-100 text-surface-300'
        }`}>
        {included ? (
          <Check className="w-3 h-3 stroke-[3]" />
        ) : (
          <X className="w-3 h-3 stroke-[3]" />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-xs md:text-sm font-semibold leading-snug text-start ${included ? 'text-surface-700' : 'text-surface-400 line-through decoration-surface-300'
          }`}>
          {text}
        </span>
        {subtext && (
          <span className="text-[10px] md:text-xs text-surface-400 font-medium mt-0.5 text-start">
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}

const PricingPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);
  const [isSanctioned, setIsSanctioned] = useState<boolean>(false); // Default: not sanctioned
  const [usingFallback, setUsingFallback] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // OPTIMIZED: Parallel loading with non-blocking geo check
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Run geo check and plans fetch in parallel (non-blocking)
        const [geoResult, plansResult, usageResult] = await Promise.all([
          // Geo check with 1s timeout (non-blocking for display)
          isUserSanctionedNonBlocking(1000).catch(() => ({ sanctioned: false, cached: false, timedOut: true })),
          // Plans API with fallback and 3s timeout
          plansApi.getAll({ timeout: 3000 }).catch(() => null),
          // Usage API (only if authenticated) with 3s timeout
          isAuthenticated ? subscriptionApi.getUsage({ timeout: 3000 }).catch(() => null) : Promise.resolve(null),
        ]);

        // Update geo status
        setIsSanctioned(geoResult.sanctioned);

        // Handle plans (API or fallback)
        if (plansResult?.data) {
          setPlans(extractArrayData<Plan>(plansResult.data));
          setUsingFallback(false);
        } else {
          // Offline or API failed - use fallback plans
          console.warn('Using fallback plans (offline or API unavailable)');
          setPlans(FALLBACK_PLANS);
          setUsingFallback(true);
        }

        // Handle usage
        if (usageResult?.data) {
          setUsage(extractObjectData<UsageSummary>(usageResult.data));
        }
      } catch (error) {
        console.error('Failed to load pricing data:', error);
        // Even on error, show fallback plans
        setPlans(FALLBACK_PLANS);
        setUsingFallback(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated]);

  const handleSelectPlan = async (planId: string) => {
    // STRICT PAYMENT VALIDATION: Re-check sanctions before payment
    // (Display is permissive, but payments are strict)
    const sanctioned = await isUserSanctioned();
    if (sanctioned) {
      console.warn('[Pricing] Payment blocked: user is in sanctioned jurisdiction');
      return;
    }

    // Find the selected plan
    const selectedPlan = plans.find(p => p.id === planId);
    if (!selectedPlan) return;

    // If it's a FREE plan, we don't need Stripe checkout for NEW users
    // New users get this plan automatically on registration/login
    if (selectedPlan.price === 0) {
      if (!isAuthenticated) {
        // Just go to login, then dashboard will auto-activate trial
        router.push(`/login?redirect=${encodeURIComponent('/dashboard')}`);
      } else {
        // If already logged in, check if they already have an active sub
        // If they don't have a plan yet, just go to dashboard to trigger auto-activation
        if (!usage?.subscription) {
          router.push('/dashboard');
        } else {
          // If they have a plan and are "downgrading" or "switching" back to default,
          // go to checkout to handle Stripe subscription update
          router.push(`/checkout?planId=${planId}`);
        }
      }
      return;
    }

    // For all other PAID plans:
    // If not authenticated, redirect to login then to checkout
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/checkout?planId=${planId}`)}`);
      return;
    }

    setChangingPlan(planId);

    // Navigate to checkout (backend will validate again)
    router.push(`/checkout?planId=${planId}`);
  };

  // Show loading skeleton
  if (loading) {
    return <PageSkeleton />;
  }

  // NORMAL PRICING FLOW

  const currentPlanId = usage?.subscription?.plan?.id;
  const hasActiveSubscription = Boolean(currentPlanId);

  // Filter out inactive plans
  const activePlans = plans.filter(p => p.slug !== 'free' || p.isActive !== false);

  return (
    <>
      <Head>
        <title>{t('pricing.seoTitle')}</title>
        <meta name="description" content={t('pricing.seoDescription')} />
        <meta name="keywords" content={t('pricing.seoKeywords')} />
        <link rel="canonical" href="https://jawab24.com/pricing" />
        <meta property="og:title" content={t('pricing.ogTitle')} />
        <meta property="og:description" content={t('pricing.ogDescription')} />
        <meta property="og:url" content="https://jawab24.com/pricing" />
      </Head>
        <div>
        {/* Fallback Disclaimer - Only shown when using offline plans */}
        {usingFallback && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 mb-1">
                {t('pricing.fallbackTitle' as TranslationKey) !== 'pricing.fallbackTitle'
                  ? t('pricing.fallbackTitle' as TranslationKey)
                  : 'Displaying Cached Pricing'}
              </p>
              <p className="text-xs text-amber-700">
                {t('pricing.fallbackMessage' as TranslationKey) !== 'pricing.fallbackMessage'
                  ? t('pricing.fallbackMessage' as TranslationKey)
                  : 'Prices may be temporarily unavailable or outdated. Final pricing is confirmed at checkout.'}
              </p>
            </div>
          </div>
        )}

        {/* Usage Summary if subscribed - Inline */}
        {usage && (
          <div className="max-w-4xl mx-auto mb-8">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 py-3.5 px-6 bg-white rounded-2xl border border-brand-100 shadow-sm">
              {/* Plan Info */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shadow-inner">
                  <Crown className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-surface-900">
                    {t(`pricing.${usage.subscription.plan.slug}` as TranslationKey) !== `pricing.${usage.subscription.plan.slug}`
                      ? t(`pricing.${usage.subscription.plan.slug}` as TranslationKey)
                      : (t(`plans.${usage.subscription.plan.slug}.name` as TranslationKey) !== `plans.${usage.subscription.plan.slug}.name`
                        ? t(`plans.${usage.subscription.plan.slug}.name` as TranslationKey)
                        : usage.subscription.plan.name)}
                  </span>
                  {usage.subscription.status === 'trialing' && (
                    <span className="px-2 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black uppercase tracking-wider shadow-sm">
                      {t('pricing.trial' as TranslationKey) !== 'pricing.trial' ? t('pricing.trial' as TranslationKey) : 'TRIAL'}
                    </span>
                  )}
                </div>
              </div>

              {/* Vertical Divider (desktop only) */}
              <div className="hidden sm:block w-px h-6 bg-surface-200" />

              {/* Usage Stats */}
              <div className="flex items-center gap-6 text-sm">
                <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
                  <span className="text-surface-500 font-medium">{t('pricing.repliesUsed' as TranslationKey)}</span>
                  <span className="font-bold text-brand-600">
                    {usage.aiReplies.used} / {usage.aiReplies.limit || '∞'}
                  </span>
                </div>

                {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                  <>
                    <div className="w-px h-4 bg-surface-200" />
                    <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-100 font-bold">
                      <Zap className="w-3.5 h-3.5 fill-amber-500" />
                      {t('pricing.daysLeftCount', { count: usage.subscription.trialDaysRemaining })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Page title */}
        <div className="text-center px-4 pt-6 sm:pt-10 md:pt-12">
          <h1 className="text-2xl md:text-3xl font-bold text-surface-900 tracking-tight">
            {t('pricing.choosePlan')}
          </h1>
          <p className="text-sm md:text-base text-surface-500 mt-2 max-w-lg mx-auto">
            {t('pricing.tryFullService')}
          </p>
        </div>

        {/* Billing interval toggle */}
        <div className="flex items-center justify-center gap-3 pt-4 pb-2">
          <button
            onClick={() => setBillingInterval('month')}
            className={`px-4 py-2 text-sm font-semibold rounded-full transition-all ${billingInterval === 'month' ? 'bg-brand-600 text-white shadow-md' : 'text-surface-500 hover:text-surface-700'}`}
          >
            {t('pricing.monthly')}
          </button>
          <button
            onClick={() => setBillingInterval('year')}
            className={`px-4 py-2 text-sm font-semibold rounded-full transition-all flex items-center gap-2 ${billingInterval === 'year' ? 'bg-brand-600 text-white shadow-md' : 'text-surface-500 hover:text-surface-700'}`}
          >
            {t('pricing.yearly')}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${billingInterval === 'year' ? 'bg-white/20 text-white' : 'bg-green-100 text-green-700'}`}>
              {t('pricing.savePercent' as TranslationKey)}
            </span>
          </button>
        </div>

        {/* Plans Grid - Responsive grid based on count */}
        <div className={`grid grid-cols-1 ${activePlans.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'} gap-4 md:gap-4 lg:gap-6 pb-8 items-stretch max-w-7xl mx-auto px-4 md:px-6 lg:px-0 pt-4 md:pt-8`}>
          {activePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={plan.id === currentPlanId}
              hasActiveSubscription={hasActiveSubscription}
              onSelect={() => handleSelectPlan(plan.id)}
              loading={changingPlan === plan.id}
              currentPlanPrice={activePlans.find(p => p.id === currentPlanId)?.price || 0}
              subscriptionStatus={usage?.subscription?.status}
              t={t}
              isSanctioned={isSanctioned === true}
              billingInterval={billingInterval}
            />
          ))}
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto px-4 pb-12 pt-16">
          <h2 className="text-xl font-bold text-surface-900 text-center mb-6">
            {t('pricing.faqTitle' as TranslationKey)}
          </h2>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => {
              const qKey = `pricing.faq${i}Q` as TranslationKey;
              const aKey = `pricing.faq${i}A` as TranslationKey;
              const question = t(qKey);
              // Skip if translation key is missing (returns the key itself)
              if (question === qKey) return null;
              return (
                <div key={i} className="border border-surface-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-start hover:bg-surface-50 transition-colors"
                  >
                    <span className="text-sm font-semibold text-surface-800">{question}</span>
                    <ChevronDown className={`w-4 h-4 text-surface-400 flex-shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-4 text-sm text-surface-600 leading-relaxed">
                      {t(aKey)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </div>
    </>
  );
};

// Persistent layout - prevents Sidebar remounting on navigation
PricingPage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Pricing" isPublic skipTitle>{page}</DashboardLayout>
);

export default PricingPage;

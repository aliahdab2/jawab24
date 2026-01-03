import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageSpinner } from '@/components/ui';
import { plansApi, subscriptionApi } from '@/lib/api';
import { extractArrayData, extractObjectData } from '@/lib/api-utils';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { Check, X, Zap, Crown, Sparkles } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';

function PlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  onSelect,
  loading,
  t,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  hasActiveSubscription: boolean;
  onSelect: () => void;
  loading: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const isPopular = plan.slug === 'business';
  const isFree = plan.price === 0;

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
        ? 'ring-2 ring-brand-500 shadow-brand-100 shadow-xl md:scale-105 z-10 md:mt-4'
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
          <span className="bg-green-100 text-green-700 text-[10px] font-bold px-3 py-1 rounded-full border border-green-200">
            {t('pricing.currentPlan')}
          </span>
        </div>
      )}

      <div className="text-center mb-3 pt-4 px-3">
        <div className={`w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 rounded-xl flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${plan.slug === 'free' ? 'bg-slate-100 text-slate-600' :
          plan.slug === 'starter' ? 'bg-blue-100 text-blue-600' :
            plan.slug === 'business' ? 'bg-brand-100 text-brand-600' :
              'bg-amber-100 text-amber-600'
          }`}>
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
          <p className="text-xs md:text-sm text-surface-500 leading-relaxed min-h-[32px] px-2">{planDescription}</p>
        )}
      </div>

      {/* Price */}
      <div className="text-center mb-4 py-3 bg-surface-50/50 rounded-xl mx-3">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl md:text-4xl font-extrabold text-surface-900">
            {isFree ? '$0' : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-surface-500 text-sm font-medium">{t('pricing.perMonth')}</span>
          )}
        </div>
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

      {/* CTA */}
      <div className="mt-auto pt-3 px-3 pb-1">
        <Button
          onClick={onSelect}
          loading={loading}
          disabled={isCurrentPlan}
          variant={isPopular ? 'primary' : 'secondary'}
          className={`w-full py-3 text-sm font-bold rounded-xl transition-all duration-300 ${isPopular ? 'shadow-lg shadow-brand-200 hover:shadow-brand-300' : ''
            }`}
        >
          {isCurrentPlan
            ? t('pricing.currentPlan')
            : hasActiveSubscription
              ? t('pricing.upgrade')
              : (isFree || plan.trialDays > 0)
                ? t('pricing.startTrial')
                : t('pricing.upgrade')
          }
        </Button>
        {isFree && (
          <p className="text-xs text-surface-400 text-center mt-3 font-medium">
            {t('pricing.noCreditCardNote')}
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
    <div className={`flex items-start gap-2.5 py-1.5 px-1 rounded-lg transition-colors ${highlight ? 'bg-brand-50/30' : ''}`}>
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

export default function PricingPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [plansRes, usageRes] = await Promise.all([
          plansApi.getAll(),
          isAuthenticated ? subscriptionApi.getUsage().catch(() => null) : Promise.resolve(null),
        ]);

        // Use utility functions for safe response parsing
        setPlans(extractArrayData<Plan>(plansRes.data));

        if (usageRes?.data) {
          setUsage(extractObjectData<UsageSummary>(usageRes.data));
        }
      } catch (error) {
        console.error('Failed to fetch plans:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated]);

  const handleSelectPlan = async (planId: string) => {
    // If not authenticated, redirect to login
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/checkout?planId=${planId}`)}`);
      return;
    }

    // Find the selected plan
    const selectedPlan = plans.find(p => p.id === planId);
    if (!selectedPlan) return;

    setChangingPlan(planId);

    // Navigate to checkout
    router.push(`/checkout?planId=${planId}`);
  };

  if (loading) {
    return (
      <DashboardLayout title={t('pricing.title')} isPublic={true}>
        <div className="flex items-center justify-center min-h-[400px]">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }

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
      <DashboardLayout title={t('pricing.title')} isPublic={true}>
        {/* Usage Summary if subscribed - Inline */}
        {usage && (
          <div className="flex flex-wrap items-center justify-center gap-4 mb-6 p-3 bg-brand-50 rounded-xl border border-brand-100">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-brand-600" />
              <span className="text-sm font-bold text-brand-700">
                {t(`pricing.${usage.subscription.plan.slug}` as TranslationKey) !== `pricing.${usage.subscription.plan.slug}`
                  ? t(`pricing.${usage.subscription.plan.slug}` as TranslationKey)
                  : (t(`plans.${usage.subscription.plan.slug}.name` as TranslationKey) !== `plans.${usage.subscription.plan.slug}.name`
                    ? t(`plans.${usage.subscription.plan.slug}.name` as TranslationKey)
                    : usage.subscription.plan.name)}
              </span>
            </div>
            <div className="text-xs text-brand-600">
              {t('pricing.usageReplies', {
                used: usage.aiReplies.used,
                limit: usage.aiReplies.limit || '∞'
              })}
            </div>
            {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
              <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                <Zap className="w-3 h-3" />
                {t('pricing.daysLeftCount', { count: usage.subscription.trialDaysRemaining })}
              </div>
            )}
          </div>
        )}

        {/* Plans Grid - Mobile: 1 column, Tablet+: 3 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 pb-8 items-stretch max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pt-2 md:pt-4">
          {activePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={plan.id === currentPlanId}
              hasActiveSubscription={hasActiveSubscription}
              onSelect={() => handleSelectPlan(plan.id)}
              loading={changingPlan === plan.id}
              t={t}
            />
          ))}
        </div>

        {/* Simple footer note */}
        <div className="text-center py-6 text-sm text-surface-400">
          {t('pricing.allPlansInclude')}
        </div>
      </DashboardLayout>
    </>
  );
}

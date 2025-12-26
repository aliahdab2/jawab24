import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSpinner } from '@/components/ui';
import { plansApi, subscriptionApi } from '@/lib/api';
import { useTranslation } from '@/i18n';
import { Check, X, Zap, Crown, Sparkles, Facebook, Instagram, MessageSquare } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';

function PlanCard({
  plan,
  isCurrentPlan,
  onSelect,
  loading,
  t,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  onSelect: () => void;
  loading: boolean;
  t: (key: string) => string;
}) {
  const isPopular = plan.slug === 'business';
  const isFree = plan.price === 0;
  
  // Format price
  const formatPrice = (price: number) => {
    return `$${(price / 100).toFixed(0)}`;
  };
  
  return (
    <Card className={`relative flex flex-col h-full ${isPopular ? 'ring-2 ring-brand-500 shadow-lg' : ''} ${isCurrentPlan ? 'bg-brand-50' : ''}`}>
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {t('pricing.popular')}
          </span>
        </div>
      )}
      
      {/* Current plan badge */}
      {isCurrentPlan && (
        <div className="absolute -top-3 right-4">
          <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
            {t('pricing.currentPlan')}
          </span>
        </div>
      )}
      
      <div className="text-center mb-6 pt-4">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-brand-100 flex items-center justify-center">
          {plan.slug === 'free' || plan.slug === 'starter' ? (
            <Zap className="w-6 h-6 text-brand-600" />
          ) : plan.slug === 'pro' ? (
            <Crown className="w-6 h-6 text-amber-600" />
          ) : (
            <Sparkles className="w-6 h-6 text-brand-600" />
          )}
        </div>
        <h3 className="text-xl font-bold text-surface-900">{plan.name}</h3>
        {plan.description && (
          <p className="text-sm text-surface-500 mt-1">{plan.description}</p>
        )}
      </div>
      
      {/* Price */}
      <div className="text-center mb-6">
        <div className="flex items-end justify-center gap-1">
          <span className="text-4xl font-bold text-surface-900">
            {isFree ? t('pricing.startTrial') : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-surface-500 mb-1">{t('pricing.perMonth')}</span>
          )}
        </div>
        {plan.trialDays > 0 && (
          <p className="text-sm text-brand-600 mt-1">
            {t('pricing.trialDays').replace('{days}', String(plan.trialDays))}
          </p>
        )}
      </div>
      
      {/* Features */}
      <div className="space-y-3 flex-1">
        {/* Pages */}
        <FeatureRow
          included={true}
          text={`${plan.maxPages === null ? t('pricing.unlimited') : plan.maxPages} ${t('pricing.pages')}`}
        />
        
        {/* AI Replies */}
        <FeatureRow
          included={true}
          text={`${plan.maxAiRepliesPerMonth === null ? t('pricing.unlimited') : plan.maxAiRepliesPerMonth.toLocaleString()} ${t('pricing.aiReplies')}`}
        />
        
        {/* Templates */}
        <FeatureRow
          included={true}
          text={`${plan.maxTemplates === null ? t('pricing.unlimited') : plan.maxTemplates} ${t('pricing.templates')}`}
        />
        
        {/* Rules */}
        <FeatureRow
          included={true}
          text={`${plan.maxRules === null ? t('pricing.unlimited') : plan.maxRules} ${t('pricing.rules')}`}
        />
        
        {/* Platforms */}
        <FeatureRow
          included={plan.facebookEnabled && plan.instagramEnabled}
          text={t('pricing.facebookInstagram')}
        />
        
        {/* Branding */}
        <FeatureRow
          included={!plan.showBranding}
          text={plan.showBranding ? t('pricing.brandingShown') : t('pricing.brandingHidden')}
        />
        
        {/* Support */}
        <FeatureRow
          included={plan.prioritySupport}
          text={plan.prioritySupport ? t('pricing.prioritySupport') : t('pricing.standardSupport')}
        />
      </div>
      
      {/* CTA */}
      <div className="mt-6 pt-4 border-t border-surface-200">
        <Button
          onClick={onSelect}
          loading={loading}
          disabled={isCurrentPlan}
          variant={isPopular ? 'primary' : 'secondary'}
          className="w-full"
          size="lg"
        >
          {isCurrentPlan 
            ? t('pricing.currentPlan')
            : isFree 
              ? t('pricing.startTrial') 
              : t('pricing.upgrade')
          }
        </Button>
      </div>
    </Card>
  );
}

function FeatureRow({ included, text }: { included: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2">
      {included ? (
        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
      ) : (
        <X className="w-4 h-4 text-surface-300 flex-shrink-0" />
      )}
      <span className={`text-sm ${included ? 'text-surface-700' : 'text-surface-400'}`}>
        {text}
      </span>
    </div>
  );
}

export default function PricingPage() {
  const { t, language } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [plansRes, usageRes] = await Promise.all([
          plansApi.getAll(),
          subscriptionApi.getUsage().catch(() => null),
        ]);
        setPlans(plansRes.data.data || []);
        if (usageRes?.data?.data) {
          setUsage(usageRes.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch plans:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);
  
  const handleSelectPlan = async (planId: string) => {
    setChangingPlan(planId);
    try {
      await subscriptionApi.changePlan(planId);
      // Refresh usage data
      const usageRes = await subscriptionApi.getUsage();
      if (usageRes?.data?.data) {
        setUsage(usageRes.data.data);
      }
    } catch (error) {
      console.error('Failed to change plan:', error);
    } finally {
      setChangingPlan(null);
    }
  };
  
  if (loading) {
    return (
      <DashboardLayout title={t('pricing.title')}>
        <div className="flex items-center justify-center h-64">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }
  
  const currentPlanId = usage?.subscription?.plan?.id;
  
  return (
    <DashboardLayout title={t('pricing.title')}>
      {/* Hero Section */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center">
            <Facebook className="w-7 h-7 text-blue-600" />
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
            <Instagram className="w-7 h-7 text-pink-600" />
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-surface-900 mb-3">
          {language === 'ar' 
            ? 'رد تلقائي على تعليقات ورسائل صفحاتك'
            : 'Auto-Reply to Your Facebook & Instagram Pages'
          }
        </h1>
        <p className="text-lg text-surface-600 max-w-2xl mx-auto">
          {language === 'ar'
            ? 'وفّر وقتك مع الردود الذكية التلقائية على تعليقات ورسائل عملائك على فيسبوك وإنستغرام'
            : 'Save time with smart auto-replies to comments and messages on your Facebook and Instagram pages'
          }
        </p>
        <div className="flex items-center justify-center gap-6 mt-6 text-sm text-surface-500">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-brand-500" />
            <span>{language === 'ar' ? 'رد على التعليقات' : 'Reply to Comments'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span>{language === 'ar' ? 'ردود ذكية بالذكاء الاصطناعي' : 'AI-Powered Smart Replies'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-500" />
            <span>{language === 'ar' ? 'يعمل 24/7' : 'Works 24/7'}</span>
          </div>
        </div>
      </div>
      
      {/* Usage Summary if subscribed */}
      {usage && (
        <Card className="mb-8 bg-gradient-to-r from-brand-50 to-violet-50">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-surface-500">{t('subscription.currentPlan')}</p>
              <p className="text-xl font-bold text-surface-900">{usage.subscription.plan.name}</p>
              {usage.subscription.trialDaysRemaining !== undefined && usage.subscription.trialDaysRemaining > 0 && (
                <p className="text-sm text-amber-600">
                  {t('subscription.trialEndsIn')} {usage.subscription.trialDaysRemaining} {t('subscription.days')}
                </p>
              )}
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold text-brand-600">
                  {usage.aiReplies.used}/{usage.aiReplies.limit || '∞'}
                </p>
                <p className="text-xs text-surface-500">{t('subscription.aiRepliesUsed')}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-brand-600">
                  {usage.pages.used}/{usage.pages.limit || '∞'}
                </p>
                <p className="text-xs text-surface-500">{t('subscription.pagesUsed')}</p>
              </div>
            </div>
          </div>
        </Card>
      )}
      
      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={plan.id === currentPlanId}
            onSelect={() => handleSelectPlan(plan.id)}
            loading={changingPlan === plan.id}
            t={t}
          />
        ))}
      </div>
      
      {/* FAQ or additional info could go here */}
    </DashboardLayout>
  );
}


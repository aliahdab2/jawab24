import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button, PageHeader, PageSpinner } from '@/components/ui';
import { plansApi, subscriptionApi } from '@/lib/api';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/lib/store';
import { Check, X, Zap, Crown, Sparkles } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';

function PlanCard({
  plan,
  isCurrentPlan,
  onSelect,
  loading,
  t,
  language,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  onSelect: () => void;
  loading: boolean;
  t: (key: string) => string;
  language: string;
}) {
  const isPopular = plan.slug === 'business';
  const isFree = plan.price === 0;
  
  // Translate plan names based on slug
  const getPlanName = () => {
    if (language === 'ar') {
      switch (plan.slug) {
        case 'free': return 'تجربة مجانية';
        case 'starter': return 'المبتدئ';
        case 'business': return 'الأعمال';
        case 'pro': return 'الاحترافي';
        default: return plan.name;
      }
    }
    return plan.name;
  };
  
  // Translate plan descriptions
  const getPlanDescription = () => {
    if (language === 'ar') {
      switch (plan.slug) {
        case 'free': return 'جرّب الخدمة مجاناً لمدة شهر';
        case 'starter': return 'للمشاريع الصغيرة والمتاجر الناشئة';
        case 'business': return 'للأعمال المتوسطة والمتاجر النشطة';
        case 'pro': return 'للوكالات والمتاجر الكبيرة';
        default: return plan.description;
      }
    }
    return plan.description;
  };
  
  // Format price
  const formatPrice = (price: number) => {
    return `$${(price / 100).toFixed(0)}`;
  };
  
  return (
    <Card 
      className={`relative flex flex-col h-full transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
        isPopular 
          ? 'ring-2 ring-brand-500 shadow-brand-100 shadow-xl md:scale-105 z-10 md:mt-4' 
          : 'border-surface-200 shadow-sm'
      } ${isCurrentPlan ? 'bg-brand-50/50' : 'bg-white'}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
          <span className="bg-gradient-to-r from-brand-600 to-violet-600 text-white text-xs font-bold px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg whitespace-nowrap">
            <Sparkles className="w-3.5 h-3.5" />
            {t('pricing.popular')}
          </span>
        </div>
      )}
      
      {/* Current plan badge */}
      {isCurrentPlan && (
        <div className="absolute top-4 right-4">
          <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-green-200">
            {t('pricing.currentPlan')}
          </span>
        </div>
      )}
      
      <div className="text-center mb-4 pt-6 px-3">
        <div className={`w-12 h-12 md:w-14 md:h-14 mx-auto mb-3 md:mb-4 rounded-xl flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${
          plan.slug === 'free' ? 'bg-slate-100 text-slate-600' :
          plan.slug === 'starter' ? 'bg-blue-100 text-blue-600' :
          plan.slug === 'business' ? 'bg-brand-100 text-brand-600' :
          'bg-amber-100 text-amber-600'
        }`}>
          {plan.slug === 'free' || plan.slug === 'starter' ? (
            <Zap className="w-6 h-6 md:w-7 md:h-7" />
          ) : plan.slug === 'pro' ? (
            <Crown className="w-6 h-6 md:w-7 md:h-7" />
          ) : (
            <Sparkles className="w-6 h-6 md:w-7 md:h-7" />
          )}
        </div>
        <h3 className="text-xl md:text-2xl font-bold text-surface-900 tracking-tight mb-2">{getPlanName()}</h3>
        {(plan.description || getPlanDescription()) && (
          <p className="text-sm text-surface-500 leading-relaxed min-h-[40px] px-2">{getPlanDescription()}</p>
        )}
      </div>
      
      {/* Price */}
      <div className="text-center mb-5 md:mb-6 py-4 bg-surface-50/50 rounded-xl mx-3">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl md:text-4xl font-extrabold text-surface-900">
            {isFree ? '$0' : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-surface-500 text-sm font-medium">{t('pricing.perMonth')}</span>
          )}
        </div>
        {plan.trialDays > 0 && (
          <div className="inline-flex items-center gap-1.5 bg-brand-100 text-brand-700 text-xs font-semibold mt-3 px-3 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            {t('pricing.trialDays').replace('{days}', String(plan.trialDays))}
          </div>
        )}
      </div>
      
      {/* Features */}
      <div className="space-y-1.5 md:space-y-2 px-3 flex-1">
        <FeatureRow
          included={true}
          text={`${plan.maxPages === null ? t('pricing.unlimited') : plan.maxPages} ${t('pricing.pages')}`}
          subtext={t('pricing.facebookInstagram')}
        />
        
        <FeatureRow
          included={true}
          highlight={true}
          text={`${plan.maxAiRepliesPerMonth === null ? t('pricing.unlimited') : plan.maxAiRepliesPerMonth.toLocaleString()} ${t('pricing.aiReplies')}`}
          subtext={t('pricing.aiPowered')}
        />
        
        <FeatureRow
          included={true}
          text={`${plan.maxTemplates === null ? t('pricing.unlimited') : plan.maxTemplates} ${t('pricing.templates')}`}
        />
        
        <FeatureRow
          included={true}
          text={`${plan.maxRules === null ? t('pricing.unlimited') : plan.maxRules} ${t('pricing.rules')}`}
        />
        
        <FeatureRow
          included={!plan.showBranding}
          text={plan.showBranding ? t('pricing.brandingShown') : t('pricing.brandingHidden')}
        />
        
        <FeatureRow
          included={plan.prioritySupport}
          text={plan.prioritySupport ? t('pricing.prioritySupport') : t('pricing.standardSupport')}
        />
      </div>
      
      {/* CTA */}
      <div className="mt-auto pt-4 px-3 pb-1">
        <Button
          onClick={onSelect}
          loading={loading}
          disabled={isCurrentPlan}
          variant={isPopular ? 'primary' : 'secondary'}
          className={`w-full py-4 text-sm md:text-base font-bold rounded-xl transition-all duration-300 ${
            isPopular ? 'shadow-lg shadow-brand-200 hover:shadow-brand-300' : ''
          }`}
        >
          {isCurrentPlan 
            ? t('pricing.currentPlan')
            : isFree 
              ? t('pricing.startTrial') 
              : t('pricing.upgrade')
          }
        </Button>
        {isFree && (
          <p className="text-xs text-surface-400 text-center mt-3 font-medium">
            * {t('pricing.noCreditCard')}
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
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
        included ? 'bg-green-100 text-green-600' : 'bg-surface-100 text-surface-300'
      }`}>
        {included ? (
          <Check className="w-3 h-3 stroke-[3]" />
        ) : (
          <X className="w-3 h-3 stroke-[3]" />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-xs md:text-sm font-semibold leading-snug ${
          included ? 'text-surface-700' : 'text-surface-400 line-through decoration-surface-300'
        }`}>
          {text}
        </span>
        {subtext && (
          <span className="text-[10px] md:text-xs text-surface-400 font-medium mt-0.5">
            {subtext}
          </span>
        )}
      </div>
    </div>
  );
}

export default function PricingPage() {
  const router = useRouter();
  const { t, language } = useTranslation();
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
  }, [isAuthenticated]);
  
  const handleSelectPlan = async (planId: string) => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    
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
      <DashboardLayout title={t('pricing.title')} isPublic={true}>
        <div className="flex items-center justify-center min-h-[400px]">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }
  
  const currentPlanId = usage?.subscription?.plan?.id;
  
  // Filter out inactive plans (like the old "free" plan)
  const activePlans = plans.filter(p => p.slug !== 'free' || p.isActive !== false);
  
  return (
    <DashboardLayout title={t('pricing.title')} isPublic={true}>
      {/* Simple Header */}
      <div className="text-center mb-10 md:mb-12">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-surface-900 mb-3">
          {t('pricing.title')}
        </h1>
        <p className="text-surface-500 text-sm max-w-md mx-auto">
          {language === 'ar' ? 'اختر الباقة المناسبة لعملك' : 'Choose the right plan for your business'}
        </p>
      </div>
      
      {/* Usage Summary if subscribed - Inline */}
      {usage && (
        <div className="flex flex-wrap items-center justify-center gap-4 mb-6 p-3 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-brand-600" />
            <span className="text-sm font-bold text-brand-700">
              {language === 'ar' ? (
                usage.subscription.plan.slug === 'starter' ? 'المبتدئ' :
                usage.subscription.plan.slug === 'business' ? 'الأعمال' :
                usage.subscription.plan.slug === 'pro' ? 'الاحترافي' :
                usage.subscription.plan.name
              ) : usage.subscription.plan.name}
            </span>
          </div>
          <div className="text-xs text-brand-600">
            {usage.aiReplies.used}/{usage.aiReplies.limit || '∞'} {language === 'ar' ? 'رد' : 'replies'}
          </div>
          {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
            <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              <Zap className="w-3 h-3" />
              {usage.subscription.trialDaysRemaining} {language === 'ar' ? 'يوم متبقي' : 'days left'}
            </div>
          )}
        </div>
      )}
      
      {/* Plans Grid - Centered for 3 plans */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5 lg:gap-8 pb-12 items-stretch max-w-6xl mx-auto px-4 md:px-6 lg:px-0 pt-4 md:pt-6">
        {activePlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={plan.id === currentPlanId}
            onSelect={() => handleSelectPlan(plan.id)}
            loading={changingPlan === plan.id}
            t={t}
            language={language}
          />
        ))}
      </div>
      
      {/* Simple footer note */}
      <div className="text-center py-6 text-sm text-surface-400">
        {language === 'ar' ? 'جميع الباقات تشمل دعم فيسبوك وإنستغرام' : 'All plans include Facebook & Instagram support'}
      </div>
    </DashboardLayout>
  );
}



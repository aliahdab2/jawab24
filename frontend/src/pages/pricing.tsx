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
          ? 'ring-2 ring-brand-500 shadow-brand-100 shadow-xl scale-105 z-10' 
          : 'border-surface-200'
      } ${isCurrentPlan ? 'bg-brand-50/50' : 'bg-white'}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-full flex justify-center">
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
      
      <div className="text-center mb-4 pt-3 px-2">
        <div className={`w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 rounded-xl flex items-center justify-center transition-transform duration-500 hover:rotate-12 ${
          plan.slug === 'free' ? 'bg-slate-100 text-slate-600' :
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
        <h3 className="text-lg md:text-xl font-bold text-surface-900 tracking-tight">{getPlanName()}</h3>
        {(plan.description || getPlanDescription()) && (
          <p className="text-xs md:text-sm text-surface-500 mt-1 leading-snug min-h-[32px] px-1">{getPlanDescription()}</p>
        )}
      </div>
      
      {/* Price - Compact */}
      <div className="text-center mb-4 md:mb-6 py-3 bg-surface-50/50 rounded-xl mx-2">
        <div className="flex items-baseline justify-center gap-0.5">
          <span className="text-3xl md:text-4xl font-extrabold text-surface-900">
            {isFree ? '$0' : formatPrice(plan.price)}
          </span>
          {!isFree && (
            <span className="text-surface-500 text-sm font-medium">{t('pricing.perMonth')}</span>
          )}
        </div>
        {plan.trialDays > 0 ? (
          <div className="inline-flex items-center gap-1 bg-brand-100/50 text-brand-700 text-[10px] font-semibold mt-2 px-2 py-0.5 rounded-full">
            <Zap className="w-2.5 h-2.5" />
            {t('pricing.trialDays').replace('{days}', String(plan.trialDays))}
          </div>
        ) : null}
      </div>
      
      {/* Features */}
      <div className="space-y-2 md:space-y-3 px-2 flex-1">
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
      <div className="mt-4 md:mt-6 pt-3">
        <Button
          onClick={onSelect}
          loading={loading}
          disabled={isCurrentPlan}
          variant={isPopular ? 'primary' : 'secondary'}
          className={`w-full py-4 md:py-5 text-sm md:text-base font-bold rounded-xl transition-all duration-300 ${
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
          <p className="text-[10px] text-surface-400 text-center mt-3 font-medium italic">
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
    <div className={`flex items-start gap-2 p-0.5 rounded-lg transition-colors ${highlight ? 'bg-brand-50/30' : ''}`}>
      <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
        included ? 'bg-green-100 text-green-600' : 'bg-surface-100 text-surface-300'
      }`}>
        {included ? (
          <Check className="w-2.5 h-2.5 stroke-[3]" />
        ) : (
          <X className="w-2.5 h-2.5 stroke-[3]" />
        )}
      </div>
      <div className="flex flex-col">
        <span className={`text-xs md:text-sm font-semibold tracking-tight leading-tight ${
          included ? 'text-surface-700' : 'text-surface-400 line-through decoration-surface-300'
        }`}>
          {text}
        </span>
        {subtext && (
          <span className="text-[9px] md:text-[10px] text-surface-500 font-medium leading-tight">
            {subtext}
          </span>
        )}
      </div>
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
        <div className="flex items-center justify-center min-h-[400px]">
          <PageSpinner />
        </div>
      </DashboardLayout>
    );
  }
  
  const currentPlanId = usage?.subscription?.plan?.id;
  
  return (
    <DashboardLayout title={t('pricing.title')}>
      {/* Hero Section - Compact */}
      <div className="relative overflow-hidden py-6 md:py-8 px-4 md:px-6 rounded-2xl md:rounded-3xl bg-surface-900 text-white mb-6 md:mb-8">
        {/* Background blobs - smaller */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-brand-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
        
        <div className="relative z-10">
          {/* Mobile: Icon + Title inline | Desktop: Stacked */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4 mb-3 md:mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                <Facebook className="w-4 h-4 md:w-5 md:h-5 text-white" />
              </div>
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                <Instagram className="w-4 h-4 md:w-5 md:h-5 text-white" />
              </div>
            </div>
            <h1 className="text-xl md:text-3xl lg:text-4xl font-display font-bold tracking-tight text-center md:text-start">
              {t('pricing.heroTitle')}
            </h1>
          </div>
          
          {/* Pills - inline on all screens */}
          <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4">
            <div className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 bg-white/5 rounded-full border border-white/10 text-xs md:text-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse"></div>
              <span className="font-medium">{t('pricing.replyToComments')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 bg-white/5 rounded-full border border-white/10 text-xs md:text-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
              <span className="font-medium">{t('pricing.aiPowered')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 bg-white/5 rounded-full border border-white/10 text-xs md:text-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
              <span className="font-medium">{t('pricing.works247')}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Usage Summary if subscribed - Compact */}
      {usage && (
        <Card className="mb-6 overflow-hidden border-none shadow-lg shadow-brand-100/30 bg-white">
          <div className="p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600">
                <Crown className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">{t('subscription.currentPlan')}</p>
                <p className="text-lg md:text-xl font-bold text-surface-900 tracking-tight">
                  {language === 'ar' ? (
                    usage.subscription.plan.slug === 'free' ? 'تجربة مجانية' :
                    usage.subscription.plan.slug === 'starter' ? 'المبتدئ' :
                    usage.subscription.plan.slug === 'business' ? 'الأعمال' :
                    usage.subscription.plan.slug === 'pro' ? 'الاحترافي' :
                    usage.subscription.plan.name
                  ) : usage.subscription.plan.name}
                </p>
                {usage.subscription.trialDaysRemaining && usage.subscription.trialDaysRemaining > 0 && (
                  <div className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-100">
                    <Zap className="w-2.5 h-2.5" />
                    {usage.subscription.trialDaysRemaining} {t('subscription.days')} {language === 'ar' ? 'متبقي' : 'left'}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-6 md:gap-8">
              <UsageMetric 
                label={t('subscription.aiRepliesUsed')} 
                used={usage.aiReplies.used} 
                limit={usage.aiReplies.limit} 
                t={t}
              />
              <UsageMetric 
                label={t('subscription.pagesUsed')} 
                used={usage.pages.used} 
                limit={usage.pages.limit} 
                t={t}
              />
            </div>
          </div>
        </Card>
      )}
      
      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 pb-8 items-stretch px-1 md:px-0">
        {plans.map((plan) => (
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
      
      {/* Trust section */}
      <div className="text-center pb-20 mt-10 border-t border-surface-100 pt-16">
        <h2 className="text-2xl font-bold text-surface-900 mb-8">{language === 'ar' ? 'نحن نهتم بنجاحك' : 'We care about your success'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <TrustItem 
            icon={<Zap className="w-6 h-6 text-brand-600" />}
            title={language === 'ar' ? 'إعداد سريع' : 'Fast Setup'}
            desc={language === 'ar' ? 'ابدأ في أقل من دقيقتين' : 'Get started in under 2 minutes'}
          />
          <TrustItem 
            icon={<Check className="w-6 h-6 text-green-600" />}
            title={language === 'ar' ? 'دقيق بنسبة 99%' : '99% Accurate'}
            desc={language === 'ar' ? 'ردود ذكية تفهم سياق الحديث' : 'Smart replies that understand context'}
          />
          <TrustItem 
            icon={<MessageSquare className="w-6 h-6 text-blue-600" />}
            title={language === 'ar' ? 'دعم مستمر' : 'Always Here'}
            desc={language === 'ar' ? 'فريق الدعم متواجد لمساعدتك' : 'Our team is here to help you'}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

function UsageMetric({ label, used, limit, t }: { label: string; used: number; limit: number | null; t: any }) {
  const percent = limit ? Math.round((used / limit) * 100) : 0;
  
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-bold text-surface-400 uppercase tracking-widest">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-surface-900">{used.toLocaleString()}</span>
        <span className="text-surface-400 font-medium text-sm">/ {limit ? limit.toLocaleString() : '∞'}</span>
      </div>
      {limit && (
        <div className="w-32 h-1.5 bg-surface-100 rounded-full overflow-hidden mt-1">
          <div 
            className={`h-full rounded-full ${percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-amber-500' : 'bg-brand-500'}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}

function TrustItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="group flex flex-col items-center text-center p-6 rounded-2xl transition-all duration-300 hover:bg-white hover:shadow-lg hover:shadow-brand-50/50">
      <div className="w-12 h-12 rounded-2xl bg-surface-50 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110">
        {icon}
      </div>
      <h4 className="text-lg font-bold text-surface-900 mb-2">{title}</h4>
      <p className="text-sm text-surface-500 leading-relaxed">{desc}</p>
    </div>
  );
}


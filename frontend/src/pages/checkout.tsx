import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslation, type TranslationKey } from '@/i18n';

import { Button } from '@/components/ui';
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft, MessageCircle } from 'lucide-react';
import { api, publicApi } from '@/lib/api';

export default function CheckoutPage() {
  const router = useRouter();
  const { planId } = router.query;
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [fetchError, setFetchError] = useState(false);

  // Extract translated string before useEffect to avoid dependency on t
  const errorLoadPlanMessage = t('checkout.errorLoadPlan');

  useEffect(() => {
    // Prevent re-fetching if already loaded or errored
    if (plan || fetchError || !planId) return;

    const fetchPlan = async () => {
      try {
        const response = await publicApi.get(`/plans/${planId}`);
        const planData = response.data.data || response.data;

        // If it's a FREE plan, redirect to dashboard as they get it for free
        // But only if they don't have a plan yet (otherwise it might be a downgrade)
        if (planData.price === 0) {
          const token = localStorage.getItem('token');
          if (token) {
            router.push('/dashboard');
            return;
          }
        }

        setPlan(planData);
      } catch (err) {
        console.error('Failed to fetch plan:', err);
        setFetchError(true);
        setError(errorLoadPlanMessage);
      }
    };

    fetchPlan();
  }, [planId, plan, fetchError, errorLoadPlanMessage]);

  const handleCheckout = async () => {
    if (!planId) return;

    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login?redirect=/checkout?planId=' + planId);
        return;
      }

      // Create checkout session (uses authenticated api client)
      const response = await api.post('/payment/create-checkout-session', {
        planId,
        successUrl: `${window.location.origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/payment/cancel`,
      });

      const { url } = response.data;

      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: any) {
      console.error('Checkout error:', err);

      // Handle specific error cases
      const errorData = err.response?.data;
      if (errorData?.code === 'EMAIL_REQUIRED') {
        // Email is missing - redirect to complete profile then back to checkout
        router.push(`/complete-profile?redirect=/checkout?planId=${planId}`);
        return;
      }

      setError(errorData?.error || errorData?.message || t('checkout.errorInitiateCheckout'));
      setLoading(false);
    }
  };

  if (!plan && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{t('checkout.title')} - Jawab24</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 py-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/landing" className="inline-flex flex-col items-center gap-2 mb-6 group">
              <img
                src="/logo-sm.png"
                alt="Jawab24 Logo"
                className="w-14 h-14 rounded-2xl shadow-lg shadow-brand-500/20 group-hover:rotate-6 transition-transform"
              />
              <span className="font-display font-bold text-2xl tracking-tight text-surface-900 group-hover:text-brand-600 transition-colors">
                Jawab24
              </span>
            </Link>
            <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 mb-2">
              {t('checkout.title')}
            </h1>
            <p className="text-surface-600">
              {t('checkout.subtitle')}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-start">
              {error}
            </div>
          )}

          {plan && (
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
              {/* Plan Details */}
              <div className="border-b border-surface-200 pb-6 mb-6 text-start">
                <h2 className="text-2xl font-bold text-surface-900 mb-2">
                  {t(`pricing.${plan.slug}` as TranslationKey) !== `pricing.${plan.slug}`
                    ? t(`pricing.${plan.slug}` as TranslationKey)
                    : (t(`plans.${plan.slug}.name` as TranslationKey) !== `plans.${plan.slug}.name` ? t(`plans.${plan.slug}.name` as TranslationKey) : plan.name)}
                </h2>
                <p className="text-surface-600 mb-4">
                  {t(`pricing.${plan.slug}Desc` as TranslationKey) !== `pricing.${plan.slug}Desc`
                    ? t(`pricing.${plan.slug}Desc` as TranslationKey)
                    : (t(`plans.${plan.slug}.description` as TranslationKey) !== `plans.${plan.slug}.description` ? t(`plans.${plan.slug}.description` as TranslationKey) : plan.description)}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-brand-600">
                    ${(plan.price / 100).toFixed(2)}
                  </span>
                  <span className="text-surface-600">
                    / {t('plans.month')}
                  </span>
                </div>
              </div>

              {/* Features */}
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-surface-700 text-start">
                    {plan.maxPages === null ? t('pricing.unlimited') : plan.maxPages} {t('plans.pages')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <span className="text-surface-700 text-start">
                    {plan.maxAiRepliesPerMonth === null ? t('pricing.unlimited') : plan.maxAiRepliesPerMonth.toLocaleString()} {t('plans.aiReplies')}
                  </span>
                </div>
                {plan.trialDays > 0 && (
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span className="text-surface-700 text-start">
                      {t('pricing.trialDays', { days: plan.trialDays })}
                    </span>
                  </div>
                )}
              </div>

              {/* Checkout Button */}
              <Button
                size="lg"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleCheckout}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t('checkout.processing')}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>{t('checkout.continueToPayment')}</span>
                    <ArrowRight className="w-5 h-5 transition-transform rtl:rotate-180" />
                  </div>
                )}
              </Button>

              <p className="text-center text-sm text-surface-500 mt-4">
                {t('checkout.securePayment')}
              </p>
            </div>
          )}

          {/* Back Link */}
          <div className="text-center">
            <Link href="/pricing" className="text-brand-600 hover:text-brand-700 font-medium inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4 transition-transform rtl:rotate-180" />
              {t('checkout.backToPricing')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}


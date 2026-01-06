import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslation, type TranslationKey } from '@/i18n';
import { BRAND_ASSETS } from '@/constants/brand';
import { isUserSanctioned } from '@/utils/geoCheck';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';

import { Button, BrandLogo } from '@/components/ui';
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { api, publicApi } from '@/lib/api';

export default function CheckoutPage() {
  const router = useRouter();
  const { planId } = router.query;
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [fetchError, setFetchError] = useState(false);
  const [isSanctioned, setIsSanctioned] = useState<boolean | null>(null); // null = checking

  // Extract translated string before useEffect to avoid dependency on t
  const errorLoadPlanMessage = t('checkout.errorLoadPlan');

  // SANCTIONS CHECK: Check geo on page load
  useEffect(() => {
    const checkGeo = async () => {
      const sanctioned = await isUserSanctioned();
      setIsSanctioned(sanctioned);
    };
    checkGeo();
  }, []);

  useEffect(() => {
    // Prevent re-fetching if already loaded or errored
    if (plan || fetchError || !planId) return;

    // Do not fetch plan if sanctioned (will show blocked message)
    if (isSanctioned === true) return;

    // Wait for geo check to complete
    if (isSanctioned === null) return;

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
  }, [planId, plan, fetchError, errorLoadPlanMessage, isSanctioned, router]);

  const handleCheckout = async () => {
    if (!planId) return;

    // SANCTIONS CHECK: Do not proceed if sanctioned
    if (isSanctioned) {
      console.warn('[Checkout] Blocked: user is in sanctioned jurisdiction');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login?redirect=/checkout?planId=' + planId);
        return;
      }

      // Create checkout session (uses authenticated api client)
      // Backend will also check geo and return 403 if sanctioned
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

      // Handle sanctions block from backend
      if (errorData?.code === 'SANCTIONED_GEO_BLOCK' || errorData?.code === 'GEO_VERIFICATION_REQUIRED') {
        setIsSanctioned(true);
        return;
      }

      if (errorData?.code === 'EMAIL_REQUIRED') {
        // Email is missing - redirect to complete profile then back to checkout
        router.push(`/complete-profile?redirect=/checkout?planId=${planId}`);
        return;
      }

      setError(errorData?.error || errorData?.message || t('checkout.errorInitiateCheckout'));
      setLoading(false);
    }
  };

  // EARLY RETURN 1: Show loading while checking geo
  if (isSanctioned === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  // EARLY RETURN 2: Show blocked message for sanctioned geos
  // CRITICAL: This prevents ANY Stripe code from being reachable
  if (isSanctioned) {
    return (
      <>
        <Head>
          <title>{t('checkout.title')} - Jawab24</title>
          <meta name="robots" content="noindex, follow" />
        </Head>

        <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 py-8 md:py-12 px-4">
          <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
              <Link href="/">
                <BrandLogo variant="main" className="w-10 h-10 mx-auto mb-4" />
              </Link>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                {t('checkout.title')}
              </h1>
            </div>

            {/* Blocked Message */}
            <div className="py-12">
              <PaymentsUnavailableNotice />
              <div className="mt-8 text-center">
                <Link href="/pricing">
                  <Button variant="secondary">
                    <ArrowLeft className="w-4 h-4 ltr:mr-2 rtl:ml-2" />
                    {t('checkout.backToPricing')}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // EARLY RETURN 3: Show loading while fetching plan (only for allowed geos)
  if (!plan && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  // NORMAL CHECKOUT FLOW - Only reachable if NOT sanctioned
  return (
    <>
      <Head>
        <title>{t('checkout.title')} - Jawab24</title>
        <meta name="description" content={t('checkout.subtitle')} />
        <link rel="canonical" href="https://jawab24.com/checkout" />
        <meta name="robots" content="noindex, follow" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-violet-50 py-8 md:py-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/" className="flex items-center gap-3">
              <BrandLogo
                variant="main"
                className="w-10 h-10"
              />
              <span className="font-display font-bold text-2xl text-surface-900 tracking-tight">{BRAND_ASSETS.meta.appName}</span>
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
            <div className="bg-white rounded-2xl p-8 mb-6" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.04)' }}>
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
                    ${(plan.price / 100).toFixed(2).split('.')[0]}<span className="opacity-60 text-3xl">.{(plan.price / 100).toFixed(2).split('.')[1]}</span>
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

              <Button
                size="lg"
                className="w-full h-[52px] shadow-md hover:shadow-lg flex items-center justify-center gap-2"
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

              <p className="text-center text-xs text-surface-400 mt-6">
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


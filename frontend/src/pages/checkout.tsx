import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BRAND_ASSETS } from '@/constants/brand';
import { isUserSanctioned } from '@/utils/geoCheck';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';
import { useAuthStore } from '@/lib/store';

import { Button, BrandLogo } from '@/components/ui';
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft, AlertTriangle } from 'lucide-react';
import { api, publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { Plan } from '@jawab24/shared';

// Set to true to disable checkout (e.g. during Stripe price changes)
function isCheckoutMaintenance() {
  return process.env.NEXT_PUBLIC_CHECKOUT_MAINTENANCE === 'true';
}

export default function CheckoutPage() {
  const router = useRouter();
  const { planId } = router.query;
  const t = useTranslations('checkout');
  const tPricing = useTranslations('pricing');
  const tPlans = useTranslations('plans');
  const tLanding = useTranslations('landing');
  const { isAuthenticated } = useAuthStore();

  // On native (Android/iOS), redirect to web checkout — Google Play prohibits Stripe in-app
  useEffect(() => {
    if (isNativePlatform()) {
      const locale = router.locale === 'en' ? '/en' : '';
      openExternalUrl(`https://jawab24.com${locale}/pricing`);
    }
  }, [router.locale]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [isSanctioned, setIsSanctioned] = useState<boolean | null>(null); // null = checking

  // Extract translated string before useEffect to avoid dependency on t
  const errorLoadPlanMessage = t('errorLoadPlan');

  // SANCTIONS CHECK: Check geo on page load
  useEffect(() => {
    if (isNativePlatform()) return; // Skip on native — redirected above
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
        if (planData.price === 0 && isAuthenticated) {
          router.push('/dashboard');
          return;
        }

        setPlan(planData);
      } catch (err) {
        captureError(err, 'Failed to fetch plan', { tags: { page: 'checkout', action: 'fetch-plan' } });
        setFetchError(true);
        setError(errorLoadPlanMessage);
      }
    };

    fetchPlan();
  }, [planId, plan, fetchError, errorLoadPlanMessage, isSanctioned, router, isAuthenticated]);

  const handleCheckout = async () => {
    if (!planId) return;

    // SANCTIONS CHECK: Do not proceed if sanctioned
    if (isSanctioned) {
      captureError(new Error('Checkout blocked: sanctioned jurisdiction'), 'Sanctions block on checkout', { tags: { page: 'checkout', action: 'sanctions_block' }, level: 'warning' });
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Check if user is authenticated (web uses cookies, mobile uses token)
      if (!isAuthenticated) {
        // ENCODE THE REDIRECT URL PROPERLY
        const returnUrl = `/checkout?planId=${planId}`;
        router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
        return;
      }

      // Create checkout session (uses authenticated api client)
      // Backend will also check geo and return 403 if sanctioned
      // IMPORTANT: Use production URL for return URLs, not window.location.origin
      // On mobile (Capacitor), window.location.origin is "localhost" which breaks Stripe redirects
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jawab24.com';
      const baseUrl = siteUrl.replace(/\/$/, ''); // Remove trailing slash
      
      const response = await api.post('/payment/create-checkout-session', {
        planId,
        successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/payment/cancel`,
      });

      const { url } = response.data;

      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: unknown) {
      captureError(err, 'Checkout error', { tags: { page: 'checkout', action: 'create-session' } });

      // Handle specific error cases
      const axiosErr = err as { response?: { data?: { code?: string; error?: string; message?: string } } };
      const errorData = axiosErr.response?.data;

      // Handle sanctions block from backend
      if (errorData?.code === 'SANCTIONED_GEO_BLOCK' || errorData?.code === 'GEO_VERIFICATION_REQUIRED') {
        setIsSanctioned(true);
        return;
      }

      if (errorData?.code === 'EMAIL_REQUIRED') {
        // Email is missing - redirect to complete profile then back to checkout
        const returnUrl = `/checkout?planId=${planId}`;
        router.push(`/complete-profile?redirect=${encodeURIComponent(returnUrl)}`);
        return;
      }

      setError(errorData?.error || errorData?.message || t('errorInitiateCheckout'));
      setLoading(false);
    }
  };

  const maintenanceMode = isCheckoutMaintenance();

  // EARLY RETURN 1: Show loading while checking geo
  if (isSanctioned === null) {
    return (
      <div className="flex-1 flex items-center justify-center ">
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
          <title>{t('title')} - Jawab24</title>
          <meta name="robots" content="noindex, follow" />
        </Head>

        <div className="flex-1 flex flex-col overflow-y-auto bg-background">
          <div className="flex-1  px-5 sm:px-6 py-8 sm:py-12 px-safe-landscape">
            <div className="max-w-md mx-auto w-full">

              {/* Header: Back link on one side, Logo on other */}
              <div className="flex items-center justify-between mb-8 sm:mb-10">
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 text-muted-foreground font-medium text-sm hover:text-brand-600 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                  {t('backToPricing')}
                </Link>

                <Link href="/" className="inline-flex items-center gap-2 group">
                  <span className="font-display font-bold text-lg text-foreground tracking-tight">
                    {BRAND_ASSETS.meta.appName}
                  </span>
                  <BrandLogo variant="main" className="w-9 h-9 transition-transform group-hover:scale-105" />
                </Link>
              </div>

              {/* Title */}
              <div className="text-center mb-8 sm:mb-10">
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2 tracking-tight font-display">
                  {t('title')}
                </h1>
              </div>

              {/* Blocked Message */}
              <PaymentsUnavailableNotice />
            </div>
          </div>
        </div>
      </>
    );
  }

  // EARLY RETURN 3: Show loading while fetching plan (only for allowed geos)
  if (!plan && !error) {
    return (
      <div className="flex-1 flex items-center justify-center ">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  // NORMAL CHECKOUT FLOW - Only reachable if NOT sanctioned
  return (
    <>
      <Head>
        <title>{t('title')} - Jawab24</title>
        <meta name="description" content={t('subtitle')} />
        <meta name="robots" content="noindex, follow" />
      </Head>

      <div className="flex-1 flex flex-col overflow-y-auto bg-background">
        {/* Content container - fills space with consistent background */}
        <div className="flex-1  px-5 sm:px-6 py-8 sm:py-12 px-safe-landscape">
          <div className="max-w-md mx-auto w-full">

            {/* Header: Back link on one side, Logo on other */}
            <div className="flex items-center justify-between mb-8 sm:mb-10">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 text-muted-foreground font-medium text-sm hover:text-brand-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                {t('backToPricing')}
              </Link>

              <Link href="/" className="inline-flex items-center gap-2 group">
                <span className="font-display font-bold text-lg text-foreground tracking-tight">
                  {BRAND_ASSETS.meta.appName}
                </span>
                <BrandLogo
                  variant="main"
                  className="w-9 h-9 transition-transform group-hover:scale-105"
                />
              </Link>
            </div>

            {/* Title */}
            <div className="text-center mb-8 sm:mb-10">
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2 tracking-tight font-display">
                {t('title')}
              </h1>
              <p className="text-muted-foreground text-base">
                {t('subtitle')}
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 alert-error border rounded-2xl text-start text-sm">
                {error}
              </div>
            )}

            {plan && (
              <div className="bg-card rounded-3xl p-6 sm:p-8 shadow-xl shadow-surface-900/5 border border-theme-border">
                {/* Plan Details */}
                {/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic plan slug keys */}
                <div className="border-b border-theme-border pb-6 mb-6 text-start">
                  <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1">
                    {tPricing(plan.slug as any) !== plan.slug
                      ? tPricing(plan.slug as any)
                      : (tPlans(`${plan.slug}.name` as any) !== `${plan.slug}.name` ? tPlans(`${plan.slug}.name` as any) : plan.name)}
                  </h2>
                  <p className="text-muted-foreground text-sm mb-5">
                    {tPricing(`${plan.slug}Desc` as any) !== `${plan.slug}Desc`
                      ? tPricing(`${plan.slug}Desc` as any)
                      : (tPlans(`${plan.slug}.description` as any) !== `${plan.slug}.description` ? tPlans(`${plan.slug}.description` as any) : plan.description)}
                  </p>
                {/* eslint-enable @typescript-eslint/no-explicit-any */}
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl sm:text-5xl font-bold text-brand-600 font-display">
                      ${(plan.price / 100).toFixed(2).split('.')[0]}
                      <span className="text-2xl sm:text-3xl opacity-70">.{(plan.price / 100).toFixed(2).split('.')[1]}</span>
                    </span>
                    <span className="text-muted-foreground font-medium">
                      / {tPlans('month')}
                    </span>
                  </div>
                </div>

                {/* Features */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="text-foreground/70 font-medium text-start">
                      {plan.maxPages === null ? tPricing('unlimited') : plan.maxPages} {tPlans('pages')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="text-foreground/70 font-medium text-start">
                      {plan.maxAiRepliesPerMonth === null ? tPricing('unlimited') : plan.maxAiRepliesPerMonth.toLocaleString()} {tPlans('aiReplies')}
                    </span>
                  </div>
                  {plan.trialDays > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      </div>
                      <span className="text-foreground/70 font-medium text-start">
                        {tPricing('trialDays', { days: plan.trialDays })}
                      </span>
                    </div>
                  )}
                </div>

                {maintenanceMode && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {tLanding('comingSoon.subtitle')}
                    </p>
                  </div>
                )}

                <Button
                  size="lg"
                  className="w-full h-14 shadow-lg shadow-brand-600/20 hover:shadow-xl hover:shadow-brand-600/25 flex items-center justify-center gap-2 text-base font-bold rounded-2xl"
                  onClick={handleCheckout}
                  disabled={loading || maintenanceMode}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {t('processing')}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>{t('continueToPayment')}</span>
                      <ArrowRight className="w-5 h-5 transition-transform rtl:rotate-180" />
                    </div>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground mt-5 font-medium">
                  {t('securePayment')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.checkout]);

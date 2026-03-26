import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { BRAND_ASSETS } from '@/constants/brand';
import { isUserSanctioned } from '@/utils/geoCheck';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';
import { useAuthStore } from '@/lib/store';

import { Button, BrandLogo } from '@/components/ui';
import { CheckCircle2, Loader2, ArrowLeft, AlertTriangle, LogIn } from 'lucide-react';
import { api, publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import type { Plan } from '@jawab24/shared';
import { getDisplayPrice, getMonthlyEquivalent } from '@/utils/pricing';

// Set to true to disable checkout (e.g. during Stripe price changes)
function isCheckoutMaintenance() {
  return process.env.NEXT_PUBLIC_CHECKOUT_MAINTENANCE === 'true';
}

// Initialize Stripe lazily — singleton pattern avoids re-creating on each render
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  if (!stripePromise && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { planId, interval, theme: themeParam } = router.query;
  const billingInterval = interval === 'year' ? 'year' : 'month';
  const t = useTranslations('checkout');
  const tPricing = useTranslations('pricing');
  const tPlans = useTranslations('plans');
  const tLanding = useTranslations('landing');
  const { isAuthenticated } = useAuthStore();

  // Apply theme from URL param (used when opened from native app's in-app browser)
  useEffect(() => {
    if (themeParam === 'dark' || themeParam === 'light') {
      document.documentElement.classList.toggle('dark', themeParam === 'dark');
    }
  }, [themeParam]);

  // On native (Android/iOS), redirect to web checkout — Google Play prohibits Stripe in-app
  useEffect(() => {
    if (isNativePlatform()) {
      const locale = router.locale === 'en' ? '/en' : '';
      openExternalUrl(`https://jawab24.com${locale}/pricing`);
    }
  }, [router.locale]);

  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [isSanctioned, setIsSanctioned] = useState<boolean | null>(null); // null = checking
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

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

        // If it's a FREE plan, redirect to dashboard — free plan activation
        // is automatic. Downgrades (cancellations) are handled via the
        // billing portal or cancel-subscription endpoint, not checkout.
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

  // Create embedded checkout session once plan is loaded and user is authenticated
  const createSession = useCallback(async () => {
    if (!plan || !isAuthenticated || clientSecret || sessionLoading || isSanctioned) return;

    setSessionLoading(true);
    setError('');

    try {
      const response = await api.post('/payment/create-checkout-session', {
        planId: plan.id,
        billingInterval,
      });

      setClientSecret(response.data.clientSecret);
    } catch (err: unknown) {
      captureError(err, 'Checkout error', { tags: { page: 'checkout', action: 'create-session' } });

      const axiosErr = err as { response?: { data?: { code?: string; error?: string; message?: string } } };
      const errorData = axiosErr.response?.data;

      if (errorData?.code === 'SANCTIONED_GEO_BLOCK' || errorData?.code === 'GEO_VERIFICATION_REQUIRED') {
        setIsSanctioned(true);
        return;
      }

      if (errorData?.code === 'EMAIL_REQUIRED') {
        const returnUrl = `/checkout?planId=${plan.id}&interval=${billingInterval}`;
        router.push(`/complete-profile?redirect=${encodeURIComponent(returnUrl)}`);
        return;
      }

      setError(errorData?.error || errorData?.message || t('errorInitiateCheckout'));
    } finally {
      setSessionLoading(false);
    }
  }, [plan, isAuthenticated, clientSecret, sessionLoading, isSanctioned, billingInterval, router, t]);

  useEffect(() => {
    createSession();
  }, [createSession]);

  const handleLogin = () => {
    if (!plan) return;
    const returnUrl = `/checkout?planId=${plan.id}&interval=${billingInterval}`;
    router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  const maintenanceMode = isCheckoutMaintenance();

  // EARLY RETURN 1: Show loading while checking geo
  if (isSanctioned === null) {
    return (
      <div className="flex-1 flex items-center justify-center" role="status" aria-busy="true">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" aria-hidden="true" />
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
      <div className="flex-1 flex items-center justify-center" role="status" aria-busy="true">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" aria-hidden="true" />
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
        <div className="flex-1 px-5 sm:px-6 py-6 sm:py-10 px-safe-landscape">

          {/* Header */}
          <div className="max-w-4xl mx-auto w-full flex items-center justify-between mb-6 sm:mb-8">
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

          {error && (
            <div className="max-w-4xl mx-auto mb-6 p-4 alert-error border rounded-2xl text-start text-sm">
              {error}
            </div>
          )}

          {plan && (
            <div className="max-w-4xl mx-auto w-full">

              {maintenanceMode && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 mb-6">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {tLanding('comingSoon.subtitle')}
                  </p>
                </div>
              )}

              {/* Two-column layout: order summary + payment form */}
              <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 lg:items-start">

                {/* Order Summary — sidebar on desktop, compact card on mobile */}
                <div className="lg:w-80 lg:flex-shrink-0 lg:sticky lg:top-10">
                  <div className="bg-card rounded-2xl p-5 sm:p-6 border border-theme-border shadow-sm">
                    {/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic plan slug keys */}
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      {t('orderSummary')}
                    </p>
                    <h2 className="text-lg font-bold text-foreground mb-0.5 text-start">
                      {tPricing(plan.slug as any) !== plan.slug
                        ? tPricing(plan.slug as any)
                        : (tPlans(`${plan.slug}.name` as any) !== `${plan.slug}.name` ? tPlans(`${plan.slug}.name` as any) : plan.name)}
                    </h2>
                    <p className="text-muted-foreground text-xs mb-4 text-start">
                      {tPricing(`${plan.slug}Desc` as any) !== `${plan.slug}Desc`
                        ? tPricing(`${plan.slug}Desc` as any)
                        : (tPlans(`${plan.slug}.description` as any) !== `${plan.slug}.description` ? tPlans(`${plan.slug}.description` as any) : plan.description)}
                    </p>
                    {/* eslint-enable @typescript-eslint/no-explicit-any */}

                    <div className="border-t border-theme-border pt-4 mb-4">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold text-brand-600 font-display">
                          ${(getDisplayPrice(plan.price, billingInterval, plan.yearlyPrice) / 100).toFixed(2).split('.')[0]}
                          <span className="text-xl opacity-70">.{(getDisplayPrice(plan.price, billingInterval, plan.yearlyPrice) / 100).toFixed(2).split('.')[1]}</span>
                        </span>
                        <span className="text-muted-foreground text-sm font-medium">
                          / {billingInterval === 'year' ? tPlans('year') : tPlans('month')}
                        </span>
                      </div>
                      {billingInterval === 'year' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {tPlans('perMonthEquivalent', { amount: `$${(getMonthlyEquivalent(plan.price, billingInterval, plan.yearlyPrice) / 100).toFixed(2)}` })} &middot; {tPlans('billedAnnually')}
                        </p>
                      )}
                    </div>

                    {/* Features */}
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                        <span className="text-foreground/80 text-sm text-start">
                          {plan.maxPages === null ? tPricing('unlimited') : plan.maxPages} {tPlans('pages')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                        <span className="text-foreground/80 text-sm text-start">
                          {plan.maxAiRepliesPerMonth === null ? tPricing('unlimited') : plan.maxAiRepliesPerMonth.toLocaleString()} {tPlans('aiReplies')}
                        </span>
                      </div>
                      {plan.trialDays > 0 && (
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                          <span className="text-foreground/80 text-sm text-start">
                            {tPricing('trialDays', { days: plan.trialDays })}
                          </span>
                        </div>
                      )}
                    </div>

                    <p className="text-center text-xs text-muted-foreground mt-4 pt-4 border-t border-theme-border">
                      {t('securePayment')}
                    </p>
                  </div>
                </div>

                {/* Payment Form — main area */}
                <div className="flex-1 min-w-0">
                  {!maintenanceMode && (
                    <>
                      {!isAuthenticated ? (
                        <div className="bg-card rounded-2xl p-6 sm:p-8 border border-theme-border text-center">
                          <p className="text-muted-foreground mb-4">
                            {t('loginToCheckout')}
                          </p>
                          <Button
                            size="lg"
                            className="w-full h-14 shadow-lg shadow-brand-600/20 hover:shadow-xl hover:shadow-brand-600/25 flex items-center justify-center gap-2 text-base font-bold rounded-2xl"
                            onClick={handleLogin}
                          >
                            <LogIn className="w-5 h-5" />
                            {t('loginButton')}
                          </Button>
                        </div>
                      ) : clientSecret && getStripePromise() ? (
                        <div className="rounded-2xl overflow-hidden">
                          <EmbeddedCheckoutProvider stripe={getStripePromise()!} options={{ clientSecret }}>
                            <EmbeddedCheckout />
                          </EmbeddedCheckoutProvider>
                        </div>
                      ) : sessionLoading ? (
                        <div className="flex flex-col items-center justify-center py-16" role="status" aria-busy="true">
                          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-3" aria-hidden="true" />
                          <p className="text-muted-foreground text-sm" aria-live="polite">{t('loadingPaymentForm')}</p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.checkout]);

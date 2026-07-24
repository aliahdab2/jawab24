import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MessageKeys, NestedKeyOf } from 'use-intl';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { StripeElementLocale } from '@stripe/stripe-js';
import { getStripePromise, getStripeAppearance } from '@/lib/stripeClient';
import { BRAND_ASSETS } from '@/constants/brand';
import { isUserSanctioned } from '@/utils/geoCheck';
import { isWhatsAppMarketable } from '@/lib/featureFlags';
import { PaymentsUnavailableNotice } from '@/components/PaymentsUnavailableNotice';
import { useAuthStore } from '@/lib/store';
import { withOwnerOnly } from '@/hoc';
import { useLocale } from 'next-intl';

import { Button, BrandLogo } from '@/components/ui';
import {
  CheckCircle2, Loader2, ArrowLeft, AlertTriangle,
  LogIn, Lock, Shield, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api, publicApi } from '@/lib/api';
import { captureError } from '@/lib/sentryHelpers';
import { isNativePlatform } from '@/lib/capacitor';
import { useIOSPaymentRedirect, useIsDarkMode } from '@/hooks';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebUrl } from '@/lib/webUrl';
import type { Plan } from '@jawab24/shared';
import { getDisplayPrice, getMonthlyEquivalent, getSarMonthlyEquivalent } from '@/utils/pricing';

type TopupPack = '5k' | '10k';
interface TopupInfo {
  repliesAdded: number;
  priceCents: number;
}

function isCheckoutMaintenance(): boolean {
  return process.env.NEXT_PUBLIC_CHECKOUT_MAINTENANCE === 'true';
}

function CheckoutHeader({ className, backHref, backLabel }: { className?: string; backHref: string; backLabel: string }) {
  return (
    <div className={`mx-auto w-full flex items-center justify-between mb-6 sm:mb-8 ${className ?? ''}`}>
      <Link href={backHref} className="inline-flex items-center gap-2 text-muted-foreground font-medium text-sm hover:text-brand-600 transition-colors">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
        {backLabel}
      </Link>
      <Link href="/" className="inline-flex items-center gap-2 group">
        <span className="font-display font-bold text-lg text-foreground tracking-tight">{BRAND_ASSETS.meta.appName}</span>
        <BrandLogo variant="main" className="w-9 h-9 transition-transform group-hover:scale-105" />
      </Link>
    </div>
  );
}

function FullPageSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center" role="status" aria-busy="true">
      <Loader2 className="w-8 h-8 animate-spin text-brand-600" aria-hidden="true" />
    </div>
  );
}

/**
 * Inner form component — must be rendered inside <Elements>. Presentational
 * props only (no Plan coupling) so it serves both the subscription checkout
 * and the one-time top-up checkout:
 *  - subscription: type may be 'setup' (trial) or 'payment'; trialDays drives
 *    the trial callout + button copy.
 *  - top-up: type is always 'payment'; trialDays omitted; submitLabel is the
 *    one-time "Pay $X" copy.
 */
function PaymentForm({
  type,
  submitLabel,
  trustNote,
  trialDays,
}: {
  type: 'payment' | 'setup';
  submitLabel: string;
  trustNote: string;
  trialDays?: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const t = useTranslations('checkout');

  const returnUrl = `${BRAND_ASSETS.urls.base}/payment/return`;

  const hasTrial = !!trialDays && trialDays > 0 && type === 'setup';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMessage('');

    const confirmFn = type === 'setup'
      ? stripe.confirmSetup
      : stripe.confirmPayment;

    const { error } = await confirmFn({
      elements,
      confirmParams: { return_url: returnUrl },
    });

    if (error) {
      captureError(error, 'Payment confirmation error', { tags: { page: 'checkout', type } });
      setErrorMessage(error.message || t('errorInitiateCheckout'));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Stripe Link is disabled server-side on the PaymentIntent (payment_method_types).
          PaymentElement's wallets option only supports applePay/googlePay — `link` is
          not a valid wallet key here. */}
      <PaymentElement />

      {/* Trust cue — lock + label placed within the card-field area. Baymard finds
          a security cue encapsulating the sensitive fields best reinforces perceived
          security (and ~18% of users abandon over trust concerns); icon + text
          together outperforms either alone. Stripe handles inline field validation,
          so the submit button stays always-enabled (disabling-until-valid is a known
          anti-pattern that breaks autofill/paste on mobile). */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
        {t('securePayment')}
      </p>

      {errorMessage && (
        <div className="mt-4 p-3 alert-error border rounded-xl text-sm text-start">
          {errorMessage}
        </div>
      )}

      {/* Trial callout — prominent, above the button */}
      {hasTrial && (
        <div className="mt-5 flex items-start gap-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/30 px-4 py-3">
          <Shield className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
              {t('startTrial', { days: trialDays! })}
            </p>
            <p className="text-xs text-brand-600/80 dark:text-brand-400/80 mt-0.5">
              {t('trialNote')}
            </p>
          </div>
        </div>
      )}

      {/* Smart submit button */}
      <Button
        type="submit"
        size="lg"
        disabled={!stripe || submitting}
        className="w-full h-14 mt-5 shadow-lg shadow-brand-600/20 hover:shadow-xl hover:shadow-brand-600/25 flex items-center justify-center gap-2 text-base font-bold rounded-2xl"
      >
        {submitting ? (
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
        ) : (
          <>
            <Lock className="w-4 h-4" aria-hidden="true" />
            {hasTrial ? t('startTrial', { days: trialDays! }) : submitLabel}
          </>
        )}
      </Button>

      {/* Trust signal */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        {trustNote}
      </p>
    </form>
  );
}

function CheckoutPage() {
  const router = useRouter();
  const { planId, interval, theme: themeParam, topup } = router.query;
  const billingInterval = interval === 'year' ? 'year' : 'month';
  const topupPack: TopupPack | null = topup === '5k' || topup === '10k' ? topup : null;
  const isTopup = !!topupPack;
  const locale = useLocale();
  const t = useTranslations('checkout');
  const tTopup = useTranslations('topup');
  const tPricing = useTranslations('pricing');
  const tPlans = useTranslations('plans');
  const tLanding = useTranslations('landing');
  const { isAuthenticated } = useAuthStore();

  // Where the header "back" link goes — top-up buyers came from the dashboard
  // modal, subscription buyers from pricing.
  const backHref = isTopup ? '/dashboard' : '/pricing';
  const backLabel = isTopup ? t('backToDashboard') : t('backToPricing');

  // Browser tab title + meta must reflect the purchase type — a one-time top-up
  // is not a subscription (the AR subscription title literally reads "complete
  // the subscription", wrong for a credit top-up).
  const pageTitle = isTopup ? t('topupSummaryTitle') : t('title');
  const pageDescription = isTopup ? t('topupSummaryTitle') : t('subtitle');

  useEffect(() => {
    if (themeParam === 'dark' || themeParam === 'light') {
      document.documentElement.classList.toggle('dark', themeParam === 'dark');
    }
  }, [themeParam]);

  const iosRedirecting = useIOSPaymentRedirect();

  useEffect(() => {
    if (iosRedirecting) return;
    if (isNativePlatform()) {
      // Native apps can't show payment UI in-app (App Store Guideline 3.1.1) —
      // bounce to the web. Preserve the top-up intent so the web flow resumes
      // the same purchase rather than dropping to a generic page.
      const webPath = isTopup ? `/checkout?topup=${topupPack}` : '/pricing';
      openExternalUrl(buildWebUrl(webPath, router.locale));
    }
  }, [router.locale, iosRedirecting, isTopup, topupPack]);


  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [isSanctioned, setIsSanctioned] = useState<boolean | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentType, setIntentType] = useState<'payment' | 'setup' | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const isDark = useIsDarkMode();
  const [showMobileSummary, setShowMobileSummary] = useState(false);

  // "Loaded" gate differs by mode: subscription needs the plan, top-up needs
  // the pack's price/replies from config.
  const purchaseReady = isTopup ? !!topupInfo : !!plan;

  const errorLoadPlanMessage = t('errorLoadPlan');
  // Shown when the card top-up kill-switch is off (config says disabled, or the
  // create-topup-intent endpoint returns 403 TOPUP_DISABLED for a stale link).
  const topupUnavailableMessage = tTopup('unavailable.checkoutMessage');

  useEffect(() => {
    if (isNativePlatform()) return;
    const checkGeo = async () => {
      const sanctioned = await isUserSanctioned();
      setIsSanctioned(sanctioned);
    };
    checkGeo();
  }, []);

  // Subscription mode: fetch the plan being purchased.
  useEffect(() => {
    if (isTopup) return;
    if (plan || fetchError || !planId) return;
    if (isSanctioned === true) return;
    if (isSanctioned === null) return;

    const fetchPlan = async () => {
      try {
        const response = await publicApi.get(`/plans/${planId}`);
        const planData = response.data.data || response.data;

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
  }, [isTopup, planId, plan, fetchError, errorLoadPlanMessage, isSanctioned, router, isAuthenticated]);

  // Top-up mode: fetch the pack's authoritative price + reply count from config.
  useEffect(() => {
    if (!isTopup || topupInfo || fetchError) return;
    if (isSanctioned !== false) return;

    const fetchTopup = async () => {
      try {
        // Public endpoint (mirrors /plans/:id) so a logged-out visitor still
        // gets the order summary + in-page login gate instead of an error.
        const response = await publicApi.get('/subscription/topup/config');
        const data = response.data.data;
        // Kill-switch: card top-up disabled server-side (e.g. flag off, or a
        // stale deep link after it was turned off) → graceful unavailable state.
        if (!data.enabled) {
          setFetchError(true);
          setError(topupUnavailableMessage);
          return;
        }
        const info = data.packs[topupPack!];
        if (!info) {
          setFetchError(true);
          setError(errorLoadPlanMessage);
          return;
        }
        setTopupInfo(info);
      } catch (err) {
        captureError(err, 'Failed to fetch top-up config', { tags: { page: 'checkout', action: 'fetch-topup' } });
        setFetchError(true);
        setError(errorLoadPlanMessage);
      }
    };

    fetchTopup();
  }, [isTopup, topupPack, topupInfo, fetchError, errorLoadPlanMessage, topupUnavailableMessage, isSanctioned]);

  const createSession = useCallback(async () => {
    if (!purchaseReady || !isAuthenticated || clientSecret || sessionLoading || isSanctioned) return;

    setSessionLoading(true);
    setError('');

    try {
      if (isTopup) {
        const response = await api.post('/payment/create-topup-intent', { pack: topupPack });
        setClientSecret(response.data.clientSecret);
        setIntentType('payment');
      } else {
        const response = await api.post('/payment/create-subscription-intent', {
          planId: plan!.id,
          billingInterval,
        });
        setClientSecret(response.data.clientSecret);
        setIntentType(response.data.type);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { code?: string; error?: string | boolean; message?: string } } };
      const errorData = axiosErr.response?.data;

      // Expected, non-error server responses are handled below and must NOT be
      // reported to Sentry — captureError runs only after these short-circuits,
      // so a sanctioned geo, a required email, a tripped kill-switch, or the
      // demo-account block don't spam the error tracker.
      if (errorData?.code === 'SANCTIONED_GEO_BLOCK' || errorData?.code === 'GEO_VERIFICATION_REQUIRED') {
        setIsSanctioned(true);
        return;
      }

      // Kill-switch tripped between page load and pay (or a stale deep link).
      if (errorData?.code === 'TOPUP_DISABLED') {
        setError(topupUnavailableMessage);
        return;
      }

      if (errorData?.code === 'EMAIL_REQUIRED') {
        const returnUrl = isTopup
          ? `/checkout?topup=${topupPack}`
          : `/checkout?planId=${plan!.id}&interval=${billingInterval}`;
        router.push(`/complete-profile?redirect=${encodeURIComponent(returnUrl)}`);
        return;
      }

      // The shared public demo account is deliberately blocked from Stripe on
      // the backend (DemoUserStripeError → 403). Show honest feedback instead
      // of the generic failure banner, and don't treat it as an error.
      if (errorData?.code === 'DEMO_USER_STRIPE_BLOCKED') {
        setError(t('errorDemoAccount'));
        return;
      }

      captureError(err, 'Checkout error', { tags: { page: 'checkout', action: 'create-session', mode: isTopup ? 'topup' : 'subscription' } });

      const axiosCode = (err as { code?: string }).code;
      const isNetwork = axiosCode === 'ERR_NETWORK' || axiosCode === 'ECONNABORTED';
      // The API error contract sometimes carries a boolean `error: true` flag
      // alongside a string `message` (e.g. the rate limiter). Use `error` as the
      // display string ONLY when it actually is a string, else fall back to
      // `message` — otherwise setError(true) would render an empty banner.
      const serverMessage = (typeof errorData?.error === 'string' ? errorData.error : undefined) ?? errorData?.message;
      setError(isNetwork ? t('errorNetwork') : (serverMessage || t('errorInitiateCheckout')));
    } finally {
      setSessionLoading(false);
    }
  }, [purchaseReady, isTopup, topupPack, plan, isAuthenticated, clientSecret, sessionLoading, isSanctioned, billingInterval, router, t, topupUnavailableMessage]);

  // Auto-create the payment intent once per purchase config (mode-aware: a
  // top-up pack, or a plan+interval). We gate on a ref keyed by that config
  // instead of depending on the `createSession` callback: createSession's
  // identity changes on every render (t, router and sessionLoading are in its
  // deps), so an effect depending on it re-ran every render — and after any
  // non-geo/non-email failure (429, 500, network) it retried instantly with no
  // backoff, flooding /payment/create-*-intent until the rate limiter tripped.
  // The key ref fires the auto-create exactly once per config; errors do not
  // reset it. Retries are manual via the retry button.
  const autoCreateKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated || isSanctioned || clientSecret || !purchaseReady) return;
    // Mode-aware key: top-up has no plan/interval, subscription has no pack.
    // Gating on `plan` here would block top-up; a `${plan.id}` key would be
    // `undefined:...` and collide across packs.
    const key = isTopup ? `topup:${topupPack}` : `plan:${plan?.id}:${billingInterval}`;
    if (autoCreateKeyRef.current === key) return;
    autoCreateKeyRef.current = key;
    createSession();
    // createSession is intentionally omitted — auto-creation is gated by the
    // config key above; depending on it would reintroduce the re-fire loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isSanctioned, clientSecret, purchaseReady, isTopup, topupPack, plan, billingInterval]);

  const handleLogin = () => {
    const returnUrl = isTopup
      ? `/checkout?topup=${topupPack}`
      : (plan ? `/checkout?planId=${plan.id}&interval=${billingInterval}` : '/pricing');
    router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  const maintenanceMode = isCheckoutMaintenance();
  const intervalLabel = tPlans(billingInterval === 'year' ? 'year' : 'month');

  // Dynamic keys from plan slugs — keys are validated at build time via translation:validate
  type PricingKey = MessageKeys<IntlMessages['pricing'], NestedKeyOf<IntlMessages['pricing']>>;
  type PlansKey = MessageKeys<IntlMessages['plans'], NestedKeyOf<IntlMessages['plans']>>;

  const getPlanName = (p: Plan): string => {
    const fromPricing = tPricing(p.slug as unknown as PricingKey);
    if (fromPricing !== p.slug) return fromPricing;
    const fromPlans = tPlans(`${p.slug}.name` as unknown as PlansKey);
    return fromPlans !== `${p.slug}.name` ? fromPlans : p.name;
  };

  const getPlanDesc = (p: Plan): string => {
    const fromPricing = tPricing(`${p.slug}Desc` as unknown as PricingKey);
    if (fromPricing !== `${p.slug}Desc`) return fromPricing;
    const fromPlans = tPlans(`${p.slug}.description` as unknown as PlansKey);
    return fromPlans !== `${p.slug}.description` ? fromPlans : (p.description ?? '');
  };

  if (isSanctioned === null) {
    return <FullPageSpinner />;
  }

  if (isSanctioned) {
    return (
      <>
        <Head>
          <title>{pageTitle} - Jawab24</title>
          <meta name="robots" content="noindex, follow" />
        </Head>
        <div className="flex-1 flex flex-col overflow-y-auto bg-background">
          <div className="flex-1 px-5 sm:px-6 py-8 sm:py-12 px-safe-landscape">
            <div className="max-w-md mx-auto w-full">
              <CheckoutHeader className="max-w-md mb-8 sm:mb-10" backHref={backHref} backLabel={backLabel} />
              <div className="text-center mb-8 sm:mb-10">
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2 tracking-tight font-display">{pageTitle}</h1>
              </div>
              <PaymentsUnavailableNotice />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (iosRedirecting) return null;

  if (!purchaseReady && !error) {
    return <FullPageSpinner />;
  }

  const topupName = topupPack === '5k' ? tTopup('pack5k.name') : topupPack === '10k' ? tTopup('pack10k.name') : '';

  const displayPrice = isTopup
    ? (topupInfo ? `$${(topupInfo.priceCents / 100).toFixed(2)}` : '')
    : (plan ? `$${(getDisplayPrice(plan.price, billingInterval, plan.yearlyPrice) / 100).toFixed(2)}` : '');

  // Submit-button copy + trust line, computed per mode and passed into the
  // shared PaymentForm so the form itself stays presentational.
  const submitLabel = isTopup
    ? t('submitTopup', { amount: displayPrice })
    : t(billingInterval === 'year' ? 'submitPaymentYearly' : 'submitPayment', { amount: displayPrice });
  const trustNote = isTopup ? t('topupTrustNote') : t('cancelAnytime');
  const summaryHeading = isTopup ? topupName : (plan ? getPlanName(plan) : '');
  const mobileSummaryPrice = isTopup
    ? `${displayPrice} · ${t('topupOneTime')}`
    : `${displayPrice}/${intervalLabel}`;

  return (
    <>
      <Head>
        <title>{pageTitle} - Jawab24</title>
        <meta name="description" content={pageDescription} />
        <meta name="robots" content="noindex, follow" />
      </Head>

      <div className="flex-1 flex flex-col overflow-y-auto bg-background">
        <div className="flex-1 px-5 sm:px-6 py-6 sm:py-10 px-safe-landscape">

          <CheckoutHeader className="max-w-4xl" backHref={backHref} backLabel={backLabel} />

          {error && (
            <div className="max-w-4xl mx-auto mb-6 p-4 alert-error border rounded-2xl text-start text-sm">
              <p>{error}</p>
              {/* Manual retry for ALL errors (not just network): the auto-create
                  fires once per config and never auto-retries, so without this a
                  generic server error (500/429) would strand the user on a dead
                  banner with no recovery but a full page reload. */}
              <div className="flex gap-3 mt-3">
                <Button
                  size="sm"
                  onClick={() => createSession()}
                  disabled={sessionLoading}
                >
                  {sessionLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : t('retry')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(backHref)}
                >
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}

          {purchaseReady && (
            <div className="max-w-4xl mx-auto w-full">

              {maintenanceMode && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 mb-6">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">{tLanding('comingSoon.subtitle')}</p>
                </div>
              )}

              <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 lg:items-start">

                {/* Order Summary — collapsible on mobile, sticky sidebar on desktop */}
                <div className="lg:w-80 lg:flex-shrink-0 lg:sticky lg:top-10 lg:order-last">
                  <div className="bg-card rounded-2xl border border-theme-border shadow-sm overflow-hidden">

                    {/* Mobile: collapsible header with price */}
                    <button
                      type="button"
                      className="lg:hidden w-full flex items-center justify-between p-4 text-start"
                      onClick={() => setShowMobileSummary(!showMobileSummary)}
                      aria-expanded={showMobileSummary}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-muted-foreground">{t('orderSummary')}</span>
                        <span className="text-sm font-bold text-foreground">{summaryHeading} &middot; {mobileSummaryPrice}</span>
                      </div>
                      {showMobileSummary
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
                    </button>

                    {/* Desktop: always visible. Mobile: collapsible */}
                    <div className={`${showMobileSummary ? 'block' : 'hidden'} lg:block p-5 sm:p-6 ${showMobileSummary ? 'pt-0' : ''} lg:pt-5`}>
                      <p className="hidden lg:block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {t('orderSummary')}
                      </p>
                      <h2 className="text-lg font-bold text-foreground mb-0.5 text-start">
                        {summaryHeading}
                      </h2>
                      <p className="text-muted-foreground text-xs mb-4 text-start">
                        {isTopup ? t('topupSummaryTitle') : (plan ? getPlanDesc(plan) : '')}
                      </p>

                      <div className="border-t border-theme-border pt-4 mb-4">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-bold text-brand-600 font-display">
                            {displayPrice.split('.')[0]}
                            <span className="text-xl opacity-70">.{displayPrice.split('.')[1]}</span>
                          </span>
                          <span className="text-muted-foreground text-sm font-medium">
                            {isTopup ? t('topupOneTime') : `/ ${intervalLabel}`}
                          </span>
                        </div>
                        {!isTopup && billingInterval === 'year' && plan && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {tPlans('perMonthEquivalent', { amount: `$${(getMonthlyEquivalent(plan.price, billingInterval, plan.yearlyPrice) / 100).toFixed(2)}` })} &middot; {tPlans('billedAnnually')}
                          </p>
                        )}
                        {/* Same informational SAR hint as the pricing page — keeps the
                            currency framing consistent through to payment. */}
                        {!isTopup && plan && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {tPricing('sarEquivalent', { amount: getSarMonthlyEquivalent(plan.price, billingInterval, plan.yearlyPrice).toLocaleString() })}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2.5">
                        {isTopup ? (
                          <>
                            <div className="flex items-center gap-2.5">
                              <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                              <span className="text-foreground/80 text-sm text-start">
                                {topupInfo ? topupInfo.repliesAdded.toLocaleString() : ''} {tPlans('aiReplies')}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                              <span className="text-foreground/80 text-sm text-start">
                                {tTopup('modal.neverExpires')}
                              </span>
                            </div>
                          </>
                        ) : plan && (
                          <>
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
                            {isWhatsAppMarketable() && plan.whatsappEnabled && (
                              <div className="flex items-center gap-2.5">
                                <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                                <span className="text-foreground/80 text-sm text-start">
                                  {tPricing('featureWhatsApp')}
                                </span>
                              </div>
                            )}
                            {plan.trialDays > 0 && (
                              <div className="flex items-center gap-2.5">
                                <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                                <span className="text-foreground/80 text-sm text-start">
                                  {tPricing('trialDays', { days: plan.trialDays })}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {/* Trust cue lives once, within the card-field area (see PaymentForm) —
                          Baymard: a single security cue encapsulating the sensitive fields
                          beats repeating identical copy across regions. */}
                    </div>
                  </div>
                </div>

                {/* Payment Form — primary area, appears first on both mobile and desktop */}
                <div className="flex-1 min-w-0 lg:order-first">
                  {/* Section heading */}
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 tracking-tight font-display">
                    {t('paymentDetails')}
                  </h1>
                  <p className="text-muted-foreground text-sm mb-6">
                    {isTopup ? t('topupSummaryTitle') : t('subtitle')}
                  </p>

                  {!maintenanceMode && (
                    <>
                      {!isAuthenticated ? (
                        <div className="bg-card rounded-2xl p-6 sm:p-8 border border-theme-border text-center">
                          <p className="text-muted-foreground mb-4">{isTopup ? t('loginToTopup') : t('loginToCheckout')}</p>
                          <Button
                            size="lg"
                            className="w-full h-14 shadow-lg shadow-brand-600/20 hover:shadow-xl hover:shadow-brand-600/25 flex items-center justify-center gap-2 text-base font-bold rounded-2xl"
                            onClick={handleLogin}
                          >
                            <LogIn className="w-5 h-5" aria-hidden="true" />
                            {t('loginButton')}
                          </Button>
                        </div>
                      ) : clientSecret && intentType && getStripePromise() ? (
                        <div className="bg-card rounded-2xl p-5 sm:p-6 border border-theme-border">
                          <Elements
                            stripe={getStripePromise()!}
                            options={{
                              clientSecret,
                              appearance: getStripeAppearance(isDark),
                              locale: locale as StripeElementLocale,
                            }}
                          >
                            <PaymentForm
                              type={intentType}
                              submitLabel={submitLabel}
                              trustNote={trustNote}
                              trialDays={isTopup ? undefined : plan?.trialDays}
                            />
                          </Elements>
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

export default withOwnerOnly(CheckoutPage);

import { makeGetStaticProps } from '@/i18n/getMessages';
import { PAGE_NAMESPACES } from '@/i18n/namespaces';
export const getStaticProps = makeGetStaticProps([...PAGE_NAMESPACES.checkout]);

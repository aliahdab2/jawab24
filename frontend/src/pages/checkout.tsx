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
import { ShamCashPanel } from '@/components/billing/ShamCashPanel';
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
import { useIOSPaymentRedirect, useIsDarkMode, useLocalPaymentRail } from '@/hooks';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebUrl } from '@/lib/webUrl';
import { isMarketplaceBilledCode, type Plan } from '@jawab24/shared';
import { getDisplayPrice, getMonthlyEquivalent, getSarMonthlyEquivalent } from '@/utils/pricing';
import { resolvePaymentSurface, shouldOfferFromSyriaLink } from '@/utils/paymentSurface';

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
 * "Log in to complete your subscription" card. One component for both payment
 * surfaces: the card form and the Sham Cash panel each read the merchant's own
 * data, so an anonymous visitor must see the same gate on either — the panel
 * used to be mounted anyway, 401, and collapse into a "payments unavailable"
 * notice with no way to log in.
 */
function LoginGateCard({ message, buttonLabel, onLogin }: { message: string; buttonLabel: string; onLogin: () => void }) {
  return (
    <div className="bg-card rounded-2xl p-6 sm:p-8 border border-theme-border text-center">
      <p className="text-muted-foreground mb-4">{message}</p>
      <Button
        size="lg"
        className="w-full h-14 shadow-lg shadow-brand-600/20 hover:shadow-xl hover:shadow-brand-600/25 flex items-center justify-center gap-2 text-base font-bold rounded-2xl"
        onClick={onLogin}
      >
        <LogIn className="w-5 h-5" aria-hidden="true" />
        {buttonLabel}
      </Button>
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
// How long Stripe.js gets to initialise before we tell the merchant the form
// failed to load. Generous enough not to fire on a slow-but-working connection.
const STRIPE_LOAD_GRACE_MS = 10_000;

// Exported for unit testing — CheckoutPage is the only production caller.
export function PaymentForm({
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
  const [loadFailed, setLoadFailed] = useState(false);
  const t = useTranslations('checkout');

  const returnUrl = `${BRAND_ASSETS.urls.base}/payment/return`;

  const hasTrial = !!trialDays && trialDays > 0 && type === 'setup';

  // Stripe.js can fail to load outright — blocked script, hostile network, a
  // WebView that never fetched js.stripe.com. The submit button below is
  // disabled while `stripe` is null, so the merchant is left staring at a dead
  // form with no explanation while we record nothing at all. From support's
  // side that is indistinguishable from a refused card, which is how a merchant
  // sat on an `incomplete` subscription across three attempts with no trace in
  // Stripe or Sentry (2026-07-25).
  //
  // The signal is deterministic: loadStripe() REJECTS when the script can't be
  // fetched, so we listen for that rather than guessing at a duration. The
  // timeout below is only a backstop for the documented case where the loader
  // promise neither resolves nor rejects (stripe/stripe-js#26) — without it
  // that quirk would leave the form dead and silent, which is the exact failure
  // this whole effect exists to surface.
  useEffect(() => {
    // Arrived late — after the backstop already fired, say. The form works now,
    // so retract the banner: leaving it up next to a live, enabled pay button
    // tells the merchant their payment is broken while it is in fact fine.
    if (stripe && elements) {
      setLoadFailed(false);
      return;
    }

    let settled = false;
    const reportDeadForm = (reason: string, cause?: unknown) => {
      if (settled) return;
      settled = true;
      captureError(
        cause instanceof Error ? cause : new Error(`Stripe.js unavailable (${reason})`),
        'Payment form failed to load',
        { tags: { page: 'checkout', type }, extra: { reason } }
      );
      setLoadFailed(true);
    };

    const loader = getStripePromise();
    if (!loader) {
      // No publishable key configured. Knowable immediately, and a deployment
      // fault rather than a network one — waiting out the backstop would report
      // it as a `timeout` and send whoever reads Sentry chasing the network.
      reportDeadForm('no-publishable-key');
      return;
    }

    loader
      .then((loaded) => { if (!loaded) reportDeadForm('resolved-null'); })
      .catch((err) => reportDeadForm('load-rejected', err));

    const backstop = setTimeout(() => reportDeadForm('timeout'), STRIPE_LOAD_GRACE_MS);
    return () => { settled = true; clearTimeout(backstop); };
  }, [stripe, elements, type]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Reachable when `elements` is null but `stripe` isn't — the button's
    // disabled prop only guards on `stripe`, so this submit is live. It used to
    // be a bare `return` that swallowed the click without a word.
    if (!stripe || !elements) {
      captureError(
        new Error('Checkout submitted before Stripe.js was ready'),
        'Payment form not ready',
        { tags: { page: 'checkout', type }, extra: { hasStripe: !!stripe, hasElements: !!elements } }
      );
      setErrorMessage(t('errorPaymentFormNotReady'));
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    const confirmFn = type === 'setup'
      ? stripe.confirmSetup
      : stripe.confirmPayment;

    // confirmPayment/confirmSetup RESOLVE with { error } for declines and
    // validation problems, but they THROW for environment failures — the one
    // that mattered being a CSP-refused fetch to api.stripe.com (2026-03-26 →
    // 08-20: connect-src listed checkout.stripe.com instead). Destructuring the
    // resolved shape alone swallowed that throw, so the merchant pressed pay,
    // the spinner reset nothing, and neither Sentry nor Stripe ever heard about
    // it — four months of dead checkouts with zero trace. Declines keep their
    // specific message; a throw gets the generic banner and a Sentry event, and
    // the hosted-checkout fallback right below stays available.
    try {
      const { error } = await confirmFn({
        elements,
        confirmParams: { return_url: returnUrl },
      });

      if (error) {
        captureError(error, 'Payment confirmation error', { tags: { page: 'checkout', type } });
        setErrorMessage(error.message || t('errorInitiateCheckout'));
        setSubmitting(false);
      }
    } catch (err) {
      captureError(err, 'Payment confirmation threw', { tags: { page: 'checkout', type } });
      setErrorMessage(t('errorInitiateCheckout'));
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

      {/* role/aria-live because this can appear with no user action at all —
          the load-failure path surfaces it on a timer, and a screen reader user
          would otherwise never learn the form is dead. */}
      {(errorMessage || loadFailed) && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-4 p-3 alert-error border rounded-xl text-sm text-start"
        >
          {errorMessage || t('errorPaymentFormNotReady')}
        </div>
      )}

      {/* Trial callout — prominent, above the button */}
      {hasTrial && (
        <div className="mt-5 flex items-start gap-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/30 px-4 py-3">
          <Shield className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-400">
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
  const requestedInterval = interval === 'year' ? 'year' : 'month';
  const topupPack: TopupPack | null = topup === '5k' || topup === '10k' ? topup : null;
  const isTopup = !!topupPack;
  const locale = useLocale();
  const t = useTranslations('checkout');
  const tTopup = useTranslations('topup');
  const tPricing = useTranslations('pricing');
  const tPlans = useTranslations('plans');
  const tLanding = useTranslations('landing');
  const tPayment = useTranslations('payment');
  const { isAuthenticated, user } = useAuthStore();

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
  // ?interval=year is honored only when the loaded plan actually has a yearly
  // Stripe price — the backend refuses yearly otherwise (YEARLY_NOT_AVAILABLE)
  // instead of silently billing monthly. Coercing here keeps the summary, the
  // submit button, and the created intent all describing the same real charge.
  // Safe to derive before the plan loads: intent creation gates on the plan
  // being present (purchaseReady), so no request fires with a stale value.
  const billingInterval: 'month' | 'year' =
    requestedInterval === 'year' && plan?.yearlyAvailable ? 'year' : 'month';
  const [topupInfo, setTopupInfo] = useState<TopupInfo | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [isSanctioned, setIsSanctioned] = useState<boolean | null>(null);

  // A blocked card is not a blocked customer: where a local rail exists (inside
  // Syria → Sham Cash) the sanctioned branch below becomes a real payment
  // screen instead of a "not available in your region" notice. Top-ups keep the
  // notice — a claim is filed against a PLAN, and there is no plan to review.
  const hasLocalRail = useLocalPaymentRail(isSanctioned !== null);
  // The merchant's own word beats our geo lookup. VPN use is routine inside
  // Syria, so the Syrian merchant usually resolves to Europe, is NOT sanctioned
  // by IP, and lands on the card form — where the card declines. The link under
  // that form sets this, and the Sham Cash panel renders regardless of geo.
  // The Stripe block is untouched: this only chooses which panel to show.
  const [forceLocalRail, setForceLocalRail] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentType, setIntentType] = useState<'payment' | 'setup' | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [hostedLoading, setHostedLoading] = useState(false);
  const isDark = useIsDarkMode();

  // Hand off to Stripe-HOSTED checkout (see the fallback link below the form).
  // Full-page redirect, not window.open: popup blockers eat new tabs opened
  // after an await, and there is nothing to come back to — success returns via
  // success_url.
  const openHostedCheckout = async () => {
    if (!plan) return;
    setHostedLoading(true);
    try {
      const response = await api.post('/payment/create-checkout-session', {
        planId: plan.id,
        billingInterval,
        uiMode: 'hosted',
      });
      window.location.href = response.data.url;
    } catch (err) {
      captureError(err, 'Failed to open hosted checkout fallback', {
        tags: { page: 'checkout', action: 'hosted-fallback' },
      });
      setError(t('errorInitiateCheckout'));
      setHostedLoading(false);
    }
  };

  // Which surface this page shows — the one decision point (see paymentSurface.ts).
  const surface = resolvePaymentSurface({
    isSanctioned,
    hasLocalRail,
    forceLocalRail,
    isTopup,
    plan,
    fetchError,
    isAuthenticated,
  });

  // The VPN escape hatch (see forceLocalRail), rendered under BOTH the card form
  // and the "payments unavailable" notice — the second is the unresolved-geo
  // case (fails closed, so no Sham Cash panel by itself), and a Syrian merchant
  // there must not be stranded on a notice either. The guard lives with the
  // surface decision so the two cannot drift.
  const fromSyriaLink = shouldOfferFromSyriaLink({ isTopup, plan, forceLocalRail, isAuthenticated }, surface) ? (
    <p className="mt-2 text-center text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setForceLocalRail(true)}
        className="underline text-brand-600 hover:text-brand-700 font-medium"
      >
        {tPayment('shamCash.fromSyriaLink')}
      </button>
    </p>
  ) : null;

  // Rendered BOTH inside the payment panel and in the panel's failure states:
  // the hosted handoff needs no Stripe.js at all (the session is created by our
  // backend), so it must stay reachable precisely when the embedded form cannot
  // render — a blocked js.stripe.com or a missing publishable key. Hiding the
  // escape hatch behind the thing that failed would repeat the incident.
  const hostedFallbackLink = !isTopup && plan ? (
    <>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t('hostedFallbackPrompt')}{' '}
        <button
          type="button"
          onClick={openHostedCheckout}
          disabled={hostedLoading}
          className="underline text-brand-600 hover:text-brand-700 disabled:opacity-50 font-medium"
        >
          {hostedLoading ? t('hostedFallbackOpening') : t('hostedFallbackLink')}
        </button>
      </p>
      {fromSyriaLink}
    </>
  ) : null;

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
    // Wait for geo, but do NOT skip the fetch for a sanctioned visitor: the
    // Sham Cash panel on the sanctioned branch is filed against this plan and
    // cannot render without it. Found in a dev run — with the old
    // `isSanctioned === true` early return the panel never appeared at all.
    // /plans/:id is a public catalogue read, not a Stripe call (Rule 4).
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

      // A marketplace bills this account (D-073), and the merchant reached a
      // Stripe surface anyway — a stale deep link, a bookmarked
      // /checkout?planId=…, or a usage summary fetched before the mirror
      // existed. Route them back to /pricing, which carries the per-rail
      // managed banner and the manage-plan destination when there is one.
      //
      // Membership test against the SHARED code set, never a literal per rail:
      // this line used to name Shopify and Salla only, so a Zid merchant landed
      // on the generic failure banner instead — the exact dead end the guard
      // exists to prevent, on the one surface a field-based check cannot cover.
      if (isMarketplaceBilledCode(errorData?.code)) {
        router.replace('/pricing');
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

  if (surface === 'loading') {
    return <FullPageSpinner />;
  }

  if (surface !== 'card') {
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
              {surface === 'local_rail' && plan ? (
                <ShamCashPanel
                  planId={plan.id}
                  planName={getPlanName(plan)}
                  billingInterval={billingInterval}
                  amountCents={getDisplayPrice(plan.price, billingInterval, plan.yearlyPrice)}
                  userEmail={user?.email}
                />
              ) : surface === 'login' ? (
                <LoginGateCard message={t('loginToCheckout')} buttonLabel={t('loginButton')} onLogin={handleLogin} />
              ) : (
                <>
                  <PaymentsUnavailableNotice />
                  {fromSyriaLink}
                </>
              )}
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
                        <LoginGateCard
                          message={isTopup ? t('loginToTopup') : t('loginToCheckout')}
                          buttonLabel={t('loginButton')}
                          onLogin={handleLogin}
                        />
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

                          {/* Escape hatch to Stripe-HOSTED checkout. The embedded
                              form can die in ways we can't always detect: privacy
                              browsers (Brave Shields etc.) can silently block the
                              cross-origin tokenisation, and for four months
                              (2026-03-26 → 08-20) our OWN CSP refused the
                              confirm call to api.stripe.com — the form rendered,
                              pay did nothing, no error surfaced anywhere. The
                              2026-07-25 incident that prompted this fallback was
                              that CSP defect, misread as Brave at the time; the
                              merchant paid instantly on checkout.stripe.com,
                              where Stripe is first-party and immune to both
                              failure classes. CSP is fixed (nginx.conf, pinned
                              by backend/test/nginxCspStripe.test.ts) and the
                              confirm throw is now caught above — the fallback
                              stays for whatever the next undetectable one is.
                              Subscriptions only — top-ups use a PaymentIntent
                              with no hosted equivalent wired up. */}
                          {hostedFallbackLink}
                        </div>
                      ) : sessionLoading ? (
                        <div className="flex flex-col items-center justify-center py-16" role="status" aria-busy="true">
                          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-3" aria-hidden="true" />
                          <p className="text-muted-foreground text-sm" aria-live="polite">{t('loadingPaymentForm')}</p>
                        </div>
                      ) : (
                        // Embedded form could not mount at all (Stripe.js
                        // unavailable / missing publishable key). The hosted
                        // handoff is backend-driven and still works — offer it.
                        hostedFallbackLink
                      )}
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

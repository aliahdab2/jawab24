import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
// Direct import, NOT the '@/hooks' barrel (53 re-exports): this hook is used
// by the public pricing page, and the barrel drags usePostReplySetup -> the
// whole Post Reply feature -> '@jawab24/shared' onto it.
import { useOwnerGate } from '@/hooks/useOwnerGate';
import { api, subscriptionApi } from '@/lib/api';
import { getCachedGeoCountry, hasLocalPaymentAlternative, isUserSanctioned } from '@/utils/geoCheck';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebAuthedUrl } from '@/lib/webUrl';
import { captureError } from '@/lib/sentryHelpers';
import { getMarketplaceBilling, MARKETPLACE_COPY, openMarketplaceManageUrl } from '@/lib/marketplaceBilling';
import type { Plan, UsageSummary } from '@jawab24/shared';

interface UseSelectPlanArgs {
  plans: Plan[];
  usage: UsageSummary | null;
  billingInterval?: 'month' | 'year';
}

/**
 * Single source of truth for the "select a plan" flow — shared by the public
 * pricing grid (`/pricing`) and the hidden high-volume page (`/pricing/scale`).
 *
 * Handles, in order: native (Android/iOS) redirect to web checkout, the
 * owner-only billing gate, the STRICT sanctions re-check, free-plan handling,
 * and the existing-Stripe-subscriber → in-place `changePlan` (proration) vs
 * new-`/checkout` split. The free-plan / downgrade-dialog branches are dormant
 * on the scale page (its plans are never free).
 */
export function useSelectPlan({ plans, usage, billingInterval = 'month' }: UseSelectPlanArgs) {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const isBlockedForMember = useOwnerGate();
  const tPricing = useTranslations('pricing');

  // A plan with no yearly Stripe price can only be billed monthly — the
  // backend refuses yearly (400 YEARLY_NOT_AVAILABLE) instead of silently
  // charging the monthly price. Coerce per plan so a "year" page toggle never
  // sends a yearly request for a monthly-only plan (e.g. the scale tiers).
  const intervalFor = (plan: Plan | undefined): 'month' | 'year' =>
    billingInterval === 'year' && plan?.yearlyAvailable ? 'year' : 'month';

  const [changingPlan, setChangingPlan] = useState<string | null>(null);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);

  const hasActiveSubscription = Boolean(usage?.subscription?.plan?.slug);

  const handleSelectPlan = async (planId: string) => {
    // Members cannot manage subscriptions — only the workspace owner can.
    // Checked BEFORE the native branch: the app now talks to the payment API
    // directly (below), so it no longer passes through the web checkout page
    // whose withOwnerOnly HOC used to enforce this for app users.
    if (isBlockedForMember) {
      toast.error(tPricing('ownerOnlyBilling'));
      return;
    }

    // A marketplace owns this account's paid plans (D-073), so EVERY Stripe
    // path below — hosted checkout, /checkout, in-place changePlan — is
    // off-limits. Send them where they actually manage the plan when we can
    // name a destination; otherwise say so plainly.
    //
    // One branch for all three rails, reading the SAME field the backend's
    // guard computes. It used to be two hard-coded branches that knew nothing
    // about Zid, so a Zid merchant fell straight through to Stripe and met a
    // generic error from the 400 — no explanation, no destination.
    //
    // An absent manageUrl means "suppress, but we have no link to offer"
    // (Salla has no plan to manage; a Zid store with no captured merchant id)
    // — it NEVER means "let them through".
    const marketplace = getMarketplaceBilling(usage);
    if (marketplace) {
      if (marketplace.manageUrl) {
        // Inside the platform frame this navigates the dashboard that frames
        // us; elsewhere it is the external-URL path (system browser on native).
        await openMarketplaceManageUrl(marketplace.manageUrl, router.locale);
      } else {
        toast.info(tPricing(MARKETPLACE_COPY[marketplace.marketplace].toast));
      }
      return;
    }

    // On native (Android/iOS), hand off to Stripe-HOSTED checkout.
    //
    // Store policy prohibits in-app purchases via Stripe, so payment always
    // happens in the system browser — which is whatever the merchant chose as
    // their default. This used to bounce to OUR embedded checkout there, and a
    // privacy browser (Brave Shields) silently blocked the PaymentElement's
    // cross-origin card tokenisation: form rendered, pay did nothing, no error
    // anywhere (live incident, 2026-07-25 — the same card paid instantly on a
    // Stripe-hosted page). On checkout.stripe.com Stripe is first-party and
    // there is nothing to block, whatever the default browser is.
    //
    // The app is authenticated, so it creates the session itself and opens the
    // Stripe URL directly — which also drops the old log-in-again-in-browser
    // step. Activation is webhook + reconciliation-sweep driven, so it does not
    // depend on what the browser does after payment.
    // Free plans need no Stripe surface at all — fall through to the shared
    // free-plan handling below (dashboard / downgrade dialog), which works
    // in-app. Creating a hosted session for a $0 plan would just 400 on the
    // backend (no stripePriceId) and toast a misleading generic error.
    const nativeSelectedPlan = plans.find((p) => p.id === planId);
    if (isNativePlatform() && (nativeSelectedPlan?.price ?? 0) > 0) {
      if (!isAuthenticated) {
        // Can't create a session without auth — fall back to the old web flow.
        const checkoutPath = `/checkout?planId=${planId}&interval=${intervalFor(nativeSelectedPlan)}`;
        await openExternalUrl(buildWebAuthedUrl(checkoutPath, router.locale));
        return;
      }
      setChangingPlan(planId);
      try {
        const response = await api.post('/payment/create-checkout-session', {
          planId,
          billingInterval: intervalFor(nativeSelectedPlan),
          uiMode: 'hosted',
        });
        await openExternalUrl(response.data.url);
      } catch (err: unknown) {
        const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
        if (code === 'EMAIL_REQUIRED') {
          router.push(`/complete-profile?redirect=${encodeURIComponent('/pricing')}`);
        } else if (code === 'SANCTIONED_GEO_BLOCK' || code === 'GEO_VERIFICATION_REQUIRED') {
          toast.error(tPricing('unavailableRegion'));
        } else {
          captureError(err, 'Failed to open hosted checkout from app', { tags: { action: 'hosted_checkout' } });
          toast.error(tPricing('planChangeError'));
        }
      } finally {
        setChangingPlan(null);
      }
      return;
    }

    // STRICT PAYMENT VALIDATION: re-check sanctions before payment
    // (display is permissive, payments are strict).
    setChangingPlan(planId);
    const sanctioned = await isUserSanctioned();
    if (sanctioned) {
      setChangingPlan(null);
      // A blocked CARD is not a blocked customer. Where the region has a local
      // rail (inside Syria → Sham Cash), send them to /checkout, whose
      // sanctioned branch renders the offline payment panel and never mounts
      // Stripe — so this is a route change, not a hole in the sanctions gate.
      // Free plans are excluded: there is nothing to transfer for.
      const railPlan = plans.find((p) => p.id === planId);
      if (hasLocalPaymentAlternative(getCachedGeoCountry()) && (railPlan?.price ?? 0) > 0) {
        const checkoutPath = `/checkout?planId=${planId}&interval=${intervalFor(railPlan)}`;
        router.push(isAuthenticated ? checkoutPath : `/login?redirect=${encodeURIComponent(checkoutPath)}`);
        return;
      }
      toast.error(tPricing('unavailableRegion'));
      captureError(new Error('Payment blocked: sanctioned jurisdiction'), 'Sanctions block on plan select', { tags: { action: 'sanctions_block' }, level: 'warning' });
      return;
    }

    const selectedPlan = plans.find((p) => p.id === planId);
    if (!selectedPlan) {
      setChangingPlan(null);
      return;
    }

    // Free plan: no Stripe checkout. New users auto-activate on login/registration;
    // an existing subscriber downgrading goes through the billing portal.
    if (selectedPlan.price === 0) {
      if (!isAuthenticated) {
        router.push(`/login?redirect=${encodeURIComponent('/dashboard')}`);
      } else if (!usage?.subscription) {
        router.push('/dashboard');
      } else {
        setShowDowngradeDialog(true);
      }
      return;
    }

    // Paid plan, not authenticated → login then checkout.
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/checkout?planId=${planId}&interval=${intervalFor(selectedPlan)}`)}`);
      return;
    }

    // Existing Stripe-backed subscriber → switch plan in place with proration.
    // Trial/manual subscriptions (no Stripe customer) fall through to checkout.
    if (hasActiveSubscription && usage?.subscription?.hasStripeCustomer) {
      try {
        await subscriptionApi.changePlan(planId, intervalFor(selectedPlan));
        toast.success(tPricing('planChangeSuccess'));
        router.replace(router.asPath); // refresh usage so the UI reflects the new plan
      } catch (err) {
        captureError(err, 'Failed to change plan', { tags: { action: 'change_plan' } });
        toast.error(tPricing('planChangeError'));
      } finally {
        setChangingPlan(null);
      }
      return;
    }

    // New subscription or trial-to-paid upgrade → checkout.
    router.push(`/checkout?planId=${planId}&interval=${intervalFor(selectedPlan)}`);
  };

  /** Open Stripe Billing Portal for downgrades / cancellation. */
  const openBillingPortal = async () => {
    try {
      const response = await subscriptionApi.billingPortal();
      window.location.href = response.data.url;
    } catch (err) {
      captureError(err, 'Failed to open billing portal', { tags: { action: 'billing_portal' } });
      toast.error(tPricing('billingPortalError'));
    }
  };

  const handleDowngradeConfirm = async () => {
    setDowngradeLoading(true);
    await openBillingPortal();
    // If we're still here (portal didn't open), reset the dialog.
    setDowngradeLoading(false);
    setShowDowngradeDialog(false);
  };

  const closeDowngradeDialog = () => {
    setShowDowngradeDialog(false);
    setDowngradeLoading(false);
  };

  return {
    changingPlan,
    handleSelectPlan,
    showDowngradeDialog,
    closeDowngradeDialog,
    downgradeLoading,
    handleDowngradeConfirm,
  };
}

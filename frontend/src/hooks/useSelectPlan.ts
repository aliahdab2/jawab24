import { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { useOwnerGate } from '@/hooks';
import { subscriptionApi } from '@/lib/api';
import { isUserSanctioned } from '@/utils/geoCheck';
import { isNativePlatform } from '@/lib/capacitor';
import { openExternalUrl } from '@/lib/openExternalUrl';
import { buildWebUrl } from '@/lib/webUrl';
import { captureError } from '@/lib/sentryHelpers';
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

  const [changingPlan, setChangingPlan] = useState<string | null>(null);
  const [showDowngradeDialog, setShowDowngradeDialog] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);

  const hasActiveSubscription = Boolean(usage?.subscription?.plan?.slug);

  const handleSelectPlan = async (planId: string) => {
    // On native (Android/iOS), open the web login → checkout flow.
    // Store policy prohibits in-app purchases via Stripe, and the in-app
    // browser doesn't share the app's auth session.
    if (isNativePlatform()) {
      const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      const checkoutPath = `/checkout?planId=${planId}&interval=${billingInterval}&theme=${theme}`;
      await openExternalUrl(buildWebUrl(`/login?redirect=${encodeURIComponent(checkoutPath)}`, router.locale));
      return;
    }

    // Members cannot manage subscriptions — only the workspace owner can.
    if (isBlockedForMember) {
      toast.error(tPricing('ownerOnlyBilling'));
      return;
    }

    // STRICT PAYMENT VALIDATION: re-check sanctions before payment
    // (display is permissive, payments are strict).
    setChangingPlan(planId);
    const sanctioned = await isUserSanctioned();
    if (sanctioned) {
      setChangingPlan(null);
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
      router.push(`/login?redirect=${encodeURIComponent(`/checkout?planId=${planId}&interval=${billingInterval}`)}`);
      return;
    }

    // Existing Stripe-backed subscriber → switch plan in place with proration.
    // Trial/manual subscriptions (no Stripe customer) fall through to checkout.
    if (hasActiveSubscription && usage?.subscription?.hasStripeCustomer) {
      try {
        await subscriptionApi.changePlan(planId, billingInterval);
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
    router.push(`/checkout?planId=${planId}&interval=${billingInterval}`);
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

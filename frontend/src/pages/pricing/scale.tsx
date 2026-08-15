import { useState, useEffect, type ReactElement } from 'react';
import Head from 'next/head';
import type { GetStaticProps } from 'next';
import clsx from 'clsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, Button } from '@/components/ui';
import { BuyTopUpCTA } from '@/components/billing/BuyTopUpCTA';
import { SanctionedCtaFallback } from '@/components/billing/SanctionedCtaFallback';
import { PlanTabSelector } from '@/components/billing/PlanTabSelector';
import { formatUsd, getSarMonthlyEquivalent, planAccentClasses, planBadgeGradient } from '@/utils/pricing';
import { subscriptionApi } from '@/lib/api';
import { extractObjectData } from '@/lib/api-utils';
import { useTranslations, useLocale } from 'next-intl';
import { useAuthStore } from '@/lib/store';
import { useSelectPlan } from '@/hooks/useSelectPlan';
import { useIOSPaymentRedirect } from '@/hooks/useIOSPaymentRedirect';
import { Check, Crown, Sparkles } from 'lucide-react';
import type { Plan, UsageSummary } from '@jawab24/shared';
import { isUserSanctionedNonBlocking } from '@/utils/geoCheck';
import { isWhatsAppMarketable } from '@/lib/featureFlags';
import { captureError } from '@/lib/sentryHelpers';
import { DEFAULT_SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';
import { getMarketplaceBilling } from '@/lib/marketplaceBilling';
import type { NextPageWithLayout } from '../_app';

interface ScalePageProps {
  plans: Plan[];
}

/**
 * Private high-volume plans page (/pricing/scale).
 *
 * These plans are flagged `isPublic: false`, so they never appear on the public
 * /pricing grid. This page is reachable only via the at-limit upgrade nudge or a
 * direct link, and serves Pro customers who outgrow 10,000 replies/month.
 *
 * An existing Stripe subscriber upgrades IN PLACE with proration via
 * `subscriptionApi.changePlan` (never a second subscription); everyone else goes
 * through checkout. This mirrors the public pricing page's paid-plan handler.
 */
function ScalePlanCard({
  plan,
  isCurrentPlan,
  hasActiveSubscription,
  currentPlanPrice,
  isSanctioned,
  loading,
  onSelect,
  locale,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  hasActiveSubscription: boolean;
  currentPlanPrice: number;
  isSanctioned: boolean;
  loading: boolean;
  onSelect: () => void;
  locale: string;
}) {
  const tPricing = useTranslations('pricing');

  const replies = plan.maxAiRepliesPerMonth ?? 0;
  const isTop = plan.slug === 'scale-30k';
  const accent = planAccentClasses(isCurrentPlan ? 'current' : isTop ? 'amber' : 'plain');

  const numberLocale = locale === 'ar' ? 'ar-u-nu-latn' : locale || 'en';
  const formatNumber = (n: number) => new Intl.NumberFormat(numberLocale).format(n);

  const sarMonthly = getSarMonthlyEquivalent(plan.price, 'month');

  // Same action-based prominence as the main pricing grid: upgrades get the
  // solid primary button; the current plan and downgrades stay quiet.
  const isDowngrade = hasActiveSubscription && !isCurrentPlan && plan.price <= currentPlanPrice;

  const ctaLabel = isCurrentPlan
    ? tPricing('currentPlan')
    : hasActiveSubscription
      ? plan.price > currentPlanPrice
        ? tPricing('upgrade')
        : tPricing('downgrade')
      : tPricing('subscribe');

  return (
    <Card
      className={clsx(
        // Mirror PlanCard's polish (hover lift). Color identity comes from the shared
        // planAccentClasses; the top Scale plan also pops with md:scale (layout-local).
        'relative flex flex-col h-full transition-all duration-300 hover:shadow-[0_12px_24px_rgba(0,0,0,0.12)] hover:-translate-y-1',
        accent.ring,
        accent.surface,
        isTop && 'md:scale-[1.02]',
      )}
    >
      <div className="text-center pt-4 px-4">
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider',
            // Amber gradient pill on the top tier (matches Pro's "Premium" badge); green on the lower tier.
            isTop ? planBadgeGradient('amber') : 'status-success border',
          )}
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          {tPricing('scaleBadge')}
        </span>

        <div
          className={clsx(
            'w-12 h-12 mx-auto mt-4 mb-3 rounded-xl flex items-center justify-center',
            isTop ? 'icon-bg-amber' : 'icon-bg-brand',
          )}
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
        >
          {isTop ? <Crown className="w-6 h-6" aria-hidden="true" /> : <Sparkles className="w-6 h-6" aria-hidden="true" />}
        </div>

        {/* Reply count is the card's identity — fully localized (number + label). */}
        <p className="text-4xl font-extrabold text-foreground tracking-tight">{formatNumber(replies)}</p>
        <p className="text-sm text-muted-foreground mt-1">{tPricing('scaleRepliesLabel')}</p>
      </div>

      <div className="text-center my-4 py-3 bg-background/50 rounded-xl mx-4">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl font-extrabold text-foreground">{formatUsd(plan.price, locale)}</span>
          <span className="text-muted-foreground text-sm font-medium">{tPricing('perMonth')}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{tPricing('sarEquivalent', { amount: sarMonthly.toLocaleString(numberLocale) })}</p>
      </div>

      <div className="px-4 flex-1">
        <p className="text-xs font-semibold text-foreground mb-2">{tPricing('scaleEverythingInPro')}</p>
        <ul className="space-y-2">
          {[
            plan.maxPages === null ? tPricing('featurePagesUnlimited') : tPricing('featurePages', { count: plan.maxPages }),
            // Scale tiers all include WhatsApp; hidden until public launch.
            ...(isWhatsAppMarketable() ? [tPricing('featureWhatsApp')] : []),
            tPricing('ecommerceIntegration'),
            tPricing('prioritySupport'),
            tPricing('featurePostRepliesUnlimited'),
          ].map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center icon-bg-emerald">
                <Check className="w-3 h-3 stroke-[3]" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-muted-foreground leading-snug text-start">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-4 px-4 pb-4">
        {isSanctioned ? (
          <SanctionedCtaFallback />
        ) : (
          <Button
            onClick={onSelect}
            loading={loading}
            disabled={isCurrentPlan}
            variant={!isCurrentPlan && !isDowngrade ? 'primary' : 'secondary'}
            className="w-full py-3 text-sm rounded-xl font-bold"
          >
            {isCurrentPlan ? (
              <span className="flex items-center justify-center gap-2">
                <Check className="w-4 h-4" aria-hidden="true" />
                {ctaLabel}
              </span>
            ) : (
              ctaLabel
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}

const ScalePage: NextPageWithLayout<ScalePageProps> = ({ plans }) => {
  const locale = useLocale();
  // Guideline 3.1.1: this page is a paid-plan grid wired to Stripe-hosted
  // checkout, and it ships inside the iOS bundle as a static route. UpgradeCTA
  // hides the links on iOS, but the route itself stays reachable (deep link,
  // restored history), so it must self-gate exactly like /pricing does.
  const iosRedirecting = useIOSPaymentRedirect();
  const tPricing = useTranslations('pricing');
  const { isAuthenticated, user } = useAuthStore();

  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [isSanctioned, setIsSanctioned] = useState(false);
  // Mobile tab state — one card visible at a time, matching the public /pricing
  // page's segmented control (shared PlanTabSelector). Defaults to the first
  // (lower-volume) plan; desktop shows both side by side.
  const [activeTab, setActiveTab] = useState(0);

  // Shared plan-selection flow (same hook as /pricing); scale plans are paid + monthly,
  // so the hook's free-plan / downgrade branches stay dormant here.
  const { changingPlan, handleSelectPlan } = useSelectPlan({ plans, usage, billingInterval: 'month' });

  // Display-side sanctions gate — hide the payment UI for sanctioned regions
  // (the strict, authoritative check still runs again at click time + backend).
  useEffect(() => {
    isUserSanctionedNonBlocking(1000)
      .then((r) => setIsSanctioned(r.sanctioned))
      .catch(() => {
        /* permissive on timeout — the strict check at click time covers it */
      });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    subscriptionApi
      .getUsage({ timeout: 3000 })
      .then((res) => {
        if (res?.data) setUsage(extractObjectData<UsageSummary>(res.data));
      })
      .catch((error) => captureError(error, 'Failed to load usage', { tags: { page: 'pricing-scale' } }));
  }, [isAuthenticated]);

  const currentPlanSlug = usage?.subscription?.plan?.slug;
  const hasActiveSubscription = Boolean(currentPlanSlug);
  const currentPlanPrice = usage?.subscription?.plan?.price ?? 0;

  if (iosRedirecting) return null;

  return (
    <>
      <Head>
        {/* Private/segment page — keep it out of search indexes. */}
        <meta name="robots" content="noindex,nofollow" />
        <title>{tPricing('scaleTitle')}</title>
      </Head>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 landscape:px-6 pt-safe pb-12">
          <div className="text-center pt-8 pb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{tPricing('scaleTitle')}</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-xl mx-auto">{tPricing('scaleSubtitle')}</p>
          </div>

          {/* Plan tabs — mobile only, shared with /pricing. Hidden when only one
              plan loaded (degraded state) — a single tab adds no value. */}
          {plans.length > 1 && (
            <PlanTabSelector
              tabs={plans.map((plan) => ({ key: plan.slug, label: tPricing(plan.slug) }))}
              activeIndex={activeTab}
              onChange={setActiveTab}
              locale={locale}
              ariaLabel={tPricing('planTabs')}
            />
          )}

          {/* Single container: stacked single-cell on mobile (only active card
              visible), side-by-side grid on md+ — same structure as /pricing. */}
          <div className="grid max-w-3xl mx-auto md:grid-cols-2 md:gap-6 md:items-stretch">
            {plans.map((plan, index) => (
              <div
                key={plan.id}
                id={`plan-panel-${plan.slug}`}
                // Completes the WAI-ARIA tabs pattern with the mobile tab in
                // PlanTabSelector (same as /pricing). On md+ the tablist is hidden
                // and these render as plain grid cards.
                role="tabpanel"
                aria-labelledby={`plan-tab-${plan.slug}`}
                className={clsx(
                  'col-start-1 row-start-1 md:col-auto md:row-auto',
                  index !== activeTab && 'hidden md:block',
                )}
              >
                <ScalePlanCard
                  plan={plan}
                  isCurrentPlan={plan.slug === currentPlanSlug}
                  hasActiveSubscription={hasActiveSubscription}
                  currentPlanPrice={currentPlanPrice}
                  isSanctioned={isSanctioned}
                  loading={changingPlan === plan.id}
                  onSelect={() => handleSelectPlan(plan.id)}
                  locale={locale}
                />
              </div>
            ))}
          </div>

          {/* Secondary, intent-framed alternative: a one-time top-up for a one-off
              spike (e.g. a seasonal Eid bump) instead of committing to a bigger
              recurring plan. Kept understated so the recurring cards stay primary.
              Only for signed-in subscribers; hidden for sanctioned regions (the
              CTA itself also self-gates iOS + free plan). */}
          {hasActiveSubscription && !isSanctioned && (
            <div className="text-center mt-6 flex flex-col items-center gap-2">
              <p className="text-sm text-muted-foreground">{tPricing('scaleOneTimeQuestion')}</p>
              <BuyTopUpCTA variant="secondary" size="sm" planSlug={currentPlanSlug} paymentMethod={usage?.subscription?.paymentMethod} marketplaceBilled={!!getMarketplaceBilling(usage)} userEmail={user?.email} />
            </div>
          )}

          <div className="text-center mt-8 text-sm text-muted-foreground">
            <span>{tPricing('scaleContactQuestion')} </span>
            <a
              href={`https://wa.me/${DEFAULT_SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(tPricing('scaleContactQuestion'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 font-semibold hover:underline"
            >
              {tPricing('scaleContactLink')}
            </a>
          </div>
        </div>
      </div>
    </>
  );
};

ScalePage.getLayout = (page: ReactElement) => (
  <DashboardLayout title="Scale plans" isPublic skipTitle>{page}</DashboardLayout>
);

export default ScalePage;

/**
 * ISR: fetch the two hidden high-volume plans by slug at build time. The
 * single-plan endpoint (/plans/:slug) is NOT filtered by isPublic, so hidden
 * plans resolve here while staying off the public /pricing grid.
 */
export const getStaticProps: GetStaticProps<ScalePageProps> = async (ctx) => {
  const { getI18nProps } = await import('@/i18n/getMessages');
  const { PAGE_NAMESPACES } = await import('@/i18n/namespaces');
  // 'topup' is required for the BuyTopUpCTA / TopUpRequestModal rendered on this page;
  // the shared `pricing` namespace set doesn't include it (the public /pricing has no top-up).
  const i18nProps = await getI18nProps(ctx, [...PAGE_NAMESPACES.pricing, 'topup']);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://jawab24.com/api';
  const slugs = ['scale-20k', 'scale-30k'];

  // allSettled (not all): one missing/failed plan must not blank the whole page.
  const settled = await Promise.allSettled(
    slugs.map(async (slug) => {
      const res = await fetch(`${apiUrl}/plans/${slug}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`API ${res.status} for ${slug}`);
      const json = await res.json();
      return json.data as Plan;
    }),
  );
  const plans = settled
    .filter((r): r is PromiseFulfilledResult<Plan> => r.status === 'fulfilled' && Boolean(r.value))
    .map((r) => r.value)
    .sort((a, b) => a.price - b.price);

  // Retry sooner if any plan failed to load (API down, or Stripe IDs not set yet).
  const revalidate = plans.length === slugs.length ? 3600 : 60;
  return {
    props: { plans, ...i18nProps },
    ...(process.env.IS_MOBILE_BUILD !== 'true' ? { revalidate } : {}),
  };
};

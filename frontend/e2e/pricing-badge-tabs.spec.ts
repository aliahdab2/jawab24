import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Pricing page — badge gradient + mobile tab selector.
 *
 * Two regressions this guards:
 *  1. The "Most Popular" badge gradient: the gradient utilities live only in
 *     utils/pricing.ts; if src/utils drops out of the Tailwind content globs
 *     they get purged and the badge renders as transparent (white text on
 *     nothing). A DOM-presence check can't catch that — we assert the computed
 *     background-image actually resolves to a gradient.
 *  2. The mobile segmented tab control: one card visible at a time, switching
 *     on tab click.
 *
 * Plans load via the page's client-side refetch (getStaticProps falls back in
 * dev), so the mocked /api/plans response below is what the cards render from.
 */

const MOCK_PLANS = [
  {
    id: 'plan_starter', slug: 'starter', name: 'Starter', description: 'Starter plan',
    price: 1500, currency: 'USD', interval: 'month', trialDays: 30,
    isActive: true, isDefault: true, maxAiRepliesPerMonth: 500, maxPages: 1,
    maxTemplates: 5, maxRules: 7, maxProducts: 50, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: false,
    ecommerceEnabled: false, regionalPricing: {}, sortOrder: 1,
  },
  {
    id: 'plan_business', slug: 'business', name: 'Business', description: 'Business plan',
    price: 2900, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 2500, maxPages: 2,
    maxTemplates: null, maxRules: null, maxProducts: 200, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: true,
    ecommerceEnabled: true, regionalPricing: {}, sortOrder: 2,
  },
  {
    id: 'plan_pro', slug: 'pro', name: 'Pro', description: 'Pro plan',
    price: 7900, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10000, maxPages: 5,
    maxTemplates: null, maxRules: null, maxProducts: null, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: true,
    ecommerceEnabled: true, regionalPricing: {}, sortOrder: 3,
  },
];

test.describe('Pricing — badge gradient + mobile tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/geo/check*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ sanctioned: false }),
    }));
    await page.route('**/api/subscription/usage**', (route) => route.fulfill({ status: 401 }));
    await page.route('**/api/plans**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: MOCK_PLANS }),
    }));
  });

  test('the Most Popular badge renders a real gradient (not a purged/transparent fill)', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const badge = page.getByText(t('pricing.popular')).first();
    await expect(badge).toBeVisible();

    // The gradient comes from `bg-gradient-to-r from-blue-500 to-brand-500`. If
    // from-blue-500 is purged, background-image collapses to 'none'.
    const backgroundImage = await badge.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backgroundImage).toContain('gradient');
    expect(backgroundImage).not.toBe('none');
  });

  test('mobile: tab selector switches the visible plan card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // The tablist is mobile-only.
    const tablist = page.getByRole('tablist', { name: t('pricing.planTabs') });
    await expect(tablist).toBeVisible();

    // Default-active tab is the popular plan (Business); its card is the visible one.
    const businessTab = page.getByRole('tab', { name: 'Business' });
    await expect(businessTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible();
    // The Pro card shares the same grid cell and is hidden until its tab is active.
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeHidden();

    // Switch to Pro — its card becomes visible, Business hides.
    await page.getByRole('tab', { name: 'Pro' }).click();
    await expect(page.getByRole('tab', { name: 'Pro' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeHidden();
  });
});

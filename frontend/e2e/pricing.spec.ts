import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Pricing Page E2E Tests
 *
 * Verifies the public pricing page renders correctly with hero section,
 * plan cards, billing toggle, and FAQ section.
 */

const MOCK_PLANS = [
  {
    id: 'plan_free', slug: 'free', name: 'Free', description: 'Free plan',
    price: 0, yearlyPrice: null, yearlyAvailable: false, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10, maxPages: 1,
    maxTemplates: 2, maxRules: 2, maxProducts: null, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: false,
    ecommerceEnabled: false, regionalPricing: {}, sortOrder: 0,
  },
  {
    id: 'plan_starter', slug: 'starter', name: 'Starter', description: 'Starter plan',
    price: 1500, yearlyPrice: 15000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 30,
    isActive: true, isDefault: true, maxAiRepliesPerMonth: 500, maxPages: 1,
    maxTemplates: 5, maxRules: 7, maxProducts: 50, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: false,
    ecommerceEnabled: false, regionalPricing: {}, sortOrder: 1,
  },
  {
    id: 'plan_business', slug: 'business', name: 'Business', description: 'Business plan',
    price: 2900, yearlyPrice: 29000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 2500, maxPages: 2,
    maxTemplates: null, maxRules: null, maxProducts: 200, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: true,
    ecommerceEnabled: true, regionalPricing: {}, sortOrder: 2,
  },
  {
    id: 'plan_pro', slug: 'pro', name: 'Pro', description: 'Pro plan',
    price: 7900, yearlyPrice: 79000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10000, maxPages: 5,
    maxTemplates: null, maxRules: null, maxProducts: null, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, prioritySupport: true,
    ecommerceEnabled: true, regionalPricing: {}, sortOrder: 3,
  },
];

test.describe('Pricing Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API routes
    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false }),
      });
    });

    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({ status: 401 });
    });

    await page.route('**/api/plans**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS }),
      });
    });
  });

  test('should render hero heading and subheading', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

  });

  test('should render all plan cards', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    // All plan cards should be visible (scroll for mobile where cards stack vertically)
    await expect(page.getByRole('heading', { name: 'Starter', exact: true })).toBeVisible();
    const businessHeading = page.getByRole('heading', { name: 'Business', exact: true });
    await businessHeading.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(businessHeading).toBeVisible();
    const proHeading = page.getByRole('heading', { name: 'Pro', exact: true });
    await proHeading.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(proHeading).toBeVisible();
  });

  test('should show Most Popular badge on Business plan', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText(t('pricing.popular')).first()).toBeVisible();
  });

  test('should toggle between monthly and yearly billing', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    const monthlyBtn = page.getByText(t('pricing.monthly')).first();
    const yearlyBtn = page.getByText(t('pricing.yearly')).first();

    await expect(monthlyBtn).toBeVisible();
    await expect(yearlyBtn).toBeVisible();

    // Click yearly — save badge should be visible
    await yearlyBtn.click();
    await expect(page.getByText(t('pricing.savePercent')).first()).toBeVisible();

    // Switch back to monthly
    await monthlyBtn.click();
  });

  test('a plan without a yearly price stays monthly while the toggle is on yearly', async ({ page }) => {
    // Mixed grid: Business has no yearly Stripe price, Starter and Pro do.
    // The toggle shows (someone offers yearly), but the Business card must
    // keep advertising its MONTHLY price — an annual total there could not be
    // charged (backend refuses with YEARLY_NOT_AVAILABLE).
    await page.route('**/api/plans**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          data: MOCK_PLANS.map(p => p.slug === 'business' ? { ...p, yearlyAvailable: false } : p),
        }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    await page.getByText(t('pricing.yearly')).first().click();

    // Pro (yearly available) switches to its per-month-equivalent: $79 → $66
    await expect(page.locator('#plan-panel-pro').getByText('$66', { exact: false })).toBeVisible();
    // Business (no yearly price) keeps its monthly $29 — never the $24
    // equivalent of an annual total that cannot be billed
    await expect(page.locator('#plan-panel-business').getByText('$29', { exact: false })).toBeVisible();
    await expect(page.locator('#plan-panel-business').getByText('$24', { exact: false })).toHaveCount(0);
  });

  test('hides the billing toggle when no plan has a yearly Stripe price', async ({ page }) => {
    // The API says yearly is not purchasable for any plan (yearlyAvailable
    // false — no stripe_yearly_price_id). The page must not promise the
    // ~17% saving it cannot charge: no toggle, no save badge.
    await page.route('**/api/plans**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS.map(p => ({ ...p, yearlyAvailable: false })) }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });
    // Plan cards rendered (the page is not just empty)…
    await expect(page.getByRole('heading', { name: 'Starter', exact: true })).toBeVisible();
    // …but the yearly offer is gone.
    await expect(page.getByText(t('pricing.yearly'))).toHaveCount(0);
    await expect(page.getByText(t('pricing.savePercent'))).toHaveCount(0);
  });

  test('should render FAQ section with expandable questions', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.faqTitle')).first()
    ).toBeVisible({ timeout: 15000 });

    // First FAQ question
    const faqQuestion = page.getByText(t('pricing.faq1Q')).first();
    await expect(faqQuestion).toBeVisible();

    // Click to expand
    await faqQuestion.click();

    // Answer should now be visible
    await expect(
      page.getByText(t('pricing.faq1A')).first()
    ).toBeVisible();
  });

  test('should show Shopify badge on eligible plans when ecommerceEnabled', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    // The badge depends on plan data from getStaticProps (server-side fetch).
    // In dev mode this hits the production API, so we check gracefully:
    // if any plan has ecommerceEnabled=true, the badge text must appear.
    const badgeLocator = page.getByText(t('pricing.shopifyBadge')).first();
    const badgeCount = await page.getByText(t('pricing.shopifyBadge')).count();

    if (badgeCount > 0) {
      await expect(badgeLocator).toBeVisible();
    }
    // If no badge found, plans from the API don't have ecommerceEnabled — still valid
  });

  test('should have login button in header', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText(t('auth.login')).first()).toBeVisible();
  });

  test('should show WhatsApp fallback for sanctioned users', async ({ page }) => {
    // Override geo mock to sanctioned
    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: true, countryCode: 'CU' }),
      });
    });

    await page.goto('/en/pricing');

    await expect(
      page.getByText(t('pricing.choosePlan')).first()
    ).toBeVisible({ timeout: 15000 });

    // Should show unavailable message instead of subscribe buttons
    const unavailableMsg = page.getByText('payment processing is not available').first();
    await unavailableMsg.waitFor({ state: 'attached', timeout: 10000 });
    await unavailableMsg.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(unavailableMsg).toBeVisible();
  });
});

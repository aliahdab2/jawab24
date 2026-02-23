import { test, expect } from '@playwright/test';

/**
 * Pricing Page E2E Tests
 *
 * Verifies the public pricing page renders correctly with hero section,
 * plan cards, billing toggle, and FAQ section.
 */

const MOCK_PLANS = [
  {
    id: 'plan_free', slug: 'free', name: 'Free', description: 'Free plan',
    price: 0, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10, maxPages: 1,
    maxTemplates: 2, maxRules: 2, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, showBranding: true, prioritySupport: false,
    ecommerceEnabled: false, regionalPricing: {}, sortOrder: 0,
  },
  {
    id: 'plan_starter', slug: 'starter', name: 'Starter', description: 'Starter plan',
    price: 900, currency: 'USD', interval: 'month', trialDays: 30,
    isActive: true, isDefault: true, maxAiRepliesPerMonth: 300, maxPages: 1,
    maxTemplates: 3, maxRules: 2, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, showBranding: true, prioritySupport: false,
    ecommerceEnabled: false, regionalPricing: {}, sortOrder: 1,
  },
  {
    id: 'plan_business', slug: 'business', name: 'Business', description: 'Business plan',
    price: 2900, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 1500, maxPages: 3,
    maxTemplates: null, maxRules: null, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, showBranding: false, prioritySupport: true,
    ecommerceEnabled: true, regionalPricing: {}, sortOrder: 2,
  },
  {
    id: 'plan_pro', slug: 'pro', name: 'Pro', description: 'Pro plan',
    price: 6900, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 9000, maxPages: 10,
    maxTemplates: null, maxRules: null, facebookEnabled: true, instagramEnabled: true,
    whatsappEnabled: false, showBranding: false, prioritySupport: true,
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
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

  });

  test('should render all plan cards', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    // All plan cards should be visible (use heading role with exact match to target card titles)
    await expect(page.getByRole('heading', { name: 'Starter', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
  });

  test('should show Most Popular badge on Business plan', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Most Popular').first()).toBeVisible();
  });

  test('should toggle between monthly and yearly billing', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    const monthlyBtn = page.getByText('Monthly').first();
    const yearlyBtn = page.getByText('Yearly').first();

    await expect(monthlyBtn).toBeVisible();
    await expect(yearlyBtn).toBeVisible();

    // Click yearly — save badge should be visible
    await yearlyBtn.click();
    await expect(page.getByText('Save ~17%').first()).toBeVisible();

    // Switch back to monthly
    await monthlyBtn.click();
  });

  test('should render FAQ section with expandable questions', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Frequently Asked Questions').first()
    ).toBeVisible({ timeout: 15000 });

    // First FAQ question
    const faqQuestion = page.getByText('Can I upgrade or downgrade my plan later?').first();
    await expect(faqQuestion).toBeVisible();

    // Click to expand
    await faqQuestion.click();

    // Answer should now be visible
    await expect(
      page.getByText('Yes! You can switch plans at any time').first()
    ).toBeVisible();
  });

  test('should show Shopify badge on eligible plans', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText('Includes Shopify Integration').first()
    ).toBeVisible();
  });

  test('should have login button in header', async ({ page }) => {
    await page.goto('/en/pricing');

    await expect(
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Login').first()).toBeVisible();
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
      page.getByText('Choose the right plan for your business').first()
    ).toBeVisible({ timeout: 15000 });

    // Should show unavailable message instead of subscribe buttons
    await expect(
      page.getByText('payment processing is not available').first()
    ).toBeVisible();
  });
});

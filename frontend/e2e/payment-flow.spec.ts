import { test, expect } from '@playwright/test';
import { t } from './i18n';

/**
 * Payment Flow E2E Tests
 *
 * Covers the full subscribe journey: pricing → checkout → Stripe,
 * including sanctions checks, auth redirects, billing portal,
 * and error recovery.
 */

const MOCK_PLANS = [
  {
    id: 'plan_free', slug: 'free', name: 'Free', description: 'Free plan',
    price: 0, yearlyPrice: null, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10, maxPages: 1,
    maxTemplates: 2, maxRules: 2, maxProducts: null, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: true,
    prioritySupport: false, ecommerceEnabled: false, regionalPricing: {}, sortOrder: 0,
  },
  {
    id: 'plan_starter', slug: 'starter', name: 'Starter', description: 'Starter plan',
    price: 1500, yearlyPrice: 15000, currency: 'USD', interval: 'month', trialDays: 30,
    isActive: true, isDefault: true, maxAiRepliesPerMonth: 500, maxPages: 1,
    maxTemplates: 5, maxRules: 7, maxProducts: 50, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: true,
    prioritySupport: false, ecommerceEnabled: false, regionalPricing: {}, sortOrder: 1,
    stripePriceId: 'price_starter_monthly', stripeYearlyPriceId: 'price_starter_yearly',
  },
  {
    id: 'plan_business', slug: 'business', name: 'Business', description: 'Business plan',
    price: 2900, yearlyPrice: 29000, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 2500, maxPages: 2,
    maxTemplates: null, maxRules: null, maxProducts: 200, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: false,
    prioritySupport: true, ecommerceEnabled: true, regionalPricing: {}, sortOrder: 2,
    stripePriceId: 'price_business_monthly', stripeYearlyPriceId: 'price_business_yearly',
  },
  {
    id: 'plan_pro', slug: 'pro', name: 'Pro', description: 'Pro plan',
    price: 7900, yearlyPrice: 79000, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10000, maxPages: 5,
    maxTemplates: null, maxRules: null, maxProducts: null, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: false,
    prioritySupport: true, ecommerceEnabled: true, regionalPricing: {}, sortOrder: 3,
    stripePriceId: 'price_pro_monthly', stripeYearlyPriceId: 'price_pro_yearly',
  },
];

const MOCK_USAGE_WITH_SUBSCRIPTION = {
  aiReplies: { used: 5, limit: 500, percentUsed: 1 },
  subscription: {
    plan: { id: 'plan_starter', slug: 'starter', name: 'Starter', price: 1500 },
    status: 'active',
    currentPeriodEnd: '2026-04-24T00:00:00Z',
  },
};

const MOCK_USAGE_TRIALING = {
  aiReplies: { used: 0, limit: 500, percentUsed: 0 },
  subscription: {
    plan: { id: 'plan_starter', slug: 'starter', name: 'Starter', price: 1500 },
    status: 'trialing',
    currentPeriodEnd: '2026-04-24T00:00:00Z',
    trialEnd: '2026-04-24T00:00:00Z',
  },
};

/* ── Helpers ─────────────────────────────────────────── */

function setupAuthState() {
  localStorage.setItem(
    'auth-storage',
    JSON.stringify({
      state: {
        user: { id: 'user_1', email: 'test@test.com', name: 'Test User', facebookId: 'fb_123' },
        token: 'mock-jwt-token',
        fbToken: 'mock-fb-token',
        isAuthenticated: true,
      },
      version: 0,
    })
  );
  localStorage.setItem(
    'ui-storage',
    JSON.stringify({
      state: { sidebarOpen: true, language: 'en', _hasHydrated: false, isOnboardingVisible: false },
      version: 0,
    })
  );
  localStorage.setItem('jawab24_onboarding_complete', 'true');
}

function setupUnauthState() {
  localStorage.setItem(
    'auth-storage',
    JSON.stringify({
      state: { user: null, token: null, isAuthenticated: false },
      version: 0,
    })
  );
  localStorage.setItem(
    'ui-storage',
    JSON.stringify({ state: { language: 'en', _hasHydrated: false }, version: 0 })
  );
}

/* ── Unauthenticated user → pricing → login redirect ─ */

test.describe('Payment Flow — Unauthenticated', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(setupUnauthState);

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
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

  test('clicking paid plan redirects to login with checkout redirect', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Click the Starter plan CTA (has trial → "Start Free for 30 Days")
    const starterBtn = page.locator('button').filter({ hasText: t('pricing.startTrial') }).first();
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();

    // Should redirect to login with checkout redirect param
    await expect(page).toHaveURL(/\/en\/login/, { timeout: 10000 });
    const url = page.url();
    const redirect = new URL(url).searchParams.get('redirect');
    expect(redirect).toContain('/checkout');
    expect(redirect).toContain('planId=plan_starter');
    expect(redirect).toContain('interval=month');
  });

  test('clicking free plan redirects to login with dashboard redirect', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Free plan button says "Get Started"
    const freeBtn = page.locator('button').filter({ hasText: t('pricing.getStarted') }).first();
    await expect(freeBtn).toBeVisible();
    await freeBtn.click();

    await expect(page).toHaveURL(/\/en\/login/, { timeout: 10000 });
    const redirect = new URL(page.url()).searchParams.get('redirect');
    expect(redirect).toContain('/dashboard');
  });

  test('yearly billing interval is preserved in redirect', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Switch to yearly billing
    const yearlyBtn = page.getByText(t('pricing.yearly')).first();
    await yearlyBtn.click();
    await expect(page.getByText(t('pricing.savePercent')).first()).toBeVisible();

    // Click Business plan subscribe
    const businessBtn = page.locator('button').filter({ hasText: t('pricing.subscribe') }).first();
    await expect(businessBtn).toBeVisible();
    await businessBtn.click();

    await expect(page).toHaveURL(/\/en\/login/, { timeout: 10000 });
    const redirect = new URL(page.url()).searchParams.get('redirect');
    expect(redirect).toContain('interval=year');
  });
});

/* ── Authenticated user — new subscription ────────── */

test.describe('Payment Flow — Authenticated (no subscription)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(setupAuthState);

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
      });
    });

    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { aiReplies: { used: 0, limit: 10, percentUsed: 0 }, subscription: null } }),
      });
    });

    await page.route('**/api/plans**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS }),
      });
    });
  });

  test('clicking paid plan navigates to checkout', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const starterBtn = page.locator('button').filter({ hasText: t('pricing.startTrial') }).first();
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();

    await expect(page).toHaveURL(/\/en\/checkout/, { timeout: 10000 });
    expect(page.url()).toContain('planId=plan_starter');
  });

  test('clicking free plan redirects to dashboard', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const freeBtn = page.locator('button').filter({ hasText: t('pricing.getStarted') }).first();
    await expect(freeBtn).toBeVisible();
    await freeBtn.click();

    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 10000 });
  });
});

/* ── Authenticated user — existing subscription ───── */

test.describe('Payment Flow — Existing Subscriber', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(setupAuthState);

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
      });
    });

    await page.route('**/api/plans**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS }),
      });
    });
  });

  test('current plan button is disabled', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Current plan (Starter) should show a disabled "Current Plan" button
    const currentPlanBtn = page.locator('button').filter({ hasText: t('pricing.currentPlan') }).first();
    await expect(currentPlanBtn).toBeVisible({ timeout: 10000 });
    await expect(currentPlanBtn).toBeDisabled();
  });

  test('upgrade button shows "Upgrade" label', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Business plan ($29) is more expensive than Starter ($15) → "Upgrade"
    await expect(
      page.locator('button').filter({ hasText: t('pricing.upgrade') }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('upgrade click opens billing portal', async ({ page }) => {
    let billingPortalCalled = false;

    // Override catch-all with a single handler that tracks billing portal calls
    await page.unroute('**/api/**');
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/payment/billing-portal')) {
        billingPortalCalled = true;
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ url: 'https://billing.stripe.com/test-portal' }),
        });
      }
      if (url.includes('/geo/check')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ sanctioned: false, country: 'SE' }),
        });
      }
      if (url.includes('/plans')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_PLANS }),
        });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const upgradeBtn = page.locator('button').filter({ hasText: t('pricing.upgrade') }).first();
    await expect(upgradeBtn).toBeVisible({ timeout: 10000 });

    const billingPortalRequest = page.waitForRequest(
      (req) => req.url().includes('/payment/billing-portal'),
      { timeout: 15000 },
    );
    await upgradeBtn.click();
    await billingPortalRequest;
    expect(billingPortalCalled).toBe(true);
  });

  test('downgrade to free shows confirmation dialog', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Free plan button should say "Downgrade"
    const downgradeBtn = page.locator('button').filter({ hasText: t('pricing.downgrade') }).first();
    await expect(downgradeBtn).toBeVisible({ timeout: 10000 });
    await downgradeBtn.click();

    // Confirmation dialog should appear
    await expect(
      page.getByText(t('pricing.downgradeToFreeTitle')).first()
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(t('pricing.downgradeToFreeMessage')).first()
    ).toBeVisible();
  });

  test('trial badge visible on trialing subscription', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_TRIALING }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Should show TRIAL badge on the current plan button
    const trialBadge = page.locator('button').filter({ hasText: /TRIAL/i }).first();
    await expect(trialBadge).toBeVisible({ timeout: 10000 });
  });
});

/* ── Sanctions & geo blocking ─────────────────────── */

test.describe('Payment Flow — Sanctions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(setupUnauthState);

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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

  test('sanctioned user sees unavailable notice instead of subscribe buttons', async ({ page }) => {
    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: true, country: 'CU' }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Should show WhatsApp support link instead of subscribe buttons
    await expect(
      page.getByText(t('payment.unavailable.message')).first()
    ).toBeVisible({ timeout: 10000 });

    // Subscribe buttons should NOT be visible
    await expect(
      page.locator('button').filter({ hasText: t('pricing.subscribe') })
    ).not.toBeVisible();
  });

  test('geo check failure does not block subscribe (uses cache)', async ({ page }) => {
    // First: set up a cached non-sanctioned result (simulating page-load check)
    await page.addInitScript(() => {
      localStorage.setItem('jawab24_geo_check', JSON.stringify({
        sanctioned: false,
        country: 'SE',
        timestamp: Date.now(),
      }));
    });

    // Page-load geo check succeeds (non-blocking)
    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Now make geo check fail for the click-time strict check
    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({ status: 503, body: 'Service Unavailable' });
    });

    // Click subscribe — should still work because cache says not sanctioned
    const starterBtn = page.locator('button').filter({ hasText: t('pricing.startTrial') }).first();
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();

    // Should redirect to login (not silently blocked)
    await expect(page).toHaveURL(/\/en\/login/, { timeout: 10000 });
  });

  test('sanctions block on checkout page shows notice', async ({ page }) => {
    await page.addInitScript(setupAuthState);

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: true, country: 'IR' }),
      });
    });

    await page.route('**/api/plans/plan_business', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[2] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_business');

    await expect(
      page.getByText(t('payment.unavailable.title')).first()
    ).toBeVisible({ timeout: 10000 });
  });
});

/* ── Checkout page ────────────────────────────────── */

test.describe('Payment Flow — Checkout', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(setupAuthState);

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
      });
    });

    await page.route('**/api/auth/profile', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'user_1', email: 'test@test.com', name: 'Test User' }),
      });
    });
  });

  test('renders plan details on checkout page', async ({ page }) => {
    await page.route('**/api/plans/plan_starter', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[1] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=/\\$15/').first()).toBeVisible({ timeout: 10000 });
  });

  test('yearly interval shows yearly price', async ({ page }) => {
    await page.route('**/api/plans/plan_starter', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[1] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_starter&interval=year');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // Yearly price: $150 ($15000 cents / 100)
    await expect(page.locator('text=/\\$150/').first()).toBeVisible({ timeout: 10000 });
  });

  test('continue to payment creates Stripe session', async ({ page }) => {
    let stripeSessionCreated = false;
    let stripeRequestBody: Record<string, unknown> = {};

    await page.route('**/api/plans/plan_business', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[2] }),
      });
    });

    await page.route('**/api/payment/create-checkout-session', async (route) => {
      stripeSessionCreated = true;
      stripeRequestBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/test-session' }),
      });
    });

    await page.goto('/en/checkout?planId=plan_business&interval=month');

    const continueBtn = page.locator('button').filter({ hasText: /Continue to Payment/i }).first();
    await expect(continueBtn).toBeVisible({ timeout: 15000 });

    const stripeRequest = page.waitForRequest(
      (req) => req.url().includes('/create-checkout-session'),
      { timeout: 15000 },
    );
    await continueBtn.click();
    await stripeRequest;
    expect(stripeSessionCreated).toBe(true);
    expect(stripeRequestBody.planId).toBe('plan_business');
    expect(stripeRequestBody.billingInterval).toBe('month');
  });

  test('shows error on checkout session failure', async ({ page }) => {
    await page.route('**/api/plans/plan_business', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[2] }),
      });
    });

    await page.route('**/api/payment/create-checkout-session', async (route) => {
      await route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/en/checkout?planId=plan_business');

    const continueBtn = page.locator('button').filter({ hasText: /Continue to Payment/i }).first();
    await expect(continueBtn).toBeVisible({ timeout: 15000 });
    await continueBtn.click();

    // Button should re-enable after error (not stuck loading)
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    // Page should not show error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('checkout without planId does not crash', async ({ page }) => {
    await page.goto('/en/checkout');
    // Wait for page to settle, then verify no crash
    await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 5000 });
  });

  test('free plan on checkout redirects to dashboard', async ({ page }) => {
    await page.route('**/api/plans/plan_free', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[0] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_free');

    // Free plan should redirect to dashboard
    await expect(page).toHaveURL(/\/en\/dashboard/, { timeout: 10000 });
  });
});

/* ── Billing portal error handling ────────────────── */

test.describe('Payment Flow — Billing Portal Errors', () => {
  /**
   * Sets up a single API route handler for the subscriber pricing page.
   * `billingPortalHandler` controls how /payment/billing-portal responds.
   */
  async function setupSubscriberRoutes(
    page: import('@playwright/test').Page,
    billingPortalHandler: (route: import('@playwright/test').Route) => Promise<void>,
  ) {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/payment/billing-portal')) return billingPortalHandler(route);
      if (url.includes('/geo/check')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ sanctioned: false, country: 'SE' }),
        });
      }
      if (url.includes('/plans')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_PLANS }),
        });
      }
      if (url.includes('/subscription/usage')) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
        });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  }

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));
    await page.addInitScript(setupAuthState);
  });

  test('billing portal failure shows error toast', async ({ page }) => {
    await setupSubscriberRoutes(page, async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const upgradeBtn = page.locator('button').filter({ hasText: t('pricing.upgrade') }).first();
    await expect(upgradeBtn).toBeVisible({ timeout: 10000 });
    await upgradeBtn.click();

    await expect(
      page.getByText(t('pricing.billingPortalError')).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('downgrade confirmation calls billing portal', async ({ page }) => {
    let billingPortalCalled = false;

    await setupSubscriberRoutes(page, async (route) => {
      billingPortalCalled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://billing.stripe.com/test-portal' }),
      });
    });

    // Use desktop viewport to see all plan cards (mobile shows tabs)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    // Free plan shows "Downgrade" for existing subscribers (waits for usage data to load)
    const downgradeBtn = page.locator('button').filter({ hasText: t('pricing.downgrade') }).first();
    await expect(downgradeBtn).toBeVisible({ timeout: 15000 });
    await downgradeBtn.click();

    // Confirmation dialog appears
    await expect(
      page.getByText(t('pricing.downgradeToFreeTitle'))
    ).toBeVisible({ timeout: 10000 });

    const confirmBtn = page.locator('button').filter({ hasText: t('pricing.downgradeToFreeConfirm') }).first();

    const portalRequest = page.waitForRequest(
      (req) => req.url().includes('/payment/billing-portal'),
      { timeout: 15000 },
    );
    await confirmBtn.click();
    await portalRequest;
    expect(billingPortalCalled).toBe(true);
  });
});

/* ── RTL / Arabic ─────────────────────────────────── */

test.describe('Payment Flow — Arabic (RTL)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.warn(`PAGE ERROR: ${err}`));

    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { user: null, token: null, isAuthenticated: false }, version: 0 })
      );
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({ state: { language: 'ar', _hasHydrated: false }, version: 0 })
      );
    });

    await page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/api/geo/check*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sanctioned: false, country: 'SE' }),
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

  test('pricing page renders in Arabic with plan cards', async ({ page }) => {
    await page.goto('/ar/pricing');

    // Plan headings should be visible (Arabic translations of plan names)
    await expect(page.getByRole('heading', { name: /Starter|المبتدئ/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /Business|الأعمال/i }).first()).toBeVisible();
  });

  test('pricing page in Arabic does not crash and shows plan cards', async ({ page }) => {
    await page.goto('/ar/pricing');

    // Wait for plan cards to render
    await expect(page.getByRole('heading', { name: /Starter|المبتدئ/i }).first()).toBeVisible({ timeout: 15000 });

    // Verify buttons are present and not in error state
    const buttons = page.locator('button').filter({ hasText: /.+/ });
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Page should not show error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });
});

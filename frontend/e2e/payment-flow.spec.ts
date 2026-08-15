import { test, expect, Locator } from '@playwright/test';
import { t } from './i18n';

/**
 * Payment Flow E2E Tests
 *
 * Covers the full subscribe journey: pricing → checkout → Stripe,
 * including sanctions checks, auth redirects, billing portal,
 * and error recovery.
 */

/** Scroll a locator into view via JS — works inside overflow containers on mobile. */
async function scrollIntoView(locator: Locator, timeout = 10000) {
  await locator.waitFor({ state: 'attached', timeout });
  await locator.evaluate(el => el.scrollIntoView({ block: 'center' }));
}

const MOCK_PLANS = [
  {
    id: 'plan_free', slug: 'free', name: 'Free', description: 'Free plan',
    price: 0, yearlyPrice: null, yearlyAvailable: false, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 10, maxPages: 1,
    maxTemplates: 2, maxRules: 2, maxProducts: null, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: true,
    prioritySupport: false, ecommerceEnabled: false, regionalPricing: {}, sortOrder: 0,
  },
  {
    id: 'plan_starter', slug: 'starter', name: 'Starter', description: 'Starter plan',
    price: 1500, yearlyPrice: 15000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 30,
    isActive: true, isDefault: true, maxAiRepliesPerMonth: 500, maxPages: 1,
    maxTemplates: 5, maxRules: 7, maxProducts: 50, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: true,
    prioritySupport: false, ecommerceEnabled: false, regionalPricing: {}, sortOrder: 1,
    stripePriceId: 'price_starter_monthly', stripeYearlyPriceId: 'price_starter_yearly',
  },
  {
    id: 'plan_business', slug: 'business', name: 'Business', description: 'Business plan',
    price: 2900, yearlyPrice: 29000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 0,
    isActive: true, isDefault: false, maxAiRepliesPerMonth: 2500, maxPages: 2,
    maxTemplates: null, maxRules: null, maxProducts: 200, facebookEnabled: true,
    instagramEnabled: true, whatsappEnabled: false, showBranding: false,
    prioritySupport: true, ecommerceEnabled: true, regionalPricing: {}, sortOrder: 2,
    stripePriceId: 'price_business_monthly', stripeYearlyPriceId: 'price_business_yearly',
  },
  {
    id: 'plan_pro', slug: 'pro', name: 'Pro', description: 'Pro plan',
    price: 7900, yearlyPrice: 79000, yearlyAvailable: true, currency: 'USD', interval: 'month', trialDays: 0,
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
    hasStripeCustomer: true,
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
    await scrollIntoView(starterBtn);
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();

    // Should redirect to login with checkout redirect param
    await expect(page).toHaveURL(/\/en\/login/, { timeout: 10000 });
    const url = page.url();
    const redirect = new URL(url).searchParams.get('redirect');
    expect(redirect).toContain('/checkout');
    // Plans come from SSG with real UUIDs — assert structure, not specific ID
    expect(redirect).toMatch(/planId=[^&]+/);
    expect(redirect).toContain('interval=month');
  });

  test.skip('clicking free plan redirects to login with dashboard redirect', async ({ page }) => {
    // No free plan in production — all plans require subscription/trial.
    // This test is kept for documentation; unskip if a free plan is re-introduced.
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const freeBtn = page.locator('button').filter({ hasText: t('pricing.getStarted') }).first();
    await scrollIntoView(freeBtn);
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
    await scrollIntoView(starterBtn);
    await expect(starterBtn).toBeVisible();
    await starterBtn.click();

    await expect(page).toHaveURL(/\/en\/checkout/, { timeout: 10000 });
    // Plans come from SSG with real UUIDs — assert structure, not specific ID
    expect(page.url()).toMatch(/planId=[^&]+/);
  });

  test.skip('clicking free plan redirects to dashboard', async ({ page }) => {
    // No free plan in production — all plans require subscription/trial.
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const freeBtn = page.locator('button').filter({ hasText: t('pricing.getStarted') }).first();
    await scrollIntoView(freeBtn);
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
    await scrollIntoView(currentPlanBtn);
    await expect(currentPlanBtn).toBeVisible({ timeout: 5000 });
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

  test('upgrade click calls /payment/change-plan with proration', async ({ page }) => {
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
      });
    });
    // Stub /payment/change-plan so the click resolves cleanly without hitting Stripe.
    await page.route('**/api/payment/change-plan', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const upgradeBtn = page.locator('button').filter({ hasText: t('pricing.upgrade') }).first();
    await scrollIntoView(upgradeBtn);
    await expect(upgradeBtn).toBeVisible({ timeout: 5000 });

    // Active Stripe subscribers now upgrade in-place via subscription.update
    // (proration handled by Stripe). Billing portal is reserved for invoice
    // history + payment method updates only.
    const [changePlanReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/payment/change-plan'), { timeout: 25000 }),
      upgradeBtn.click(),
    ]);
    expect(changePlanReq.method()).toBe('POST');
    const body = changePlanReq.postDataJSON();
    expect(body).toMatchObject({ planId: expect.any(String) });
  });

  test.skip('downgrade to free shows confirmation dialog', async ({ page }) => {
    // No free ($0) plan in production — starter is the cheapest plan, so no "Downgrade"
    // button appears for starter subscribers. Unskip if a free plan is re-introduced.
    await page.route('**/api/subscription/usage**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_USAGE_WITH_SUBSCRIPTION }),
      });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const downgradeBtn = page.locator('button').filter({ hasText: t('pricing.downgrade') }).first();
    await scrollIntoView(downgradeBtn);
    await expect(downgradeBtn).toBeVisible({ timeout: 5000 });
    await downgradeBtn.click();

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
    const unavailableMsg = page.getByText(t('payment.unavailable.message')).first();
    await scrollIntoView(unavailableMsg);
    await expect(unavailableMsg).toBeVisible({ timeout: 5000 });

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
    await scrollIntoView(starterBtn);
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
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/api/plans/plan_starter', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[1] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_starter');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // Target the desktop sidebar price (font-display class on the price container)
    await expect(page.locator('.font-display >> text=/\\$15/').first()).toBeVisible({ timeout: 10000 });
  });

  test('yearly interval shows yearly price', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/api/plans/plan_starter', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[1] }),
      });
    });

    await page.goto('/en/checkout?planId=plan_starter&interval=year');

    await expect(page.locator('h2').filter({ hasText: /Starter/i }).first()).toBeVisible({ timeout: 15000 });
    // Yearly price: $150 ($15000 cents / 100) — target desktop sidebar price
    await expect(page.locator('.font-display >> text=/\\$150/').first()).toBeVisible({ timeout: 10000 });
  });

  // The yearly guard (2026-08-15): ?interval=year on a plan with NO yearly
  // Stripe price must fall back to a plainly-monthly checkout — price, label
  // AND the created intent. The backend refuses billingInterval=year for such
  // a plan (400 YEARLY_NOT_AVAILABLE); before the guard this URL silently
  // subscribed the merchant at the monthly price under a yearly promise.
  test('yearly URL on a plan without a yearly price falls back to a monthly checkout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/api/plans/plan_starter', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { ...MOCK_PLANS[1], yearlyAvailable: false } }),
      });
    });
    // No create-subscription-intent mock on purpose: the beforeEach catchall
    // answers `{}` (no clientSecret), so Stripe Elements never initializes.
    // Fulfilling with a fake secret crashes the page — Stripe.js validates the
    // `${id}_secret_${secret}` shape synchronously and throws into the React
    // error boundary. waitForRequest still observes the request and its body.

    const intentRequest = page.waitForRequest(
      (req) => req.url().includes('/create-subscription-intent'),
      { timeout: 20000 },
    );

    await page.goto('/en/checkout?planId=plan_starter&interval=year');

    // Monthly price shown — never the $150.00 yearly total
    await expect(page.locator('.font-display >> text=/\\$15\\.00/').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.font-display >> text=/\\$150\\.00/')).toHaveCount(0);

    // And the intent actually created bills MONTHLY
    const body = JSON.parse((await intentRequest).postData() || '{}');
    expect(body.planId).toBe('plan_starter');
    expect(body.billingInterval).toBe('month');
  });

  test('embedded checkout session is created automatically', async ({ page }) => {
    await page.route('**/api/plans/plan_business', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_PLANS[2] }),
      });
    });

    // Route exists only to fulfill the response — assertions read the request
    // object from waitForRequest below. Asserting via flags set inside the
    // route handler is racy: under the serial full-suite run the request can
    // be observed by waitForRequest while this handler loses the interception
    // race, leaving the flag false (flaked pre-deploy on 2026-06-12).
    await page.route('**/api/payment/create-subscription-intent', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ clientSecret: 'pi_test_123_secret', type: 'payment', subscriptionId: 'sub_test_123' }),
      });
    });

    // Start waiting for the request BEFORE navigating (session fires automatically on load)
    const stripeRequest = page.waitForRequest(
      (req) => req.url().includes('/create-subscription-intent'),
      { timeout: 20000 },
    );

    await page.goto('/en/checkout?planId=plan_business&interval=month');
    const sessionRequest = await stripeRequest;

    const stripeRequestBody = JSON.parse(sessionRequest.postData() || '{}');
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

    await page.route('**/api/payment/create-subscription-intent', async (route) => {
      await route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/en/checkout?planId=plan_business');

    // Session creation is automatic — error should show without clicking any button
    await expect(page.locator('[class*="alert-error"]').first()).toBeVisible({ timeout: 15000 });
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

test.describe('Payment Flow — Plan Change Errors', () => {
  /**
   * Sets up a single API route handler for the subscriber pricing page.
   * `changePlanHandler` controls how /payment/change-plan responds — that's
   * the endpoint the upgrade button hits for active Stripe subscribers.
   */
  async function setupSubscriberRoutes(
    page: import('@playwright/test').Page,
    changePlanHandler: (route: import('@playwright/test').Route) => Promise<void>,
  ) {
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/payment/change-plan')) return changePlanHandler(route);
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

  test('change-plan failure shows error toast', async ({ page }) => {
    await setupSubscriberRoutes(page, async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const upgradeBtn = page.locator('button').filter({ hasText: t('pricing.upgrade') }).first();
    await expect(upgradeBtn).toBeVisible({ timeout: 10000 });

    // Click until the app responds, rather than once and hope.
    //
    // `toBeVisible()` is satisfied by SERVER-RENDERED html, which exists before React has
    // hydrated and attached this button's onClick. A single click in that window lands on
    // inert markup: no request, no toast, and a 10s wait on an element that will never
    // appear. Reproduced at ~1 in 25 runs under load (`--repeat-each=25 --workers=6`) — it
    // is what made this spec the repeat offender in full-suite runs while passing in
    // isolation, where hydration wins the race every time.
    //
    // This is not a retry-until-green wrapper: the assertion inside is the real one, and a
    // genuinely broken plan-change still fails after the retry window. It encodes what a
    // user does when a button does nothing — press it again. Safe here because the route is
    // mocked to 500, so a repeated click cannot double-submit anything real.
    await expect(async () => {
      await upgradeBtn.click();
      await expect(page.getByText(t('pricing.planChangeError')).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
  });

  test.skip('downgrade confirmation calls billing portal', async ({ page }) => {
    // No free ($0) plan in production — downgrade-to-free flow untestable without it.
    // Unskip if a free plan is re-introduced.
    let billingPortalCalled = false;

    await setupSubscriberRoutes(page, async (route) => {
      billingPortalCalled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://billing.stripe.com/test-portal' }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/pricing');
    await expect(page.getByText(t('pricing.choosePlan')).first()).toBeVisible({ timeout: 15000 });

    const downgradeBtn = page.locator('button').filter({ hasText: t('pricing.downgrade') }).first();
    await expect(downgradeBtn).toBeVisible({ timeout: 15000 });
    await downgradeBtn.click();

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
